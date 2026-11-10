import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ThemeStore } from '../src/main/themes.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url))), capture = process.argv.includes('--capture');
await mkdir(path.join(root, '.test-output'), { recursive: true }); const data = await mkdtemp(path.join(root, '.test-output/smurfs-'));
const fetcher = async url => { const relative = new URL(url).pathname.split('/main/themes/')[1]; if (!relative || relative.includes('..')) throw Error('Invalid fixture URL.'); return new Response(await readFile(path.join(root, 'themes', relative))); };
const store = new ThemeStore({ bundled: path.join(root, 'themes'), data, fetcher }); await store.init(); await store.refresh(); await store.install('smurfs'); assert.ok(await store.integrity('smurfs'));
await writeFile(path.join(data, 'settings.json'), JSON.stringify({ theme: 'smurfs', reducedMotion: true }));
const env = { ...process.env, AGENT_WATCH_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: process.env.AGENT_WATCH_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe'), args: process.env.AGENT_WATCH_TEST_EXE ? ['--smoke-test'] : [root, '--smoke-test'], env, timeout: 45000 });
const errors = [];
try {
  const page = await application.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.waitForURL('aw://app/renderer/index.html'); await page.waitForSelector('#scene[data-ready="true"][data-theme="smurfs"]', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.agent-card').length === 6 && [...document.querySelectorAll('.agent-card p')].every(p => !p.textContent.includes('Arriving')));
  assert.deepEqual(await page.locator('.agent-card strong').allTextContents(), ['Papa Smurf', 'Smurfette', 'Brainy Smurf', 'Jokey Smurf', 'Hefty Smurf', 'Smurf']);
  assert.match(await page.locator('.agent-card').first().innerText(), /Coordinating at Papa/);
  const alpha = await page.evaluate(async () => {
    const theme = (await window.agentWatch.state()).theme, files = [...new Set(Object.values(theme.assets).map(a => a.file))], results = [];
    for (const file of files) {
      const img = new Image(); img.src = `aw://app/theme/smurfs/${file}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      let transparent = 0; for (let n = 3; n < pixels.length; n += 4) if (pixels[n] === 0) transparent++;
      results.push({ file, transparent: transparent / (pixels.length / 4), width: c.width, height: c.height });
    } return results;
  });
  assert.equal(alpha.length, 10); for (const a of alpha) assert.ok(a.transparent > .25, `${a.file} must have a genuinely transparent background.`);
  await page.screenshot({ path: path.join(root, '.test-output/smurfs.png') });
  if (capture) {
    await page.locator('#scene').screenshot({ path: path.join(root, 'themes/smurfs/assets/preview.png') });
    const file = path.join(root, 'themes/smurfs/theme.json'), t = JSON.parse(await readFile(file)); t.preview = 'assets/preview.png'; await writeFile(file, JSON.stringify(t, null, 2) + '\n');
  }
  // Exercise actual renderer assignment with delegates arriving before a coordinator.
  const assignments = await page.evaluate(async () => {
    const { Scene } = await import('./scene.mjs'), { theme } = await window.agentWatch.state();
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;left:-3000px;top:0;width:1000px;height:700px'; document.body.append(canvas);
    const scene = new Scene(canvas, () => {}); await scene.load(theme);
    const agents = Array.from({ length: 12 }, (_, i) => ({ id: `fixture-${i}`, role: i === 11 ? 'coordinator' : 'delegate', state: 'working', lastSeen: new Date().toISOString() }));
    const settings = { reducedMotion: true, activityOverrides: {}, characterAssignments: {} };
    scene.update({ agents, events: [] }, settings); const before = Object.fromEntries([...scene.actors].map(([id, a]) => [id, a.character.id]));
    scene.update({ agents: [...agents].reverse(), events: [] }, settings); const reordered = Object.fromEntries([...scene.actors].map(([id, a]) => [id, a.character.id]));
    agents[11].role = 'delegate'; agents[10].role = 'coordinator'; scene.update({ agents, events: [] }, settings);
    const after = Object.fromEntries([...scene.actors].map(([id, a]) => [id, a.character.id]));
    scene.theme = null; scene.resize.disconnect(); canvas.remove(); return { before, reordered, after };
  });
  assert.equal(assignments.before['fixture-11'], 'papa'); assert.equal(Object.values(assignments.before).filter(c => c === 'papa').length, 1);
  assert.equal(Object.values(assignments.before).filter(c => c === 'smurf').length, 7); assert.deepEqual(assignments.before, assignments.reordered);
  assert.equal(assignments.after['fixture-10'], 'papa'); assert.notEqual(assignments.after['fixture-11'], 'papa');
  await page.locator('#edit-world').click(); assert.equal(await page.locator('#editor-kind option').count(), 24);
  await page.locator('#editor-object').selectOption('home-smurfette'); await page.locator('#editor-u').fill('6'); await page.locator('#editor-u').press('Tab');
  await page.locator('#editor-save').click(); await page.waitForSelector('#world-editor[hidden]', { state: 'attached' });
  const saved = await page.evaluate(() => window.agentWatch.state()); assert.deepEqual(saved.theme.scene.objects.find(o => o.id === 'home-smurfette').tile, [6, 13]); assert.deepEqual(saved.baseTheme.scene.objects.find(o => o.id === 'home-smurfette').tile, [4, 13]);
  await page.locator('[data-view="studio"]').click(); assert.match(await page.locator('#idle-summary').innerText(), /Jokey Smurf/);
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, '.test-output/smurfs-results.json'), JSON.stringify({ passed: true, sixCharacters: true, papaCoordinatorReserved: true, genericOverflow: true, stableAssignments: true, roleChange: true, sceneryTypes: 24, layoutSave: true, packageIntegrity: true, alpha, errors }, null, 2));
  console.log('Smurfs passed: six characters, coordinator reservation, generic overflow, real sprite alpha, 24 scenery types, theme integrity and editable layout.');
} catch (e) { const page = await application.firstWindow(); await page.screenshot({ path: path.join(root, '.test-output/smurfs-failure.png') }).catch(() => {}); console.error(errors); throw e; }
finally { await application.close(); }
