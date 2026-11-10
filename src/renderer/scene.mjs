import { project, unproject, bridgeBounds, walkGrid, nearestTile, route } from '../shared/navigation.mjs';
import { chooseActivity, hashString } from '../shared/theme.mjs';
import { advanceEnvironment, smokeOrigin, smokePuffs, waterStreaks } from '../shared/effects.mjs';
export const assetUrl = (id, file) => `aw://app/theme/${id}/${file}`;
export class Scene {
  constructor(canvas, onSelect) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.actors = new Map(); this.zoom = 1; this.pan = [0, 0]; this.onSelect = onSelect;
    this.frame = this.frame.bind(this); this.lastTime = 0; this.environmentTime = 0; this.reducedMotion = false; this.labels = true; this.selected = null;
    this.resize = new ResizeObserver(() => this.layout()); this.resize.observe(canvas);
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.zoom = Math.max(.65, Math.min(2.8, this.zoom * (event.deltaY < 0 ? 1.1 : .9))); }, { passive: false });
    canvas.addEventListener('pointerdown', e => { if (!this.theme) return; canvas.focus(); canvas.setPointerCapture(e.pointerId); if (this.editor && e.button === 0 && !e.altKey) { this.editor.pointerDown(e); return; } this.drag = { x: e.clientX, y: e.clientY, pan: [...this.pan] }; });
    canvas.addEventListener('pointermove', e => { if (this.editor && !this.drag) this.editor.pointerMove(e); if (this.drag) this.pan = [this.drag.pan[0] + e.clientX - this.drag.x, this.drag.pan[1] + e.clientY - this.drag.y]; });
    canvas.addEventListener('pointerup', e => {
      if (this.editor && !this.drag) { this.editor.pointerUp(e); return; }
      if (this.drag && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) < 5) {
        const rect = canvas.getBoundingClientRect(), p = this.toWorld([e.clientX - rect.left, e.clientY - rect.top]);
        const actor = [...this.actors.values()].reverse().find(a => { const q = project(this.theme.scene.world, a.position); return Math.abs(q[0] - p[0]) < 28 && p[1] > q[1] - 75 && p[1] < q[1] + 20; });
        if (actor) { this.selected = actor.agent.id; onSelect(actor.agent.id); }
      }
      this.drag = null;
    });
    canvas.addEventListener('pointercancel', () => { this.drag = null; this.editor?.cancelGesture(); });
    requestAnimationFrame(this.frame);
  }
  layout() {
    const { width, height } = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr); this.dpr = dpr;
    this.width = width; this.height = height;
  }
  fit() { this.zoom = 1; this.pan = [0, 0]; }
  scale() { return this.theme ? Math.min(this.width / this.theme.scene.world.width, this.height / this.theme.scene.world.height) * this.zoom : 1; }
  toWorld(p) { const s = this.scale(), w = this.theme.scene.world; return [(p[0] - this.width / 2 - this.pan[0]) / s + w.width / 2, (p[1] - this.height / 2 - this.pan[1]) / s + w.height / 2]; }
  eventPoint(e) { const r = this.canvas.getBoundingClientRect(); return this.toWorld([e.clientX - r.left, e.clientY - r.top]); }
  eventTile(e) { const w = this.theme.scene.world, p = unproject(w, this.eventPoint(e)).map(Math.round); return p[0] >= 0 && p[1] >= 0 && p[0] < w.columns && p[1] < w.rows ? p : null; }
  hitObject(point) {
    return [...this.theme.scene.objects].sort((a, b) => project(this.theme.scene.world, b.tile)[1] - project(this.theme.scene.world, a.tile)[1]).find(o => {
      const a = this.assets[this.theme.objects[o.kind].asset], p = project(this.theme.scene.world, o.tile), width = o.height * a.rect[2] / a.rect[3];
      let x = (point[0] - p[0]) * (o.mirror ? -1 : 1) / width + a.anchor[0], y = (point[1] - p[1]) / o.height + a.anchor[1];
      if (o.kind === 'bridge') { const b = bridgeBounds(this.theme.scene.world, o, this.theme.objects[o.kind].deck); x = (point[0] - b[0]) / b[2]; y = (point[1] - b[1]) / b[3]; if (o.axis === 'v') x = 1 - x; }
      if (x < 0 || x >= 1 || y < 0 || y >= 1) return false;
      return a.hit.getImageData(a.crop[0] + Math.floor(x * a.rect[2]), a.crop[1] + Math.floor(y * a.rect[3]), 1, 1).data[3] > 24;
    });
  }
  setLayout(theme) {
    this.theme = theme; this.grid = walkGrid(theme); this.tiles = [...this.grid].map(k => k.split(',').map(Number)); this.paintFloor();
    for (const actor of this.actors.values()) { actor.character = theme.characters.find(c => c.id === actor.character.id) || theme.characters[0]; actor.position = nearestTile(this.grid, actor.position) || actor.position; actor.route = []; actor.activityId = null; }
  }
  async load(theme) {
    const generation = this.generation = (this.generation || 0) + 1;
    const images = new Map();
    await Promise.all([...new Set([...Object.values(theme.assets).map(a => a.file), ...(theme.background ? [theme.background] : [])])].map(async file => {
      const image = new Image(); image.src = assetUrl(theme.id, file) + `?v=${generation}`; await image.decode(); images.set(file, image);
    }));
    const assets = {};
    for (const [id, spec] of Object.entries(theme.assets)) {
      const image = images.get(spec.file), rect = spec.rect || [0, 0, image.naturalWidth, image.naturalHeight];
      if (rect[0] + rect[2] > image.naturalWidth || rect[1] + rect[3] > image.naturalHeight) throw Error(`Sprite ${id} extends past its image.`);
      // Crop only at render time; original PNG bytes and alpha remain untouched.
      const sample = document.createElement('canvas'); sample.width = rect[2]; sample.height = rect[3];
      const ctx = sample.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, ...rect, 0, 0, rect[2], rect[3]);
      const pixels = ctx.getImageData(0, 0, rect[2], rect[3]).data;
      let x0 = rect[2], y0 = rect[3], x1 = 0, y1 = 0;
      for (let y = 0; y < rect[3]; y++) for (let x = 0; x < rect[2]; x++) if (pixels[(y * rect[2] + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
      if (x1 <= x0 || y1 <= y0) throw Error(`Sprite ${id} is empty.`);
      const anchor = spec.anchor ? [(spec.anchor[0] * rect[2] - x0) / (x1 - x0), (spec.anchor[1] * rect[3] - y0) / (y1 - y0)] : [.5, 1];
      // SVGs need a stable raster surface before source-rectangle scaling in Chromium.
      const vector = spec.file.endsWith('.svg');
      assets[id] = { ...spec, image: vector ? sample : image, rect: [x0 + (vector ? 0 : rect[0]), y0 + (vector ? 0 : rect[1]), x1 - x0, y1 - y0], anchor, hit: ctx, crop: [x0, y0] };
    }
    if (generation !== this.generation) return;
    this.theme = theme; this.assets = assets; this.background = images.get(theme.background); this.actors.clear(); this.grid = walkGrid(theme); this.tiles = [...this.grid].map(k => k.split(',').map(Number));
    this.paintFloor(); this.fit(); this.layout(); this.canvas.dataset.theme = theme.id; this.canvas.dataset.ready = 'true';
  }
  sprite(ctx, id, point, height, flip = false) {
    const a = this.assets[id]; if (!a) return;
    const h = height || a.height, w = h * a.rect[2] / a.rect[3];
    ctx.save(); ctx.translate(...point); if (flip) ctx.scale(-1, 1);
    ctx.drawImage(a.image, ...a.rect, -w * a.anchor[0], -h * a.anchor[1], w, h); ctx.restore();
  }
  thumbnail(canvas, characterId) {
    if (!this.theme) return;
    const c = this.theme.characters.find(c => c.id === characterId) || this.theme.characters[0];
    canvas.width = 80; canvas.height = 90; this.sprite(canvas.getContext('2d'), c.poses.idle, [40, 85], 78);
  }
  paintFloor() {
    const { scene, palette } = this.theme, w = scene.world;
    this.floor = document.createElement('canvas'); this.floor.width = w.width * 1.5; this.floor.height = w.height * 1.5;
    const ctx = this.floor.getContext('2d'); ctx.scale(1.5, 1.5);
    this.waterLayers = new Map();
    for (const [kind, definition] of Object.entries(this.theme.terrain)) if (definition.flow) {
      const tile = this.assets[definition.asset], texture = document.createElement('canvas'); texture.width = w.tileWidth * 2; texture.height = w.tileHeight * 2;
      const water = texture.getContext('2d');
      for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) water.drawImage(tile.image, ...tile.rect, texture.width / 2 + (u - v) * w.tileWidth / 2 - w.tileWidth / 2 - .2, texture.height / 2 + (u + v) * w.tileHeight / 2 - w.tileHeight / 2 - .2, w.tileWidth + .4, w.tileHeight + .4);
      this.waterLayers.set(kind, { flow: definition.flow, mask: new Path2D(), pattern: this.ctx.createPattern(texture, 'repeat'), width: texture.width, height: texture.height });
    }
    const corners = [[-.5, -.5], [w.columns - .5, -.5], [w.columns - .5, w.rows - .5], [-.5, w.rows - .5]].map(p => project(w, p));
    ctx.fillStyle = palette.border; ctx.shadowColor = '#00000065'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    ctx.beginPath(); corners.forEach(([x, y], i) => i ? ctx.lineTo(x, y + 22) : ctx.moveTo(x, y + 22)); ctx.closePath(); ctx.fill(); ctx.shadowColor = 'transparent';
    for (let v = 0; v < w.rows; v++) for (let u = 0; u < w.columns; u++) {
      const a = this.assets[this.theme.terrain[scene.terrain[v][u]].asset], [x, y] = project(w, [u, v]), hw = w.tileWidth / 2 + .2, hh = w.tileHeight / 2 + .2;
      ctx.save(); ctx.beginPath(); ctx.moveTo(x, y - hh); ctx.lineTo(x + hw, y); ctx.lineTo(x, y + hh); ctx.lineTo(x - hw, y); ctx.closePath(); ctx.clip();
      ctx.drawImage(a.image, ...a.rect, x - hw, y - hh, hw * 2, hh * 2); ctx.restore();
      const layer = this.waterLayers.get(scene.terrain[v][u]);
      if (layer) { layer.mask.moveTo(x, y - hh); layer.mask.lineTo(x + hw, y); layer.mask.lineTo(x, y + hh); layer.mask.lineTo(x - hw, y); layer.mask.closePath(); }
    }
    // Ground objects are drawn after moving water, so bridges and garden plots stay above it.
  }
  update(snapshot, settings) {
    if (!this.theme) return;
    this.reducedMotion = settings.reducedMotion;
    this.overrides = settings.activityOverrides?.[this.theme.id] || {};
    const assignments = settings.characterAssignments?.[this.theme.id] || {};
    const ids = new Set(snapshot.agents.map(a => a.id));
    for (const id of this.actors.keys()) if (!ids.has(id)) this.actors.delete(id);
    const used = new Set([...this.actors.values()].map(a => a.character.id));
    for (const agent of snapshot.agents) {
      let actor = this.actors.get(agent.id);
      const forced = assignments[agent.id] || this.theme.roleCharacters?.[agent.role];
      if (!actor || forced && forced !== actor.character.id) {
        const chars = this.theme.characters;
        const character = chars.find(c => c.id === forced) || chars.find(c => !used.has(c.id)) || chars[hashString(agent.id) % chars.length]; used.add(character.id);
        const position = nearestTile(this.grid, character.home || [this.theme.scene.world.columns / 2, this.theme.scene.world.rows / 2]);
        if (!position) continue;
        actor = { character, position, route: [], phase: hashString(agent.id) % 100, activityId: null, traveled: 0, nextWander: 0 };
        this.actors.set(agent.id, actor);
      }
      actor.agent = agent;
      const event = snapshot.events.find(e => e.agentId === agent.id);
      actor.action = event?.kind; actor.actionAt = Date.parse(event?.at || agent.lastSeen) || Date.now();
    }
  }
  destination(actor, activity) {
    if (activity.motion === 'home') return actor.character.home || actor.position;
    if (activity.motion === 'visit') return activity.targets[hashString(actor.agent.id) % activity.targets.length];
    return this.tiles[(hashString(actor.agent.id) + Math.floor(Date.now() / 15000) * 37) % this.tiles.length];
  }
  advance(actor, dt, now) {
    const id = chooseActivity(this.theme, actor.agent, actor.action, now - actor.actionAt, this.overrides), activity = this.theme.activities[id];
    if (this.editor) { actor.activityId = id; actor.moving = false; return; }
    if (id !== actor.activityId) { actor.activityId = id; actor.route = activity.motion === 'stay' ? [] : route(this.grid, actor.position, this.destination(actor, activity)); actor.nextWander = now + activity.duration * 1000; }
    if (activity.motion === 'wander' && !actor.route.length && now > actor.nextWander) { actor.route = route(this.grid, actor.position, this.destination(actor, activity)); actor.nextWander = now + activity.duration * 1000; }
    actor.moving = actor.route.length > 0 && !this.reducedMotion;
    if (this.reducedMotion) { if (actor.route.length) actor.position = actor.route.at(-1); actor.route = []; return; }
    if (actor.moving) {
      const next = actor.route[0], dx = next[0] - actor.position[0], dy = next[1] - actor.position[1], distance = Math.hypot(dx, dy), step = dt * 1.65;
      actor.flip = dx - dy < 0; actor.back = dx + dy < 0; actor.traveled += Math.min(step, distance);
      if (distance <= step) { actor.position = next; actor.route.shift(); }
      else actor.position = [actor.position[0] + dx / distance * step, actor.position[1] + dy / distance * step];
    }
  }
  frame(time) {
    requestAnimationFrame(this.frame);
    if (!this.theme || !this.width || document.hidden) return;
    const dt = Math.min(.06, Math.max(0, (time - this.lastTime) / 1000)); this.lastTime = time;
    this.environmentTime = advanceEnvironment(this.environmentTime, dt * 1000, !this.reducedMotion && !this.editor);
    const ctx = this.ctx, w = this.theme.scene.world, palette = this.theme.palette, now = Date.now();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.width, this.height); ctx.fillStyle = palette.world; ctx.fillRect(0, 0, this.width, this.height);
    if (this.background) { const scale = Math.max(this.width / this.background.naturalWidth, this.height / this.background.naturalHeight); const bw = this.background.naturalWidth * scale, bh = this.background.naturalHeight * scale; ctx.drawImage(this.background, (this.width - bw) / 2, (this.height - bh) / 2, bw, bh); }
    ctx.translate(this.width / 2 + this.pan[0], this.height / 2 + this.pan[1]); ctx.scale(this.scale(), this.scale()); ctx.translate(-w.width / 2, -w.height / 2);
    ctx.drawImage(this.floor, 0, 0, w.width, w.height);
    this.drawWater(ctx);
    for (const o of this.theme.scene.objects.filter(o => o.kind === 'bridge' || this.theme.objects[o.kind].ground)) this.drawObject(ctx, o, project(w, o.tile));
    const objects = this.theme.scene.objects.filter(o => o.kind !== 'bridge' && !this.theme.objects[o.kind].ground).map(o => ({ object: o, point: project(w, o.tile) }));
    for (const actor of this.actors.values()) { this.advance(actor, dt, now); objects.push({ actor, point: project(w, actor.position) }); }
    objects.sort((a, b) => a.point[1] - b.point[1]);
    for (const item of objects) {
      if (item.object) { this.drawObject(ctx, item.object, item.point); continue; }
      const a = item.actor, activity = this.theme.activities[a.activityId], poses = a.character.poses;
      const pose = a.moving ? a.back && poses['walk-back'] ? poses['walk-back'] : poses.walk || poses.idle : poses[activity.pose] || poses.idle;
      const frames = Array.isArray(pose) ? pose : [pose];
      const phase = a.moving ? a.traveled * 3 : time / 1000 * activity.fps + a.phase;
      const frame = frames[this.reducedMotion || this.editor ? 0 : Math.floor(phase) % frames.length];
      ctx.save(); ctx.fillStyle = a.agent.id === this.selected ? palette.accent + 'aa' : '#0b182b28'; ctx.beginPath(); ctx.ellipse(item.point[0], item.point[1] - 2, 19, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      this.sprite(ctx, frame, item.point, undefined, a.moving && a.flip && !poses['walk-back']);
      if (activity.prop) this.sprite(ctx, activity.prop, [item.point[0] + 20, item.point[1] - 15], 26);
    }
    if (this.labels) for (const a of this.actors.values()) {
      const point = project(w, a.position), label = a.character.name, active = a.agent.state === 'working';
      ctx.font = '600 14px Segoe UI'; const width = ctx.measureText(label).width + 27;
      ctx.fillStyle = palette.label; ctx.beginPath(); ctx.roundRect(point[0] - width / 2, point[1] + 6, width, 23, 6); ctx.fill();
      ctx.fillStyle = active ? palette.accent : palette.muted; ctx.beginPath(); ctx.arc(point[0] - width / 2 + 9, point[1] + 17, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = palette.text; ctx.fillText(label, point[0] - width / 2 + 17, point[1] + 22);
    }
    this.editor?.draw(ctx);
  }
  drawWater(ctx) {
    const { scene, terrain } = this.theme, w = scene.world;
    for (const layer of this.waterLayers.values()) {
      const [u, v] = layer.flow.direction, dx = (u - v) * w.tileWidth / 2, dy = (u + v) * w.tileHeight / 2, distance = Math.hypot(dx, dy), travel = this.environmentTime / 1000 * 5 * layer.flow.speed;
      const x = travel * dx / distance % layer.width, y = travel * dy / distance % layer.height;
      ctx.save(); ctx.clip(layer.mask); ctx.translate(x, y); ctx.fillStyle = layer.pattern; ctx.globalAlpha = .9; ctx.fillRect(-x, -y, w.width, w.height); ctx.restore();
    }
    for (let v = 0; v < w.rows; v++) for (let u = 0; u < w.columns; u++) {
      const flow = terrain[scene.terrain[v][u]].flow; if (!flow) continue;
      const [x, y] = project(w, [u, v]), hw = w.tileWidth / 2, hh = w.tileHeight / 2;
      const [du, dv] = flow.direction, dx = (du - dv) * hw, dy = (du + dv) * hh, length = Math.hypot(dx, dy);
      const ax = dx / length, ay = dy / length;
      ctx.save(); ctx.beginPath(); ctx.moveTo(x, y - hh); ctx.lineTo(x + hw, y); ctx.lineTo(x, y + hh); ctx.lineTo(x - hw, y); ctx.closePath(); ctx.clip(); ctx.strokeStyle = flow.color; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
      for (const s of waterStreaks(this.environmentTime, u * 31 + v * 17, flow.speed)) {
        const sx = x + ax * s.along * hw - ay * s.across * hh, sy = y + ay * s.along * hw + ax * s.across * hh;
        ctx.globalAlpha = s.opacity; ctx.beginPath(); ctx.moveTo(sx - ax * 4, sy - ay * 4); ctx.quadraticCurveTo(sx, sy - 1.5, sx + ax * 4, sy + ay * 4); ctx.stroke();
      }
      ctx.restore();
    }
  }
  drawObject(ctx, object, point) {
    const definition = this.theme.objects[object.kind];
    if (object.kind === 'bridge') {
      const a = this.assets[definition.asset], bounds = bridgeBounds(this.theme.scene.world, object, definition.deck);
      ctx.save(); if (object.axis === 'v') { ctx.translate(bounds[0] * 2 + bounds[2], 0); ctx.scale(-1, 1); }
      ctx.drawImage(a.image, ...a.rect, ...bounds); ctx.restore();
    } else this.sprite(ctx, definition.asset, point, object.height, object.mirror);
    this.drawSmoke(ctx, object, point);
  }
  drawSmoke(ctx, object, point) {
    const definition = this.theme.objects[object.kind], effect = definition.smoke; if (!effect) return;
    const a = this.assets[definition.asset], origin = smokeOrigin(point, object.height, a.rect, a.anchor, effect.anchor, object.mirror);
    ctx.save(); ctx.fillStyle = effect.color;
    for (const puff of smokePuffs(this.environmentTime, hashString(object.id), effect.scale * object.height / 105, effect.speed)) {
      ctx.globalAlpha = puff.opacity; ctx.beginPath(); ctx.arc(origin[0] + puff.x, origin[1] + puff.y, puff.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}
