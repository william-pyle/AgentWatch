import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTheme, chooseActivity, chooseCharacter } from '../src/shared/theme.mjs';
import { walkGrid, route } from '../src/shared/navigation.mjs';
import { stationFor, syncDockHomes, moveHome, chooseDock, beginDock, advanceDock, dockPose } from '../src/shared/docking.mjs';
import { diffLayout, applyLayout } from '../src/shared/layout.mjs';
import { lightingFrame } from '../src/shared/lighting.mjs';
import { advanceEnvironment } from '../src/shared/effects.mjs';
const load = async () => JSON.parse(await readFile(new URL('../themes/borg/theme.json', import.meta.url)));
const actorFor = (t, n = 1) => ({ character: t.characters[n], position: [...t.characters[n].home], route: [], moving: false });

test('Borg cube contains eight distinct drones, reserved Queen, 16 alcoves and connected workstations', async () => {
  const t = validateTheme(await load()), grid = walkGrid(t), start = t.characters[0].home;
  assert.equal(t.characters.length, 9); assert.equal(Object.keys(t.objects).length, 17); assert.equal(Object.keys(t.activities).length, 12);
  assert.equal(new Set(t.characters.map(c => t.assets[c.poses.idle].file)).size, 9);
  const stations = t.scene.objects.filter(o => o.kind === 'alcove').map(o => stationFor(t, o)); assert.equal(stations.length, 16);
  for (const p of [...t.characters.map(c => c.home), ...Object.values(t.activities).flatMap(a => a.targets || []), ...stations.flatMap(s => [s.entry, s.approach])]) {
    assert.ok(grid.has(p.join(',')), `Blocked tile ${p}`); assert.ok(p.join() === start.join() || route(grid, start, p).length, `Unreachable ${p}`);
  }
  const used = new Set(), chosen = [];
  for (let n = 0; n < 12; n++) { const c = chooseCharacter(t, { id: String(n), role: 'delegate' }, used); used.add(c.id); chosen.push(c.id); }
  assert.equal(new Set(chosen.slice(0, 8)).size, 8); assert.ok(!chosen.includes('queen')); assert.equal(chooseCharacter(t, { role: 'coordinator' }, used).id, 'queen');
});
test('inactive drones regenerate immediately; Queen has four distinct action sequences', async () => {
  const t = await load(), a = { id: 'a', state: 'working', role: 'delegate' };
  for (const c of t.characters.slice(1)) for (const state of ['idle','quiet','completed','waiting','interrupted','unknown']) assert.equal(chooseActivity(t, { ...a, state }, 'build', 0, {}, c), 'regenerate');
  assert.equal(chooseActivity(t, { ...a, state: 'waiting' }, 'build', 0, { waiting: 'process' }, t.characters[1]), 'process');
  const sequences = [];
  for (const [action, id] of [['coordinate','command'],['research','scan'],['message','commune'],['build','assemble']]) {
    assert.equal(chooseActivity(t, { ...a, role: 'coordinator' }, action, 0, {}, t.characters[0]), `queen-${id}`);
    const frames = t.characters[0].poses[id]; assert.ok(new Set(frames).size >= 3); sequences.push(JSON.stringify(frames));
  }
  assert.equal(new Set(sequences).size, 4);
});
test('alcove reservations cover approaching and docked drones, with graceful overflow', async () => {
  const t = await load(), grid = walkGrid(t), actors = [];
  for (let n = 0; n < 16; n++) { const a = actorFor(t, n % 8 + 1), s = chooseDock(t, a, actors, grid); assert.ok(s); beginDock(a, s); actors.push(a); }
  assert.equal(new Set(actors.map(a => a.dock.id)).size, 16); assert.equal(chooseDock(t, actorFor(t), actors, grid), null);
  actors[0].dock = null; assert.equal(chooseDock(t, actorFor(t), actors, grid).id, 'alcove-1');
});
test('drones turn outward, enter backwards, hold regeneration and exit on new work', async () => {
  const t = await load(), a = actorFor(t), station = stationFor(t, t.scene.objects.find(o => o.id === a.character.homeDock)); beginDock(a, station);
  advanceDock(a, .1, false); assert.equal(a.dock.stage, 'turning'); assert.equal(dockPose(a), 'idle');
  advanceDock(a, .5, false); assert.equal(a.dock.stage, 'entering'); assert.equal(dockPose(a), 'dock');
  advanceDock(a, 1.2, false); assert.deepEqual(a.position, [5,6]);
  advanceDock(a, 1.2, false); assert.equal(a.dock.stage, 'docked'); assert.deepEqual(a.position, station.entry); assert.equal(dockPose(a), 'regenerate');
  advanceDock(a, 20, false); assert.deepEqual(a.position, station.entry);
  advanceDock(a, .7, false, true); assert.equal(a.dock.stage, 'exiting'); assert.deepEqual(a.position, [5,6]);
  assert.equal(advanceDock(a, .7, false, true), 'released'); assert.equal(a.dock, null); assert.deepEqual(a.position, station.approach);
});
test('entry can be interrupted and reduced motion snaps safely into and out of regeneration', async () => {
  const t = await load(), a = actorFor(t), station = stationFor(t, t.scene.objects[0]); beginDock(a, station);
  advanceDock(a, .5, false); advanceDock(a, .6, false); const before = [...a.position];
  advanceDock(a, 0, false, true); assert.deepEqual(a.position, before); assert.equal(a.dock.stage, 'exiting');
  advanceDock(a, 1.4, false, true); assert.deepEqual(a.position, station.approach);
  beginDock(a, station); advanceDock(a, 0, true); assert.equal(a.dock.stage, 'docked'); assert.deepEqual(a.position, station.entry);
  advanceDock(a, 0, true, true); assert.equal(a.dock, null); assert.deepEqual(a.position, station.approach);
});
test('moved and mirrored alcoves retain linked homes through layout save and reload', async () => {
  const base = await load(), t = structuredClone(base); const o = t.scene.objects[0]; o.tile = [7,11]; o.mirror = true;
  syncDockHomes(t); assert.deepEqual(t.characters[1].home, [9,11]);
  moveHome(t, 'drone-01', [9,13]); assert.deepEqual(o.tile, [7,13]);
  const restored = applyLayout(base, diffLayout(base, t)).theme;
  assert.deepEqual(restored.characters[1].home, [9,13]); assert.deepEqual(restored.scene.objects[0], o);
  const grid = walkGrid(restored); assert.ok(grid.has('7,13')); assert.ok(!grid.has('6,13'));
  assert.equal(chooseDock(restored, actorFor(restored), [], grid).id, 'alcove-1');
});
test('blocked back-step paths and removed alcoves fall back to another reachable bay', async () => {
  const t = await load(); t.scene.terrain[6][5] = 'conduit'; const a = actorFor(t);
  assert.notEqual(chooseDock(t, a, [], walkGrid(t)).id, 'alcove-1');
  t.scene.objects = t.scene.objects.filter(o => o.kind !== 'alcove'); syncDockHomes(t);
  assert.equal(chooseDock(t, a, [], walkGrid(t)), null);
});
test('lighting animates occupied stations, stays dim when vacant and freezes with reduced motion', () => {
  const a = lightingFrame(0, 1, 1, true), b = lightingFrame(1000, 1, 1, true); assert.notDeepEqual(a,b);
  assert.ok(lightingFrame(0, 1, 1, false).intensity < a.intensity);
  const paused = advanceEnvironment(1000, 2000, false); assert.equal(paused, 1000); assert.deepEqual(lightingFrame(paused, 1, 1, true), b);
});
test('docking, sprite alignment and light definitions reject unsafe values', async () => {
  const base = await load();
  for (const mutate of [t=>t.objects.alcove.dock.entry=[9,0], t=>t.objects.alcove.dock.enterSeconds=0, t=>t.objects.alcove.dock.restPose='missing', t=>t.objects.alcove.lights.nodes=[[2,0,.1]], t=>t.objects.alcove.lights.scan.width=9, t=>t.assets['queen-0'].trim='no', t=>t.characters[1].inactiveActivity='missing']) {
    const t = structuredClone(base); mutate(t); assert.throws(()=>validateTheme(t));
  }
});
