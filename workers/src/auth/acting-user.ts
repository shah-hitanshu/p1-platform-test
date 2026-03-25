/**
 * Acting-user header extraction for agent principals.
 *
 * When the MCP server (authenticated as an agent) forwards requests to the CSS backend,
 * it includes X-Acting-User-Id and X-Acting-User-Email headers identifying the human
 * who initiated the action. This module extracts those headers, but ONLY trusts them
 * from agent principals (security: prevents header spoofing by regular users).
 */

export interface ActingUserInfo {
  actingUserId: string;
  actingUserEmail: string;
}

/**
 * Extract acting-user identity from request headers.
 * ONLY trusts these headers when the authenticated principal is type 'agent'.
 * Returns null for all other principal types (security: prevents header spoofing).
 */
export function extractActingUser(
  headers: Headers,
  principal: { type: string },
): ActingUserInfo | null {
  if (principal.type !== 'agent') {
    return null;
  }

  const userId = headers.get('X-Acting-User-Id');
  const userEmail = headers.get('X-Acting-User-Email');

  if (userId === null || userId === '' || userEmail === null || userEmail === '') {
    return null;
  }

  return { actingUserId: userId, actingUserEmail: userEmail };
}
