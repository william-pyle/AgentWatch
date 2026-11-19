import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { repository, workflow, artifactName, sha256, filenames, buildIdentity, verifyProducer, verifyUpdater, verifyBundle } from '../scripts/release-bundle.mjs';
import { selectArtifact, verifyArchive, promote, extractBundle } from '../scripts/promote-release.mjs';
const root = path.resolve(import.meta.dirname, '..'), commit = 'a'.repeat(40);
const run = { id: 12, run_attempt: 1, repository: { id: 3, full_name: repository }, head_repository: { full_name: repository }, workflow_id: 9, path: workflow, event: 'push', head_branch: 'main', head_sha: commit, status: 'completed', conclusion: 'success', html_url: 'https://github.com/example/run' };
const archive = Buffer.from('mock archive');
const artifact = { id: 42, name: artifactName, expired: false, digest: `sha256:${sha256(archive)}`, workflow_run: { id: 12, head_sha: commit, head_branch: 'main', repository_id: 3, head_repository_id: 3 } };

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aw-bundle-test-'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'))), names = filenames(pkg.version);
  const exe = Buffer.from('synthetic installer'), blockmap = Buffer.from('synthetic blockmap');
  const hash = createHash('sha512').update(exe).digest('base64');
  const metadata = Buffer.from(`version: ${pkg.version}\nfiles:\n  - url: ${names[0]}\n    sha512: ${hash}\n    size: ${exe.length}\npath: ${names[0]}\nsha512: ${hash}\nreleaseDate: '2026-11-18'\n`);
  const bytes = [exe, blockmap, metadata];
  const manifest = { schema: 1, repository, workflow, commit, runId: 12, runAttempt: 1, ...await buildIdentity(root, pkg), files: names.map((name, i) => ({ name, size: bytes[i].length, sha256: sha256(bytes[i]) })) };
  await Promise.all(names.map((name, i) => writeFile(path.join(dir, name), bytes[i])));
  await writeFile(path.join(dir, 'release-manifest.json'), JSON.stringify(manifest));
  return { dir, pkg, names, bytes, manifest };
}

test('producer gate rejects wrong repository, workflow, commit, branch, event and unsuccessful state', () => {
  verifyProducer(run, commit, 9);
  const mutations = [
    { repository: { full_name: 'other/repo' } }, { head_repository: { full_name: 'other/repo' } },
    { workflow_id: 10 }, { path: '.github/workflows/other.yml' }, { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' }, { event: 'pull_request' }, { event: 'workflow_dispatch' },
    { status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' },
  ];
  for (const change of mutations) assert.throws(() => verifyProducer({ ...run, ...change }, commit, 9), JSON.stringify(change));
});

test('artifact selection requires one unexpired exact-run artifact and trusted archive digest', () => {
  assert.equal(selectArtifact([artifact], run, commit), artifact);
  for (const list of [[], [artifact, artifact], [{ ...artifact, expired: true }], [{ ...artifact, digest: null }],
    ...['id', 'head_sha', 'head_branch', 'repository_id', 'head_repository_id'].map(key => [{ ...artifact, workflow_run: { ...artifact.workflow_run, [key]: 'wrong' } }])]) {
    assert.throws(() => selectArtifact(list, run, commit));
  }
  verifyArchive(archive, artifact);
  assert.throws(() => verifyArchive(Buffer.from('tampered'), artifact));
});

test('bundle verifies immutable assets, updater SHA-512 and exact toolchain/source identity', async () => {
  const f = await fixture();
  await verifyBundle(root, f.dir, run, commit);
  for (const key of ['commit', 'version', 'target', 'node', 'runner', 'electron', 'builder', 'features', 'runId', 'runAttempt', 'repository', 'workflow', 'inputs']) {
    await writeFile(path.join(f.dir, 'release-manifest.json'), JSON.stringify({ ...f.manifest, [key]: 'wrong' }));
    await assert.rejects(verifyBundle(root, f.dir, run, commit), undefined, key);
  }
  await writeFile(path.join(f.dir, 'release-manifest.json'), JSON.stringify(f.manifest));
  await writeFile(path.join(f.dir, f.names[1]), 'changed');
  await assert.rejects(verifyBundle(root, f.dir, run, commit));
  await writeFile(path.join(f.dir, f.names[1]), f.bytes[1]);
  await writeFile(path.join(f.dir, 'unexpected.exe'), 'extra');
  await assert.rejects(verifyBundle(root, f.dir, run, commit));
});

test('updater rejects wrong version, paths, size, hash, duplicates and extra file records', async () => {
  const f = await fixture(), text = f.bytes[2].toString();
  for (const changed of [text.replace('version: ' + f.pkg.version, 'version: 9.9.9'), text.replace('size: 19', 'size: 20'),
    text.replace('url: Agent-', 'url: ../Agent-'), text.replace('sha512: ', 'sha512: AAA'), text + 'path: evil.exe\n',
    text.replace('\npath:', '\n  - url: evil.exe\npath:')]) assert.throws(() => verifyUpdater(Buffer.from(changed), f.bytes[0], f.pkg.version));
});

test('native extraction accepts flat files and rejects traversal and duplicate entries before writing', { skip: process.platform !== 'win32' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aw-zip-test-'));
  for (const [i, names] of [['safe.txt'], ['../escaped.txt'], ['nested/file.txt'], ['same.txt', 'same.txt']].entries()) {
    const zip = path.join(temp, `${i}.zip`), dir = path.join(temp, `${i}-out`);
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $zip = [System.IO.Compression.ZipFile]::Open($env:AW_TEST_ZIP, 'Create')
      try { foreach ($name in ($env:AW_TEST_NAMES | ConvertFrom-Json)) { $null = $zip.CreateEntry($name) } } finally { $zip.Dispose() }
    `], { env: { ...process.env, AW_TEST_ZIP: zip, AW_TEST_NAMES: JSON.stringify(names) } });
    if (i === 0) { extractBundle(zip, dir); assert.equal((await readFile(path.join(dir, 'safe.txt'))).length, 0); }
    else assert.throws(() => extractBundle(zip, dir));
  }
});

async function simulate({ failure, envChange = {} } = {}) {
  const f = await fixture(), writes = [], stored = new Map();
  const env = { GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: commit, GITHUB_REF: `refs/tags/v${f.pkg.version}`, GH_TOKEN: 'synthetic', ...envChange };
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url), p = u.pathname, method = opts.method || 'GET';
    if (method !== 'GET') writes.push({ method, p, body: opts.body });
    if (p.endsWith('/actions/workflows/windows.yml')) return respond({ id: 9 });
    if (p.endsWith('/actions/workflows/9/runs')) return respond({ workflow_runs: failure === 'missing-run' ? [] : [run] });
    if (p.endsWith('/actions/runs/12')) return respond({ ...run, ...(failure === 'failed-ci' ? { conclusion: 'failure' } : {}) });
    if (p.endsWith('/attempts/1/jobs')) return respond({ jobs: [{ name: 'validate', conclusion: failure === 'failed-job' ? 'skipped' : 'success' }] });
    if (p.endsWith('/actions/runs/12/artifacts')) return respond({ artifacts: failure === 'missing-artifact' ? [] : [artifact] });
    if (p.endsWith('/actions/artifacts/42/zip')) return new Response(failure === 'archive-hash' ? 'bad' : archive);
    if (p.includes('/releases/tags/')) return respond({}, failure === 'existing-release' ? 200 : 404);
    if (p.endsWith('/releases') && method === 'POST') return respond({ id: 7, upload_url: 'https://uploads.github.com/upload{?name}', html_url: 'https://github.com/example/release' });
    if (p === '/upload') { stored.set(u.searchParams.get('name'), opts.body); return respond({}); }
    if (p.endsWith('/releases/7') && method === 'GET') return respond({ assets: [...stored.keys()].map(name => ({ name, state: 'uploaded', url: `https://api.github.com/assets/${name}` })) });
    if (p.startsWith('/assets/')) return new Response(failure === 'uploaded-hash' ? 'bad' : stored.get(p.slice(8)));
    if (p.endsWith('/releases/7') && method === 'PATCH') return respond({});
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  try {
    await promote(env, { root, fetchImpl, extract: (_zip, dir) => cpSync(f.dir, dir, { recursive: true }) });
  } catch (error) {
    return { writes, error };
  }
  return { writes };
}

test('promotion uploads verified bytes into a draft and publishes only after download verification', async () => {
  const { writes, error } = await simulate();
  assert.ifError(error);
  assert.equal(writes.length, 6);
  assert.equal(JSON.parse(writes[0].body).draft, true);
  assert.equal(writes.filter(w => w.p === '/upload').length, 4);
  assert.equal(writes.at(-1).method, 'PATCH');
  assert.equal(JSON.parse(writes.at(-1).body).draft, false);
});

test('promotion never writes on failed gate, missing artifact, altered archive or existing release', async () => {
  for (const failure of ['missing-run', 'failed-ci', 'failed-job', 'missing-artifact', 'archive-hash', 'existing-release']) {
    const { writes, error } = await simulate({ failure });
    assert.ok(error, failure);
    assert.deepEqual(writes, [], failure);
  }
  for (const envChange of [{ GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/tags/v9.9.9' }, { GITHUB_REPOSITORY: 'other/repo' }]) {
    const { writes, error } = await simulate({ envChange });
    assert.ok(error); assert.deepEqual(writes, []);
  }
});

test('uploaded byte mismatch leaves a draft and never publishes', async () => {
  const { writes, error } = await simulate({ failure: 'uploaded-hash' });
  assert.ok(error);
  assert.ok(writes.some(w => w.method === 'POST'));
  assert.ok(!writes.some(w => w.method === 'PATCH'));
});

test('workflow retains full CI once, no release rebuild, isolated concurrency and explicit retention', async () => {
  const text = await readFile(path.join(root, workflow), 'utf8');
  const [producer, release] = text.split('  release:');
  for (const command of ['npm test', 'npm run test:desktop', 'npm run build']) assert.equal(producer.split(`run: ${command}\n`).length - 1, 1);
  assert.doesNotMatch(producer, /run: npm run themes:check/);
  assert.match(producer, /retention-days: 30/);
  assert.match(producer, /if-no-files-found: error/);
  assert.match(producer, /cancel-in-progress:.*!startsWith/);
  assert.doesNotMatch(release, /npm ci|electron-builder|npm run build|npm test/);
  assert.match(release, /actions: read/);
  assert.match(release, /node scripts\/promote-release.mjs/);
});
