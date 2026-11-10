import { LayoutHistory, layoutTheme } from '../shared/layout.mjs';
import { project, bridgeBounds, walkGrid } from '../shared/navigation.mjs';
import { syncDockHomes, moveHome } from '../shared/docking.mjs';
const $ = id => document.getElementById(`editor-${id}`);
const clone = value => structuredClone(value);
const title = id => id.replaceAll('-', ' ').replace(/^./, c => c.toUpperCase());
function options(select, values) {
  select.replaceChildren(...values.map(([id, label]) => { const o = document.createElement('option'); o.value = id; o.textContent = label; return o; }));
}
export class WorldEditor {
  constructor(scene, getState, save, closed, notify) {
    Object.assign(this, { scene, getState, save, closed, notify }); this.active = false;
    document.getElementById('edit-world').addEventListener('click', () => this.open());
    $('tool').addEventListener('change', () => this.render());
    $('kind').addEventListener('change', () => this.preview());
    $('object').addEventListener('change', () => { this.selected = $('object').value; this.render(); });
    for (const field of ['height', 'u', 'v', 'mirror', 'axis', 'length']) $(field).addEventListener('change', () => this.change(t => {
      const o = t.scene.objects.find(o => o.id === this.selected); if (!o) return;
      if (field === 'mirror') o.mirror = $('mirror').checked;
      else if (field === 'axis') o.axis = $('axis').value;
      else if (field === 'u' || field === 'v') o.tile[field === 'u' ? 0 : 1] = Number($(field).value);
      else o[field] = Number($(field).value);
    }));
    $('delete').onclick = () => this.remove();
    $('duplicate').onclick = () => this.change(t => {
      const o = t.scene.objects.find(o => o.id === this.selected); if (!o) return;
      const duplicate = { ...clone(o), id: `placed-${crypto.randomUUID()}`, tile: [Math.min(t.scene.world.columns - 1, o.tile[0] + 1), o.tile[1]] };
      t.scene.objects.push(duplicate); this.selected = duplicate.id;
    });
    $('undo').onclick = () => { this.cancelGesture(); this.history.undo(); this.refresh(); };
    $('redo').onclick = () => { this.cancelGesture(); this.history.redo(); this.refresh(); };
    $('reset').onclick = () => { this.history.commit(this.base); this.selected = null; this.refresh(); };
    $('cancel').onclick = () => { this.finish(); void this.closed(); };
    $('save').onclick = async () => {
      this.endGesture(); $('save').disabled = true;
      try { const next = await this.save(this.base.id, this.history.value, this.expected); this.finish(); await this.closed(next); this.notify('World layout saved. Theme updates keep your changes.'); }
      catch (e) { this.notify(e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
      finally { $('save').disabled = false; }
    };
    window.addEventListener('keydown', e => {
      if (!this.active || e.target.matches('input,select,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('redo') : $('undo')).click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); $('redo').click(); }
      else if (e.key === 'Delete') { e.preventDefault(); this.remove(); }
      else if (e.key === 'Escape') { this.cancelGesture(); }
      else if (this.selected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); this.change(t => { const o = t.scene.objects.find(o => o.id === this.selected); if (!o) return; const i = ['ArrowLeft', 'ArrowRight'].includes(e.key) ? 0 : 1; o.tile[i] += ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1; });
      }
    });
  }
  open() {
    if (this.active) return;
    const state = this.getState(); this.base = clone(state.baseTheme); this.expected = clone(state.layout); this.original = clone(state.theme); this.history = new LayoutHistory(state.theme);
    this.active = true; this.selected = null; this.scene.editor = this; this.scene.canvas.setAttribute('aria-label', 'World editor canvas');
    document.getElementById('world-editor').hidden = false; document.querySelector('.roster-panel').hidden = true; document.getElementById('monitor').classList.add('editing');
    for (const button of document.querySelectorAll('nav button, #choose-project, #preview-toggle, #edit-world')) button.disabled = true;
    options($('kind'), Object.keys(this.base.objects).map(k => [k, title(k)]));
    options($('terrain'), Object.keys(this.base.terrain).map(k => [k, title(k)]));
    options($('home'), this.base.characters.map(c => [c.id, c.name]));
    options($('target'), Object.entries(this.base.activities).filter(([, a]) => a.motion === 'visit').flatMap(([id, a]) => a.targets.map((_, i) => [`${id}:${i}`, `${a.label} · ${i + 1}`])));
    $('tool').querySelector('[value="target"]').disabled = !$('target').options.length;
    $('tool').value = 'select'; this.render(); this.scene.paintFloor(); this.scene.layout();
    if (state.layout.warnings.length) this.notify(state.layout.warnings.join(' '));
  }
  finish() {
    this.active = false; this.gesture = null; this.scene.editor = null; this.scene.canvas.setAttribute('aria-label', 'Animated agent workspace');
    this.scene.paintFloor();
    document.getElementById('world-editor').hidden = true; document.querySelector('.roster-panel').hidden = false; document.getElementById('monitor').classList.remove('editing');
    for (const button of document.querySelectorAll('nav button, #choose-project, #preview-toggle, #edit-world')) button.disabled = false;
  }
  change(operation) {
    this.endGesture(); const next = clone(this.history.value);
    try { operation(next); syncDockHomes(next); layoutTheme(this.base, next); this.history.commit(next); this.refresh(); }
    catch (e) { this.notify(e.message); this.render(); }
  }
  refresh() { this.scene.setLayout(this.history.value); this.render(); }
  remove() { if (this.selected) this.change(t => { t.scene.objects = t.scene.objects.filter(o => o.id !== this.selected); this.selected = null; }); }
  render() {
    if (!this.active) return;
    const tool = $('tool').value, t = this.history.value;
    for (const name of ['add', 'paint', 'home', 'target']) $(`${name}-field`).hidden = tool !== name;
    $('selection').hidden = tool !== 'select';
    options($('object'), [['', 'Choose on the map or in this list'], ...t.scene.objects.map(o => [o.id, `${title(o.kind)} · ${o.tile.join(', ')} · ${o.id}`])]);
    $('object').value = this.selected || '';
    const o = t.scene.objects.find(o => o.id === this.selected); $('properties').hidden = !o;
    if (o) { $('height').value = o.height; $('u').value = o.tile[0]; $('v').value = o.tile[1]; $('u').max = t.scene.world.columns - 1; $('v').max = t.scene.world.rows - 1; $('mirror').checked = !!o.mirror; $('bridge').hidden = o.kind !== 'bridge'; $('axis').value = o.axis || 'u'; $('length').value = o.length || 1; }
    $('height').disabled = $('mirror').disabled = o?.kind === 'bridge';
    $('undo').disabled = !this.history.undoStack.length; $('redo').disabled = !this.history.redoStack.length;
    const dirty = JSON.stringify(t) !== JSON.stringify(this.original);
    $('status').textContent = `${dirty ? 'Unsaved layout changes' : 'Layout ready to edit'} · ${t.scene.objects.length} objects. Save or cancel to leave the editor.`;
    this.preview();
  }
  preview() {
    const kind = $('kind').value; if (!kind) return;
    const c = document.createElement('canvas'); c.width = 200; c.height = 130;
    this.scene.sprite(c.getContext('2d'), this.base.objects[kind].asset, [100, 120], 100); $('preview').src = c.toDataURL();
  }
  pointerDown(e) {
    const tile = this.scene.eventTile(e), tool = $('tool').value;
    if (tool === 'select') {
      const hit = this.scene.hitObject(this.scene.eventPoint(e)); this.selected = hit?.id || null; this.render();
      if (hit) this.gesture = { tool, draft: clone(this.history.value), start: this.scene.eventTile(e) || hit.tile, from: [...hit.tile], id: hit.id };
      return;
    }
    if (!tile) return;
    if (tool === 'add') this.change(t => {
      const kind = $('kind').value, id = `placed-${crypto.randomUUID()}`;
      const example = t.scene.objects.find(o => o.kind === kind), definition = t.objects[kind];
      t.scene.objects.push({ id, kind, tile, height: example?.height || t.assets[definition.asset].height, ...(kind === 'bridge' ? { axis: 'u', length: 3 } : {}) }); this.selected = id;
    });
    else if (tool === 'paint') { this.gesture = { tool, draft: clone(this.history.value), last: tile }; this.paint(tile); }
    else if (tool === 'home' || tool === 'target') this.change(t => {
      if (!walkGrid(t).has(tile.join(','))) throw Error('Choose walkable ground for a home or work destination.');
      if (tool === 'home') moveHome(t, $('home').value, tile);
      else { const [id, i] = $('target').value.split(':'); t.activities[id].targets[Number(i)] = tile; }
    });
  }
  pointerMove(e) {
    const tile = this.scene.eventTile(e); this.hover = tile;
    if (!this.gesture || !tile) return;
    const g = this.gesture;
    if (g.tool === 'paint') this.paint(tile);
    if (g.tool === 'select') {
      const o = g.draft.scene.objects.find(o => o.id === g.id), w = g.draft.scene.world;
      o.tile = tile.map((x, i) => Math.max(0, Math.min((i ? w.rows : w.columns) - 1, g.from[i] + x - g.start[i])));
      this.scene.setLayout(g.draft);
    }
  }
  paint(tile) {
    const g = this.gesture, steps = Math.max(1, Math.abs(tile[0] - g.last[0]), Math.abs(tile[1] - g.last[1]));
    for (let i = 0; i <= steps; i++) { const p = tile.map((n, axis) => Math.round(g.last[axis] + (n - g.last[axis]) * i / steps)); g.draft.scene.terrain[p[1]][p[0]] = $('terrain').value; }
    g.last = tile; this.scene.setLayout(g.draft);
  }
  pointerUp() { this.endGesture(); }
  endGesture() {
    if (!this.gesture) return; const draft = this.gesture.draft; this.gesture = null;
    try { syncDockHomes(draft); layoutTheme(this.base, draft); this.history.commit(draft); } catch (e) { this.notify(e.message); }
    this.refresh();
  }
  cancelGesture() { if (this.gesture) { this.gesture = null; this.refresh(); } }
  draw(ctx) {
    if (!this.active) return;
    const t = this.scene.theme, w = t.scene.world;
    ctx.save(); ctx.lineWidth = 1 / this.scene.scale();
    const diamond = (tile, color, fill = false, size = 1) => {
      const [x, y] = project(w, tile); ctx.beginPath(); ctx.moveTo(x, y - w.tileHeight / 2 * size); ctx.lineTo(x + w.tileWidth / 2 * size, y); ctx.lineTo(x, y + w.tileHeight / 2 * size); ctx.lineTo(x - w.tileWidth / 2 * size, y); ctx.closePath(); ctx.strokeStyle = color; if (fill) { ctx.fillStyle = color; ctx.fill(); } ctx.stroke();
    };
    ctx.globalAlpha = .2;
    if ($('grid').checked) for (let v = 0; v < w.rows; v++) for (let u = 0; u < w.columns; u++) diamond([u, v], '#ffffff');
    ctx.globalAlpha = 1;
    for (const c of t.characters) if (c.home) { const p = project(w, c.home); ctx.strokeStyle = '#ffcf79'; ctx.beginPath(); ctx.ellipse(...p, 10, 5, 0, 0, Math.PI * 2); ctx.stroke(); }
    for (const a of Object.values(t.activities)) if (a.motion === 'visit') for (const tile of a.targets) diamond(tile, '#a8e6ff', false, .4);
    if (this.hover) { ctx.globalAlpha = .35; diamond(this.hover, '#ffffff', true); ctx.globalAlpha = 1; }
    const o = t.scene.objects.find(o => o.id === this.selected);
    if (o) {
      diamond(o.tile, '#ffcf79'); const a = this.scene.assets[t.objects[o.kind].asset], p = project(w, o.tile), width = o.height * a.rect[2] / a.rect[3];
      ctx.strokeStyle = '#ffcf79'; ctx.setLineDash([5, 4]);
      if (o.kind === 'bridge') ctx.strokeRect(...bridgeBounds(w, o, t.objects[o.kind].deck));
      else ctx.strokeRect(p[0] - width * (o.mirror ? 1 - a.anchor[0] : a.anchor[0]), p[1] - o.height * a.anchor[1], width, o.height);
    }
    ctx.restore();
  }
}
