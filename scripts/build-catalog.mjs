import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateTheme, themeFiles } from '../src/shared/theme.mjs';
import { digest, checkedFile } from '../src/main/files.mjs';
import { validatePackage } from '../src/main/themes.mjs';
const root = fileURLToPath(new URL('../themes/', import.meta.url));
const check = process.argv.includes('--check');
async function emit(file, data) {
  const bytes = JSON.stringify(data, null, 2) + '\n';
  if (check) { if (await readFile(file, 'utf8') !== bytes) throw Error(`Stale catalog metadata: ${file}. Run npm run themes:build.`); }
  else await writeFile(file, bytes);
  return Buffer.from(bytes);
}
const themes = [];
for (const dir of (await readdir(root, { withFileTypes: true })).filter(x => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const folder = path.join(root, dir.name), t = validateTheme(JSON.parse(await readFile(path.join(folder, 'theme.json'), 'utf8')));
  if (dir.name !== t.id) throw Error('Theme ID must match directory.');
  const files = [];
  for (const name of themeFiles(t)) { const bytes = await readFile(await checkedFile(folder, name)); files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) }); }
  const pkg = validatePackage({ schemaVersion: 1, id: t.id, version: t.version, files }, t.id);
  const bytes = await emit(path.join(folder, 'package.json'), pkg);
  themes.push({ id: t.id, name: t.name, description: t.description, version: t.version, author: t.author, preview: t.preview, revision: digest(bytes), bytes: files.reduce((n, f) => n + f.bytes, 0) });
}
await emit(path.join(root, 'index.json'), { schemaVersion: 1, themes });
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Watch themes</title><style>body{font:16px/1.6 Segoe UI,sans-serif;background:#101c24;color:#edf5f3;max-width:1100px;margin:auto;padding:48px 30px}h1{font-size:38px}a{color:#83d8ce}p{color:#9db5bd}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}article{border:1px solid #304a55;border-radius:12px;overflow:hidden;background:#162831}img{width:100%;height:240px;object-fit:contain;background:#182d39}.copy{padding:22px}h2{margin:0;font-size:22px}small{color:#9db5bd}</style></head><body><p>AGENT WATCH / THEME LIBRARY</p><h1>Choose a world for your team.</h1><p>Install themes inside Agent Watch. The Robot Datacenter comes with the Windows installer; other themes download on demand. Every theme includes replaceable graphics, characters, activities and action mappings.</p><p><a href="../docs/guide.html">Theme authoring guide</a> · <a href="index.json">Machine-readable catalog</a> · <a href="https://github.com/william-pyle/AgentWatch/releases/latest">Windows installer</a></p><div class="grid">${themes.map(t => `<article><img src="${escape(t.id)}/${escape(t.preview)}" alt="${escape(t.name)} preview"><div class="copy"><h2>${escape(t.name)}</h2><p>${escape(t.description)}</p><small>v${escape(t.version)} · ${(t.bytes / 1024 / 1024).toFixed(1)} MiB · ${t.id === 'datacenter' ? 'Included with the app' : 'Optional download'}</small><p><a href="${escape(t.id)}/theme.json">View theme manifest</a></p></div></article>`).join('')}</div></body></html>\n`;
if (check) { if (await readFile(path.join(root, 'index.html'), 'utf8') !== gallery) throw Error('Theme gallery is stale. Run npm run themes:build.'); }
else await writeFile(path.join(root, 'index.html'), gallery);
console.log(`${check ? 'Verified' : 'Built'} ${themes.length} theme packages.`);
