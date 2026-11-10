import { Scene, assetUrl } from './scene.mjs';
import { ACTIONS, themeFiles } from '../shared/theme.mjs';
import { WorldEditor } from './editor.mjs';
const api = window.agentWatch, $ = id => document.getElementById(id);
const make = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const clear = element => element.replaceChildren();
let current, preview, loadedTheme = '', view = 'monitor', noticeTimer, fullscreen = false, returnView = 'monitor';
const scene = new Scene($('scene'), id => { scene.selected = id; renderRoster(); });
const editor = new WorldEditor(scene, () => current, (...args) => api.saveLayout(...args), async next => run(null, async () => applyState(next || await api.state(), true)), notify);
const labels = { started: 'Starting work', build: 'Editing / building', read: 'Reading', research: 'Researching', review: 'Reviewing / testing', delegate: 'Delegating', message: 'Sending a message', coordinate: 'Coordinating', tool: 'Using a tool', wait: 'Waiting on a tool', update: 'Reporting progress', completed: 'Turn finished', interrupted: 'Interrupted', working: 'Working', waiting: 'Awaiting your answer', quiet: 'Quiet', idle: 'Idle', unknown: 'Unconfirmed' };
function notify(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500); }
async function run(button, action) {
  if (button) button.disabled = true;
  try { await action(); } catch (error) { notify(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  finally { if (button) button.disabled = false; }
}
function on(id, action) { $(id).addEventListener('click', event => run(event.currentTarget, action)); }
function demoSnapshot() {
  const index = Math.floor(Date.now() / 14000), kinds = ['build', 'research', 'review', 'read', 'tool', 'completed'];
  const names = ['Controller', 'Implementation', 'Research', 'Validation', 'Documentation', 'Maintenance'];
  const agents = current.theme.characters.map((c, i) => ({ id: `preview-${i}`, name: names[i] || 'Theme resident', provider: i % 2 ? 'Claude' : 'Codex', role: i === 0 ? 'coordinator' : 'delegate', state: i === 0 ? 'working' : i === 5 ? 'idle' : kinds[(index + i) % kinds.length] === 'completed' ? 'completed' : 'working', action: '', tools: 0, turns: 0, lastSeen: new Date().toISOString(), observed: false }));
  const events = agents.map((a, i) => ({ id: `${index}-${i}`, agentId: a.id, at: new Date(Math.floor(Date.now() / 14000) * 14000).toISOString(), kind: i === 0 ? ['coordinate', 'research', 'message', 'build'][index % 4] : kinds[(index + i) % kinds.length] }));
  return { agents, events, generatedAt: new Date().toISOString() };
}
function observed() { return preview ? demoSnapshot() : current.snapshot; }
async function applyState(next, force = false) {
  // Startup checks may finish while a draft is open. Keep the draft and its save revision.
  if (editor.active) return;
  current = next;
  setFullscreen(!!current.fullscreen);
  if (preview === undefined) preview = !current.settings.project;
  const key = JSON.stringify(current.theme);
  if (force || loadedTheme !== key) {
    $('scene-loading').hidden = false;
    $('scene-loading').textContent = 'Loading theme artwork…';
    for (const [key, value] of Object.entries(current.theme.palette)) document.documentElement.style.setProperty(`--${key}`, value);
    $('brand-logo').src = assetUrl(current.theme.id, current.theme.logo);
    try { await scene.load(current.theme); loadedTheme = key; $('scene-loading').hidden = true; }
    catch (error) { $('scene-loading').textContent = `Could not load this theme: ${error.message}`; throw error; }
  }
  $('scene-title').textContent = current.theme.name;
  document.querySelector('[data-view="monitor"]').lastChild.textContent = current.theme.id === 'datacenter' ? ' Datacenter' : ' Workspace';
  $('app-version').textContent = `Agent Watch for Windows · ${current.version}`;
  $('project-label').textContent = current.settings.project || 'Choose a project to bring your agents into this workspace.';
  renderSettings(); renderThemes(); renderStudio(); updateMonitor();
  if (current.layout.warnings.length) notify(current.layout.warnings.join(' '));
}
function updateMonitor() {
  if (!current || !scene.theme) return;
  const data = observed(); scene.update(data, current.settings);
  $('preview-toggle').textContent = preview ? 'Back to live' : 'Preview activities';
  const stale = !preview && data.generatedAt && Date.now() - Date.parse(data.generatedAt) > 15000;
  $('feed-status').textContent = preview ? 'Preview · sample activity' : current.collectorError ? 'Observer disconnected' : stale ? 'Observations are stale' : current.settings.project ? 'Live · local observation' : 'No project selected';
  $('scene-summary').textContent = `${data.agents.length} ${preview ? 'residents' : 'agents'} · ${data.agents.filter(a => a.state === 'working').length} working`;
  $('scene-caption').textContent = preview ? 'Preview residents · no agent activity is being reported' : current.collectorError || (stale ? 'Last observations are no longer current' : 'Local activity · last 24 hours');
  $('activity-context').textContent = preview ? 'Sample actions show how this theme responds.' : 'Observed actions, with no transcript content.';
  renderRoster(); renderTimeline();
}
function renderRoster() {
  if (!current || !scene.theme) return;
  const data = observed(); $('team-count').textContent = data.agents.length; $('empty-roster').hidden = data.agents.length > 0;
  const cards = new Map([...$('roster').children].map(c => [c.dataset.agentId, c]));
  const ids = new Set(data.agents.map(a => a.id)); for (const [id, card] of cards) if (!ids.has(id)) card.remove();
  for (const a of data.agents) {
    const actor = scene.actors.get(a.id); if (!actor) continue;
    let card = cards.get(a.id);
    if (!card) {
      card = make('div', undefined, 'agent-card'); card.dataset.agentId = a.id; card.tabIndex = 0; card.setAttribute('role', 'button');
      const body = make('div'), title = make('div', undefined, 'agent-title'); title.append(make('strong'), make('span', '', 'agent-state'));
      body.append(title, make('div', '', 'agent-name'), make('p'), make('div', '', 'agent-meta')); const portrait = make('img', undefined, 'portrait'); portrait.alt = ''; card.append(portrait, body); $('roster').append(card);
      const select = () => { scene.selected = a.id; renderRoster(); }; card.addEventListener('click', select); card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
    }
    card.classList.toggle('selected', scene.selected === a.id); card.setAttribute('aria-label', `${actor.character.name}: ${a.name}`);
    const thumbnailKey = `${scene.generation}:${actor.character.id}`;
    if (card.dataset.thumbnail !== thumbnailKey) { const canvas = document.createElement('canvas'); scene.thumbnail(canvas, actor.character.id); card.querySelector('.portrait').src = canvas.toDataURL(); card.dataset.thumbnail = thumbnailKey; }
    card.querySelector('strong').textContent = actor.character.name; card.querySelector('.agent-state').textContent = labels[a.state] || a.state; card.querySelector('.agent-name').textContent = a.name;
    card.querySelector('p').textContent = current.theme.activities[actor.activityId]?.label || 'Arriving in the workspace';
    card.querySelector('.agent-meta').textContent = `${preview ? 'Preview' : a.provider} · ${a.role === 'coordinator' ? 'Controller' : preview ? 'Resident' : `${a.tools || 0} tool calls`}`;
  }
}
function renderTimeline() {
  clear($('timeline')); const data = observed();
  for (const event of data.events.slice(0, 4)) {
    const actor = scene.actors.get(event.agentId), item = make('div', undefined, 'event');
    item.append(make('strong', actor?.character.name || 'Agent'), make('p', labels[event.kind] || event.kind), make('small', preview ? 'Sample activity' : new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))); $('timeline').append(item);
  }
  if (!data.events.length) $('timeline').append(make('p', 'Activity will appear here when a local agent starts working.'));
}
function renderThemes() {
  clear($('installed-themes')); clear($('catalog-themes'));
  $('catalog-status').textContent = current.themeStatus.message;
  function card(t, installed, available) {
    const c = make('article', undefined, 'theme-card'), preview = make('div', undefined, 'theme-preview');
    if (installed && !t.error) { const img = make('img'); img.src = assetUrl(t.id, t.preview); img.alt = `${t.name} preview`; preview.append(img); }
    else preview.append(make('span', ({ village: 'Woodland', datacenter: 'Robots', orbital: 'Orbit', smurfs: 'Smurfs' })[t.id] || t.name, 'theme-symbol'));
    c.append(preview); const content = make('div', undefined, 'theme-content'); content.append(make('h2', t.name), make('p', t.error || t.description));
    const meta = make('div', undefined, 'theme-meta'); meta.append(make('small', t.personal ? 'Personal · kept on this computer' : `${t.bundled ? 'Included · ' : ''}v${t.version}`));
    const active = current.settings.theme === t.id;
    const button = make('button', installed ? active ? 'In use' : 'Use theme' : available ? 'Update theme' : 'Download theme');
    button.disabled = !!t.error || installed && active;
    button.addEventListener('click', () => run(button, async () => {
      if (installed) await applyState(await api.selectTheme(t.id));
      else { button.textContent = 'Downloading…'; await applyState(await api.installTheme(t.id)); notify(`${t.name} is installed. Choose it above to use it.`); }
    })); meta.append(button); content.append(meta); c.append(content); return c;
  }
  for (const t of current.themes) $('installed-themes').append(card(t, true));
  for (const t of current.catalog.themes) {
    const installed = current.themes.find(i => i.id === t.id && !i.error);
    if (!installed || installed.revision !== t.revision && !installed.personal) $('catalog-themes').append(card(t, false, !!installed));
  }
  if (!$('catalog-themes').children.length) $('catalog-themes').append(make('p', current.catalog.themes.length ? 'All available themes are installed and current.' : 'Refresh the catalog to browse themes from GitHub. The included theme works offline.'));
}
function activitySelect(value) {
  const select = make('select');
  for (const [id, activity] of Object.entries(current.theme.activities)) { const o = make('option', activity.label); o.value = id; select.append(o); }
  select.value = value; return select;
}
function bindingField(action, value) {
  const field = make('div', undefined, 'field'), label = make('label', labels[action] || action), select = activitySelect(value);
  select.id = `binding-${action.replace(/[^a-zA-Z0-9-]/g, '-')}`; label.htmlFor = select.id; select.dataset.action = action;
  field.append(label, select); $('bindings').append(field);
}
function renderStudio() {
  const t = current.theme, personal = current.themes.find(x => x.id === t.id)?.personal;
  $('studio-description').textContent = `Editing ${t.name} · ${personal ? 'personal copy' : 'installed theme'}`;
  clear($('bindings'));
  const overrides = current.settings.activityOverrides[t.id] || {}, bindings = { ...t.bindings, ...overrides };
  for (const action of [...ACTIONS.filter(a => !['quiet', 'idle', 'unknown', 'update'].includes(a)), ...Object.keys(bindings).filter(k => k.startsWith('tool:'))]) bindingField(action, bindings[action] || t.bindings.default);
  clear($('idle-summary'));
  for (const id of t.idleActivities) { const a = t.activities[id], row = make('div', undefined, 'idle-item'); row.append(make('span', a.label), make('small', `${a.duration}s`)); $('idle-summary').append(row); }
  for (const c of t.characters.filter(c => c.idleActivities)) $('idle-summary').append(make('p', `${c.name}: ${c.idleActivities.map(id => t.activities[id].label).join(' · ')}`));
  clear($('assignments'));
  const agents = current.snapshot.agents;
  if (!agents.length) $('assignments').append(make('p', 'Choose a project. Character assignments become available when agents are observed.'));
  for (const a of agents.slice(0, 50)) {
    const row = make('div', undefined, 'assignment'), label = make('label', a.name), select = make('select');
    for (const c of t.characters) { const o = make('option', `${c.name}${c.home ? ` · home ${c.home.join(', ')}` : ''}`); o.value = c.id; select.append(o); }
    select.value = current.settings.characterAssignments[t.id]?.[a.id] || scene.actors.get(a.id)?.character.id || t.characters[0].id;
    select.setAttribute('aria-label', `Character for ${a.name}`);
    select.addEventListener('change', () => run(select, async () => { await applyState(await api.settings({ characterAssignments: { ...current.settings.characterAssignments[t.id], [a.id]: select.value } })); }));
    row.append(label, select); $('assignments').append(row);
  }
  $('theme-editor').hidden = !personal;
  if (personal) {
    $('theme-json').value = JSON.stringify(current.baseTheme, null, 2); clear($('replace-asset'));
    for (const file of themeFiles(t).filter(x => !x.endsWith('.json'))) { const o = make('option', file); o.value = file; $('replace-asset').append(o); }
  }
}
function renderSettings() {
  $('settings-project').textContent = current.settings.project || 'No project selected.';
  $('provider-codex').checked = current.settings.providers.includes('Codex'); $('provider-claude').checked = current.settings.providers.includes('Claude');
  $('auto-themes').checked = current.settings.autoUpdateThemes; $('reduced-motion').checked = current.settings.reducedMotion;
  $('update-status').textContent = current.update.message; $('theme-update-status').textContent = current.themeStatus.message;
  $('install-update').hidden = current.update.status !== 'ready';
  $('check-updates').disabled = ['checking', 'downloading'].includes(current.update.status);
  $('update-progress').hidden = current.update.status !== 'downloading'; $('update-progress').value = current.update.percent || 0;
}
function showView(next, refresh = true) {
  view = next; for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.view === view);
  if (view === 'studio' && refresh) renderStudio(); if (view === 'monitor') scene.layout();
}
function setFullscreen(active) {
  if (active === fullscreen) return;
  if (active) { returnView = view; showView('monitor', false); }
  fullscreen = active; document.body.classList.toggle('fullscreen', active);
  $('fullscreen').textContent = active ? 'Exit fullscreen' : 'Fullscreen';
  $('fullscreen').setAttribute('aria-pressed', String(active));
  if (!active) showView(returnView, false);
  scene.layout();
}
for (const button of document.querySelectorAll('nav button')) button.addEventListener('click', () => showView(button.dataset.view));
const chooseProject = async () => { const next = await api.chooseProject(); if (next.settings.project) preview = false; await applyState(next); };
on('choose-project', chooseProject); on('settings-choose', chooseProject);
on('preview-toggle', async () => { preview = !preview; updateMonitor(); });
on('zoom-out', async () => { scene.zoom = Math.max(.65, scene.zoom / 1.2); }); on('zoom-in', async () => { scene.zoom = Math.min(2.8, scene.zoom * 1.2); }); on('fit', async () => scene.fit());
on('labels', async () => { scene.labels = !scene.labels; $('labels').textContent = scene.labels ? 'Names on' : 'Names off'; });
on('fullscreen', async () => setFullscreen(await api.setFullscreen(!fullscreen)));
window.addEventListener('keydown', event => {
  const toggle = event.key === 'F11' && !event.altKey && !event.ctrlKey && !event.metaKey;
  const exit = event.key === 'Escape' && fullscreen;
  if (!toggle && !exit) return;
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat) run(null, async () => setFullscreen(await api.setFullscreen(exit ? false : !fullscreen)));
}, { capture: true });
on('refresh-catalog', async () => applyState(await api.catalog())); on('import-theme', async () => applyState(await api.importTheme()));
on('clone-theme', async () => { await applyState(await api.cloneTheme(current.theme.id)); notify('Personal copy created. Edit it freely; catalog updates will leave it alone.'); });
on('open-theme', async () => api.openTheme()); on('guide', async () => api.openGuide());
on('add-tool', async () => { const name = $('tool-name').value.trim(); if (!/^[\w.:/-]{1,120}$/.test(name)) throw Error('Enter the exact tool name from your agent.'); if (![...$('bindings').querySelectorAll('select')].some(s => s.dataset.action === `tool:${name}`)) bindingField(`tool:${name}`, current.theme.bindings.default); $('tool-name').value = ''; });
on('save-bindings', async () => {
  const changes = { ...current.settings.activityOverrides[current.theme.id] };
  for (const select of $('bindings').querySelectorAll('select')) {
    const action = select.dataset.action, base = current.theme.bindings[action] || current.theme.bindings.default;
    if (select.value !== base || action.startsWith('tool:')) changes[action] = select.value; else delete changes[action];
  }
  await applyState(await api.settings({ activityOverrides: changes })); notify('Activity mappings saved.');
});
on('reset-bindings', async () => { await applyState(await api.settings({ activityOverrides: {} })); notify('Theme defaults restored.'); });
on('save-theme', async () => { const theme = JSON.parse($('theme-json').value); await applyState(await api.saveTheme(theme), true); notify('Theme validated and saved.'); });
on('replace-image', async () => { await applyState(await api.replaceImage($('replace-asset').value), true); notify('Theme artwork reloaded.'); });
on('check-updates', async () => applyState(await api.checkUpdates())); on('install-update', async () => api.installUpdate());
for (const id of ['provider-codex', 'provider-claude', 'auto-themes', 'reduced-motion']) $(id).addEventListener('change', () => run(null, async () => {
  const patch = id.startsWith('provider') ? { providers: ['Codex', 'Claude'].filter(x => $(`provider-${x.toLowerCase()}`).checked) } : { [id === 'auto-themes' ? 'autoUpdateThemes' : 'reducedMotion']: $(id).checked };
  await applyState(await api.settings(patch));
}));
api.onChange(change => {
  if (typeof change.fullscreen === 'boolean') setFullscreen(change.fullscreen);
  if (!current) return;
  if (change.refresh) { run(null, async () => applyState(await api.state())); return; }
  Object.assign(current, change); if (change.snapshot || 'collectorError' in change) updateMonitor(); else renderSettings();
});
await run(null, async () => applyState(await api.state()));
setInterval(updateMonitor, 2000);
