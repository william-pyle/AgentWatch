import { VillageCollector } from '../collector/collector.mjs';
const config = JSON.parse(process.argv[2]);
const collector = new VillageCollector({ ...config, includeManaged: true });
let busy = false;
async function poll() {
  if (busy) return; busy = true;
  try {
    const snapshot = await collector.snapshot();
    // Only observation metadata crosses into the application. No transcript text is retained.
    const agents = snapshot.agents.map(({ id, nativeId, parentId, name, sourceName, provider, role, state, action, tools, turns, lastSeen, toolName, observed }) => ({ id, nativeId, parentId, name: sourceName || name, provider, role, state, action, tools, turns, lastSeen, toolName, observed }));
    const events = snapshot.events.filter(e => e.kind !== 'update').map(({ id, agentId, at, kind }) => ({ id, agentId, at, kind }));
    process.parentPort.postMessage({ type: 'snapshot', data: { generatedAt: snapshot.generatedAt, agents, events, coverage: snapshot.coverage } });
  } catch { process.parentPort.postMessage({ type: 'error', message: 'Could not read local activity. Check the project and source folders.' }); }
  finally { busy = false; }
}
await poll(); setInterval(poll, 2000);
