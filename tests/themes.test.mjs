import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTheme, themeFiles, chooseActivity, safePath } from '../src/shared/theme.mjs';
import { ThemeStore, validatePackage, validateCatalog, download } from '../src/main/themes.mjs';
import { digest } from '../src/main/files.mjs';
import { walkGrid, route } from '../src/shared/navigation.mjs';
const themes = fileURLToPath(new URL('../themes/', import.meta.url));
const load = async id => JSON.parse(await readFile(path.join(themes, id, 'theme.json'), 'utf8'));
const clone = value => structuredClone(value);
async function fixture() {
  const data = await mkdtemp(path.join(tmpdir(), 'agent-watch-test-'));
  const fetcher = async url => {
    const relative = new URL(url).pathname.split('/main/themes/')[1];
    try { return new Response(await readFile(path.join(themes, relative))); } catch { return new Response('missing', { status: 404 }); }
  };
  const store = new ThemeStore({ bundled: themes, data, fetcher }); await store.init(); await store.refresh();
  return { store, data, fetcher };
}
test('all shipped themes validate with complete assets and hashes', async () => {
  const catalog = validateCatalog(JSON.parse(await readFile(path.join(themes, 'index.json'))));
  for (const entry of catalog.themes) {
    const t = validateTheme(await load(entry.id)), bytes = await readFile(path.join(themes, entry.id, 'package.json')), p = validatePackage(JSON.parse(bytes), t.id);
    assert.equal(digest(bytes), entry.revision);
    assert.deepEqual(p.files.map(f => f.path), themeFiles(t));
    for (const file of p.files) { const bytes = await readFile(path.join(themes, t.id, file.path)); assert.equal(digest(bytes), file.sha256); assert.equal(bytes.length, file.bytes); }
  }
});
test('datacenter has six individual homes and a controller monitor wall', async () => {
  const t = await load('datacenter'); assert.equal(t.characters.length, 6); assert.equal(new Set(t.characters.map(c => c.home.join(','))).size, 6);
  assert.equal(t.roleCharacters.coordinator, 'gold'); assert.ok(t.scene.objects.some(o => o.id === 'controller-wall'));
  const grid = walkGrid(t);
  for (const c of t.characters) {
    assert.ok(grid.has(c.home.join(',')), `Home for ${c.id} must be reachable`);
    for (const activity of Object.values(t.activities)) for (const destination of activity.targets || []) assert.ok(route(grid, c.home, destination).length > 0);
  }
});
test('theme validation rejects traversal, code files, missing assets and invalid homes', async () => {
  const t = await load('datacenter');
  for (const file of ['../outside.png', 'C:/private.png', 'assets/CON.png', 'assets/a.js', 'assets/a.png:secret', 'a%2fpng', String.raw`\\server\x.png`]) assert.equal(safePath(file), false);
  for (const mutate of [t => t.assets.floor.file = '../outside.png', t => t.characters[0].poses.idle = 'missing', t => t.characters[0].home = [900, 9], t => t.bindings.build = 'missing', t => t.activities.code.targets = [[500, 1]], t => t.palette.text = 'url(https://evil)']) { const changed = clone(t); mutate(changed); assert.throws(() => validateTheme(changed)); }
});
test('downloaded themes install atomically and work from disk offline', async () => {
  const { store, data } = await fixture(); await store.install('orbital');
  assert.equal((await store.read('orbital')).name, 'Orbital Station'); assert.ok(await store.integrity('orbital'));
  const offline = new ThemeStore({ bundled: themes, data, fetcher: async () => { throw Error('offline'); } }); await offline.init();
  await assert.rejects(offline.refresh(), /offline/); assert.equal((await offline.read('orbital')).id, 'orbital'); assert.equal((await offline.read('datacenter')).id, 'datacenter'); assert.equal(offline.catalog.themes.length, 3);
});
test('corrupt downloads never become active', async () => {
  const { store, fetcher } = await fixture();
  store.fetcher = url => url.endsWith('nova-idle.svg') ? Promise.resolve(new Response('corrupt')) : fetcher(url);
  await assert.rejects(store.install('orbital'), /Integrity/); assert.equal(store.registry.orbital, undefined);
  await assert.rejects(store.read('orbital'), /not installed/);
});
test('modified themes update by content revision even without a version bump; personal copies survive', async () => {
  const { store, fetcher } = await fixture(); await store.install('orbital');
  const previous = store.registry.orbital.revision;
  const personal = await store.importFolder(await store.location('orbital'), 'my-orbital');
  const personalTheme = await store.read(personal); personalTheme.name = 'My station'; await store.savePersonal(personal, personalTheme);
  const t = await load('orbital'); t.description = 'Changed upstream'; const themeBytes = Buffer.from(JSON.stringify(t));
  const manifest = JSON.parse(await readFile(path.join(themes, 'orbital/package.json'))); const f = manifest.files.find(f => f.path === 'theme.json'); f.bytes = themeBytes.length; f.sha256 = digest(themeBytes);
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); store.catalog.themes.find(t => t.id === 'orbital').revision = digest(manifestBytes);
  store.fetcher = url => url.endsWith('/orbital/theme.json') ? Promise.resolve(new Response(themeBytes)) : url.endsWith('/orbital/package.json') ? Promise.resolve(new Response(manifestBytes)) : fetcher(url);
  const results = await store.updateInstalled(); assert.ok(results.some(r => r.id === 'orbital' && r.changed));
  assert.equal((await store.read('orbital')).description, 'Changed upstream'); assert.equal(store.registry.orbital.previousRevision, previous);
  assert.equal((await store.read(personal)).name, 'My station');
});
test('local modifications are protected from automatic replacement', async () => {
  const { store } = await fixture(); await store.install('orbital');
  await writeFile(path.join(await store.location('orbital'), 'assets/nova-idle.svg'), 'user change');
  await assert.rejects(store.install('orbital'), /local edits/);
});
test('malicious package paths, duplicate files and overlarge downloads are rejected', async () => {
  const file = { path: 'theme.json', sha256: 'a'.repeat(64), bytes: 10 };
  assert.throws(() => validatePackage({ schemaVersion: 1, id: 'test', files: [file, { ...file, path: '../escape.png' }] }, 'test'));
  assert.throws(() => validatePackage({ schemaVersion: 1, id: 'test', files: [file, file] }, 'test'));
  await assert.rejects(download('https://example.test', 3, async () => new Response('1234')), /size limit/);
});
test('action rules, exact tool overrides, waiting state and idle rotations resolve correctly', async () => {
  const t = await load('datacenter'), a = { id: 'test', state: 'working', role: 'delegate', toolName: 'print' };
  assert.equal(chooseActivity(t, a, 'tool', 0), 'print');
  assert.equal(chooseActivity(t, { ...a, state: 'completed' }, 'completed', 0), 'signal');
  assert.equal(chooseActivity(t, { ...a, state: 'waiting' }, 'tool', 0), 'wait');
  assert.equal(chooseActivity(t, { ...a, toolName: null }, 'build', 0, { build: 'inspect' }), 'inspect');
  assert.equal(chooseActivity(t, { ...a, role: 'coordinator', toolName: null }, 'build', 0), 'control');
  const idle = new Set(Array.from({ length: 80 }, (_, i) => chooseActivity(t, { ...a, state: 'idle' }, null, i * 1000)));
  assert.deepEqual(idle, new Set(t.idleActivities));
});
test('original village map and PNG hashes remain preserved', async () => {
  const p = JSON.parse(await readFile(path.join(themes, 'village/provenance.json')));
  assert.equal(digest(await readFile(path.join(themes, 'village/source-map.json'))), p.mapSha256);
  assert.equal(p.artwork.length, 71);
  for (const image of p.artwork) assert.equal(digest(await readFile(path.join(themes, 'village', image.file))), image.sha256);
});
