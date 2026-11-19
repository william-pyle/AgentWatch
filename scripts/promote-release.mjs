import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { repository, workflow, artifactName, sha256, json, verifyProducer, verifyBundle } from './release-bundle.mjs';

export function selectArtifact(artifacts, run, commit) {
  const matches = artifacts.filter(a => a.name === artifactName && !a.expired);
  assert.equal(matches.length, 1, 'Exactly one complete unexpired artifact is required');
  const artifact = matches[0];
  assert.equal(artifact.workflow_run.id, run.id);
  assert.equal(artifact.workflow_run.head_sha, commit);
  assert.equal(artifact.workflow_run.head_branch, 'main');
  assert.equal(artifact.workflow_run.repository_id, run.repository.id);
  assert.equal(artifact.workflow_run.head_repository_id, run.repository.id);
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/, 'GitHub archive digest is required');
  return artifact;
}

export function verifyArchive(bytes, artifact) {
  assert.equal(`sha256:${sha256(bytes)}`, artifact.digest, 'GitHub archive digest mismatch');
}

export function extractBundle(zip, dir, env = process.env) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($env:AW_ZIP)
    try {
      $names = @()
      foreach ($entry in $archive.Entries) {
        if ($entry.FullName -match '[/\\\\:]' -or $entry.FullName -eq '.' -or $entry.FullName -eq '..') { throw 'Unsafe archive entry' }
        if ($names -contains $entry.FullName) { throw 'Duplicate archive entry' }
        $names += $entry.FullName
      }
    } finally { $archive.Dispose() }
    Expand-Archive -LiteralPath $env:AW_ZIP -DestinationPath $env:AW_BUNDLE
  `], { env: { ...env, AW_ZIP: zip, AW_BUNDLE: dir } });
}

export async function promote(env = process.env, { fetchImpl = fetch, extract = extractBundle, root = process.cwd() } = {}) {
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_EVENT_NAME, 'push', 'Only an authorized tag push publishes');
  assert.match(env.GITHUB_SHA, /^[a-f0-9]{40}$/);
  const pkg = await json(path.join(root, 'package.json')), tag = `v${pkg.version}`;
  assert.equal(env.GITHUB_REF, `refs/tags/${tag}`, 'Tag must match package version');
  assert.ok(env.GH_TOKEN, 'GitHub token required');
  const base = `https://api.github.com/repos/${repository}`;
  async function request(url, options = {}) {
    const result = await fetchImpl(url, { ...options, headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', ...options.headers,
    } });
    if (!result.ok) throw new Error(`GitHub ${result.status}: ${new URL(url).pathname}`);
    return result;
  }
  const api = async (suffix, options) => (await request(base + suffix, options)).json();
  async function all(suffix, field) {
    const output = [];
    for (let page = 1; ; page++) {
      const data = await api(`${suffix}${suffix.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      output.push(...data[field]);
      if (data[field].length < 100) return output;
    }
  }
  const producerWorkflow = await api(`/actions/workflows/${path.basename(workflow)}`);
  const runs = await all(`/actions/workflows/${producerWorkflow.id}/runs?event=push&branch=main&head_sha=${env.GITHUB_SHA}`, 'workflow_runs');
  // Never fall back to an older successful attempt or a different commit.
  const candidate = runs.sort((a, b) => b.id - a.id)[0];
  assert.ok(candidate, 'No main push build for this commit; finish CI before tagging');
  const run = await api(`/actions/runs/${candidate.id}`);
  verifyProducer(run, env.GITHUB_SHA, producerWorkflow.id);
  const jobs = await all(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
  assert.ok(jobs.some(j => j.name === 'validate' && j.conclusion === 'success'), 'Required validate job did not pass');
  const artifact = selectArtifact(await all(`/actions/runs/${run.id}/artifacts`, 'artifacts'), run, env.GITHUB_SHA);
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'agent-watch-release-'));
  const archive = Buffer.from(await (await request(`${base}/actions/artifacts/${artifact.id}/zip`)).arrayBuffer());
  verifyArchive(archive, artifact);
  const zip = path.join(scratch, 'bundle.zip'), dir = path.join(scratch, 'bundle');
  await writeFile(zip, archive);
  // These paths are generated locally, never supplied by the manifest.
  extract(zip, dir, env);
  const manifest = await verifyBundle(root, dir, run, env.GITHUB_SHA);
  console.log(`Verified producer ${run.html_url}; artifact ${artifact.id}; commit ${manifest.commit}`);
  // Existing drafts and releases fail closed. Never replace published assets.
  const existing = await fetchImpl(`${base}/releases/tags/${tag}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}` } });
  assert.equal(existing.status, 404, 'Release already exists or cannot be checked');
  const release = await api('/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tag_name: tag, target_commitish: env.GITHUB_SHA, draft: true, prerelease: false,
    name: pkg.build.releaseInfo.releaseName, body: pkg.build.releaseInfo.releaseNotes,
  }) });
  const publishFiles = [...manifest.files, { name: 'release-manifest.json', sha256: sha256(await readFile(path.join(dir, 'release-manifest.json'))) }];
  for (const file of publishFiles) {
    await request(release.upload_url.replace(/\{.*$/, '') + '?name=' + encodeURIComponent(file.name), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await readFile(path.join(dir, file.name)),
    });
  }
  async function verifyUploaded() {
    const current = await api(`/releases/${release.id}`);
    assert.deepEqual(current.assets.map(a => a.name).sort(), publishFiles.map(f => f.name).sort(), 'Uploaded asset set');
    for (const file of publishFiles) {
      const asset = current.assets.find(a => a.name === file.name);
      assert.equal(asset.state, 'uploaded');
      const bytes = Buffer.from(await (await request(asset.url, { headers: { Accept: 'application/octet-stream' } })).arrayBuffer());
      assert.equal(sha256(bytes), file.sha256, `Uploaded ${file.name} checksum`);
    }
  }
  await verifyUploaded();
  await api(`/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'true' }) });
  await verifyUploaded();
  console.log(`Published and verified ${release.html_url}; installation is a separate user action.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await promote();
