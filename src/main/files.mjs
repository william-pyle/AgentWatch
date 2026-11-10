import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const contained = (root, file) => { const r = path.relative(path.resolve(root), path.resolve(file)); return r === '' || !r.startsWith('..') && !path.isAbsolute(r); };
export async function checkedFile(root, relative) {
  const file = path.resolve(root, relative);
  if (!contained(root, file) || !contained(await realpath(root), await realpath(file))) throw Error('File is outside its theme folder.');
  return file;
}
export async function json(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (fallback !== undefined && (error.code === 'ENOENT' || error instanceof SyntaxError)) return fallback; throw error; } }
export async function atomicJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n');
  await rename(temp, file);
}
