import type { ActorPresence } from '@pantheon-systems/css-client';

export const AGENT_DISPLAY_NAME = 'Zappy';

/** Presence carries an agent's registry name, which varies by environment. */
export function actorDisplayName(actor: ActorPresence): string {
  return actor.role === 'agent' ? AGENT_DISPLAY_NAME : actor.name;
}
