import { mkdir, readdir, readFile, writeFile, rename, stat, copyFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateTheme, themeFiles, safeId, safePath } from '../shared/theme.mjs';
import { atomicJson, json, digest, checkedFile } from './files.mjs';

export const REPOSITORY = 'william-pyle/AgentWatch';
const RAW = `https://raw.githubusercontent.com/${REPOSITORY}/main/themes/`;
const HASH = /^[a-f0-9]{64}$/;
const MAX_FILE = 20 * 1024 * 1024, MAX_PACK = 180 * 1024 * 1024;
export async function download(url, maxBytes, fetcher = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(45000), redirect: 'error', headers: { 'User-Agent': 'AgentWatch', 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw Error(`GitHub returned ${response.status}. Try again when online.`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw Error('Download is too large.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw Error('Download exceeded its size limit.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.themes) || catalog.themes.length > 200) throw Error('Unsupported theme catalog.');
  const ids = new Set();
  for (const t of catalog.themes) {
    if (!safeId(t.id) || ids.has(t.id) || !HASH.test(t.revision) || !/^\d+\.\d+\.\d+$/.test(t.version) || typeof t.name !== 'string' || typeof t.description !== 'string' || !Number.isSafeInteger(t.bytes) || t.bytes < 1 || t.bytes > MAX_PACK) throw Error('Invalid theme catalog entry.');
    ids.add(t.id);
  }
  return catalog;
}
export function validatePackage(p, id) {
  if (p?.schemaVersion !== 1 || p.id !== id || !Array.isArray(p.files) || !p.files.length || p.files.length > 505) throw Error('Invalid theme package.');
  const names = new Set(); let bytes = 0;
  for (const f of p.files) {
    if (!safePath(f.path) || names.has(f.path.toLowerCase()) || !HASH.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > MAX_FILE) throw Error('Unsafe or duplicate theme file.');
    names.add(f.path.toLowerCase()); bytes += f.bytes;
  }
  if (bytes > MAX_PACK || !names.has('theme.json')) throw Error('Theme package is incomplete or too large.');
  return p;
}
export class ThemeStore {
  constructor({ bundled, data, fetcher = fetch }) {
    Object.assign(this, { bundled, data, fetcher });
    this.root = path.join(data, 'themes'); this.registryFile = path.join(this.root, 'installed.json');
    this.catalog = { schemaVersion: 1, themes: [] }; this.registry = {}; this.busy = new Set();
    this.status = { state: 'idle', message: 'Bundled datacenter is available offline.' };
    this.writes = Promise.resolve();
  }
  async init() {
    await mkdir(path.join(this.root, 'personal'), { recursive: true });
    const registry = await json(this.registryFile, {});
    this.registry = Object.fromEntries(Object.entries(registry).filter(([id, r]) => safeId(id) && HASH.test(r?.revision)));
    try { this.catalog = validateCatalog(await json(path.join(this.root, 'catalog.json'))); } catch { /* Fresh install works offline. */ }
  }
  async persist() {
    this.writes = this.writes.catch(() => {}).then(() => atomicJson(this.registryFile, this.registry));
    return this.writes;
  }
  async location(id) {
    if (!safeId(id)) throw Error('Invalid theme ID.');
    const personal = path.join(this.root, 'personal', id);
    if (await stat(path.join(personal, 'theme.json')).catch(() => null)) return personal;
    if (this.registry[id]) return path.join(this.root, 'versions', id, this.registry[id].revision);
    if (id === 'datacenter') return path.join(this.bundled, 'datacenter');
    throw Error('Theme is not installed.');
  }
  async read(id) {
    const root = await this.location(id);
    const theme = validateTheme(await json(await checkedFile(root, 'theme.json')));
    if (theme.id !== id) throw Error('Theme identity does not match its folder.');
    return theme;
  }
  async list() {
    const ids = new Set(['datacenter', ...Object.keys(this.registry), ...await readdir(path.join(this.root, 'personal')).catch(() => [])]);
    const list = [];
    for (const id of ids) {
      try {
        const t = await this.read(id), personal = (await this.location(id)) === path.join(this.root, 'personal', id);
        list.push({ id, name: t.name, description: t.description, version: t.version, preview: t.preview, personal, bundled: id === 'datacenter', revision: personal ? null : await this.currentRevision(id) });
      } catch (e) { list.push({ id, name: id, error: e.message }); }
    }
    return list;
  }
  async refresh() {
    this.status = { state: 'checking', message: 'Checking the GitHub theme catalog…' };
    try {
      this.catalog = validateCatalog(JSON.parse((await download(`${RAW}index.json`, 512 * 1024, this.fetcher)).toString()));
      await atomicJson(path.join(this.root, 'catalog.json'), this.catalog);
      this.status = { state: 'ready', message: 'Theme catalog is current.', checkedAt: new Date().toISOString() };
    } catch (e) { this.status = { state: 'error', message: e.message }; throw e; }
    return this.catalog;
  }
  async currentRevision(id) {
    if (this.registry[id]) return this.registry[id].revision;
    if (id === 'datacenter') return digest(await readFile(path.join(this.bundled, 'datacenter', 'package.json')));
    return null;
  }
  async integrity(id) {
    const root = await this.location(id);
    try {
      const bytes = await readFile(await checkedFile(root, 'package.json'));
      if (digest(bytes) !== await this.currentRevision(id)) return false;
      const manifest = validatePackage(JSON.parse(bytes), id);
      for (const f of manifest.files) if (digest(await readFile(await checkedFile(root, f.path))) !== f.sha256) return false;
      return true;
    } catch { return false; }
  }
  async install(id) {
    if (this.busy.has(id)) throw Error('This theme is already being downloaded.');
    const entry = this.catalog.themes.find(t => t.id === id);
    if (!entry) throw Error('Theme is not in the trusted GitHub catalog.');
    this.busy.add(id);
    try {
      if (await stat(path.join(this.root, 'personal', id)).catch(() => null)) throw Error('A personal theme has this ID. Rename its copy before installing.');
      const current = await this.currentRevision(id);
      if (current && !await this.integrity(id)) throw Error(`${entry.name} has local edits. Make a personal copy before updating.`);
      if (current === entry.revision) return { id, changed: false };
      const bytes = await download(`${RAW}${id}/package.json`, 256 * 1024, this.fetcher);
      if (digest(bytes) !== entry.revision) throw Error('Theme changed during download. Refresh the catalog and retry.');
      const manifest = validatePackage(JSON.parse(bytes), id);
      const parent = path.join(this.root, 'versions', id), dest = path.join(parent, entry.revision);
      const stage = path.join(parent, `.staging-${randomUUID()}`);
      await mkdir(stage, { recursive: true });
      // Only complete packs are referenced by installed.json. Interrupted staging is inert.
      let cursor = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (cursor < manifest.files.length) {
          const f = manifest.files[cursor++];
          const data = await download(`${RAW}${id}/${f.path}`, Math.min(MAX_FILE, f.bytes), this.fetcher);
          if (data.length !== f.bytes || digest(data) !== f.sha256) throw Error(`Integrity check failed: ${f.path}`);
          const file = path.join(stage, f.path); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, data);
        }
      }));
      const theme = validateTheme(await json(path.join(stage, 'theme.json')));
      if (theme.id !== id || theme.version !== entry.version) throw Error('Downloaded theme identity does not match the catalog.');
      const files = new Set(manifest.files.map(f => f.path));
      if (themeFiles(theme).some(f => !files.has(f))) throw Error('Theme has missing assets.');
      await writeFile(path.join(stage, 'package.json'), bytes);
      try { await rename(stage, dest); } catch (e) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(e.code)) throw e;
        // A previous interrupted activation may already have this revision. Verify it.
        for (const f of manifest.files) if (digest(await readFile(await checkedFile(dest, f.path))) !== f.sha256) throw Error('An existing revision is damaged.');
      }
      const previous = this.registry[id];
      this.registry[id] = { revision: entry.revision, previousRevision: previous?.revision || null, version: theme.version, installedAt: new Date().toISOString() };
      try { await this.persist(); } catch (e) { if (previous) this.registry[id] = previous; else delete this.registry[id]; throw e; }
      return { id, changed: true };
    } finally { this.busy.delete(id); }
  }
  async updateInstalled() {
    const results = [];
    for (const id of new Set(['datacenter', ...Object.keys(this.registry)])) {
      const entry = this.catalog.themes.find(t => t.id === id);
      if (!entry || entry.revision === await this.currentRevision(id)) continue;
      try { results.push(await this.install(id)); } catch (e) { results.push({ id, error: e.message }); }
    }
    return results;
  }
  async importFolder(source, cloneId) {
    const original = validateTheme(await json(await checkedFile(source, 'theme.json')));
    const id = cloneId || `${original.id.slice(0, 48)}-${randomUUID().slice(0, 8)}`;
    if (!safeId(id)) throw Error('Invalid personal theme ID.');
    const dest = path.join(this.root, 'personal', id);
    if (await stat(dest).catch(() => null)) throw Error('Personal theme already exists.');
    await mkdir(dest, { recursive: true });
    let bytes = 0;
    for (const name of themeFiles(original).filter(n => n !== 'theme.json')) {
      const file = await checkedFile(source, name), s = await lstat(file);
      if (!s.isFile() || s.size > MAX_FILE || (bytes += s.size) > MAX_PACK) throw Error('Theme assets are too large or unsupported.');
      await mkdir(path.dirname(path.join(dest, name)), { recursive: true }); await copyFile(file, path.join(dest, name));
    }
    const theme = { ...original, id, name: `${original.name.slice(0, 65)} · Personal` };
    await atomicJson(path.join(dest, 'theme.json'), theme);
    return id;
  }
  async savePersonal(id, theme) {
    const root = await this.location(id);
    if (root !== path.join(this.root, 'personal', id)) throw Error('Make a personal copy before editing.');
    validateTheme(theme); if (theme.id !== id) throw Error('Keep the personal theme ID unchanged.');
    for (const name of themeFiles(theme).filter(f => f !== 'theme.json')) await checkedFile(root, name);
    await atomicJson(path.join(root, 'theme.json'), theme);
    return theme;
  }
  async replaceImage(id, relative, source) {
    const root = await this.location(id), theme = await this.read(id);
    if (root !== path.join(this.root, 'personal', id) || !themeFiles(theme).includes(relative) || relative === 'theme.json') throw Error('Choose an image in a personal theme.');
    if (path.extname(source).toLowerCase() !== path.extname(relative).toLowerCase()) throw Error('Replacement image must use the same file format.');
    const s = await stat(source); if (!s.isFile() || s.size > MAX_FILE) throw Error('Image is too large.');
    const target = await checkedFile(root, relative); await copyFile(source, target);
  }
}
