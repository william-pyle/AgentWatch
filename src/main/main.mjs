import { app, BrowserWindow, ipcMain, protocol, net, session, dialog, shell, utilityProcess, Menu } from 'electron';
import updaterPackage from 'electron-updater';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { ThemeStore } from './themes.mjs';
import { atomicJson, json, checkedFile } from './files.mjs';
import { safeId, safePath, ACTIONS } from '../shared/theme.mjs';
import { AppUpdates } from './updater.mjs';
import { LayoutStore } from './layouts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const smoke = process.argv.includes('--smoke-test');
if (smoke && process.env.AGENT_WATCH_TEST_DATA) app.setPath('userData', process.env.AGENT_WATCH_TEST_DATA);
app.setName('Agent Watch');
protocol.registerSchemesAsPrivileged([{ scheme: 'aw', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window, worker, themeStore, layoutStore, settings, updates, closing = false;
  let snapshot = { generatedAt: null, agents: [], events: [] }, collectorError = null;
  let checking = null, settingsWrites = Promise.resolve();
  const broadcast = value => { if (window && !window.isDestroyed()) window.webContents.send('agent-watch:change', value); };
  const persist = () => { settingsWrites = settingsWrites.catch(() => {}).then(() => atomicJson(path.join(app.getPath('userData'), 'settings.json'), settings)); return settingsWrites; };
  async function state() {
    let theme;
    try { theme = await themeStore.read(settings.theme); }
    catch { settings.theme = 'datacenter'; theme = await themeStore.read('datacenter'); }
    const layout = await layoutStore.state(theme);
    return { settings, baseTheme: theme, theme: layout.theme, layout: { revision: layout.revision, baseRevision: layout.baseRevision, modified: layout.modified, warnings: layout.warnings }, themes: await themeStore.list(), catalog: themeStore.catalog, themeStatus: themeStore.status, update: updates.state, snapshot, collectorError, version: app.getVersion(), fullscreen: window?.isFullScreen() || false };
  }
  function startCollector() {
    if (worker) { worker.removeAllListeners(); worker.kill(); worker = null; }
    snapshot = { generatedAt: null, agents: [], events: [] }; collectorError = null;
    if (!settings.project || smoke && !process.argv.includes('--observe-fixtures')) return;
    const current = utilityProcess.fork(path.join(root, 'src/main/collector-worker.mjs'), [JSON.stringify({ repo: settings.project, providers: settings.providers })], { serviceName: 'Agent Watch local observer', stdio: 'ignore' });
    worker = current;
    current.on('message', message => {
      if (worker !== current) return;
      if (message.type === 'snapshot') { snapshot = message.data; collectorError = null; broadcast({ snapshot, collectorError }); }
      else { collectorError = message.message; broadcast({ collectorError }); }
    });
    current.on('exit', () => { if (worker === current && !closing) { collectorError = 'The observer stopped. Select the project again to reconnect.'; broadcast({ collectorError }); } });
  }
  async function checkAll() {
    if (checking) return checking;
    checking = (async () => {
      const appCheck = updates.check();
      try {
        await themeStore.refresh(); broadcast({ themeStatus: themeStore.status });
        if (settings.autoUpdateThemes) {
          themeStore.status = { state: 'updating', message: 'Checking installed themes for changes…' };
          broadcast({ themeStatus: themeStore.status });
          const results = await themeStore.updateInstalled();
          const errors = results.filter(x => x.error);
          themeStore.status = { state: errors.length ? 'error' : 'ready', message: errors.length ? errors.map(x => x.error).join(' ') : `Themes are current${results.some(x => x.changed) ? ' · updates installed' : ''}.`, checkedAt: new Date().toISOString() };
        }
      } catch { /* Cached and bundled themes stay usable offline. */ }
      await appCheck; broadcast({ refresh: true });
    })().finally(() => { checking = null; });
    return checking;
  }
  app.whenReady().then(async () => {
  app.setAppUserModelId('com.williampyle.agentwatch');
  const saved = await json(path.join(app.getPath('userData'), 'settings.json'), {});
  settings = { theme: safeId(saved.theme) ? saved.theme : 'datacenter', project: typeof saved.project === 'string' ? saved.project : null,
    providers: Array.isArray(saved.providers) ? saved.providers.filter(x => ['Codex', 'Claude'].includes(x)) : ['Codex', 'Claude'],
    autoUpdateThemes: saved.autoUpdateThemes !== false, reducedMotion: saved.reducedMotion === true,
    activityOverrides: saved.activityOverrides && typeof saved.activityOverrides === 'object' ? saved.activityOverrides : {},
    characterAssignments: saved.characterAssignments && typeof saved.characterAssignments === 'object' ? saved.characterAssignments : {} };
  themeStore = new ThemeStore({ bundled: app.isPackaged ? path.join(process.resourcesPath, 'themes') : path.join(root, 'themes'), data: app.getPath('userData') });
  await themeStore.init();
  layoutStore = new LayoutStore(app.getPath('userData'));
  updates = new AppUpdates(updaterPackage.autoUpdater, { packaged: app.isPackaged && !smoke, version: app.getVersion(), changed: update => broadcast({ update }) });
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  protocol.handle('aw', async request => {
    try {
      const url = new URL(request.url), relative = decodeURIComponent(url.pathname.slice(1));
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      let file;
      if (url.hostname === 'app' && /^(?:renderer|shared)\/[a-z0-9-]+\.(?:html|mjs|css)$/.test(relative)) file = await checkedFile(path.join(root, 'src'), relative);
      else if (url.hostname === 'app' && relative.startsWith('theme/')) {
        const [, id, ...parts] = relative.split('/'), asset = parts.join('/');
        if (!safeId(id) || !safePath(asset) || asset.endsWith('.json')) throw Error('Invalid image.');
        file = await checkedFile(await themeStore.location(id), asset);
      } else return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href);
      const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': 'aw://app' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  const handle = (name, fn) => ipcMain.handle(`agent-watch:${name}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'aw://app/renderer/index.html') throw Error('Untrusted application request.');
    return fn(...args);
  });
  handle('state', state);
  handle('set-fullscreen', active => {
    if (typeof active !== 'boolean') throw Error('Invalid fullscreen state.');
    window.setFullScreen(active);
    return window.isFullScreen();
  });
  handle('save-layout', async (id, draft, expected) => {
    if (id !== settings.theme) throw Error('Reopen the editor for the selected theme.');
    await layoutStore.save(await themeStore.read(id), draft, expected); return state();
  });
  handle('choose-project', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose the project to watch', properties: ['openDirectory'] });
    if (!result.canceled) { settings.project = result.filePaths[0]; await persist(); startCollector(); }
    return state();
  });
  handle('settings', async patch => {
    if (!patch || typeof patch !== 'object') throw Error('Invalid settings.');
    for (const k of ['autoUpdateThemes', 'reducedMotion']) if (typeof patch[k] === 'boolean') settings[k] = patch[k];
    if (patch.providers) {
      if (!Array.isArray(patch.providers) || patch.providers.some(x => !['Codex', 'Claude'].includes(x))) throw Error('Invalid providers.');
      settings.providers = [...new Set(patch.providers)]; startCollector();
    }
    const theme = await themeStore.read(settings.theme);
    if (patch.activityOverrides) {
      if (Object.keys(patch.activityOverrides).length > 100 || Object.entries(patch.activityOverrides).some(([action, activity]) => !(ACTIONS.includes(action) || /^tool:[\w.:/-]{1,120}$/.test(action)) || !Object.hasOwn(theme.activities, activity))) throw Error('Invalid activity mapping.');
      settings.activityOverrides[theme.id] = patch.activityOverrides;
    }
    if (patch.characterAssignments) {
      if (Object.keys(patch.characterAssignments).length > 500 || Object.entries(patch.characterAssignments).some(([id, character]) => id.length > 200 || !theme.characters.some(c => c.id === character))) throw Error('Invalid character assignment.');
      settings.characterAssignments[theme.id] = patch.characterAssignments;
    }
    await persist(); return state();
  });
  handle('catalog', async () => { await themeStore.refresh(); return state(); });
  handle('install-theme', async id => { await themeStore.install(id); return state(); });
  handle('select-theme', async id => { await themeStore.read(id); settings.theme = id; await persist(); return state(); });
  handle('clone-theme', async id => {
    const effective = await layoutStore.state(await themeStore.read(id));
    settings.theme = await themeStore.importFolder(await themeStore.location(id));
    const base = await themeStore.read(settings.theme), initial = await layoutStore.state(base);
    await layoutStore.save(base, { ...effective.theme, id: base.id }, initial);
    await persist(); return state();
  });
  handle('import-theme', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Import a folder containing theme.json', properties: ['openDirectory'] });
    if (!result.canceled) { settings.theme = await themeStore.importFolder(result.filePaths[0]); await persist(); }
    return state();
  });
  handle('save-theme', async theme => { await themeStore.savePersonal(settings.theme, theme); return state(); });
  handle('replace-image', async relative => {
    const ext = path.extname(relative).slice(1);
    const result = await dialog.showOpenDialog(window, { title: 'Choose a replacement image', filters: [{ name: ext.toUpperCase(), extensions: [ext] }], properties: ['openFile'] });
    if (!result.canceled) await themeStore.replaceImage(settings.theme, relative, result.filePaths[0]);
    return state();
  });
  handle('open-theme', async () => { await shell.openPath(await themeStore.location(settings.theme)); });
  handle('check-updates', async () => { await checkAll(); return state(); });
  handle('install-update', () => { closing = true; updates.install(); });
  handle('open-guide', () => shell.openPath(path.join(app.isPackaged ? process.resourcesPath : root, 'docs/guide.html')));
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 980, minHeight: 680, show: !smoke,
    backgroundColor: '#101a18', title: 'Agent Watch', icon: path.join(root, 'build/icon.ico'),
    webPreferences: { preload: path.join(root, 'src/main/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false, ...(smoke ? { offscreen: true, backgroundThrottling: false } : {}) } });
  Menu.setApplicationMenu(null);
  for (const event of ['enter-full-screen', 'leave-full-screen']) window.on(event, () => broadcast({ fullscreen: window.isFullScreen() }));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  await window.loadURL('aw://app/renderer/index.html');
  if (settings.project && !await stat(settings.project).then(s => s.isDirectory()).catch(() => false)) settings.project = null;
  startCollector();
  if (!smoke) void checkAll();
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.show(); window.focus(); });
  app.on('before-quit', () => { closing = true; if (worker) worker.kill(); });
  app.on('window-all-closed', () => app.quit());
  }).catch(error => { console.error('Agent Watch could not start:', error); if (!smoke) dialog.showErrorBox('Agent Watch could not start', error.message); app.exit(1); });
}
