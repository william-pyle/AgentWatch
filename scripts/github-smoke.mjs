import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ThemeStore } from '../src/main/themes.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(root, '.test-output'), { recursive: true });
const data = await mkdtemp(path.join(root, '.test-output/github-'));
const store = new ThemeStore({ bundled: path.join(root, 'themes'), data }); await store.init(); await store.refresh();
assert.deepEqual(store.catalog.themes.map(t => t.id).sort(), ['borg', 'datacenter', 'orbital', 'smurfs', 'village']);
for (const id of ['orbital', 'village', 'smurfs', 'borg']) {
  await store.install(id); assert.ok(await store.integrity(id)); console.log(`GitHub download and integrity passed: ${id}`);
}
await writeFile(path.join(root, '.test-output/github-results.json'), JSON.stringify({ passed: true, repository: 'william-pyle/AgentWatch', checkedAt: new Date().toISOString(), catalog: true, downloadedAndVerified: ['orbital', 'village', 'smurfs', 'borg'] }, null, 2));
