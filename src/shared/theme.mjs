export const THEME_API = 1;
export const ACTIONS = ['started', 'build', 'read', 'research', 'review', 'delegate', 'message', 'coordinate', 'tool', 'wait', 'update', 'completed', 'interrupted', 'working', 'waiting', 'quiet', 'idle', 'unknown'];
export const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export const safePath = value => typeof value === 'string' && value.length <= 200 && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:json|png|webp|jpg|jpeg|svg|gif)$/.test(value) && !value.split('/').some(x => /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(x));
const own = (o, k) => Object.hasOwn(o || {}, k);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const number = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const point = p => Array.isArray(p) && p.length === 2 && p.every(x => number(x, 0, 128));
const text = (s, max = 200) => typeof s === 'string' && s.length > 0 && s.length <= max;
const fail = message => { throw Error(message); };
export function validateTheme(t) {
  if (!record(t) || t.schemaVersion !== THEME_API || !safeId(t.id) || !/^\d+\.\d+\.\d+$/.test(t.version || '')) fail('Unsupported theme identity or version.');
  if (!text(t.name, 80) || !text(t.description, 600) || !text(t.author, 100)) fail('Theme name, description and author are required.');
  for (const field of ['preview', 'logo']) if (!safePath(t[field]) || t[field].endsWith('.json')) fail(`Invalid ${field} image.`);
  if (t.background && (!safePath(t.background) || t.background.endsWith('.json'))) fail('Invalid background image.');
  const colors = ['background', 'panel', 'surface', 'text', 'muted', 'accent', 'border', 'world', 'label'];
  if (!record(t.palette) || colors.some(k => !/^#[a-fA-F0-9]{6}$/.test(t.palette[k] || ''))) fail('Theme palette needs nine six-digit hex colors.');
  const assets = t.assets;
  if (!record(assets) || !Object.keys(assets).length || Object.keys(assets).length > 500) fail('Theme needs 1–500 assets.');
  for (const [id, a] of Object.entries(assets)) {
    if (!safeId(id) || !record(a) || !safePath(a.file) || a.file.endsWith('.json') || !number(a.height, 1, 512)) fail(`Invalid asset: ${id}`);
    if (a.anchor && (!Array.isArray(a.anchor) || a.anchor.length !== 2 || a.anchor.some(n => !number(n, 0, 1)))) fail(`Invalid anchor: ${id}`);
    if (a.rect && (!Array.isArray(a.rect) || a.rect.length !== 4 || a.rect.some(n => !Number.isInteger(n) || !number(n, 0, 8192)) || a.rect[2] < 1 || a.rect[3] < 1)) fail(`Invalid sprite rectangle: ${id}`);
  }
  const asset = id => own(assets, id);
  const m = t.scene, w = m?.world;
  if (!w || !['width', 'height', 'tileWidth', 'tileHeight', 'originX', 'originY'].every(k => number(w[k], 1, 10000)) || !['columns', 'rows'].every(k => Number.isInteger(w[k]) && number(w[k], 2, 64))) fail('Invalid scene dimensions.');
  const inside = p => point(p) && p.every(Number.isInteger) && p[0] < w.columns && p[1] < w.rows;
  if (!record(t.terrain) || Object.values(t.terrain).some(x => !record(x) || !asset(x.asset) || typeof x.walkable !== 'boolean')) fail('Invalid terrain definitions.');
  if (!Array.isArray(m.terrain) || m.terrain.length !== w.rows || m.terrain.some(r => !Array.isArray(r) || r.length !== w.columns || r.some(k => !own(t.terrain, k)))) fail('Incomplete terrain grid.');
  if (!record(t.objects)) fail('Object definitions are required.');
  for (const [id, o] of Object.entries(t.objects)) {
    if (!safeId(id) || !asset(o.asset)) fail(`Invalid object: ${id}`);
    if (o.footprint && (!Array.isArray(o.footprint) || o.footprint.length !== 4 || !o.footprint.every(Number.isInteger) || o.footprint.some(n => Math.abs(n) > 8) || o.footprint[2] < 1 || o.footprint[3] < 1)) fail(`Invalid footprint: ${id}`);
  }
  const ids = new Set();
  if (!Array.isArray(m.objects) || m.objects.length > 1500) fail('Invalid scene objects.');
  for (const o of m.objects) {
    if (!text(o.id, 100) || ids.has(o.id) || !own(t.objects, o.kind) || !inside(o.tile) || !number(o.height, 1, 512)) fail('Invalid scene object.');
    if (o.kind === 'bridge' && (!['u', 'v'].includes(o.axis) || !Number.isInteger(o.length) || !number(o.length, 1, 12))) fail('Invalid bridge.');
    ids.add(o.id);
  }
  if (!Array.isArray(t.characters) || t.characters.length < 1 || t.characters.length > 64) fail('Theme needs 1–64 characters.');
  ids.clear();
  for (const c of t.characters) {
    if (!safeId(c.id) || ids.has(c.id) || !text(c.name, 60) || !record(c.poses) || !asset(c.poses.idle)) fail('Invalid character.');
    for (const frames of Object.values(c.poses)) if (!(Array.isArray(frames) ? frames.length > 0 && frames.length <= 60 && frames.every(asset) : asset(frames))) fail(`Invalid pose for ${c.name}.`);
    ids.add(c.id);
    if (c.home && !inside(c.home)) fail('Invalid character home.');
  }
  if (!record(t.activities) || !Object.keys(t.activities).length || Object.keys(t.activities).length > 100) fail('Activities are required.');
  for (const [id, a] of Object.entries(t.activities)) {
    if (!safeId(id) || !text(a.label, 80) || !text(a.pose, 64) || !number(a.fps, 0.1, 30) || !number(a.duration, 2, 300) || !['stay', 'wander', 'visit', 'home'].includes(a.motion)) fail(`Invalid activity: ${id}`);
    if (t.characters.some(c => !own(c.poses, a.pose))) fail(`Every character needs the ${a.pose} pose.`);
    if (a.motion === 'visit' && (!Array.isArray(a.targets) || !a.targets.length || a.targets.length > 50 || !a.targets.every(inside))) fail(`Invalid destinations: ${id}`);
    if (a.prop && !asset(a.prop)) fail(`Invalid activity prop: ${id}`);
  }
  if (!Array.isArray(t.idleActivities) || !t.idleActivities.length || t.idleActivities.some(id => !own(t.activities, id))) fail('Invalid idle activities.');
  const binding = k => k === 'default' || ACTIONS.includes(k) || /^tool:[\w.:/-]{1,120}$/.test(k);
  if (!record(t.bindings) || !own(t.activities, t.bindings.default) || Object.entries(t.bindings).some(([k, v]) => !binding(k) || !own(t.activities, v))) fail('Invalid action bindings.');
  if (t.roleBindings && (!record(t.roleBindings) || Object.entries(t.roleBindings).some(([role, rules]) => !['coordinator', 'lead', 'delegate'].includes(role) || !record(rules) || Object.entries(rules).some(([k, v]) => !binding(k) || !own(t.activities, v))))) fail('Invalid role activities.');
  if (t.roleCharacters && (!record(t.roleCharacters) || Object.entries(t.roleCharacters).some(([role, id]) => !['coordinator', 'lead', 'delegate'].includes(role) || !ids.has(id)))) fail('Invalid role characters.');
  return t;
}
export function themeFiles(t) {
  return [...new Set(['theme.json', t.preview, t.logo, ...(t.background ? [t.background] : []), ...Object.values(t.assets).map(a => a.file)])].sort();
}
export function hashString(value) { return [...String(value)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0); }
export function chooseActivity(theme, agent, action, elapsed, overrides = {}) {
  const bindings = { ...theme.bindings, ...theme.roleBindings?.[agent.role], ...overrides };
  const quiet = ['idle', 'quiet', 'unknown', 'completed'].includes(agent.state);
  const seed = hashString(agent.id);
  if (quiet && (!action || elapsed > 10000)) {
    // Different activity durations are respected, with stable per-agent phase offsets.
    const cycle = theme.idleActivities.reduce((n, id) => n + theme.activities[id].duration * 1000, 0);
    let at = (Math.max(0, elapsed) + seed % cycle) % cycle;
    for (const id of theme.idleActivities) { at -= theme.activities[id].duration * 1000; if (at < 0) return id; }
  }
  const toolActivity = agent.state === 'working' && action !== 'started' ? bindings[`tool:${agent.toolName}`] : null;
  const selected = ['waiting', 'interrupted'].includes(agent.state) ? bindings[agent.state] || bindings.default : toolActivity || bindings[action] || bindings[agent.state] || bindings.default;
  return own(theme.activities, selected) ? selected : theme.bindings.default;
}
