import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(root, '.test-output'), { recursive: true });
const data = await mkdtemp(path.join(root, '.test-output/release-'));
const env = { ...process.env, AGENT_WATCH_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: path.join(root, 'dist/win-unpacked/Agent Watch.exe'), args: ['--smoke-test'], env });
try {
  const page = await application.firstWindow(); await page.waitForURL('aw://app/renderer/index.html'); await page.waitForSelector('#scene[data-ready="true"]');
  const result = await application.evaluate(async ({ app }) => {
    const { autoUpdater } = require(app.getAppPath() + '/node_modules/electron-updater');
    autoUpdater.autoDownload = false;
    const result = await autoUpdater.checkForUpdates();
    return { packaged: app.isPackaged, currentVersion: app.getVersion(), latestVersion: result.updateInfo.version, assets: result.updateInfo.files.map(f => ({ url: f.url, sha512: f.sha512, size: f.size })) };
  });
  assert.equal(result.packaged, true); assert.equal(result.latestVersion, result.currentVersion);
  assert.ok(result.assets.some(f => f.url.endsWith('.exe') && f.sha512));
  await writeFile(path.join(root, '.test-output/release-results.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), ...result }, null, 2));
  console.log(`Packaged app checked real GitHub Releases: ${result.currentVersion} is current, installer and checksum found.`);
} finally { await application.close(); }
