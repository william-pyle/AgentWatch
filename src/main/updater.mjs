export class AppUpdates {
  constructor(updater, { packaged, version, changed = () => {} }) {
    Object.assign(this, { updater, packaged, changed });
    this.state = { status: packaged ? 'idle' : 'development', version, message: packaged ? 'Checks GitHub Releases on startup.' : 'App updates are available in the installed Windows version.' };
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => this.set({ status: 'checking', message: 'Checking GitHub Releases…' }));
    updater.on('update-not-available', () => this.set({ status: 'current', message: 'You have the latest version.' }));
    updater.on('update-available', info => this.set({ status: 'downloading', availableVersion: info.version, message: `Downloading version ${info.version}…` }));
    updater.on('download-progress', info => this.set({ status: 'downloading', percent: Math.round(info.percent), message: `Downloading update · ${Math.round(info.percent)}%` }));
    updater.on('update-downloaded', info => this.set({ status: 'ready', availableVersion: info.version, message: `Version ${info.version} is ready. Restart Agent Watch to install.` }));
    updater.on('error', error => this.set({ status: 'error', message: /404|No published versions|latest.yml/.test(error.message) ? 'No Windows update has been published yet.' : 'Could not check or download an update. Try again when online.' }));
  }
  set(value) { this.state = { ...this.state, ...value }; this.changed(this.state); }
  async check() {
    if (!this.packaged || ['checking', 'downloading', 'ready'].includes(this.state.status)) return this.state;
    this.set({ status: 'checking', message: 'Checking GitHub Releases…', checkedAt: new Date().toISOString() });
    try { await this.updater.checkForUpdates(); } catch { /* Error event supplies a safe message. */ }
    return this.state;
  }
  install() { if (this.state.status !== 'ready') throw Error('An update is not ready.'); this.updater.quitAndInstall(false, true); }
}
