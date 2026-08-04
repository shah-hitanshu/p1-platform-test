/**
 * Edit session persistence utilities.
 * Extracted from document-session.ts for maintainability.
 *
 * Handles serializing/deserializing agent edit sessions to/from
 * Durable Object storage so they survive DO eviction/re-instantiation.
 */

import type { EditSession, StoredEditSession } from './document-session-types';
import { EDIT_SESSIONS_STORAGE_KEY } from './document-session-types';

/**
 * Read a stored session's owner. A record naming only `agentId` predates
 * person-owned sessions, so it is an agent's.
 */
function storedSessionOwner(
  stored: StoredEditSession,
): { id: string; type: 'user' | 'agent' } | null {
  if (stored.ownerId !== undefined && stored.ownerId !== '') {
    return { id: stored.ownerId, type: stored.ownerType ?? 'agent' };
  }
  if (stored.agentId !== undefined && stored.agentId !== '') {
    return { id: stored.agentId, type: 'agent' };
  }
  return null;
}

/**
 * Persist all edit sessions to DO storage.
 * Called whenever sessions are created, modified, or removed.
 *
 * @param storage - Durable Object storage instance
 * @param editSessions - The current in-memory edit sessions Map
 */
export async function persistEditSessions(
  storage: DurableObjectStorage,
  editSessions: Map<string, EditSession>,
): Promise<void> {
  const sessions: Record<string, EditSession> = {};
  for (const [key, session] of editSessions) {
    sessions[key] = session;
  }
  await storage.put(EDIT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

/**
 * Read persisted edit sessions, resolving each record's owner. A record naming
 * no owner is dropped rather than restored unattributable.
 *
 * Callers apply their own age and rollback policy to the result.
 *
 * @param stored - The raw value read from DO storage
 * @returns Sessions by id, empty when the value is absent or unparseable
 */
export function parseStoredEditSessions(stored: unknown): Map<string, EditSession> {
  const sessions = new Map<string, EditSession>();
  if (typeof stored !== 'string') {
    return sessions;
  }

  let parsed: Record<string, StoredEditSession>;
  try {
    parsed = JSON.parse(stored) as Record<string, StoredEditSession>;
  } catch (error) {
    console.warn('Failed to parse stored edit sessions:', error);
    return sessions;
  }

  for (const [key, session] of Object.entries(parsed)) {
    const owner = storedSessionOwner(session);
    if (owner === null) {
      console.warn(`Discarding stored edit session ${key}: no owner recorded`);
      continue;
    }
    sessions.set(key, {
      id: session.id,
      ownerId: owner.id,
      ownerType: owner.type,
      trigger: session.trigger,
      intent: session.intent,
      targetRegions: session.targetRegions,
      checkpointId: session.checkpointId,
      startedAt: session.startedAt,
      conflicted: session.conflicted,
      conflictReason: session.conflictReason,
    });
  }

  return sessions;
}
