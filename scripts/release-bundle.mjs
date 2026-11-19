import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = 'william-pyle/AgentWatch';
export const workflow = '.github/workflows/windows.yml';
export const artifactName = 'Agent-Watch-Windows-x64';
export const nodeVersion = 'v24.22.2';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const filenames = version => [`Agent-Watch-Setup-${version}-x64.exe`, `Agent-Watch-Setup-${version}-x64.exe.blockmap`, 'latest.yml'];
export const json = async file => JSON.parse(await readFile(file, 'utf8'));

export function verifyProducer(run, commit, workflowId) {
  assert.equal(run.repository.full_name, repository, 'Producer repository');
  assert.equal(run.head_repository.full_name, repository, 'Producer head repository');
  assert.equal(run.workflow_id, workflowId, 'Producer workflow ID');
  assert.equal(run.path, workflow, 'Producer workflow path');
  assert.equal(run.event, 'push', 'Only main push builds can be promoted');
  assert.equal(run.head_branch, 'main', 'Producer branch');
  assert.equal(run.head_sha, commit, 'Producer commit');
  assert.equal(run.status, 'completed', 'Producer must be complete');
  assert.equal(run.conclusion, 'success', 'Required Windows CI gate');
}

export async function buildIdentity(root, pkg) {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Stable release version');
  return {
    version: pkg.version, target: 'windows-x64-nsis', runner: 'windows-2025',
    node: nodeVersion, electron: pkg.devDependencies.electron,
    builder: pkg.devDependencies['electron-builder'], features: 'default',
    inputs: Object.fromEntries(await Promise.all(['package.json', 'package-lock.json', workflow,
      'scripts/release-bundle.mjs', 'scripts/promote-release.mjs'].map(async file => [file, sha256(await readFile(path.join(root, file)))]))),
  };
}

export function verifyUpdater(bytes, exe, version) {
  // Fail closed if electron-builder changes its single Windows x64 file format.
  const text = bytes.toString('utf8').replaceAll('\r\n', '\n');
  const header = text.match(/^version: (\d+\.\d+\.\d+)\nfiles:\n  - url: ([\w.-]+)\n    sha512: ([A-Za-z0-9+/=]+)\n    size: (\d+)\npath: ([\w.-]+)\nsha512: ([A-Za-z0-9+/=]+)\n/);
  assert.ok(header, 'Unsupported updater metadata');
  const digest = createHash('sha512').update(exe).digest('base64');
  assert.deepEqual(header.slice(1), [version, filenames(version)[0], digest, String(exe.length), filenames(version)[0], digest], 'Updater checksum, size, version and path');
  assert.doesNotMatch(text.slice(header[0].length), /^(version|files|path|sha512):/m, 'Duplicate updater fields');
}

export async function seal(root, env = process.env) {
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, nodeVersion);
  const pkg = await json(path.join(root, 'package.json'));
  const names = filenames(pkg.version), dir = path.join(root, 'dist');
  const bytes = await Promise.all(names.map(name => readFile(path.join(dir, name))));
  verifyUpdater(bytes[2], bytes[0], pkg.version);
  const manifest = { schema: 1, repository, workflow, commit: env.GITHUB_SHA,
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    ...await buildIdentity(root, pkg),
    files: names.map((name, i) => ({ name, size: bytes[i].length, sha256: sha256(bytes[i]) })),
  };
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  assert.ok(manifest.runId > 0 && manifest.runAttempt > 0);
  await writeFile(path.join(dir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

export async function verifyBundle(root, dir, run, commit) {
  const pkg = await json(path.join(root, 'package.json'));
  const manifest = await json(path.join(dir, 'release-manifest.json'));
  const expected = { schema: 1, repository, workflow, commit, runId: run.id, runAttempt: run.run_attempt, ...await buildIdentity(root, pkg) };
  const { files, ...identity } = manifest;
  assert.deepEqual(identity, expected, 'Artifact provenance and build inputs');
  const names = filenames(pkg.version);
  assert.deepEqual(files.map(f => f.name), names, 'Exact release asset allowlist');
  assert.deepEqual((await readdir(dir)).sort(), [...names, 'release-manifest.json'].sort(), 'Unexpected bundle entries');
  const bytes = [];
  for (const file of files) {
    const location = path.join(dir, file.name);
    assert.ok((await lstat(location)).isFile(), 'Expected regular asset');
    const data = await readFile(location);
    assert.equal(data.length, file.size, `${file.name} size`);
    assert.equal(sha256(data), file.sha256, `${file.name} SHA-256`);
    bytes.push(data);
  }
  verifyUpdater(bytes[2], bytes[0], pkg.version);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], 'seal');
  await seal(process.cwd());
}
