import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicJson, digest } from './files.mjs';
import { safeId } from '../shared/theme.mjs';
import { applyLayout, diffLayout } from '../shared/layout.mjs';
export const themeRevision = theme => digest(Buffer.from(JSON.stringify(theme)));
export class LayoutStore {
  constructor(data) { this.root = path.join(data, 'layouts'); this.queue = Promise.resolve(); }
  file(id) { if (!safeId(id)) throw Error('Invalid layout identity.'); return path.join(this.root, `${id}.json`); }
  async read(id) {
    let bytes;
    try { bytes = await readFile(this.file(id)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    return { bytes, revision: digest(bytes) };
  }
  async state(base) {
    const saved = await this.read(base.id), revision = saved?.revision || null;
    try {
      const patch = saved ? JSON.parse(saved.bytes) : null;
      return { ...applyLayout(base, patch), revision, modified: !!patch, baseRevision: themeRevision(base) };
    } catch (e) { return { theme: structuredClone(base), revision, modified: !!saved, baseRevision: themeRevision(base), warnings: [e.message] }; }
  }
  save(base, draft, expected) {
    const operation = this.queue.catch(() => {}).then(async () => {
      const existing = await this.read(base.id);
      if (expected?.revision !== (existing?.revision || null)) throw Error('This layout was changed elsewhere. Cancel and reopen the editor before saving.');
      if (expected?.baseRevision !== themeRevision(base)) throw Error('The theme was updated while you were editing. Your draft is still open. Cancel and reopen the editor to use the update.');
      if (JSON.stringify(draft).length > 2_000_000) throw Error('Layout is too large.');
      const patch = diffLayout(base, draft);
      patch.savedAt = new Date().toISOString(); patch.editId = randomUUID();
      // Retain the prior user layout for recovery, including a layout an update cannot apply.
      if (existing) {
        let previous; try { previous = JSON.parse(existing.bytes); } catch { previous = { recoveryText: existing.bytes.toString('utf8') }; }
        await atomicJson(path.join(this.root, `${base.id}.previous.json`), previous);
      }
      await atomicJson(this.file(base.id), patch);
      return this.state(base);
    });
    this.queue = operation; return operation;
  }
}
