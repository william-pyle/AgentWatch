// Exercise an actual GitHub theme upgrade with a user layout in a packaged app.
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ThemeStore } from '../src/main/themes.mjs';
import { LayoutStore } from '../src/main/layouts.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(root, '.test-output'), { recursive: true });
const data = await mkdtemp(path.join(root, '.test-output/theme-upgrade-'));
const old = new ThemeStore({ bundled: path.join(root, 'themes'), data, fetcher: (url, options) => fetch(url.replace('/main/', '/v0.1.0/'), options) });
await old.init(); await old.refresh(); await old.install('village');
const original = await old.read('village'), draft = structuredClone(original), house = draft.scene.objects.find(o => o.kind === 'cottage');
house.tile = [3, 20]; house.height = 125; house.mirror = !house.mirror; draft.scene.terrain[1][1] = 'path';
const layouts = new LayoutStore(data); await layouts.save(original, draft, await layouts.state(original));
await writeFile(path.join(data, 'settings.json'), JSON.stringify({ theme: 'village', autoUpdateThemes: true }));
const env = { ...process.env, AGENT_WATCH_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: path.join(root, 'dist/win-unpacked/Agent Watch.exe'), args: ['--smoke-test'], env });
try {
  const page = await application.firstWindow(); await page.waitForURL('aw://app/renderer/index.html'); await page.waitForSelector('#scene[data-ready="true"]', { timeout: 60000 });
  const before = await page.evaluate(() => window.agentWatch.state()); assert.equal(before.theme.version, '1.0.0'); assert.ok(!before.theme.terrain.water.flow);
  const after = await page.evaluate(() => window.agentWatch.checkUpdates()); assert.equal(after.theme.version, '1.1.0');
  assert.ok(after.theme.terrain.water.flow && after.theme.objects.cottage.smoke);
  assert.deepEqual(after.theme.scene.objects.find(o => o.id === house.id), house); assert.equal(after.theme.scene.terrain[1][1], 'path');
  assert.equal(after.layout.revision, before.layout.revision); assert.deepEqual(after.layout.warnings, []);
  assert.notDeepEqual(after.baseTheme.scene.objects.find(o => o.id === house.id).tile, house.tile);
  const results = { passed: true, checkedAt: new Date().toISOString(), appVersion: after.version, theme: 'village', from: before.theme.version, to: after.theme.version, savedHousePreserved: true, savedTerrainPreserved: true, layoutFileUnchanged: true, waterAndSmokeInstalled: true, source: 'GitHub v0.1.0 to current main catalog' };
  await writeFile(path.join(root, '.test-output/theme-upgrade-results.json'), JSON.stringify(results, null, 2));
  console.log('Packaged app upgraded Mooseville 1.0.0 to 1.1.0 from GitHub; house placement, size, mirror and painted terrain survived unchanged.');
} finally { await application.close(); }
