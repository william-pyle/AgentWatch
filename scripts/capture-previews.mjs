import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ThemeStore } from '../src/main/themes.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(root, '.test-output'), { recursive: true });
const data = await mkdtemp(path.join(root, '.test-output/previews-'));
await writeFile(path.join(data, 'settings.json'), JSON.stringify({ reducedMotion: true }));
const store = new ThemeStore({ bundled: path.join(root, 'themes'), data }); await store.init();
await store.importFolder(path.join(root, 'themes/village'), 'village-preview'); await store.importFolder(path.join(root, 'themes/orbital'), 'orbital-preview');
await store.importFolder(path.join(root, 'themes/smurfs'), 'smurfs-preview');
await store.importFolder(path.join(root, 'themes/borg'), 'borg-preview');
const env = { ...process.env, AGENT_WATCH_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--smoke-test'], env });
try {
  const page = await application.firstWindow(); await page.waitForURL('aw://app/renderer/index.html'); await page.waitForSelector('#scene[data-ready="true"]');
  for (const [id, installed] of [['datacenter', 'datacenter'], ['village', 'village-preview'], ['orbital', 'orbital-preview'], ['smurfs', 'smurfs-preview'], ['borg', 'borg-preview']]) {
    if (id !== 'datacenter') {
      await page.locator('[data-view="themes"]').click();
      const title = { village: 'Mooseville', orbital: 'Orbital Station', smurfs: 'Smurfs', borg: 'Borg Cube' }[id];
      await page.locator('#installed-themes .theme-card').filter({ hasText: title }).getByRole('button', { name: 'Use theme' }).click();
      await page.waitForFunction(id => document.querySelector('#scene').dataset.theme === id, installed); await page.locator('[data-view="monitor"]').click();
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.agent-card p')].every(p => !p.textContent.includes('Arriving')));
    await page.locator('#scene').screenshot({ path: path.join(root, 'themes', id, 'assets/preview.png') });
    if (id === 'datacenter') { await mkdir(path.join(root, 'docs/assets'), { recursive: true }); await page.screenshot({ path: path.join(root, 'docs/assets/datacenter.png') }); }
    const file = path.join(root, 'themes', id, 'theme.json'), theme = JSON.parse(await readFile(file)); theme.preview = 'assets/preview.png'; await writeFile(file, JSON.stringify(theme, null, 2) + '\n');
  }
} finally { await application.close(); }
console.log('Captured all five theme previews from the application renderer. Run npm run themes:build.');
