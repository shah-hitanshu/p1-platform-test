/**
 * Agent politeness, edit session, org settings, and kill-switch HTTP handlers.
 * Extracted from document-session.ts for maintainability.
 *
 * Each handler is a standalone async function that receives an AgentPolitenessDeps
 * object with all required dependencies, avoiding circular imports back to
 * document-session.ts.
 */

import type { PresenceManager } from '../services/presence-service';
import type {
  ActivityDetector,
} from '../services/activity-detection-service';
import type { AgentEditPermissionService } from '../services/agent-edit-permission-service';
import { getAgentById } from '../services/agent-service';
import type { Organization } from '../types';
import {
  MAX_INTENT_LENGTH,
  MAX_TARGET_REGIONS,
  MAX_REASON_LENGTH,
} from '../constants/security-limits';

import type {
  AgentEditSession,
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
  createAgentPreEditCheckpoint,
  createAgentPostEditCheckpoint,
  rollbackToAgentCheckpoint,
} from './agent-checkpoint-client';

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
  editSessions: Map<string, AgentEditSession>;
  presenceManager: PresenceManager;
  activityDetector: ActivityDetector;
  agentEditPermissionService: AgentEditPermissionService;
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

  // Validate required fields before type narrowing
  if (typeof rawBody.agentId !== 'string' || rawBody.agentId.length === 0) {
    return deps.errorResponse(400, 'agentId is required');
  }

  if (rawBody.trigger !== 'human_requested' && rawBody.trigger !== 'autonomous') {
    return deps.errorResponse(400, 'trigger must be "human_requested" or "autonomous"');
  }

  const parsed = body as CanAgentEditRequest;

  // Validate agentId format
  const agentIdError = validateActorId(parsed.agentId);
  if (agentIdError !== null) {
    return deps.errorResponse(400, agentIdError);
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

  // Check permission using AgentEditPermissionService
  const permission = await deps.agentEditPermissionService.canAgentEdit({
    agentId: parsed.agentId,
    trigger: parsed.trigger,
    intent: '', // not available for pre-flight permission check
    targetRegions,
  });

  // Get conflicting regions
  const conflictingRegions = deps.agentEditPermissionService.getConflictingRegions(targetRegions);

  return deps.jsonResponse(200, {
    allowed: permission.allowed,
    reason: permission.reason,
    conflictingRegions,
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

  // Validate required fields before type narrowing
  if (typeof rawBody.agentId !== 'string' || rawBody.agentId.length === 0) {
    return deps.errorResponse(400, 'agentId is required');
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

  // Validate agentId format
  const agentIdError = validateActorId(parsed.agentId);
  if (agentIdError !== null) {
    return deps.errorResponse(400, agentIdError);
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

  // Check if agent already has an active edit session
  for (const existingSession of deps.editSessions.values()) {
    if (existingSession.agentId === parsed.agentId) {
      return deps.errorResponse(409, 'Agent already has an active edit session');
    }
  }

  // Check permission
  const permission = await deps.agentEditPermissionService.canAgentEdit({
    agentId: parsed.agentId,
    trigger: parsed.trigger,
    intent: parsed.intent,
    targetRegions,
  });

  if (!permission.allowed) {
    return deps.jsonResponse(403, {
      allowed: false,
      reason: permission.reason,
    });
  }

  // Look up agent's display name from the registry
  // Wrapped in try-catch because database may not be available in DO context
  let agentName = parsed.agentId;
  try {
    const agent = await getAgentById(parsed.agentId);
    agentName = agent?.name ?? parsed.agentId;
  } catch (error) {
    console.warn('Failed to look up agent name, using agentId:', error);
  }

  // Generate edit session ID using cryptographically secure random
  const editSessionId = `edit-${crypto.randomUUID()}`;

  // Create checkpoint for autonomous work via internal API
  let checkpointId: string | undefined;
  if (parsed.trigger === 'autonomous') {
    checkpointId = await createAgentPreEditCheckpoint(
      deps.env,
      deps.sessionInfo,
      parsed.agentId,
      parsed.intent,
      parsed.trigger,
      targetRegions,
    );
  }

  // Schedule cleanup alarm for HTTP-only clients (idempotent if already scheduled)
  void deps.scheduleCleanupAlarm();

  // Create edit session
  const newSession: AgentEditSession = {
    id: editSessionId,
    agentId: parsed.agentId,
    trigger: parsed.trigger,
    intent: parsed.intent,
    targetRegions,
    checkpointId,
    startedAt: Date.now(),
  };

  deps.editSessions.set(editSessionId, newSession);
  await deps.persistEditSessions();

  // Register agent presence with focus regions and editing state
  deps.presenceManager.register({
    actorId: parsed.agentId,
    actorType: 'agent',
    name: agentName,
    focusRegions: targetRegions,
    intent: parsed.intent,
    state: 'editing',
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

  // Create post-edit checkpoint if there was a pre-edit checkpoint
  let postCheckpointId: string | undefined;
  if (session.checkpointId !== undefined) {
    postCheckpointId = await createAgentPostEditCheckpoint(
      deps.env,
      deps.sessionInfo,
      session.agentId,
      session.intent,
      session.checkpointId,
      session.targetRegions,
    );
  }

  // Clear agent's presence and persist to storage immediately
  // (prevents stale presence from being restored on DO hibernation wake)
  deps.presenceManager.unregisterByActorId(session.agentId);
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

  if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
    return deps.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
  }

  // Find the edit session
  const session = deps.editSessions.get(parsed.editSessionId);
  if (session === undefined) {
    return deps.errorResponse(404, 'Edit session not found');
  }

  // Rollback if there was a checkpoint (for autonomous work)
  let rolledBack = false;
  if (session.checkpointId !== undefined) {
    rolledBack = await rollbackToAgentCheckpoint(
      deps.env,
      deps.sessionInfo,
      session.checkpointId,
      session.agentId,
      parsed.reason,
    );
  }

  // Clear agent's presence and persist to storage immediately
  // (prevents stale presence from being restored on DO hibernation wake)
  deps.presenceManager.unregisterByActorId(session.agentId);
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

  // Find the edit session by agentId
  let session: AgentEditSession | undefined;
  let sessionId: string | undefined;
  for (const [id, s] of deps.editSessions.entries()) {
    if (s.agentId === parsed.agentId) {
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
    rolledBack = await rollbackToAgentCheckpoint(
      deps.env,
      deps.sessionInfo,
      session.checkpointId,
      session.agentId,
      parsed.reason ?? 'Stopped by human user',
    );
  }

  // Clear agent's presence and persist to storage immediately
  // (prevents stale presence from being restored on DO hibernation wake)
  deps.presenceManager.unregisterByActorId(session.agentId);
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
    agentId: session.agentId,
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
