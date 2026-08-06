/**
 * Selects the human collaborators shown as avatars in the editor header.
 *
 * Agents are deliberately excluded — they render as chips in the subheader.
 *
 */

import type { ActorPresence } from '@pantheon-systems/css-client';

export interface HeaderPresenceState {
  humans?: ActorPresence[];
}

export function selectHeaderCollaborators(
  presence: HeaderPresenceState | null | undefined,
  _hasActiveHumans: boolean,
  humanPresenceCount: number,
): ActorPresence[] {
  const humans = presence?.humans ?? [];
  // humanPresenceCount is the fresher of the two signals on a mid-session
  // departure, so it still guards against a stale presence getter.
  if (humanPresenceCount <= 0 || humans.length === 0) return [];
  return humans;
}
