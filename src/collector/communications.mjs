// Keep routing metadata only. Message bodies and tool arguments are never published.
export function observeCommunication(agent, record) {
  if (Number.isFinite(record.ordinal) && record.ordinal < (agent.historyStart || 0)) return;
  const payload = record.payload || {}, at = record.timestamp || agent.lastSeen;
  if (agent.provider === 'Claude') {
    if (record.isMeta || record.isSidechain && !agent.isDelegate) return;
    const content = record.message?.content;
    if (record.type === 'user') {
      const items = Array.isArray(content) ? content : [];
      if (typeof content === 'string' || items.some(item => item.type === 'text' || item.type === 'tool_result' && item.tool_use_id === agent.questionCall)) { agent.questionAt = null; agent.questionCall = null; }
      const text = typeof content === 'string' ? content : items.filter(item => item.type === 'text').map(item => item.text || '').join('\n');
      const sender = text.match(/^<teammate-message\s+teammate_id=["']([^"']+)["']/)?.[1];
      if (sender) (agent.signals ||= []).push({ id: `${agent.id}:received:${at}`, at, author: sender, recipient: agent.nativeId, received: true });
    }
    if (record.type === 'assistant') for (const item of Array.isArray(content) ? content : []) {
      if (item.type !== 'tool_use') continue;
      if (item.name === 'AskUserQuestion') { agent.questionAt = at; agent.questionCall = item.id; }
      else if (item.name === 'SendMessage' && typeof item.input?.recipient === 'string' && (!item.input.type || item.input.type === 'message')) {
        (agent.signals ||= []).push({ id: item.id || `${agent.id}:send:${at}`, at, authorId: agent.id, recipient: item.input.recipient, pending: /\?/.test(item.input.content || ''), received: false });
      }
    }
    if (agent.signals?.length > 100) agent.signals.splice(0, agent.signals.length - 100);
    return;
  }
  if (record.type === 'event_msg' && ['task_started', 'user_message'].includes(payload.type)) agent.questionAt = null;
  if (record.type !== 'response_item') return;
  if (payload.type === 'agent_message') {
    if (typeof payload.author !== 'string' || typeof payload.recipient !== 'string') return;
    (agent.signals ||= []).push({ id: payload.id || `${agent.id}:received:${at}`, at, author: payload.author, recipient: payload.recipient, received: true });
  }
  if (['function_call', 'custom_tool_call'].includes(payload.type)) {
    const name = String(payload.name || '').split('__').pop();
    if (/request_user_input/.test(name)) agent.questionAt = at;
    if (!/^(send_message|followup_task|send_to_chat|spawn_agent)$/.test(name)) return;
    let args; try { args = JSON.parse(payload.arguments || payload.input || '{}'); } catch { return; }
    const target = args.target || args.id || (name === 'spawn_agent' ? args.task_name : null);
    if (typeof target !== 'string') return;
    (agent.signals ||= []).push({ id: payload.call_id || `${agent.id}:send:${at}`, at, authorId: agent.id, recipient: target,
      pending: name === 'followup_task' || name === 'spawn_agent' || /\?/.test(args.message || args.text || ''), received: false });
  }
  if (agent.signals?.length > 100) agent.signals.splice(0, agent.signals.length - 100);
}

export function communicationSnapshot(rawAgents, publicAgents, now) {
  const byId = new Map(rawAgents.map(agent => [agent.id, agent]));
  const byNative = new Map(rawAgents.map(agent => [agent.nativeId, agent]));
  const publicById = new Map(publicAgents.map(agent => [agent.id, agent]));
  const rootOf = agent => {
    const seen = new Set();
    while (agent?.parentNativeId && byNative.has(agent.parentNativeId) && !seen.has(agent.id)) { seen.add(agent.id); agent = byNative.get(agent.parentNativeId); }
    return agent?.id;
  };
  function resolve(reference, context) {
    const exact = rawAgents.find(agent => agent.id === reference || agent.nativeId === reference || !agent.parentNativeId && agent.originator === `mrmak_chat_${reference}`);
    if (exact && publicById.has(exact.id)) return exact;
    const candidates = rawAgents.filter(agent => publicById.has(agent.id) && rootOf(agent) === rootOf(context) &&
      ((agent.agentPath || '/root') === reference || agent.agentPath?.split('/').pop() === reference));
    return candidates.length === 1 ? candidates[0] : null;
  }
  const messages = [];
  for (const context of rawAgents) for (const signal of context.signals || []) {
    if (now - Date.parse(signal.at) > 90000 || Date.parse(signal.at) > now + 2000) continue;
    const from = signal.authorId ? byId.get(signal.authorId) : resolve(signal.author, context);
    const to = resolve(signal.recipient, context);
    if (from && to && from.id !== to.id && publicById.has(from.id)) messages.push({ ...signal, fromId: from.id, toId: to.id });
  }
  const communications = [], pairs = new Set();
  for (const message of messages.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const key = [message.fromId, message.toId].sort().join('|');
    if (pairs.has(key)) continue;
    const request = messages.find(other => other.pending && other.fromId === message.fromId && other.toId === message.toId);
    const reply = messages.some(other => other.fromId === message.toId && other.toId === message.fromId && Date.parse(other.at) > Date.parse(request?.at || message.at));
    const received = messages.some(other => other.received && other.fromId === message.fromId && other.toId === message.toId && Date.parse(other.at) >= Date.parse(message.at));
    const completedReply = publicById.get(message.toId)?.state === 'completed' && Date.parse(publicById.get(message.toId).lastSeen) > Date.parse(request?.at || message.at);
    const pending = !!request && !reply && !completedReply;
    const ttl = pending ? 60000 : received || message.received ? 12000 : 20000;
    const expiresAt = new Date(Date.parse(message.at) + ttl).toISOString();
    if (Date.parse(expiresAt) <= now) continue;
    pairs.add(key);
    communications.push({ id: message.id, fromId: message.fromId, toId: message.toId, at: message.at, expiresAt, pending, phase: message.received || received ? 'received' : 'sent' });
  }
  const questions = rawAgents.filter(agent => agent.questionAt && publicById.has(agent.id) && publicById.get(agent.id).state !== 'completed' && now - Date.parse(agent.questionAt) < 180000)
    .map(agent => ({ agentId: agent.id, at: agent.questionAt, expiresAt: new Date(Date.parse(agent.questionAt) + 180000).toISOString() }));
  return { communications, questions };
}
