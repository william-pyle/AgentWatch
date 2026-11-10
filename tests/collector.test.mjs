import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm, utimes } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { applyRecord, excerpt, VillageCollector } from '../src/collector/collector.mjs';
import { withAgentIdentity, withAgentIdentities } from '../src/collector/identities.mjs';

const now = Date.now();
const iso = new Date(now).toISOString();
const record = (type, payload, extra = {}) => ({ type, timestamp: iso, payload, ...extra });
const line = value => JSON.stringify(value) + '\n';
const agent = overrides => ({ id: 'test', provider: 'Codex', lastSeen: iso, sequence: 0, tools: 0, turns: 0, state: 'unknown', ...overrides });
async function fixture(t) {
  await mkdir('.test-output', { recursive: true });
  const root = await mkdtemp(path.resolve('.test-output/village-test-'));
  t.after(() => { assert.ok(root.startsWith(path.resolve('.test-output') + path.sep)); return rm(root, { recursive: true, force: true }); });
  const repo = path.join(root, 'repo'), codexHome = path.join(root, 'codex'), claudeHome = path.join(root, 'claude');
  const folder = path.join(codexHome, 'sessions/2026/10/16');
  await mkdir(path.join(repo, '.alpha'), { recursive: true }); await mkdir(folder, { recursive: true });
  const collector = new VillageCollector({ repo, codexHome, claudeHome, now: () => now });
  return { root, repo, codexHome, claudeHome, folder, collector };
}

test('only native completion marks a turn finished; silence, output, final previews and reasoning do not', () => {
  const value = agent(), events = [];
  const apply = r => applyRecord(value, r, event => events.push(event));
  apply(record('event_msg', { type: 'task_started' }));
  apply(record('response_item', { type: 'reasoning', summary: [{ text: 'PRIVATE REASONING' }] }));
  apply(record('response_item', { type: 'custom_tool_call', name: 'exec', input: 'PRIVATE COMMAND' }));
  apply(record('response_item', { type: 'custom_tool_call_output', output: 'PRIVATE RESULT' }));
  apply(record('response_item', { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Ready for review' }] }));
  assert.equal(value.state, 'working'); assert.equal(value.turns, 0); assert.equal(value.tools, 1);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
  apply(record('event_msg', { type: 'task_complete', turn_id: 'turn-1' }));
  apply(record('event_msg', { type: 'task_complete', turn_id: 'turn-1' }));
  assert.equal(value.state, 'completed'); assert.equal(value.turns, 1);
  apply(record('event_msg', { type: 'task_started' }));
  assert.equal(value.state, 'working');
});

test('delegates exclude inherited fork history and redact credential patterns from public progress', () => {
  const value = agent({ historyStart: 25 }), events = [];
  applyRecord(value, record('event_msg', { type: 'task_complete' }, { ordinal: 9 }), event => events.push(event));
  assert.equal(value.turns, 0);
  applyRecord(value, record('response_item', { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Checking api_key=supersecret and Bearer abcdefghijklmnop' }] }, { ordinal: 26 }), event => events.push(event));
  assert.doesNotMatch(value.detail, /supersecret|abcdefghijklmnop/);
  assert.match(value.detail, /redacted/);
  assert.equal(excerpt('x'.repeat(300)).length, 220);
});

test('incremental records handle partial UTF-8, attach delegates to leads, exclude other repositories, and do not replay', async t => {
  const { repo, folder, collector } = await fixture(t);
  const leadFile = path.join(folder, 'rollout-lead.jsonl'), childFile = path.join(folder, 'rollout-child.jsonl');
  await writeFile(leadFile, line(record('session_meta', { id: 'lead', cwd: repo, timestamp: iso })) + line(record('event_msg', { type: 'task_started' })));
  await writeFile(childFile, line(record('session_meta', { id: 'child', cwd: repo, timestamp: iso, parent_thread_id: 'lead', agent_path: '/root/terrain_review', agent_nickname: 'Willow' })) + line(record('response_item', { type: 'custom_tool_call', name: 'apply_patch' })));
  await writeFile(path.join(folder, 'unrelated.jsonl'), line(record('session_meta', { id: 'unrelated', cwd: path.dirname(repo), timestamp: iso })));
  await writeFile(path.join(repo, '.alpha/sessions.json'), JSON.stringify([{ id: 'managed', nativeId: 'lead', open: true, name: 'Build Mooseville' }]));
  let data = await collector.snapshot();
  assert.equal(data.agents.length, 2);
  const lead = data.agents.find(x => x.nativeId === 'lead'), child = data.agents.find(x => x.nativeId === 'child');
  assert.equal(lead.role, 'coordinator'); assert.equal(lead.name, 'Build Mooseville'); assert.equal(lead.sourceName, 'Build Mooseville'); assert.equal(child.parentId, lead.id);
  assert.equal(child.functionLabel, 'Terrain Review'); assert.equal(child.sourceName, 'Terrain Review'); assert.equal(child.tools, 1);
  const count = data.events.length;
  assert.equal((await collector.snapshot()).events.length, count);
  const text = Buffer.from(line(record('response_item', { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Reviewing moose 🫎' }] })));
  const split = text.indexOf(Buffer.from('🫎')) + 2;
  await appendFile(childFile, text.subarray(0, split));
  assert.equal((await collector.snapshot()).events.length, count);
  await appendFile(childFile, text.subarray(split));
  data = await collector.snapshot();
  assert.equal(data.agents.find(x => x.nativeId === 'child').detail, 'Reviewing moose 🫎');
  assert.equal(data.events.length, count + 1);
});

test('quiet work remains unconfirmed and saved chats cannot masquerade as a live feed', async t => {
  const { repo, folder, collector } = await fixture(t);
  await writeFile(path.join(folder, 'quiet.jsonl'), line(record('session_meta', { id: 'quiet', cwd: repo, timestamp: iso })) + line(record('event_msg', { type: 'task_started' }, { timestamp: new Date(now - 240000).toISOString() })));
  await writeFile(path.join(repo, '.alpha/sessions.json'), JSON.stringify([{ id: 'saved', open: true, name: 'Saved chat', activity: 'working', status: 'running', createdAt: iso }]));
  const data = await collector.snapshot();
  assert.equal(data.agents.find(x => x.nativeId === 'quiet').state, 'quiet');
  assert.equal(data.agents.find(x => x.id === 'managed:saved').state, 'unknown');
  assert.equal(data.dispatcher.observed, false); assert.equal(data.dispatcher.state, 'unavailable');
});

test('Claude mode headers and sidechain files are discovered without exposing thinking blocks', async t => {
  const { repo, claudeHome, collector } = await fixture(t);
  const folder = path.join(claudeHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(path.join(folder, 'root/subagents'), { recursive: true });
  const head = line({ type: 'mode', sessionId: 'claude-lead' });
  const user = { type: 'user', cwd: repo, sessionId: 'claude-lead', timestamp: iso, message: { content: [{ type: 'text', text: 'Review world' }] } };
  await writeFile(path.join(folder, 'root.jsonl'), head + line(user));
  await writeFile(path.join(folder, 'root/subagents/agent-123.jsonl'), line({ ...user, isSidechain: true }) + line({ type: 'assistant', isSidechain: true, timestamp: iso, message: { id: 'final', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'DO NOT DISPLAY' }, { type: 'text', text: 'Reviewed' }] } }));
  const data = await collector.snapshot();
  assert.equal(data.agents.length, 2);
  const child = data.agents.find(x => x.role === 'delegate');
  assert.equal(child.state, 'completed'); assert.equal(child.turns, 1); assert.ok(child.parentId);
  assert.doesNotMatch(JSON.stringify(data), /DO NOT DISPLAY/);
});

test('24-hour counters expire while a long-running collector stays online', async t => {
  const { repo, folder, collector } = await fixture(t);
  const file = path.join(folder, 'rolling.jsonl');
  await writeFile(file, line(record('session_meta', { id: 'rolling', cwd: repo, timestamp: iso })) + line(record('response_item', { type: 'custom_tool_call', name: 'exec' })));
  assert.equal((await collector.snapshot()).agents[0].tools, 1);
  const later = now + 86400000 + 1000;
  collector.now = () => later;
  await appendFile(file, line({ type: 'event_msg', timestamp: new Date(later).toISOString(), payload: { type: 'task_started' } }));
  await utimes(file, new Date(later), new Date(later));
  const data = await collector.snapshot();
  assert.equal(data.agents[0].tools, 0); assert.equal(data.agents[0].turns, 0);
});

test('authenticated desktop data supplies live dispatcher state without leaking service credentials', async t => {
  const { repo, collector } = await fixture(t);
  const token = 'private-fixture-credential';
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/api/bootstrap'); assert.equal(request.headers.authorization, `Bearer ${token}`);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ coordinator: 'working', sessions: [{ id: 'live-chat', name: 'Terrain cleanup', open: true, agent: 'kimi', activity: 'waiting', createdAt: iso, updatedAt: iso }], operations: [{ id: 'op', at: iso, text: 'Inspect terrain', status: 'running' }], voiceHistory: ['PRIVATE TRANSCRIPT'] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await writeFile(path.join(repo, '.alpha/runtime.json'), JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}`, token }));
  const data = await collector.snapshot();
  assert.equal(data.dispatcher.state, 'working'); assert.equal(data.dispatcher.observed, true);
  assert.equal(data.agents[0].state, 'waiting'); assert.equal(data.agents[0].source, 'service');
  assert.doesNotMatch(JSON.stringify(data), /private-fixture-credential|PRIVATE TRANSCRIPT/);
});
