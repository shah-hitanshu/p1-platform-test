/**
 * Agent politeness, edit session, org settings, and kill-switch HTTP handlers.
 * Extracted from document-session.ts for maintainability.
 *
 * Each handler is a standalone async function that receives an AgentPolitenessDeps
 * object with all required dependencies, avoiding circular imports back to
 * document-session.ts.
 */

import { type PresenceManager, regionsOverlap } from '../services/presence-service';
import type {
  ActivityDetector,
} from '../services/activity-detection-service';
import type { EditPermissionService } from '../services/edit-permission-service';
import type { Organization } from '../types';
import {
  MAX_INTENT_LENGTH,
  MAX_TARGET_REGIONS,
  MAX_REASON_LENGTH,
  MAX_ACTING_USER_NAME_LENGTH,
  MAX_ACTOR_ID_LENGTH,
} from '../constants/security-limits';

import type {
  EditSession,
  SessionOwner,
  CanAgentEditRequest,
  AgentEditStartRequest,
  AgentEditCompleteRequest,
  AgentEditAbortRequest,
  AgentStopRequest,
  SessionInfo,
  DocumentSessionEnv,
} from './document-session-types';

import { validateActorId } from './session-validators';
import {
  createSessionPreEditCheckpoint,
  createSessionPostEditCheckpoint,
  rollbackToSessionCheckpoint,
} from './session-checkpoint-client';

// =============================================================================
// Dependency interface
// =============================================================================

/**
 * All dependencies needed by the agent politeness handlers.
 * Constructed by the DocumentSession class and passed to each handler.
 */
export interface AgentPolitenessDeps {
  env: DocumentSessionEnv;
  sessionInfo: SessionInfo;
  editSessions: Map<string, EditSession>;
  presenceManager: PresenceManager;
  activityDetector: ActivityDetector;
  editPermissionService: EditPermissionService;
  cachedOrganization: Organization | null | undefined;
  getConnectionCount: () => number;
  persistEditSessions: () => Promise<void>;
  persistPresence: () => Promise<void>;
  broadcastPresenceUpdate: () => void;
  refreshOrganizationSettings: () => Promise<void>;
  scheduleCleanupAlarm: () => Promise<void>;
  jsonResponse: (status: number, data: unknown) => Response;
  errorResponse: (status: number, message: string) => Response;
}

// =============================================================================
// Verified identity
// =============================================================================

/**
 * The identity the Worker verified from the credential and forwarded as
 * X-Verified-Actor-Id. The DO is only reachable through the Worker, so this is
 * the authoritative acting agent. Null for internal calls made without it.
 */
function verifiedActorId(request: Request): string | null {
  const value = request.headers.get('X-Verified-Actor-Id');
  return value !== null && value !== '' ? value : null;
}

/**
 * The kind of actor the Worker verified. Anything other than an explicit `user`
 * is an agent, so an unset header keeps the pre-existing agent behaviour.
 */
function verifiedActorType(request: Request): 'user' | 'agent' {
  return request.headers.get('X-Verified-Actor-Type') === 'user' ? 'user' : 'agent';
}

/**
 * The session owner acting on this request, from verified headers only. A
 * declared owner in the body is ignored.
 */
function actingOwner(request: Request): SessionOwner | null {
  const id = verifiedActorId(request);
  return id === null ? null : { id, type: verifiedActorType(request) };
}

/** The owner recorded on a session. */
function sessionOwner(session: EditSession): SessionOwner {
  return { id: session.ownerId, type: session.ownerType };
}

/**
 * Which of the requested regions another open session already holds.
 *
 * An open session reserves its target regions against every other actor, so two
 * sessions cannot claim overlapping regions whoever owns them. The caller's own
 * session is skipped — reopening a reservation is a different condition.
 */
function regionsHeldByOtherSessions(
  editSessions: Map<string, EditSession>,
  owner: SessionOwner,
  targetRegions: string[],
): string[] {
  const held = new Set<string>();
  for (const session of editSessions.values()) {
    if (session.ownerId === owner.id && session.ownerType === owner.type) {
      continue;
    }
    for (const target of targetRegions) {
      if (session.targetRegions.some((reserved) => regionsOverlap(target, reserved))) {
        held.add(target);
      }
    }
  }
  return Array.from(held);
}

/**
 * The name to publish for a session owner. The Worker resolves both — an agent's
 * registry name into X-Agent-Name, a person's provider name into X-Verified-Name
 * — because neither is reachable from the DO. Falls back to the owner id.
 */
function ownerDisplayName(request: Request, owner: SessionOwner): string {
  const header = owner.type === 'user' ? 'X-Verified-Name' : 'X-Agent-Name';
  const raw = request.headers.get(header) ?? owner.id;
  return raw.trim().slice(0, MAX_ACTING_USER_NAME_LENGTH) || owner.id;
}

/**
 * The identity a session's checkpoints are written against. Presence identifies a
 * person by their provider subject, but rows reference app.users.id, so the
 * resolved database id wins when the Worker supplies it.
 */
function checkpointOwner(request: Request, owner: SessionOwner): SessionOwner {
  if (owner.type !== 'user') {
    return owner;
  }
  const dbUserId = request.headers.get('X-Verified-Db-User-Id');
  return dbUserId !== null && dbUserId !== ''
    ? { id: dbUserId, type: 'user' }
    : owner;
}

/**
 * Only the actor that owns an edit session may act on it. Both the id and the
 * kind must match, so an agent cannot act on a person's session by presenting
 * the same identifier. Completing and aborting mutate and roll back content, so
 * an unidentified caller is refused rather than allowed through. Returns an
 * error response when the caller is not the owner, or null to proceed.
 */
function requireSessionOwner(
  deps: AgentPolitenessDeps,
  request: Request,
  session: EditSession,
): Response | null {
  const acting = actingOwner(request);
  if (acting === null) {
    return deps.errorResponse(400, 'a verified actor is required');
  }
  if (acting.id !== session.ownerId || acting.type !== session.ownerType) {
    return deps.errorResponse(403, 'Edit session belongs to a different actor');
  }
  return null;
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Handle POST /can-agent-edit - Check if agent can proceed with editing
 */
export async function handleCanAgentEdit(
  deps: AgentPolitenessDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deps.errorResponse(400, 'Invalid JSON body');
  }

  const rawBody = body as Record<string, unknown>;

  const owner = actingOwner(request);
  if (owner === null) {
    return deps.errorResponse(400, 'a verified actor is required');
  }

  if (rawBody.trigger !== 'human_requested' && rawBody.trigger !== 'autonomous') {
    return deps.errorResponse(400, 'trigger must be "human_requested" or "autonomous"');
  }

  const parsed = body as CanAgentEditRequest;

  const ownerIdError = validateActorId(owner.id);
  if (ownerIdError !== null) {
    return deps.errorResponse(400, ownerIdError);
  }

  // Validate target regions - REQUIRED for agent politeness enforcement
  if (!Array.isArray(parsed.targetRegions)) {
    return deps.errorResponse(400, 'targetRegions is required and must be an array of region paths');
  }
  const targetRegions = parsed.targetRegions;
  if (targetRegions.length === 0) {
    return deps.errorResponse(400, 'targetRegions cannot be empty - specify which regions you intend to edit');
  }
  if (targetRegions.length > MAX_TARGET_REGIONS) {
    return deps.errorResponse(400, `targetRegions exceeds maximum of ${String(MAX_TARGET_REGIONS)}`);
  }

  const permission = await deps.editPermissionService.canEdit({
    owner,
    trigger: parsed.trigger,
    intent: '', // not available for pre-flight permission check
    targetRegions,
  });

  const heldByOthers = regionsHeldByOtherSessions(deps.editSessions, owner, targetRegions);

  if (!permission.allowed) {
    // Regions describe a region conflict. A suspension or an active person is
    // not about any region, so none are named.
    return deps.jsonResponse(200, {
      allowed: false,
      reason: permission.reason,
      conflictingRegions: permission.reason === 'region_conflict'
        ? Array.from(new Set([...(permission.conflictingRegions ?? []), ...heldByOthers]))
        : [],
    });
  }

  if (heldByOthers.length > 0) {
    return deps.jsonResponse(200, {
      allowed: false,
      reason: 'region_conflict',
      conflictingRegions: heldByOthers,
    });
  }

  return deps.jsonResponse(200, {
    allowed: true,
    conflictingRegions: [],
  });
}

/**
 * Handle POST /agent-edit-start - Start an agent edit session
 */
export async function handleAgentEditStart(
  deps: AgentPolitenessDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deps.errorResponse(400, 'Invalid JSON body');
  }

  const rawBody = body as Record<string, unknown>;

  const owner = actingOwner(request);
  if (owner === null) {
    return deps.errorResponse(400, 'a verified actor is required');
  }

  if (rawBody.trigger !== 'human_requested' && rawBody.trigger !== 'autonomous') {
    return deps.errorResponse(400, 'trigger must be "human_requested" or "autonomous"');
  }

  if (typeof rawBody.intent !== 'string' || rawBody.intent.length === 0) {
    return deps.errorResponse(400, 'intent is required');
  }

  if (rawBody.intent.length > MAX_INTENT_LENGTH) {
    return deps.errorResponse(400, `intent exceeds maximum length of ${String(MAX_INTENT_LENGTH)}`);
  }

  const parsed = body as AgentEditStartRequest;

  const ownerIdError = validateActorId(owner.id);
  if (ownerIdError !== null) {
    return deps.errorResponse(400, ownerIdError);
  }

  // Validate target regions - REQUIRED for agent politeness enforcement
  if (!Array.isArray(parsed.targetRegions)) {
    return deps.errorResponse(400, 'targetRegions is required and must be an array of region paths');
  }
  const targetRegions = parsed.targetRegions;
  if (targetRegions.length === 0) {
    return deps.errorResponse(400, 'targetRegions cannot be empty - specify which regions you intend to edit');
  }
  if (targetRegions.length > MAX_TARGET_REGIONS) {
    return deps.errorResponse(400, `targetRegions exceeds maximum of ${String(MAX_TARGET_REGIONS)}`);
  }

  // One open session per actor per document.
  for (const existingSession of deps.editSessions.values()) {
    if (existingSession.ownerId === owner.id && existingSession.ownerType === owner.type) {
      return deps.errorResponse(409, 'Actor already has an active edit session');
    }
  }

  const permission = await deps.editPermissionService.canEdit({
    owner,
    trigger: parsed.trigger,
    intent: parsed.intent,
    targetRegions,
  });

  if (!permission.allowed) {
    return deps.jsonResponse(403, {
      allowed: false,
      reason: permission.reason,
      conflictingRegions: permission.conflictingRegions,
    });
  }

  const heldByOthers = regionsHeldByOtherSessions(deps.editSessions, owner, targetRegions);
  if (heldByOthers.length > 0) {
    return deps.jsonResponse(403, {
      allowed: false,
      reason: 'region_conflict',
      conflictingRegions: heldByOthers,
    });
  }

  const displayName = ownerDisplayName(request, owner);

  // Generate edit session ID using cryptographically secure random
  const editSessionId = `edit-${crypto.randomUUID()}`;

  // A person's session always takes a checkpoint: it is their only rollback
  // boundary. An agent's does so for autonomous work.
  let checkpointId: string | undefined;
  if (owner.type === 'user' || parsed.trigger === 'autonomous') {
    checkpointId = await createSessionPreEditCheckpoint(
      deps.env,
      deps.sessionInfo,
      checkpointOwner(request, owner),
      parsed.intent,
      owner.type === 'user' ? 'manual' : parsed.trigger,
      targetRegions,
    );
  }

  // Schedule cleanup alarm for HTTP-only clients (idempotent if already scheduled)
  void deps.scheduleCleanupAlarm();

  const newSession: EditSession = {
    id: editSessionId,
    ownerId: owner.id,
    ownerType: owner.type,
    trigger: parsed.trigger,
    intent: parsed.intent,
    targetRegions,
    checkpointId,
    startedAt: Date.now(),
  };

  deps.editSessions.set(editSessionId, newSession);
  await deps.persistEditSessions();

  // Who asked an agent to do this work. The Worker resolves it from the
  // credential and forwards it verified, so only an agent acting for someone
  // carries one; a person owning the session is already named as the actor.
  let requestedById: string | undefined;
  let requestedByName: string | undefined;
  if (parsed.trigger === 'human_requested') {
    const rawId = request.headers.get('X-Verified-Requested-By-Id');
    if (rawId !== null && rawId.trim() !== '') {
      requestedById = rawId.trim().slice(0, MAX_ACTOR_ID_LENGTH);
    }
    const rawName = request.headers.get('X-Verified-Requested-By-Name');
    const trimmedName = rawName !== null ? rawName.trim() : '';
    if (trimmedName !== '') {
      requestedByName = trimmedName.slice(0, MAX_ACTING_USER_NAME_LENGTH);
    }
  }

  // Publish the owner as an editor holding the reserved regions.
  deps.presenceManager.register({
    actorId: owner.id,
    actorType: owner.type,
    name: displayName,
    focusRegions: targetRegions,
    intent: parsed.intent,
    state: 'editing',
    requestedById,
    requestedByName,
  });

  // Broadcast presence update to all connected clients
  deps.broadcastPresenceUpdate();

  return deps.jsonResponse(200, {
    editSessionId,
    checkpointId,
  });
}

/**
 * Handle POST /agent-edit-complete - Complete an agent edit session
 */
export async function handleAgentEditComplete(
  deps: AgentPolitenessDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deps.errorResponse(400, 'Invalid JSON body');
  }

  const parsed = body as AgentEditCompleteRequest;

  if (typeof parsed.editSessionId !== 'string' || parsed.editSessionId.length === 0) {
    return deps.errorResponse(400, 'editSessionId is required');
  }

  // Find the edit session
  const session = deps.editSessions.get(parsed.editSessionId);
  if (session === undefined) {
    return deps.errorResponse(404, 'Edit session not found');
  }

  const notOwnerError = requireSessionOwner(deps, request, session);
  if (notOwnerError !== null) {
    return notOwnerError;
  }

  // Create post-edit checkpoint if there was a pre-edit checkpoint
  let postCheckpointId: string | undefined;
  if (session.checkpointId !== undefined) {
    postCheckpointId = await createSessionPostEditCheckpoint(
      deps.env,
      deps.sessionInfo,
      checkpointOwner(request, sessionOwner(session)),
      session.intent,
      session.checkpointId,
      session.targetRegions,
    );
  }

  // Clear agent's presence and persist to storage immediately
  // (prevents stale presence from being restored on DO hibernation wake)
  deps.presenceManager.unregisterByActorId(session.ownerId);
  await deps.persistPresence();

  // Remove the edit session
  deps.editSessions.delete(parsed.editSessionId);
  await deps.persistEditSessions();

  // Broadcast presence update to all connected clients
  deps.broadcastPresenceUpdate();

  return deps.jsonResponse(200, {
    success: true,
    checkpointId: postCheckpointId,
  });
}

/**
 * Handle POST /agent-edit-abort - Abort an agent edit session
 */
export async function handleAgentEditAbort(
  deps: AgentPolitenessDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deps.errorResponse(400, 'Invalid JSON body');
  }

  const parsed = body as AgentEditAbortRequest;

  if (typeof parsed.editSessionId !== 'string' || parsed.editSessionId.length === 0) {
    return deps.errorResponse(400, 'editSessionId is required');
  }

  // Find the edit session
  const session = deps.editSessions.get(parsed.editSessionId);
  if (session === undefined) {
    return deps.errorResponse(404, 'Edit session not found');
  }

  const notOwnerError = requireSessionOwner(deps, request, session);
  if (notOwnerError !== null) {
    return notOwnerError;
  }

  if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
    return deps.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
  }

  // Rollback if there was a checkpoint (for autonomous work)
  let rolledBack = false;
  if (session.checkpointId !== undefined) {
    rolledBack = await rollbackToSessionCheckpoint(
      deps.env,
      deps.sessionInfo,
      session.checkpointId,
      checkpointOwner(request, sessionOwner(session)),
      parsed.reason,
    );
  }

  // Clear agent's presence and persist to storage immediately
  // (prevents stale presence from being restored on DO hibernation wake)
  deps.presenceManager.unregisterByActorId(session.ownerId);
  await deps.persistPresence();

  // Remove the edit session
  deps.editSessions.delete(parsed.editSessionId);
  await deps.persistEditSessions();

  // Broadcast presence update to all connected clients
  deps.broadcastPresenceUpdate();

  return deps.jsonResponse(200, {
    success: true,
    rolledBack,
  });
}

/**
 * Handle POST /agent-stop - Stop an agent's edit session (human-initiated)
 *
 * Unlike /agent-edit-abort which requires the editSessionId, this endpoint
 * looks up the session by agentId, making it easier for humans to stop
 * an agent without knowing the session details.
 */
export async function handleAgentStop(
  deps: AgentPolitenessDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deps.errorResponse(400, 'Invalid JSON body');
  }

  const parsed = body as AgentStopRequest;

  if (typeof parsed.agentId !== 'string' || parsed.agentId.length === 0) {
    return deps.errorResponse(400, 'agentId is required');
  }

  if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
    return deps.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
  }

  // Only an agent's session can be stopped this way; a person ends their own.
  let session: EditSession | undefined;
  let sessionId: string | undefined;
  for (const [id, s] of deps.editSessions.entries()) {
    if (s.ownerType === 'agent' && s.ownerId === parsed.agentId) {
      session = s;
      sessionId = id;
      break;
    }
  }

  // If no active session, return success with rolledBack=false
  if (session === undefined || sessionId === undefined) {
    return deps.jsonResponse(200, {
      success: true,
      rolledBack: false,
      message: 'No active session for agent',
    });
  }

  // Rollback if there was a checkpoint (for autonomous work)
  let rolledBack = false;
  if (session.checkpointId !== undefined) {
    rolledBack = await rollbackToSessionCheckpoint(
      deps.env,
      deps.sessionInfo,
      session.checkpointId,
      sessionOwner(session),
      parsed.reason ?? 'Stopped by human user',
    );
  }

  // Clear agent's presence and persist to storage immediately
  // (prevents stale presence from being restored on DO hibernation wake)
  deps.presenceManager.unregisterByActorId(session.ownerId);
  await deps.persistPresence();

  // Remove the edit session
  deps.editSessions.delete(sessionId);
  await deps.persistEditSessions();

  // Broadcast presence update to all connected clients
  deps.broadcastPresenceUpdate();

  return deps.jsonResponse(200, {
    success: true,
    rolledBack,
  });
}

/**
 * Handle GET /edit-sessions - Return active edit sessions
 */
export function handleGetEditSessions(
  deps: AgentPolitenessDeps,
): Response {
  const sessions = Array.from(deps.editSessions.values()).map((session) => ({
    id: session.id,
    ownerId: session.ownerId,
    ownerType: session.ownerType,
    trigger: session.trigger,
    intent: session.intent,
    targetRegions: session.targetRegions,
    startedAt: session.startedAt,
    conflicted: session.conflicted,
    conflictReason: session.conflictReason,
  }));

  return deps.jsonResponse(200, { sessions });
}

/**
 * Handle POST /set-idle-timeout - Configure idle timeout
 */
export async function handleSetIdleTimeout(
  deps: AgentPolitenessDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deps.errorResponse(400, 'Invalid JSON body');
  }

  const parsed = body as { idleTimeoutMs: number };

  if (typeof parsed.idleTimeoutMs !== 'number') {
    return deps.errorResponse(400, 'idleTimeoutMs must be a number');
  }

  if (parsed.idleTimeoutMs < 0) {
    return deps.errorResponse(400, 'idleTimeoutMs must be non-negative');
  }

  deps.activityDetector.setIdleTimeout(parsed.idleTimeoutMs);

  return deps.jsonResponse(200, {
    idleTimeoutMs: deps.activityDetector.getIdleTimeoutMs(),
  });
}

/**
 * Handle GET /org-settings - Return organization settings for this site
 */
export function handleGetOrgSettings(
  deps: AgentPolitenessDeps,
): Response {
  const org = deps.cachedOrganization;

  return deps.jsonResponse(200, {
    organizationId: org?.id ?? null,
    organizationName: org?.name ?? null,
    agentIdleTimeoutMs: deps.activityDetector.getIdleTimeoutMs(),
  });
}

/**
 * Handle POST /org-settings/refresh - Refresh cached organization settings
 */
export async function handleRefreshOrgSettings(
  deps: AgentPolitenessDeps,
): Promise<Response> {
  await deps.refreshOrganizationSettings();

  // Re-read the cached organization after refresh
  const org = deps.cachedOrganization;

  return deps.jsonResponse(200, {
    organizationId: org?.id ?? null,
    organizationName: org?.name ?? null,
    agentIdleTimeoutMs: deps.activityDetector.getIdleTimeoutMs(),
  });
}
