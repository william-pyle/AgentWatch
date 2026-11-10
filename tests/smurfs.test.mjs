import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTheme, chooseCharacter, chooseActivity } from '../src/shared/theme.mjs';
import { walkGrid, route } from '../src/shared/navigation.mjs';
const load = async () => JSON.parse(await readFile(new URL('../themes/smurfs/theme.json', import.meta.url)));
test('Smurfs has all six requested characters, editable scenery and ambient effects', async () => {
  const t = validateTheme(await load()); assert.deepEqual(t.characters.map(c => c.id), ['papa', 'smurfette', 'brainy', 'jokey', 'hefty', 'smurf']);
  assert.equal(t.roleCharacters.coordinator, 'papa'); assert.equal(t.fallbackCharacter, 'smurf'); assert.equal(Object.keys(t.objects).length, 24);
  for (const kind of ['papa-house', 'smurfette-house', 'brainy-house', 'jokey-house', 'hefty-house', 'smurf-house', 'berry-bush', 'well', 'oak', 'forest-tree', 'alchemy', 'workbench', 'reading-desk']) assert.ok(t.scene.objects.some(o => o.kind === kind), kind);
  assert.ok(t.terrain.water.flow); assert.ok(t.objects['papa-house'].smoke);
});
test('every Smurf home and activity destination is walkable and connected across the stream', async () => {
  const t = await load(), grid = walkGrid(t), start = t.characters[0].home;
  const destinations = [...t.characters.map(c => c.home), ...Object.values(t.activities).flatMap(a => a.targets || [])];
  for (const p of destinations) { assert.ok(grid.has(p.join(',')), `Blocked destination ${p}`); assert.ok(p.join() === start.join() || route(grid, start, p).length, `Unreachable destination ${p}`); }
});
test('Papa is reserved for the coordinator and additional agents use the generic Smurf', async () => {
  const t = await load(), used = new Set(), chosen = [];
  for (let i = 0; i < 14; i++) { const c = chooseCharacter(t, { id: `agent-${i}`, role: 'delegate' }, used); used.add(c.id); chosen.push(c.id); }
  assert.deepEqual(chosen.slice(0, 5), ['smurfette', 'brainy', 'jokey', 'hefty', 'smurf']); assert.ok(chosen.slice(5).every(id => id === 'smurf'));
  assert.equal(chooseCharacter(t, { id: 'controller', role: 'coordinator' }, used).id, 'papa');
  assert.equal(chooseCharacter(t, { id: 'custom', role: 'delegate' }, used, 'brainy').id, 'brainy');
});
test('character activities preserve coordinator, waiting and explicit user override precedence', async () => {
  const t = await load(), smurfette = t.characters.find(c => c.id === 'smurfette'), a = { id: 'flower-agent', role: 'delegate', state: 'working' };
  assert.equal(chooseActivity(t, a, 'build', 0, {}, smurfette), 'garden');
  assert.equal(chooseActivity(t, a, 'build', 0, { build: 'craft' }, smurfette), 'craft');
  assert.equal(chooseActivity(t, { ...a, role: 'coordinator' }, 'build', 0, {}, smurfette), 'council');
  assert.equal(chooseActivity(t, { ...a, state: 'waiting' }, 'build', 0, {}, smurfette), 'wait');
  for (const c of t.characters) { const cycle = new Set(Array.from({ length: 160 }, (_, i) => chooseActivity(t, { ...a, state: 'idle' }, null, i * 1000, {}, c))); assert.deepEqual(cycle, new Set(c.idleActivities)); }
});
test('invalid reusable characters and per-character actions are rejected', async () => {
  const t = await load(); t.fallbackCharacter = 'missing'; assert.throws(() => validateTheme(t), /fallback character/); t.fallbackCharacter = 'smurf';
  t.characters[0].bindings = { build: 'missing' }; assert.throws(() => validateTheme(t), /character activities/); delete t.characters[0].bindings;
  t.characters[0].idleActivities = []; assert.throws(() => validateTheme(t), /character idle/);
});
