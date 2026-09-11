/** The chat agent every site reaches unless it configures another one. */
export const PRODUCTION_AGENT_URL = 'https://agent.p1.pantheon.io';

/** Blank counts as unset, so a defined-but-empty env var still reaches the default. */
export function resolveAgentUrl(agentUrl: string | undefined): string {
  const trimmed = agentUrl?.trim();
  return trimmed ? trimmed : PRODUCTION_AGENT_URL;
}
