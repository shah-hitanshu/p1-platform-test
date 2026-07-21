/**
 * Session ID parsing and connection metadata utilities.
 * Extracted from document-session.ts for maintainability.
 */

import type { SessionInfo } from './document-session-types';
import type { ConnectionMeta } from '../types';

/**
 * Storage key for persisted session info (survives hibernation/alarm wakeups)
 */
export const SESSION_INFO_KEY = 'sessionInfo';

/**
 * Parse session identifier from Durable Object ID name.
 * Format: {siteId}:{documentId}:{branchId}
 *
 * Note: We use state.id.name (not state.id.toString()) because:
 * - idFromName(sessionId) stores the name in state.id.name
 * - state.id.toString() returns the internal hex ID, not the name
 *
 * @param stateIdName - The Durable Object ID name (from state.id.name)
 */
export function parseSessionId(stateIdName: string | undefined): SessionInfo {
  if (stateIdName === undefined || stateIdName === '') {
    console.error('Durable Object ID has no name - was it created with idFromName()?');
    return {
      siteId: 'unknown',
      documentId: 'unknown',
      branchId: 'unknown',
    };
  }

  const parts = stateIdName.split(':');
  const [siteId, documentId, branchId] = parts;

  if (parts.length >= 3 && siteId !== undefined && documentId !== undefined && branchId !== undefined) {
    return { siteId, documentId, branchId };
  }

  console.error(`Malformed session ID name: ${stateIdName}`);
  // Default values for malformed IDs (shouldn't happen in practice)
  return {
    siteId: 'unknown',
    documentId: 'unknown',
    branchId: 'unknown',
  };
}

/**
 * Update session info from request header if not available from state.id.name.
 * This is needed because Miniflare (local dev) doesn't provide state.id.name.
 *
 * @param currentInfo - The current session info
 * @param request - The incoming HTTP request
 * @returns An object containing the updated session info and whether it changed
 */
export function updateSessionInfoFromRequest(
  currentInfo: SessionInfo,
  request: Request,
): { updated: SessionInfo; changed: boolean } {
  // Only update if session info has unknown values (meaning state.id.name wasn't available)
  if (currentInfo.siteId !== 'unknown') {
    return { updated: currentInfo, changed: false };
  }

  // Try header first (for regular HTTP requests)
  let sessionId = request.headers.get('X-Session-Id');

  // Fall back to query parameter (for WebSocket requests where headers can't be modified)
  if (sessionId === null || sessionId === '') {
    const url = new URL(request.url);
    sessionId = url.searchParams.get('_sessionId');
  }

  if (sessionId !== null && sessionId !== '') {
    const parts = sessionId.split(':');
    const [siteId, documentId, branchId] = parts;
    if (parts.length >= 3 && siteId !== undefined && documentId !== undefined && branchId !== undefined) {
      const updated: SessionInfo = {
        siteId,
        documentId,
        branchId,
      };
      console.log(`Session info updated from request: ${JSON.stringify(updated)}`);
      return { updated, changed: true };
    } else {
      console.error(`Invalid session ID format: ${sessionId}`);
    }
  } else {
    console.error(`No session ID found in request. URL: ${request.url}, Headers: X-Session-Id=${request.headers.get('X-Session-Id') ?? 'null'}`);
  }

  return { updated: currentInfo, changed: false };
}

/**
 * Restore session info from DO storage when state.id.name is unavailable.
 * This handles alarm wakeups in Miniflare where state.id.name is undefined.
 *
 * @param currentInfo - The current session info
 * @param storage - The Durable Object storage
 * @returns The restored session info (or current if no stored info found)
 */
export async function restoreSessionInfoFromStorage(
  currentInfo: SessionInfo,
  storage: DurableObjectStorage,
): Promise<SessionInfo> {
  if (currentInfo.siteId !== 'unknown') {
    return currentInfo;
  }
  const stored = await storage.get<SessionInfo>(SESSION_INFO_KEY);
  if (stored !== undefined && stored.siteId !== 'unknown') {
    return stored;
  }
  return currentInfo;
}

/**
 * Get connection metadata from a WebSocket's serialized attachment.
 */
export function getConnectionMeta(ws: WebSocket): ConnectionMeta | null {
  try {
    return ws.deserializeAttachment() as ConnectionMeta | null;
  } catch {
    return null;
  }
}

/**
 * Get all connections paired with their metadata.
 *
 * @param getWebSockets - Function that returns all WebSockets (e.g., state.getWebSockets)
 */
export function getAllConnections(
  getWebSockets: () => WebSocket[],
): [WebSocket, ConnectionMeta][] {
  const result: [WebSocket, ConnectionMeta][] = [];
  for (const ws of getWebSockets()) {
    const meta = getConnectionMeta(ws);
    if (meta !== null) {
      result.push([ws, meta]);
    }
  }
  return result;
}
