import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ThemeStore } from '../src/main/themes.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(root, '.test-output'), { recursive: true });
const data = await mkdtemp(path.join(root, '.test-output/world-'));
const store = new ThemeStore({ bundled: path.join(root, 'themes'), data }); await store.init(); await store.importFolder(path.join(root, 'themes/village'), 'village-test');
const env = { ...process.env, AGENT_WATCH_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath: process.env.AGENT_WATCH_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe'), args: process.env.AGENT_WATCH_TEST_EXE ? ['--smoke-test'] : [root, '--smoke-test'], env, timeout: 45000 });
let application = await launch(); const errors = []; let saved, movedId;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(app) { const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message)); await page.waitForURL('aw://app/renderer/index.html'); await page.waitForSelector('#scene[data-ready="true"]', { timeout: 60000 }); return page; }
async function tilePoint(page, tile) {
  const w = (await page.evaluate(() => window.agentWatch.state())).theme.scene.world, r = await page.locator('#scene').boundingBox(), s = Math.min(r.width / w.width, r.height / w.height);
  return { x: r.x + r.width / 2 + (w.originX + (tile[0] - tile[1]) * w.tileWidth / 2 - w.width / 2) * s, y: r.y + r.height / 2 + (w.originY + (tile[0] + tile[1]) * w.tileHeight / 2 - w.height / 2) * s, scale: s };
}
async function clickTile(page, tile) { const p = await tilePoint(page, tile); await page.mouse.click(p.x, p.y); }
async function choose(page, name, id) {
  await page.locator('[data-view="themes"]').click(); await page.locator('#installed-themes .theme-card').filter({ hasText: name }).getByRole('button', { name: 'Use theme' }).click();
  await page.waitForFunction(id => document.querySelector('#scene').dataset.theme === id, id, { timeout: 60000 }); await page.locator('[data-view="monitor"]').click();
}
try {
  let page = await ready(application);
  await page.locator('#edit-world').click(); await page.locator('#editor-tool').selectOption('add'); await page.locator('#editor-kind').selectOption('printer');
  await clickTile(page, [2, 26]); await page.locator('#editor-tool').selectOption('select');
  movedId = await page.locator('#editor-object').inputValue(); assert.match(movedId, /^placed-/);
  const start = await tilePoint(page, [2, 26]), end = await tilePoint(page, [4, 26]), height = Number(await page.locator('#editor-height').inputValue());
  // Use world-scaled artwork coordinates: CI display scaling differs from a local desktop.
  const offset = height * .6 * start.scale;
  await page.mouse.move(start.x, start.y - offset); await page.mouse.down();
  assert.equal(await page.locator('#editor-object').inputValue(), movedId, 'Grab the placed object silhouette.');
  await page.mouse.move(end.x, end.y - offset, { steps: 12 }); await page.mouse.up();
  assert.equal(await page.locator('#editor-u').inputValue(), '4'); assert.equal(await page.locator('#editor-v').inputValue(), '26');
  await page.locator('#editor-undo').click(); assert.equal(await page.locator('#editor-u').inputValue(), '2');
  await page.locator('#editor-redo').click(); assert.equal(await page.locator('#editor-u').inputValue(), '4');
  await page.locator('#editor-height').fill('95'); await page.locator('#editor-height').press('Tab'); await page.locator('#editor-mirror').check();
  await page.locator('#editor-duplicate').click(); await page.locator('#editor-delete').click();
  await page.locator('#editor-tool').selectOption('paint'); await page.locator('#editor-terrain').selectOption('aisle');
  const a = await tilePoint(page, [1, 1]), b = await tilePoint(page, [4, 1]); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 10 }); await page.mouse.up();
  await page.locator('#editor-tool').selectOption('home'); await page.locator('#editor-home').selectOption('teal'); await clickTile(page, [1, 2]);
  await page.locator('#editor-tool').selectOption('target'); await page.locator('#editor-target').selectOption('print:0'); await clickTile(page, [4, 21]);
  await page.screenshot({ path: path.join(root, '.test-output/world-editor.png') });
  await page.locator('#editor-save').click(); await page.waitForSelector('#world-editor[hidden]', { state: 'attached' });
  saved = await page.evaluate(() => window.agentWatch.state()); const object = saved.theme.scene.objects.find(o => o.id === movedId);
  assert.deepEqual(object.tile, [4, 26]); assert.equal(object.height, 95); assert.equal(object.mirror, true);
  assert.deepEqual(saved.theme.scene.terrain[1].slice(1, 5), Array(4).fill('aisle')); assert.deepEqual(saved.theme.characters[0].home, [1, 2]); assert.deepEqual(saved.theme.activities.print.targets[0], [4, 21]);
  assert.ok(!saved.baseTheme.scene.objects.some(o => o.id === movedId));
  await page.locator('#edit-world').click(); await page.locator('#editor-reset').click(); await page.locator('#editor-cancel').click(); await page.waitForSelector('#world-editor[hidden]', { state: 'attached' });
  assert.deepEqual((await page.evaluate(() => window.agentWatch.state())).theme.scene, saved.theme.scene);
  await application.close(); application = await launch(); page = await ready(application);
  assert.deepEqual((await page.evaluate(() => window.agentWatch.state())).theme.scene, saved.theme.scene);
  // Switching themes leaves each layout independent. Empty live mode isolates ambient animation.
  await choose(page, 'Mooseville', 'village-test'); await page.locator('#preview-toggle').click();
  await page.waitForFunction(() => document.querySelectorAll('.agent-card').length === 0);
  const village = (await page.evaluate(() => window.agentWatch.state())).theme;
  assert.ok(village.terrain.water.flow && village.objects.cottage.smoke);
  const crop = async (kind, delay = 0) => {
    if (delay) await wait(delay);
    return page.evaluate(async ({ kind }) => {
      const t = (await window.agentWatch.state()).theme, c = document.querySelector('#scene'), r = c.getBoundingClientRect(), s = Math.min(r.width / t.scene.world.width, r.height / t.scene.world.height), d = c.width / r.width, w = t.scene.world;
      const { project } = await import('../shared/navigation.mjs');
      let point, width, height;
      if (kind === 'water') { point = project(w, [18, 23]); width = 55; height = 28; }
      else {
        const o = t.scene.objects.find(o => o.kind === 'townhall'), def = t.objects[o.kind], spec = t.assets[def.asset], image = new Image(); image.src = `aw://app/theme/${t.id}/${spec.file}`; await image.decode();
        const temp = document.createElement('canvas'); temp.width = image.naturalWidth; temp.height = image.naturalHeight; const ctx = temp.getContext('2d'); ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, temp.width, temp.height).data;
        let x0 = temp.width, y0 = temp.height, x1 = 0, y1 = 0;
        for (let y = 0; y < temp.height; y++) for (let x = 0; x < temp.width; x++) if (pixels[(y * temp.width + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
        const p = project(w, o.tile), anchor = def.smoke.anchor;
        point = [p[0] + (anchor[0] - .5) * o.height * (x1 - x0) / (y1 - y0) + 8, p[1] - o.height + o.height * anchor[1] - 24]; width = 35; height = 45;
      }
      const x = (r.width / 2 + (point[0] - w.width / 2 - width / 2) * s) * d, y = (r.height / 2 + (point[1] - w.height / 2 - height / 2) * s) * d;
      return [...c.getContext('2d').getImageData(Math.floor(x), Math.floor(y), Math.ceil(width * s * d), Math.ceil(height * s * d)).data];
    }, { kind });
  };
  const water0 = await crop('water', 300), smoke0 = await crop('smoke'), water1 = await crop('water', 1000), smoke1 = await crop('smoke');
  assert.notDeepEqual(water0, water1, 'Water region must visibly change.'); assert.notDeepEqual(smoke0, smoke1, 'Chimney region must visibly change.');
  await page.screenshot({ path: path.join(root, '.test-output/village-effects.png') });
  await page.locator('[data-view="settings"]').click(); await page.locator('#reduced-motion').check(); await page.locator('[data-view="monitor"]').click();
  const waterStill = await crop('water', 300), smokeStill = await crop('smoke'); assert.deepEqual(waterStill, await crop('water', 800)); assert.deepEqual(smokeStill, await crop('smoke'));
  await choose(page, 'Robot Datacenter', 'datacenter'); assert.deepEqual((await page.evaluate(() => window.agentWatch.state())).theme.scene, saved.theme.scene);
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, '.test-output/world-results.json'), JSON.stringify({ passed: true, visualPlacement: true, dragMove: true, terrainBrush: true, undoRedo: true, resizeMirror: true, duplicateRemove: true, homesAndDestinations: true, cancelReset: true, persistsAfterRelaunch: true, themeIsolation: true, animatedWaterPixels: true, animatedSmokePixels: true, reducedMotionFreezesEffects: true, errors }, null, 2));
  console.log('World editor passed: drag, placement, paint, undo/redo, homes, destinations, persistence, theme isolation, animated water/smoke pixels and reduced motion.');
} catch (e) {
  const page = await application.firstWindow(); await page.screenshot({ path: path.join(root, '.test-output/world-failure.png') }).catch(() => {});
  console.error('World smoke errors:', errors, await page.locator('#notice').textContent()); throw e;
} finally { await application.close(); }
