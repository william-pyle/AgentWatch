import { route } from './navigation.mjs';
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const dockOffset = (object, offset) => object.mirror ? [offset[1], offset[0]] : offset;
export function stationFor(theme, object) {
  const spec = theme.objects[object.kind]?.dock;
  if (!spec) return null;
  const at = offset => dockOffset(object, offset).map((n, i) => n + object.tile[i]);
  return { id: object.id, spec, approach: at(spec.approach), entry: at(spec.entry), mirror: !!object.mirror };
}
export function syncDockHomes(theme) {
  for (const c of theme.characters) {
    const object = theme.scene.objects.find(o => o.id === c.homeDock);
    const station = object && stationFor(theme, object);
    if (station) c.home = station.approach;
  }
  return theme;
}
export function moveHome(theme, characterId, tile) {
  const c = theme.characters.find(c => c.id === characterId);
  const object = theme.scene.objects.find(o => o.id === c.homeDock);
  if (object && theme.objects[object.kind].dock) {
    const offset = dockOffset(object, theme.objects[object.kind].dock.approach);
    object.tile = tile.map((n, i) => n - offset[i]);
  }
  c.home = [...tile];
  return syncDockHomes(theme);
}
export function chooseDock(theme, actor, actors, grid) {
  if (!actor.character.homeDock) return null;
  const occupied = new Set([...actors].filter(a => a !== actor && a.dock).map(a => a.dock.id));
  const clearEntry = s => {
    const steps = Math.max(...s.entry.map((n, i) => Math.abs(n - s.approach[i]))) * 2;
    return Array.from({ length: steps + 1 }, (_, j) => s.approach.map((n, i) => Math.round(n + (s.entry[i] - n) * j / steps))).every(p => grid.has(p.join(',')));
  };
  const candidates = theme.scene.objects.map(o => stationFor(theme, o)).filter(s => s && !occupied.has(s.id) && clearEntry(s));
  candidates.sort((a, b) => Number(b.id === actor.character.homeDock) - Number(a.id === actor.character.homeDock) || distance(a.approach, actor.character.home || actor.position) - distance(b.approach, actor.character.home || actor.position));
  return candidates.find(s => distance(actor.position, s.approach) < .05 || route(grid, actor.position, s.approach).length) || null;
}
export function beginDock(actor, station) {
  actor.dock = { ...station, stage: 'approach', elapsed: 0 };
}
// Docking is simulation time, never wall time: hidden windows and paused editors
// cannot skip the turn/back-step sequence. The approach uses ordinary pathfinding.
export function advanceDock(actor, dt, reducedMotion, leave = false) {
  const d = actor.dock;
  if (!d) return 'released';
  if (leave && d.stage === 'approach') { actor.dock = null; return 'released'; }
  if (leave && d.stage !== 'exiting') { d.stage = 'exiting'; d.elapsed = 0; d.from = [...actor.position]; }
  if (reducedMotion) {
    actor.position = [...(d.stage === 'exiting' ? d.approach : d.entry)]; actor.route = []; actor.moving = false;
    if (d.stage === 'exiting') { actor.dock = null; return 'released'; }
    d.stage = 'docked'; return 'busy';
  }
  if (d.stage === 'approach') {
    if (actor.route.length || distance(actor.position, d.approach) > .05) return 'approach';
    d.stage = 'turning'; d.elapsed = 0;
  }
  actor.moving = false; d.elapsed += Math.max(0, dt);
  if (d.stage === 'turning') {
    if (d.elapsed >= d.spec.turnSeconds) { d.stage = 'entering'; d.elapsed = 0; }
  } else if (d.stage === 'entering' || d.stage === 'exiting') {
    const exiting = d.stage === 'exiting', from = exiting ? d.from : d.approach, to = exiting ? d.approach : d.entry;
    const t = Math.min(1, d.elapsed / (exiting ? d.spec.exitSeconds : d.spec.enterSeconds));
    actor.position = from.map((n, i) => n + (to[i] - n) * t);
    if (t === 1) {
      if (exiting) { actor.dock = null; return 'released'; }
      d.stage = 'docked'; d.elapsed = 0;
    }
  }
  return 'busy';
}
export function dockPose(actor) {
  const d = actor.dock;
  if (!d || d.stage === 'approach') return null;
  return d.stage === 'entering' ? d.spec.enterPose : d.stage === 'docked' ? d.spec.restPose : d.stage === 'exiting' ? 'walk' : 'idle';
}
