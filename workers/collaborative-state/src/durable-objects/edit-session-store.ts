/**
 * Edit session persistence utilities.
 * Extracted from document-session.ts for maintainability.
 *
 * Handles serializing/deserializing agent edit sessions to/from
 * Durable Object storage so they survive DO eviction/re-instantiation.
 */

import type { AgentEditSession } from './document-session-types';
import { EDIT_SESSIONS_STORAGE_KEY } from './document-session-types';
import { MAX_EDIT_SESSION_AGE_MS } from '../constants/security-limits';

/**
 * Persist all edit sessions to DO storage.
 * Called whenever sessions are created, modified, or removed.
 *
 * @param storage - Durable Object storage instance
 * @param editSessions - The current in-memory edit sessions Map
 */
export async function persistEditSessions(
  storage: DurableObjectStorage,
  editSessions: Map<string, AgentEditSession>,
): Promise<void> {
  const sessions: Record<string, AgentEditSession> = {};
  for (const [key, session] of editSessions) {
    sessions[key] = session;
  }
  await storage.put(EDIT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

/**
 * Restore edit sessions from DO storage into the in-memory Map.
 * Called during initialization to recover sessions after DO eviction.
 * Filters out sessions that have exceeded MAX_EDIT_SESSION_AGE_MS.
 *
 * @param storage - Durable Object storage instance
 * @param editSessions - The in-memory edit sessions Map to populate
 */
export async function restoreEditSessions(
  storage: DurableObjectStorage,
  editSessions: Map<string, AgentEditSession>,
): Promise<void> {
  try {
    const stored = await storage.get(EDIT_SESSIONS_STORAGE_KEY);
    if (typeof stored !== 'string') {
      return;
    }

    const sessions = JSON.parse(stored) as Record<string, AgentEditSession>;
    const now = Date.now();

    for (const [key, session] of Object.entries(sessions)) {
      // Skip sessions that have exceeded the maximum age
      if (now - session.startedAt > MAX_EDIT_SESSION_AGE_MS) {
        continue;
      }
      editSessions.set(key, session);
    }

    if (editSessions.size > 0) {
      console.log(`Restored ${String(editSessions.size)} edit session(s) from storage`);
    }
  } catch (error) {
    console.warn('Failed to restore edit sessions from storage:', error);
  }
}
