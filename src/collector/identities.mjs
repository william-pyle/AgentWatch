// Characters and display aliases belong to themes; observation keeps session identity.
export function withAgentIdentity(agent) {
  return { ...agent, sourceName: agent.sourceName || agent.name, shortName: agent.nickname || agent.name, functionLabel: agent.name };
}
export const withAgentIdentities = agents => agents.map(withAgentIdentity);
