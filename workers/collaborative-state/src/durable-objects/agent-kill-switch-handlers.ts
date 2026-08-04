/**
 * Agent kill-switch HTTP handlers (Phase 6).
 * Extracted from agent-politeness-handlers.ts for maintainability.
 *
 * Contains admin operations for terminating agent edit sessions:
 * - /kick-agent: Terminate a specific agent
 * - /kick-all-agents: Terminate all agents
 * - /active-agents: List active agent sessions
 */

import { MAX_REASON_LENGTH } from '../constants/security-limits';
import type { AgentPolitenessDeps } from './agent-politeness-handlers';

/**
 * Handle POST /kick-agent - Terminate a specific agent's edit session
 */
export async function handleKickAgent(
  deps: AgentPolitenessDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deps.errorResponse(400, 'Invalid JSON body');
  }

  const parsed = body as { agentId?: string; reason?: string };

  if (parsed.agentId === undefined || parsed.agentId === '') {
    return deps.errorResponse(400, 'agentId is required');
  }

  // Validate reason length if provided
  if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
    return deps.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
  }

  // The kill switch reaches agents only; a person's session is not an agent's to end.
  let sessionToRemove: { id: string; ownerId: string } | undefined;
  let sessionKey: string | undefined;

  for (const [key, session] of deps.editSessions.entries()) {
    if (session.ownerType === 'agent' && session.ownerId === parsed.agentId) {
      sessionToRemove = session;
      sessionKey = key;
      break;
    }
  }

  if (sessionToRemove === undefined || sessionKey === undefined) {
    return deps.errorResponse(404, `Agent session not found for agentId: ${parsed.agentId}`);
  }

  // Remove the edit session
  deps.editSessions.delete(sessionKey);
  await deps.persistEditSessions();

  // Clear agent's presence
  deps.presenceManager.unregisterByActorId(parsed.agentId);

  // Broadcast presence update to all connected clients
  deps.broadcastPresenceUpdate();

  // Get the actor who is kicking
  const kickedBy = request.headers.get('X-Actor-Id') ?? 'unknown';

  return deps.jsonResponse(200, {
    success: true,
    agentId: parsed.agentId,
    sessionId: sessionToRemove.id,
    reason: parsed.reason ?? 'No reason provided',
    kickedBy,
  });
}

/**
 * Handle POST /kick-all-agents - Terminate all active agent edit sessions
 */
export async function handleKickAllAgents(
  deps: AgentPolitenessDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = body as { reason?: string };

  // Validate reason length if provided
  if (parsed.reason !== undefined && parsed.reason.length > MAX_REASON_LENGTH) {
    return deps.errorResponse(400, `reason exceeds maximum length of ${String(MAX_REASON_LENGTH)}`);
  }

  const kickedBy = request.headers.get('X-Actor-Id') ?? 'unknown';

  // Collect the agent-owned sessions; person-owned sessions are left running.
  const kickedAgents: string[] = [];
  for (const [key, session] of deps.editSessions.entries()) {
    if (session.ownerType === 'agent') {
      kickedAgents.push(session.ownerId);
      deps.editSessions.delete(key);
    }
  }
  await deps.persistEditSessions();

  // Clear all agent presences
  for (const agentId of kickedAgents) {
    deps.presenceManager.unregisterByActorId(agentId);
  }

  // Broadcast presence update to all connected clients
  if (kickedAgents.length > 0) {
    deps.broadcastPresenceUpdate();
  }

  return deps.jsonResponse(200, {
    success: true,
    kickedCount: kickedAgents.length,
    kickedAgents,
    reason: parsed.reason ?? 'No reason provided',
    kickedBy,
  });
}

/**
 * Handle GET /active-agents - Return list of active agent edit sessions
 */
export function handleGetActiveAgents(
  deps: AgentPolitenessDeps,
): Response {
  const agents = Array.from(deps.editSessions.values())
    .filter((session) => session.ownerType === 'agent')
    .map((session) => ({
      agentId: session.ownerId,
      sessionId: session.id,
      regions: session.targetRegions,
      trigger: session.trigger,
      intent: session.intent,
      startedAt: session.startedAt,
      conflicted: session.conflicted,
    }));

  return deps.jsonResponse(200, { agents });
}
