import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { diffLayout, applyLayout, layoutTheme, LayoutHistory } from '../src/shared/layout.mjs';
import { LayoutStore } from '../src/main/layouts.mjs';
import { validateTheme } from '../src/shared/theme.mjs';
import { project, unproject, bridgeBounds, walkGrid, route } from '../src/shared/navigation.mjs';
import { advanceEnvironment, smokeOrigin, smokePuffs, waterStreaks } from '../src/shared/effects.mjs';
const load = async (id = 'datacenter') => JSON.parse(await readFile(new URL(`../themes/${id}/theme.json`, import.meta.url)));
test('layout changes merge over new artwork, activities and untouched upstream scenery', async () => {
  const base = await load(), draft = structuredClone(base);
  draft.scene.objects[0].tile = [3, 3]; const removed = draft.scene.objects.splice(2, 1)[0].id;
  draft.scene.objects.push({ id: 'my-printer', kind: 'printer', tile: [1, 2], height: 90, mirror: true });
  draft.scene.terrain[1][1] = 'aisle'; draft.characters[0].home = [1, 1]; draft.activities.print.targets = [[1, 3]];
  const patch = diffLayout(base, draft), updated = structuredClone(base); updated.palette.accent = '#123456'; updated.activities.print.fps = 4; updated.scene.objects.push({ id: 'upstream-printer', kind: 'printer', tile: [22, 22], height: 80 });
  const applied = applyLayout(updated, patch);
  assert.deepEqual(applied.theme.scene.objects[0].tile, [3, 3]); assert.ok(!applied.theme.scene.objects.some(o => o.id === removed));
  assert.ok(applied.theme.scene.objects.some(o => o.id === 'my-printer')); assert.ok(applied.theme.scene.objects.some(o => o.id === 'upstream-printer'));
  assert.equal(applied.theme.palette.accent, '#123456'); assert.equal(applied.theme.activities.print.fps, 4);
  assert.equal(applied.theme.scene.terrain[1][1], 'aisle'); assert.deepEqual(applied.theme.characters[0].home, [1, 1]); assert.deepEqual(applied.theme.activities.print.targets, [[1, 3]]);
  assert.deepEqual(applied.warnings, []); assert.ok(!('assets' in patch));
});
test('incompatible upstream changes report warnings and preserve the original patch', async () => {
  const base = await load(), draft = structuredClone(base); draft.scene.objects[0].tile = [2, 2];
  const patch = diffLayout(base, draft), before = JSON.stringify(patch), updated = structuredClone(base);
  delete updated.objects.command; updated.scene.objects = updated.scene.objects.filter(o => o.kind !== 'command');
  assert.match(applyLayout(updated, patch).warnings[0], /unavailable/); assert.equal(JSON.stringify(patch), before);
  updated.scene.world.columns = 27;
  assert.match(applyLayout(updated, patch).warnings[0], /dimensions/); assert.equal(JSON.stringify(patch), before);
});
test('layout edits cannot alter pack behavior and reject invalid geometry', async () => {
  const base = await load(), draft = structuredClone(base); draft.palette.accent = '#123456'; draft.bindings.build = 'print';
  assert.deepEqual(layoutTheme(base, draft).palette, base.palette); assert.deepEqual(layoutTheme(base, draft).bindings, base.bindings);
  draft.scene.objects[0].tile = [-1, 999]; assert.throws(() => diffLayout(base, draft), /scene object/);
  draft.scene = structuredClone(base.scene); draft.id = '../escape'; assert.throws(() => diffLayout(base, draft), /identity/);
});
test('layout saves are persistent, serialized, revision checked and retain recovery copies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aw-layout-')), store = new LayoutStore(root), base = await load(), initial = await store.state(base), draft = structuredClone(base);
  draft.scene.objects[0].tile = [2, 3];
  const results = await Promise.allSettled([store.save(base, draft, initial), store.save(base, draft, initial)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.match(results.find(r => r.status === 'rejected').reason.message, /changed elsewhere/);
  const next = await new LayoutStore(root).state(base); assert.deepEqual(next.theme.scene.objects[0].tile, [2, 3]);
  const newer = structuredClone(base); newer.version = '9.0.0'; await assert.rejects(store.save(newer, draft, next), /updated while/);
  await store.save(base, base, next); const restored = await store.state(base); assert.deepEqual(restored.theme.scene, base.scene);
  const backup = JSON.parse(await readFile(path.join(root, 'layouts/datacenter.previous.json'))); assert.deepEqual(backup.objects[0].tile, [2, 3]);
  assert.throws(() => store.file('../escape'), /identity/);
});
test('corrupt local layouts are retained and can be recovered without blocking a new save', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aw-layout-')), store = new LayoutStore(root), base = await load();
  await store.save(base, base, await store.state(base)); await writeFile(store.file(base.id), '{broken');
  const state = await store.state(base); assert.equal(state.warnings.length, 1); assert.deepEqual(state.theme, base);
  await store.save(base, base, state); const backup = JSON.parse(await readFile(path.join(root, 'layouts/datacenter.previous.json'))); assert.equal(backup.recoveryText, '{broken');
});
test('a gesture is one undo step and branching clears redo', async () => {
  const theme = await load(), history = new LayoutHistory(theme), draft = structuredClone(theme);
  draft.scene.objects[0].tile = [1, 1]; history.commit(draft); draft.scene.objects[0].tile = [2, 2];
  assert.deepEqual(history.value.scene.objects[0].tile, [1, 1]); assert.deepEqual(history.undo(), theme); assert.deepEqual(history.redo().scene.objects[0].tile, [1, 1]);
  history.undo(); history.commit(draft); assert.equal(history.redoStack.length, 0);
});
test('tile picking, moved obstacles, bridge spans and bridge rails agree with navigation', async () => {
  const t = await load(), w = t.scene.world;
  for (const p of [[0, 0], [3, 15], [27, 27]]) assert.deepEqual(unproject(w, project(w, p)), p);
  t.scene.objects = [{ id: 'box', kind: 'storage', tile: [5, 5], height: 80 }]; const before = walkGrid(t);
  t.scene.objects[0].tile = [15, 15]; const after = walkGrid(t); assert.ok(!before.has('5,5') && after.has('5,5')); assert.ok(!after.has('15,15'));
  const village = await load('village'); village.scene.objects = [{ id: 'bridge', kind: 'bridge', tile: [3, 3], axis: 'u', length: 4, height: 80 }];
  village.scene.terrain = village.scene.terrain.map(r => r.map(() => 'grass'));
  const grid = walkGrid(village), p = route(grid, [3, 2], [3, 3]); assert.ok(p.length > 1, 'Cannot jump sideways through a bridge railing.');
  for (const axis of ['u', 'v']) { const b = { ...village.scene.objects[0], axis }, bounds = bridgeBounds(village.scene.world, b); assert.ok(bounds[2] > 0 && bounds[3] > 0); }
  village.scene.objects[0].tile = [31, 31]; assert.throws(() => validateTheme(village), /bridge span/);
});
test('water and smoke animate deterministically, pause, and track resized mirrored chimneys', () => {
  assert.equal(advanceEnvironment(400, 60000, true), 500); assert.equal(advanceEnvironment(400, 17, false), 400);
  assert.notDeepEqual(waterStreaks(0, 7), waterStreaks(1000, 7)); assert.notDeepEqual(smokePuffs(0, 12), smokePuffs(1000, 12));
  const normal = smokeOrigin([100, 200], 100, [0, 0, 200, 100], [.5, 1], [.75, .1]);
  assert.deepEqual(normal, [150, 110]); assert.deepEqual(smokeOrigin([100, 200], 200, [0, 0, 200, 100], [.5, 1], [.75, .1], true), [0, 20]);
});
test('ambient effects are declarative, bounded and present in Mooseville', async () => {
  const t = await load('village'); assert.ok(t.terrain.water.flow); assert.equal(Object.values(t.objects).filter(o => o.smoke).length, 7);
  t.terrain.water.flow.direction = [0, 0]; assert.throws(() => validateTheme(t), /water flow/);
  t.terrain.water.flow.direction = [0, 1]; t.objects.cottage.smoke.anchor = [2, 1]; assert.throws(() => validateTheme(t), /smoke effect/);
});
