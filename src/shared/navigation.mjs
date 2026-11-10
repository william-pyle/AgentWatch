export function project(world, [u, v]) { return [world.originX + (u - v) * world.tileWidth / 2, world.originY + (u + v) * world.tileHeight / 2]; }
const key = ([u, v]) => `${u},${v}`;
export function walkGrid(theme) {
  const { scene, objects, terrain } = theme, allowed = new Set();
  for (let v = 0; v < scene.world.rows; v++) for (let u = 0; u < scene.world.columns; u++) if (terrain[scene.terrain[v][u]].walkable) allowed.add(key([u, v]));
  for (const o of scene.objects) {
    const d = objects[o.kind];
    if (o.kind === 'bridge') { for (let n = 0; n < o.length; n++) allowed.add(key([o.tile[0] + (o.axis === 'u' ? n : 0), o.tile[1] + (o.axis === 'v' ? n : 0)])); continue; }
    if (d.walkable || d.ground) continue;
    const [x, y, w, h] = d.footprint || [0, 0, 1, 1];
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) allowed.delete(key([o.tile[0] + x + i, o.tile[1] + y + j]));
  }
  return allowed;
}
export function nearestTile(grid, tile) {
  if (grid.has(key(tile))) return tile;
  let closest = null, distance = Infinity;
  for (const k of grid) { const p = k.split(',').map(Number), d = Math.abs(p[0] - tile[0]) + Math.abs(p[1] - tile[1]); if (d < distance) { distance = d; closest = p; } }
  return closest;
}
export function route(grid, from, to) {
  const start = nearestTile(grid, from.map(Math.round)), end = nearestTile(grid, to.map(Math.round));
  if (!start || !end) return [];
  const queue = [start], parents = new Map([[key(start), null]]), target = key(end);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (key(current) === target) { const result = []; for (let k = target; k; k = parents.get(k)) result.push(k.split(',').map(Number)); return result.reverse().slice(1); }
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [current[0] + du, current[1] + dv], k = key(next);
      if (grid.has(k) && !parents.has(k)) { parents.set(k, key(current)); queue.push(next); }
    }
  }
  return [];
}
