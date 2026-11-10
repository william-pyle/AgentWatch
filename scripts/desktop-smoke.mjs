import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ThemeStore } from '../src/main/themes.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(root, '.test-output'), { recursive: true });
const data = await mkdtemp(path.join(root, '.test-output/desktop-'));
const store = new ThemeStore({ bundled: path.join(root, 'themes'), data }); await store.init();
await store.importFolder(path.join(root, 'themes/village'), 'village-test');
await store.importFolder(path.join(root, 'themes/orbital'), 'orbital-test');
const env = { ...process.env, AGENT_WATCH_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: process.env.AGENT_WATCH_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe'), args: process.env.AGENT_WATCH_TEST_EXE ? ['--smoke-test'] : [root, '--smoke-test'], env, timeout: 45000 });
const errors = [];
try {
  const page = await application.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.waitForURL('aw://app/renderer/index.html');
  await page.waitForSelector('#scene[data-ready="true"]', { timeout: 60000 });
  assert.equal(await page.locator('#scene').getAttribute('data-theme'), 'datacenter');
  await page.waitForSelector('.agent-card');
  assert.equal(await page.locator('.agent-card').count(), 6);
  await page.waitForFunction(() => [...document.querySelectorAll('.agent-card p')].every(p => !p.textContent.includes('Arriving')));
  const floorPixel = await page.evaluate(() => {
    const c = document.getElementById('scene'), r = c.getBoundingClientRect(), s = Math.min(r.width / 1450, r.height / 1050);
    const x = (r.width / 2 + (485 - 725) * s) * c.width / r.width, y = (r.height / 2 + (378 - 525) * s) * c.height / r.height;
    return [...c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data];
  });
  assert.ok(floorPixel[0] > 130, `Raised floor tiles must render: ${floorPixel}`);
  await page.screenshot({ path: path.join(root, '.test-output/datacenter.png') });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  await page.locator('[data-view="themes"]').click();
  await page.locator('#installed-themes .theme-card').filter({ hasText: 'Mooseville' }).getByRole('button', { name: 'Use theme' }).click();
  await page.waitForFunction(() => document.querySelector('#scene').dataset.theme === 'village-test', null, { timeout: 60000 });
  await page.locator('[data-view="monitor"]').click();
  await page.screenshot({ path: path.join(root, '.test-output/village.png') });
  await page.locator('[data-view="themes"]').click();
  await page.locator('#installed-themes .theme-card').filter({ hasText: 'Orbital Station' }).getByRole('button', { name: 'Use theme' }).click();
  await page.waitForFunction(() => document.querySelector('#scene').dataset.theme === 'orbital-test');
  await page.locator('[data-view="monitor"]').click();
  await page.screenshot({ path: path.join(root, '.test-output/orbital.png') });
  await page.locator('[data-view="themes"]').click();
  await page.locator('#installed-themes .theme-card').filter({ hasText: 'Robot Datacenter' }).getByRole('button', { name: 'Use theme' }).click();
  await page.waitForFunction(() => document.querySelector('#scene').dataset.theme === 'datacenter');
  await page.locator('[data-view="studio"]').click();
  await page.locator('#binding-build').selectOption('print'); await page.locator('#save-bindings').click();
  assert.equal(await page.locator('#binding-build').inputValue(), 'print');
  await page.locator('#clone-theme').click();
  await page.waitForSelector('#theme-editor:not([hidden])');
  const theme = JSON.parse(await page.locator('#theme-json').inputValue()); theme.id = 'wrong-id';
  await page.locator('#theme-json').fill(JSON.stringify(theme)); await page.locator('#save-theme').click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('ID unchanged'));
  await page.locator('[data-view="settings"]').click(); await page.locator('#reduced-motion').check();
  await page.waitForFunction(() => document.querySelector('#reduced-motion').checked);
  await page.screenshot({ path: path.join(root, '.test-output/settings.png') });
  const state = await page.evaluate(() => window.agentWatch.state());
  assert.equal(state.settings.reducedMotion, true);
  assert.equal(state.settings.activityOverrides.datacenter.build, 'print');
  assert.equal(state.update.status, 'development');
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, '.test-output/desktop-results.json'), JSON.stringify({ passed: true, themes: 3, robotResidents: 6, themeSwitching: true, personalCopy: true, invalidSaveRejected: true, activityOverridePersisted: true, reducedMotion: true, contextIsolation: true, errors }, null, 2));
  console.log('Desktop smoke passed: robot scene, all themes, personal copies, activity overrides, validation, settings and renderer isolation.');
} catch (error) {
  console.error('Smoke failure:', error.message);
  const page = await application.firstWindow();
  console.error('Renderer errors:', errors); console.error('Visible text:', (await page.locator('body').innerText().catch(() => '')).slice(-3000));
  await page.screenshot({ path: path.join(root, '.test-output/failure.png'), timeout: 3000 }).catch(() => {}); throw error;
} finally { await application.close(); }

// Verify the real Electron utility process reads fixtures and sends metadata only.
const observerData = await mkdtemp(path.join(root, '.test-output/observer-'));
const project = path.join(observerData, 'project'), codex = path.join(observerData, 'codex');
await mkdir(project, { recursive: true }); await mkdir(path.join(codex, 'sessions/2026/11/09'), { recursive: true });
const at = new Date().toISOString();
const records = [
  { type: 'session_meta', timestamp: at, payload: { id: 'fixture-agent', cwd: project, timestamp: at } },
  { type: 'event_msg', timestamp: at, payload: { type: 'task_started' } },
  { type: 'response_item', timestamp: at, payload: { type: 'custom_tool_call', name: 'apply_patch', input: 'PRIVATE-FIXTURE-COMMAND' } },
  { type: 'response_item', timestamp: at, payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'PRIVATE-FIXTURE-COMMENTARY' }] } }
];
await writeFile(path.join(codex, 'sessions/2026/11/09/session.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
await writeFile(path.join(observerData, 'settings.json'), JSON.stringify({ project, providers: ['Codex'], theme: 'datacenter' }));
const observerEnv = { ...env, AGENT_WATCH_TEST_DATA: observerData, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: path.join(observerData, 'claude') };
const observer = await electron.launch({ executablePath: process.env.AGENT_WATCH_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(process.env.AGENT_WATCH_TEST_EXE ? [] : [root]), '--smoke-test', '--observe-fixtures'], env: observerEnv });
try {
  const page = await observer.firstWindow(); await page.waitForURL('aw://app/renderer/index.html');
  let state;
  for (let attempt = 0; attempt < 40; attempt++) { state = await page.evaluate(() => window.agentWatch.state()); if (state.snapshot.agents.length === 1) break; await new Promise(resolve => setTimeout(resolve, 500)); }
  assert.equal(state.snapshot.agents.length, 1, state.collectorError || 'Fixture agent must be observed.');
  assert.equal(state.snapshot.agents[0].state, 'working'); assert.equal(state.snapshot.agents[0].toolName, 'apply_patch');
  assert.equal(state.snapshot.events[0].kind, 'build'); assert.doesNotMatch(JSON.stringify(state.snapshot), /PRIVATE-FIXTURE/);
  const resultsFile = path.join(root, '.test-output/desktop-results.json');
  const results = JSON.parse(await readFile(resultsFile)); results.utilityProcessObservation = true; results.transcriptExcluded = true;
  await writeFile(resultsFile, JSON.stringify(results, null, 2)); console.log('Utility-process fixture observation passed; commands and commentary excluded from the desktop feed.');
} finally { await observer.close(); }
