/**
 * The work behind `/apply`: writing a batch of edit operations into the session
 * and getting them to Postgres. The request parsing and response shaping around
 * it live in crdt-endpoint-handlers.
 */

import * as Y from 'yjs';
import { getLogger } from '@pantheon-systems/p1-telemetry';
import { regionsOverlap } from '../services/presence-service';
import {
  MAX_CONFLICT_REGIONS_TO_REPORT,
  MAX_CONFLICT_REASON_LENGTH,
} from '../constants/security-limits';
import type { EditOperation, VersionAttribution } from '../types';
import type { EditSession, SessionOwner } from './document-session-types';
import { applyOperation } from './crdt-operations';
import type { ActorIdentity } from './postgres-sync-manager';
import type { CrdtEndpointDeps } from './crdt-endpoint-handlers';
import { internalApiConfig, type InternalApiConfig } from './internal-api-config';

export type ApplyOperationsDeps = Pick<
  CrdtEndpointDeps,
  | 'getYdoc'
  | 'env'
  | 'editSessions'
  | 'activityDetector'
  | 'syncManager'
  | 'persist'
  | 'flushPendingPersist'
  | 'broadcastUpdate'
  | 'scheduleCleanupAlarm'
>;

export interface ApplyOperationsCommand {
  actor: SessionOwner;
  operations: EditOperation[];
  /** Who the version is written for: the resolved app user when known, else the actor. */
  syncActorId: string;
  identity: ActorIdentity;
  /** Set when the operations are an agent's accepted proposal, applied for the actor. */
  attribution?: VersionAttribution;
}

export interface SessionConflict {
  ownerId: string;
  ownerType: 'user' | 'agent';
  regions: string[];
  sessionId: string;
}

export interface ApplyOperationsResult {
  snapshot: Record<string, unknown>;
  sessionConflicts: SessionConflict[];
}

export class ApplyOperationsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApplyOperationsError';
  }
}

export async function applyOperations(
  deps: ApplyOperationsDeps,
  command: ApplyOperationsCommand,
): Promise<ApplyOperationsResult> {
  const internalApi = internalApiConfig(deps.env);
  if (command.attribution !== undefined && internalApi !== undefined) {
    await writePendingEditsFirst(deps, command);
  }

  const ydoc = deps.getYdoc();
  const root = ydoc.getMap('root');
  try {
    ydoc.transact(() => {
      for (const op of command.operations) {
        applyOperation(root, op);
      }
    }, command.actor.id);
  } catch (error) {
    throw new ApplyOperationsError(400, `Failed to apply operations: ${messageOf(error, 'Unknown error')}`);
  }

  try {
    await deps.persist();
  } catch {
    throw new ApplyOperationsError(500, 'Failed to persist state');
  }

  deps.broadcastUpdate(Y.encodeStateAsUpdate(ydoc));

  const regions = command.operations
    .map((op) => op.path)
    .filter((path): path is string => typeof path === 'string');

  // Only a person's edits make agents wait out the idle timeout.
  if (command.actor.type === 'user') {
    void deps.scheduleCleanupAlarm();
    deps.activityDetector.recordHumanActivity(command.actor.id, regions);
  }

  const sessionConflicts = markSessionConflicts(deps.editSessions, command.actor, regions);
  await syncToPostgres(deps, command, internalApi);

  return { snapshot: root.toJSON(), sessionConflicts };
}

/**
 * An attributed write gets a version of its own: whatever edits are still
 * waiting to sync belong to whoever made them, so they are written first. If
 * they cannot be, the apply fails rather than folding them into the agent's
 * version, and the caller retries once Postgres is back.
 */
async function writePendingEditsFirst(
  deps: ApplyOperationsDeps,
  command: ApplyOperationsCommand,
): Promise<void> {
  if (!deps.syncManager.hasUnsyncedChanges()) return;
  try {
    await deps.syncManager.flushAndSync(deps.flushPendingPersist, {
      actorId: command.syncActorId,
      actorType: command.actor.type,
    });
  } catch (error) {
    getLogger().warn('Could not write pending edits before an attributed apply', {
      error: messageOf(error),
    });
    throw new ApplyOperationsError(503, 'Edits already waiting could not be written first; retry the apply');
  }
}

/**
 * Edits landing in a region another session reserved put that session in
 * conflict, whichever kind of actor made them. Reservation stops two sessions
 * declaring the same region, but not an actor editing outside what it declared.
 */
function markSessionConflicts(
  editSessions: Map<string, EditSession>,
  actor: SessionOwner,
  regions: string[],
): SessionConflict[] {
  const conflicts: SessionConflict[] = [];
  for (const session of editSessions.values()) {
    if (session.ownerId === actor.id && session.ownerType === actor.type) {
      continue;
    }

    const overlappingRegions: string[] = [];
    regionCheck:
    for (const editedRegion of regions) {
      for (const reservedRegion of session.targetRegions) {
        if (regionsOverlap(editedRegion, reservedRegion)) {
          overlappingRegions.push(reservedRegion);
          if (overlappingRegions.length >= MAX_CONFLICT_REGIONS_TO_REPORT) {
            break regionCheck;
          }
        }
      }
    }
    if (overlappingRegions.length === 0) continue;

    session.conflicted = true;
    const actorLabel = actor.type === 'user' ? 'Human' : 'Agent';
    let reason = `${actorLabel} activity in overlapping regions: ${overlappingRegions.join(', ')}`;
    if (reason.length > MAX_CONFLICT_REASON_LENGTH) {
      reason = reason.substring(0, MAX_CONFLICT_REASON_LENGTH - 3) + '...';
    }
    session.conflictReason = reason;
    conflicts.push({
      ownerId: session.ownerId,
      ownerType: session.ownerType,
      regions: overlappingRegions,
      sessionId: session.id,
    });
  }
  return conflicts;
}

/**
 * Sync after the idle timeout, carrying the verified identity so unprovisioned
 * OAuth principals editing over HTTP are provisioned at sync time like websocket
 * editors are. An attributed write is synced at once instead, so the version
 * exists by the time the acceptance is recorded.
 */
async function syncToPostgres(
  deps: ApplyOperationsDeps,
  command: ApplyOperationsCommand,
  internalApi: InternalApiConfig | undefined,
): Promise<void> {
  const identity: ActorIdentity = {
    ...command.identity,
    ...(command.attribution !== undefined ? { attribution: command.attribution } : {}),
  };
  if (command.attribution !== undefined && internalApi !== undefined) {
    try {
      await deps.syncManager.performDirectSync(
        internalApi.url,
        internalApi.secret,
        command.syncActorId,
        command.actor.type,
        identity,
      );
      return;
    } catch (error) {
      getLogger().warn('Immediate sync of an attributed apply failed, scheduling it instead', {
        error: messageOf(error),
      });
    }
  }
  await deps.syncManager.scheduleSync(command.syncActorId, command.actor.type, identity);
}

function messageOf(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}
