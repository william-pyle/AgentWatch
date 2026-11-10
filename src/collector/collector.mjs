import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { withAgentIdentities } from './identities.mjs';
import { observeCommunication, communicationSnapshot } from './communications.mjs';

const DAY = 86400000;
const clean = value => String(value || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\b(?:sk-[\w-]{12,}|Bearer\s+[\w.\/-]{12,})/gi, '[redacted]').replace(/\b((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)["']?[^\s,"'}]+/gi, '$1[redacted]').replace(/\s+/g, ' ').trim();
export const excerpt = (value, max = 220) => { const text = clean(value); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const contained = (root, value) => { const relative = path.relative(path.resolve(root), path.resolve(value || '.')); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
const texts = content => typeof content === 'string' ? content : (content || []).filter(x => ['text', 'input_text', 'output_text'].includes(x.type)).map(x => x.text || '').join(' ');
const friendlyName = value => String(value || '').split('/').pop().replace(/[_-]+/g, ' ').replace(/\b\w/g, x => x.toUpperCase());

export function toolAction(name, input = '') {
  const value = String(name || '').toLowerCase().split('.').at(-1);
  if (value === 'exec') {
    if (/tools\.apply_patch\(/.test(input)) return ['build', 'Editing project files'];
    if (/node --test|npm (?:run )?(?:test|build)|pytest|playwright|tsc --/.test(input)) return ['review', 'Running project checks'];
    if (/tools\.web__|search_query/.test(input)) return ['research', 'Researching a reference'];
    if (/tools\.view_image\(/.test(input)) return ['review', 'Reviewing a local image'];
    if (/Get-Content|\brg (?:-n|--files)|readFile\(/.test(input)) return ['read', 'Reading project material'];
  }
  if (/spawn_agent|open_chat|task$|^agent$/.test(value)) return ['delegate', 'Delegating work'];
  if (/send_message|followup_task|send_to_chat/.test(value)) return ['message', 'Sending a teammate message'];
  if (/wait_agent|list_agents/.test(value)) return ['coordinate', 'Checking on the team'];
  if (/apply_patch|write_file|edit_file|multiedit|^edit$|^write$/.test(value)) return ['build', 'Editing project files'];
  if (/web|search|browse/.test(value)) return ['research', 'Researching a reference'];
  if (/view_image|screenshot|image/.test(value)) return ['review', 'Reviewing visuals'];
  if (/blender|tripo|unreal/.test(value)) return ['build', 'Working on a game asset'];
  if (/read|glob|grep/.test(value)) return ['read', 'Reading project material'];
  if (value === 'exec') return ['tool', 'Running a tool batch'];
  if (/exec|bash|powershell|terminal/.test(value)) return ['tool', 'Using a terminal tool'];
  if (/wait|sleep/.test(value)) return ['wait', 'Waiting for a tool'];
  return ['tool', `Using ${excerpt(name || 'a tool', 65)}`];
}

export function applyRecord(agent, record, emit) {
  if (Number.isFinite(record.ordinal) && record.ordinal < (agent.historyStart || 0)) return;
  observeCommunication(agent, record);
  const at = record.timestamp || record.created_at || agent.lastSeen;
  const payload = record.payload || {};
  const recent = !agent.since || Date.parse(at) >= agent.since;
  const count = kind => { if (recent) { agent[kind]++; (agent[`${kind}Times`] ||= []).push(Date.parse(at)); } };
  const event = (kind, text) => { agent.lastSeen = at || agent.lastSeen; emit({ id: `${agent.id}:${agent.sequence++}`, agentId: agent.id, at: agent.lastSeen, kind, text: excerpt(text) }); };
  const working = () => { agent.state = 'working'; agent.lastSeen = at || agent.lastSeen; };
  if (agent.provider === 'Claude') {
    if (record.isMeta || record.isSidechain && !agent.isDelegate) return;
    if (record.type === 'user' && record.message?.content) {
      const content = record.message.content;
      if (texts(content).startsWith('[Request interrupted')) { agent.state = 'interrupted'; event('interrupted', 'Turn interrupted'); }
      else { working(); if (typeof content === 'string' || content.some(x => x.type === 'text')) event('started', 'A new turn started'); }
    }
    if (record.type !== 'assistant') return;
    const content = record.message?.content || [];
    for (const item of content) {
      if (item.type === 'tool_use') { working(); count('tools'); agent.toolName = item.name; const [kind, label] = toolAction(item.name); agent.action = label; event(kind, label); }
      if (item.type === 'text' && item.text) { agent.detail = excerpt(item.text); agent.lastSeen = at || agent.lastSeen; }
    }
    if (record.message?.stop_reason !== 'end_turn' && content.some(x => x.type === 'text')) working();
    if (record.message?.stop_reason === 'end_turn' && content.some(x => x.type === 'text') && (!record.message.id || agent.lastCompletionId !== record.message.id)) { agent.lastCompletionId = record.message.id; agent.state = 'completed'; count('turns'); agent.action = 'Turn finished · ready for review'; event('completed', agent.action); }
    if (agent.questionAt && agent.state !== 'completed') { agent.state = 'waiting'; agent.action = 'Awaiting your answer'; }
    return;
  }
  if (record.type === 'turn_context' && payload.model) agent.model = excerpt(payload.model, 60);
  if (record.type === 'event_msg') {
    if (payload.type === 'task_started') { working(); agent.action = 'Starting a new turn'; event('started', 'A new turn started'); }
    if (payload.type === 'task_complete' && (!payload.turn_id || agent.lastCompletionId !== payload.turn_id)) { agent.lastCompletionId = payload.turn_id; agent.state = 'completed'; count('turns'); agent.action = 'Turn finished · ready for review'; event('completed', agent.action); }
    if (payload.type === 'turn_aborted') { agent.state = 'interrupted'; agent.action = 'Turn interrupted'; event('interrupted', agent.action); }
    if (payload.type === 'user_message' && !agent.task) {
      const text = clean(payload.message);
      if (text && !/^(# AGENTS|<environment|<INSTRUCTIONS|<permissions)/i.test(text)) agent.task = excerpt(text, 120);
    }
  }
  if (record.type !== 'response_item') return;
  if (['function_call', 'custom_tool_call'].includes(payload.type)) {
    working(); count('tools');
    agent.toolName = payload.name; const [kind, label] = toolAction(payload.name, payload.input || payload.arguments || ''); agent.action = label; event(kind, label);
  }
  if (payload.type === 'message' && payload.role === 'assistant') {
    const text = texts(payload.content);
    if (payload.phase === 'commentary' && text) { working(); agent.detail = excerpt(text); event('update', text); }
    // A final message is a preview, not proof that the native turn completed.
    if (payload.phase === 'final_answer' && text) { agent.detail = excerpt(text); agent.lastSeen = at || agent.lastSeen; }
  }
}

async function json(file, fallback = null) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
async function filesUnder(root, depth = 4) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory() && depth > 0) result.push(...await filesUnder(file, depth - 1));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(file);
  }
  return result;
}

export class VillageCollector {
  constructor({ repo, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), providers = ['Codex', 'Claude'], includeManaged = true, now = () => Date.now() }) {
    Object.assign(this, { repo: path.resolve(repo), codexHome, claudeHome, providers, includeManaged, now });
    this.files = new Map(); this.agents = new Map(); this.events = []; this.scanAt = 0; this.discovery = [];
  }
  emit(event) { this.events.push(event); if (this.events.length > 500) this.events.sort((a, b) => String(a.at).localeCompare(String(b.at))).splice(0, this.events.length - 300); }
  async discover(managed) {
    const known = new Set(managed.filter(x => x.open).map(x => x.nativeId).filter(Boolean));
    const codex = this.providers.includes('Codex') ? await filesUnder(path.join(this.codexHome, 'sessions')) : [];
    const escaped = this.repo.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const projects = path.join(this.claudeHome, 'projects');
    const matches = this.providers.includes('Claude') ? (await readdir(projects).catch(() => [])).filter(x => x.toLowerCase() === escaped || x.toLowerCase().startsWith(`${escaped}-`)) : [];
    // Sessions launched in a project subdirectory have their own Claude folder.
    // readNative still verifies cwd containment before admitting any session.
    const claude = (await Promise.all(matches.map(folder => filesUnder(path.join(projects, folder), 3)))).flat();
    const candidates = [];
    for (const [provider, files] of [['Codex', codex], ['Claude', claude]]) for (const file of files) {
      const info = await stat(file).catch(() => null);
      if (info && (info.mtimeMs >= this.now() - DAY || [...known].some(id => file.includes(id)))) candidates.push({ file, provider, mtime: info.mtimeMs });
    }
    this.discovery = candidates.sort((a, b) => b.mtime - a.mtime).slice(0, 250);
    this.scanAt = this.now();
  }
  async readNative({ file, provider }) {
    const info = await stat(file).catch(() => null); if (!info) return;
    let cursor = this.files.get(file);
    if (cursor && info.size < cursor.offset) { this.agents.delete(cursor.id); this.files.delete(file); cursor = null; }
    const handle = await open(file, 'r').catch(() => null); if (!handle) return;
    try {
      if (!cursor) {
        const head = Buffer.alloc(Math.min(info.size, 1024 * 1024));
        const { bytesRead } = await handle.read(head, 0, head.length, 0);
        const lines = head.subarray(0, bytesRead).toString('utf8').split('\n');
        let first; try { first = provider === 'Codex' ? JSON.parse(lines[0]) : lines.map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(record => record.cwd && record.sessionId); } catch { return; }
        const meta = provider === 'Codex' ? first?.payload : first;
        if (!meta || !contained(this.repo, meta.cwd)) return;
        const spawn = meta.source?.subagent?.thread_spawn || {};
        const isDelegate = provider === 'Claude' && /[\\/]subagents[\\/]/.test(file);
        const nativeId = provider === 'Codex' ? meta.id : isDelegate ? path.basename(file, '.jsonl') : meta.sessionId;
        if (!nativeId) return;
        const id = `${provider.toLowerCase()}:${nativeId}:${provider === 'Claude' ? path.basename(file, '.jsonl') : ''}`;
        const agentPath = meta.agent_path || spawn.agent_path || (provider === 'Claude' ? meta.agentName || meta.agent_type || '' : '');
        const agent = { id, nativeId, provider, parentNativeId: meta.parent_thread_id || spawn.parent_thread_id || (isDelegate ? meta.sessionId : null), isDelegate,
          agentPath, nickname: excerpt(meta.agent_nickname || spawn.agent_nickname || '', 40), originator: meta.originator || '',
          name: friendlyName(agentPath) || (provider === 'Claude' && /agent-/.test(path.basename(file)) ? 'Claude delegate' : 'Project lead'),
          state: 'unknown', action: 'No turn state observed', detail: '', tools: 0, turns: 0, sequence: 0, historyStart: meta.subagent_history_start_ordinal || 0, since: this.now() - DAY,
          createdAt: meta.timestamp || first.timestamp || info.birthtime.toISOString(), lastSeen: meta.timestamp || first.timestamp || info.mtime.toISOString() };
        this.agents.set(id, agent);
        cursor = { id, offset: 0, partial: '', decoder: new StringDecoder('utf8'), oversized: false };
        this.files.set(file, cursor);
      }
      const agent = this.agents.get(cursor.id); if (!agent) return;
      // Incremental, bounded chunks: no commands, raw results, reasoning, or transcript copies leave this reader.
      const buffer = Buffer.alloc(256 * 1024);
      while (cursor.offset < info.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - cursor.offset), cursor.offset);
        if (!bytesRead) break;
        cursor.offset += bytesRead;
        const lines = (cursor.partial + cursor.decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        cursor.partial = lines.pop() || '';
        for (const line of lines) {
          if (cursor.oversized) { cursor.oversized = false; continue; }
          try { applyRecord(agent, JSON.parse(line), event => this.emit(event)); } catch { /* Incomplete or unsupported native record. */ }
        }
        if (cursor.partial.length > 2 * 1024 * 1024) { cursor.partial = ''; cursor.oversized = true; }
      }
    } finally { await handle.close(); }
  }
  async snapshot() {
    const now = this.now();
    const managed = this.includeManaged ? await json(path.join(this.repo, '.alpha', 'sessions.json'), []) : [];
    const runtime = this.includeManaged ? await json(path.join(this.repo, '.alpha', 'runtime.json'), {}) : {};
    let bootstrap = null;
    if (runtime.token && /^http:\/\/127\.0\.0\.1:\d+$/.test(runtime.origin || '')) {
      try { const response = await fetch(`${runtime.origin}/api/bootstrap`, { headers: { Authorization: `Bearer ${runtime.token}` }, signal: AbortSignal.timeout(1200) }); if (response.ok) bootstrap = await response.json(); } catch { /* Native records remain available independently. */ }
    }
    const sessions = bootstrap?.sessions || managed;
    if (!this.scanAt || now - this.scanAt > 5000) await this.discover(sessions);
    for (const file of this.discovery) await this.readNative(file);
    const children = new Set([...this.agents.values()].map(x => x.parentNativeId).filter(Boolean));
    const agents = [...this.agents.values()].filter(x => Date.parse(x.lastSeen) >= now - DAY).map(agent => {
      const session = sessions.find(x => x.nativeId === agent.nativeId || agent.originator === `alpha_chat_${x.id}` && !agent.parentNativeId);
      const { id, nativeId, parentNativeId, provider, nickname, model, createdAt, lastSeen, detail, action, task } = agent;
      agent.toolsTimes = (agent.toolsTimes || []).filter(at => at >= now - DAY);
      agent.turnsTimes = (agent.turnsTimes || []).filter(at => at >= now - DAY);
      const tools = agent.toolsTimes.length, turns = agent.turnsTimes.length;
      const quiet = agent.state === 'working' && now - Date.parse(lastSeen) > 180000;
      const state = quiet ? 'quiet' : agent.state;
      return { id, nativeId, parentId: [...this.agents.values()].find(x => x.nativeId === parentNativeId)?.id || null,
        name: excerpt(session?.name || agent.name, 90), task: task || session?.name || agent.name, agentPath: agent.agentPath, provider, nickname, model,
        role: children.has(nativeId) ? 'coordinator' : parentNativeId || provider === 'Claude' && /agent-/.test(id) ? 'delegate' : 'lead',
        state, action: quiet ? 'Quiet · last turn state was working' : action, detail, tools, turns, createdAt, lastSeen,
        source: 'native', observed: true, toolName: agent.toolName };
    });
    for (const session of sessions.filter(x => x.open && !agents.some(a => a.nativeId === x.nativeId))) {
      const live = !!bootstrap;
      agents.push({ id: `managed:${session.id}`, nativeId: session.nativeId || null, name: excerpt(session.name, 90), task: excerpt(session.name, 120), provider: friendlyName(session.agent),
        role: 'lead', state: live ? session.activity === 'working' ? 'working' : session.activity === 'waiting' ? 'waiting' : session.unread ? 'completed' : 'idle' : 'unknown',
        action: live ? 'Managed chat activity' : 'Saved chat · live state unavailable', detail: '', tools: 0, turns: 0,
        createdAt: session.createdAt, lastSeen: session.updatedAt || session.createdAt, source: live ? 'service' : 'saved', observed: live, parentId: null });
    }
    const savedOps = this.includeManaged ? [...await json(path.join(this.repo, '.alpha', 'operations.json'), []), ...await json(path.join(this.repo, '.alpha', 'quick-operations.json'), [])] : [];
    const operations = (bootstrap?.operations || savedOps).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12).map(x => ({ id: x.id, at: x.at, text: excerpt(x.text, 140), status: x.status, result: excerpt(x.result, 220) }));
    const dispatcher = { name: 'Alpha', state: bootstrap?.coordinator || 'unavailable', observed: !!bootstrap,
      detail: bootstrap ? 'Live desktop coordinator' : operations.length ? 'Saved requests available; live dispatcher state unavailable' : 'No live desktop dispatcher feed; project coordinators are tracked below', operations };
    return { version: 1, generatedAt: new Date(now).toISOString(), intervalMs: 2000, scope: 'This workspace · last 24 hours',
      sources: { native: agents.some(x => x.source === 'native'), desktop: !!bootstrap, saved: managed.length > 0 },
      agents: withAgentIdentities(agents).sort((a, b) => Number(b.state === 'working') - Number(a.state === 'working') || String(b.lastSeen).localeCompare(String(a.lastSeen))),
      dispatcher, ...communicationSnapshot([...this.agents.values()], agents, now), events: this.events.filter(x => Date.parse(x.at) >= now - DAY).toReversed().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 120),
      coverage: 'Observed local Codex and Claude records and managed chats. Tool calls show activity, not success. A finished turn does not prove the whole task is complete. Uninstrumented agents and reasoning are not visible.' };
  }
}
