/**
 * Presence persistence and PresenceManager DO push utilities.
 * Extracted from document-session.ts for maintainability.
 *
 * Handles serializing/deserializing presence state to/from DO storage
 * and pushing presence updates to the site-level PresenceManager DO.
 */

import { PresenceManager, type SerializedPresenceState } from '../services/presence-service';
import type { ActorPresence } from '../types';
import { PRESENCE_STORAGE_KEY } from './document-session-types';
import type { SessionInfo, DocumentSessionEnv } from './document-session-types';

/**
 * Persist presence state to DO storage.
 * Called immediately on disconnect, debounced on focus updates.
 *
 * @param storage - Durable Object storage instance
 * @param presenceManager - The PresenceManager instance to serialize
 */
export async function persistPresence(
  storage: DurableObjectStorage,
  presenceManager: PresenceManager,
): Promise<void> {
  const serialized = presenceManager.serialize();
  await storage.put(PRESENCE_STORAGE_KEY, serialized);
}

/**
 * Restore presence state from DO storage.
 * Called during initialization to recover presence after DO eviction.
 *
 * @param storage - Durable Object storage instance
 * @returns A restored PresenceManager instance, or null if no stored state was found
 */
export async function restorePresence(
  storage: DurableObjectStorage,
): Promise<PresenceManager | null> {
  try {
    const stored = await storage.get(PRESENCE_STORAGE_KEY);
    if (stored !== undefined && stored !== null && typeof stored === 'object') {
      const data = stored as SerializedPresenceState;
      if (Array.isArray(data.presences)) {
        const manager = PresenceManager.deserialize(data);
        console.log(`Restored ${String(manager.count())} presence(s) from storage`);
        return manager;
      }
    }
  } catch (error) {
    console.warn('Failed to restore presence from storage:', error);
  }
  return null;
}

/**
 * Push presence update to PresenceManager DO.
 * Fire-and-forget: wrapped in try/catch, non-blocking.
 *
 * @param env - The DocumentSession environment bindings
 * @param sessionInfo - Current session info (siteId, documentId, branchId)
 * @param type - The type of presence update
 * @param actorId - The actor whose presence changed
 * @param extra - Additional data depending on the update type
 */
export function pushPresenceUpdate(
  env: DocumentSessionEnv,
  sessionInfo: SessionInfo,
  type: 'join' | 'leave' | 'focus' | 'state',
  actorId: string,
  extra?: { actor?: ActorPresence; focusRegions?: string[]; state?: string },
): void {
  if (env.PRESENCE === undefined) {
    return;
  }

  try {
    const presenceId = env.PRESENCE.idFromName(sessionInfo.siteId);
    const stub = env.PRESENCE.get(presenceId);

    const payload = {
      siteId: sessionInfo.siteId,
      branchId: sessionInfo.branchId,
      documentId: sessionInfo.documentId,
    };

    const rpcStub = stub as unknown as {
      actorJoined: (arg: unknown) => Promise<void>;
      actorLeft: (arg: unknown) => Promise<void>;
      focusChanged: (arg: unknown) => Promise<void>;
      stateChanged: (arg: unknown) => Promise<void>;
    };
    let rpcCall: Promise<void> | undefined;

    switch (type) {
      case 'join':
        if (extra?.actor !== undefined) {
          rpcCall = rpcStub.actorJoined({ ...payload, actor: extra.actor });
        }
        break;
      case 'leave':
        rpcCall = rpcStub.actorLeft({ ...payload, actorId });
        break;
      case 'focus':
        if (extra?.focusRegions !== undefined) {
          rpcCall = rpcStub.focusChanged({
            ...payload,
            actorId,
            focusRegions: extra.focusRegions,
          });
        }
        break;
      case 'state':
        if (extra?.state !== undefined) {
          rpcCall = rpcStub.stateChanged({
            ...payload,
            actorId,
            state: extra.state,
          });
        }
        break;
    }

    if (rpcCall !== undefined) {
      rpcCall.catch((error: unknown) => {
        console.warn('Failed to push presence update to PresenceManager:', error);
      });
    }
  } catch (error) {
    console.warn('Failed to get PresenceManager stub:', error);
  }
}
