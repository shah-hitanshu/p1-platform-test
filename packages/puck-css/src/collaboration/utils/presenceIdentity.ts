/**
 * Identity key for presence rosters.
 *
 * Lives here rather than beside selectHeaderCollaborators so P1PuckProvider can
 * import it without depending on the editor plugin.
 */

import type { ActorPresence } from '@pantheon-systems/css-client';

/**
 * Identity key for the provider memo that publishes presence on the context.
 *
 * The context exposes `presence` through a getter so a focus-region broadcast
 * doesn't recreate it, which means consumers only observe new presence when that
 * memo's deps change. Actor *count* is not enough to detect a change:
 *
 *  - a leave and a join in the same WS frame keeps the count identical, so the
 *    header would keep rendering whoever left;
 *  - `userNameResolver` filling in display names asynchronously rewrites `name`
 *    and `avatar` without touching the count.
 *
 * Used for both rosters, so it covers the union of what each one renders:
 *
 *  - human avatars (PresenceStack) use actorId, name, avatar and state — state
 *    drives the live dot, and a transition changes neither count nor ids;
 *  - agent chips (P1EditorSubheader, mapped in P1Plugin) use actorId, name,
 *    intent, requestedById and requestedByName.
 *
 */
export function presenceIdentityKey(actors: ActorPresence[] | undefined | null): string {
  if (!actors || actors.length === 0) return '';
  return actors
    .map((a) =>
      [
        a.actorId,
        a.state,
        a.name,
        a.avatar ?? '',
        a.intent ?? '',
        a.requestedById ?? '',
        a.requestedByName ?? '',
      ].join('\u0000'),
    )
    .join('\u0001');
}
