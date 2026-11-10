import { validateTheme } from './theme.mjs';
import { walkGrid } from './navigation.mjs';
import { syncDockHomes } from './docking.mjs';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = value => structuredClone(value);
// Only these fields belong to a layout. Artwork and activity behavior remain in the pack.
export function layoutTheme(base, draft) {
  const theme = copy(base);
  if (draft.id !== base.id || !same(draft.scene.world, base.scene.world)) throw Error('Keep the theme identity and world dimensions unchanged.');
  theme.scene.terrain = copy(draft.scene.terrain);
  theme.scene.objects = copy(draft.scene.objects);
  for (const c of theme.characters) {
    const edited = draft.characters.find(x => x.id === c.id);
    if (edited?.home) c.home = copy(edited.home); else delete c.home;
  }
  for (const [id, a] of Object.entries(theme.activities)) if (a.motion === 'visit') a.targets = copy(draft.activities[id]?.targets);
  syncDockHomes(theme); validateTheme(theme);
  if (!walkGrid(theme).size) throw Error('Leave at least one walkable tile for your residents.');
  return theme;
}
export function diffLayout(base, draft) {
  const t = layoutTheme(base, draft), original = new Map(base.scene.objects.map(o => [o.id, o]));
  const current = new Set(t.scene.objects.map(o => o.id));
  return { schemaVersion: 1, themeId: base.id, dimensions: [base.scene.world.columns, base.scene.world.rows],
    objects: t.scene.objects.filter(o => !same(o, original.get(o.id))), removed: [...original.keys()].filter(id => !current.has(id)),
    terrain: t.scene.terrain.flatMap((row, v) => row.flatMap((kind, u) => kind === base.scene.terrain[v][u] ? [] : [{ tile: [u, v], kind }])),
    homes: t.characters.filter(c => !same(c.home, base.characters.find(x => x.id === c.id)?.home)).map(c => ({ id: c.id, tile: c.home || null })),
    targets: Object.entries(t.activities).filter(([id, a]) => a.motion === 'visit' && !same(a.targets, base.activities[id].targets)).map(([id, a]) => ({ id, tiles: a.targets })) };
}
export function applyLayout(base, patch) {
  if (!patch) return { theme: copy(base), warnings: [] };
  if (patch.schemaVersion !== 1 || patch.themeId !== base.id || !['objects', 'removed', 'terrain', 'homes', 'targets'].every(k => Array.isArray(patch[k]))) throw Error('The saved layout is invalid. It has been kept on disk.');
  if (!same(patch.dimensions, [base.scene.world.columns, base.scene.world.rows])) return { theme: copy(base), warnings: ['The theme changed its world dimensions. Your saved layout is kept on disk; the theme layout is shown.'] };
  const t = copy(base), warnings = [];
  const inside = p => Array.isArray(p) && p.length === 2 && p.every((x, i) => Number.isInteger(x) && x >= 0 && x < patch.dimensions[i]);
  t.scene.objects = t.scene.objects.filter(o => !patch.removed.includes(o.id));
  for (const o of patch.objects) {
    if (!Object.hasOwn(t.objects, o.kind) || !inside(o.tile)) { warnings.push(`Saved object ${o.id} is unavailable in this theme revision.`); continue; }
    const i = t.scene.objects.findIndex(x => x.id === o.id);
    if (i < 0) t.scene.objects.push(copy(o)); else t.scene.objects[i] = copy(o);
  }
  for (const cell of patch.terrain) {
    if (inside(cell.tile) && Object.hasOwn(t.terrain, cell.kind)) t.scene.terrain[cell.tile[1]][cell.tile[0]] = cell.kind;
    else warnings.push('A saved terrain tile is unavailable in this theme revision.');
  }
  for (const home of patch.homes) {
    const c = t.characters.find(c => c.id === home.id);
    if (c && home.tile === null) delete c.home;
    else if (c && inside(home.tile)) c.home = copy(home.tile);
    else warnings.push(`Saved home ${home.id} is unavailable in this theme revision.`);
  }
  for (const target of patch.targets) {
    if (t.activities[target.id]?.motion === 'visit' && Array.isArray(target.tiles) && target.tiles.length && target.tiles.every(inside)) t.activities[target.id].targets = copy(target.tiles);
    else warnings.push(`Saved destination ${target.id} is unavailable in this theme revision.`);
  }
  syncDockHomes(t); validateTheme(t);
  if (!walkGrid(t).size) throw Error('The saved layout has no walkable ground with this theme revision. It has been kept on disk.');
  return { theme: t, warnings: [...new Set(warnings)] };
}
export class LayoutHistory {
  constructor(theme) { this.value = copy(theme); this.undoStack = []; this.redoStack = []; }
  commit(next) {
    if (same(next, this.value)) return false;
    this.undoStack.push(this.value); if (this.undoStack.length > 80) this.undoStack.shift();
    this.value = copy(next); this.redoStack = []; return true;
  }
  undo() { if (this.undoStack.length) { this.redoStack.push(this.value); this.value = this.undoStack.pop(); } return this.value; }
  redo() { if (this.redoStack.length) { this.undoStack.push(this.value); this.value = this.redoStack.pop(); } return this.value; }
}
