import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AppUpdates } from '../src/main/updater.mjs';
class FakeUpdater extends EventEmitter {
  checks = 0; installs = 0;
  async checkForUpdates() { this.checks++; this.emit('checking-for-update'); this.emit('update-available', { version: '0.2.0' }); }
  quitAndInstall(silent, restart) { this.installs++; assert.equal(silent, false); assert.equal(restart, true); }
}
test('startup updates download in background and install only after explicit restart', async () => {
  const updater = new FakeUpdater(), service = new AppUpdates(updater, { packaged: true, version: '0.1.0' });
  assert.equal(updater.autoDownload, true); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.throws(() => service.install(), /not ready/); await service.check(); assert.equal(updater.checks, 1); assert.equal(service.state.status, 'downloading');
  await service.check(); assert.equal(updater.checks, 1);
  updater.emit('download-progress', { percent: 50 }); assert.equal(service.state.percent, 50);
  updater.emit('update-downloaded', { version: '0.2.0' }); assert.equal(service.state.status, 'ready'); assert.equal(updater.installs, 0);
  service.install(); assert.equal(updater.installs, 1);
});
test('offline errors are visible and development builds do not request updates', async () => {
  const updater = new FakeUpdater(), service = new AppUpdates(updater, { packaged: false, version: '0.1.0' });
  await service.check(); assert.equal(updater.checks, 0);
  updater.emit('error', Error('offline')); assert.equal(service.state.status, 'error'); assert.match(service.state.message, /online/);
});
