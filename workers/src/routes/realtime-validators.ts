/**
 * Body validation functions for Real-Time API Routes
 *
 * Extracted from realtime-api.ts to reduce file size.
 * Each validator parses and validates a POST request body,
 * returning either the parsed data or an error Response.
 */

import {
  parseAgentContext,
  type AgentContext,
} from '../services/agent-context-service';
import {
  MAX_ACTOR_ID_LENGTH as MAX_AGENT_ID_LENGTH,
  MAX_INTENT_LENGTH,
  MAX_TARGET_REGIONS,
  MAX_REGION_PATH_LENGTH,
  MAX_OPERATION_TYPE_LENGTH,
  MAX_EDIT_SESSION_ID_LENGTH,
  MAX_REASON_LENGTH,
  MAX_FOCUS_REGIONS_PER_REQUEST,
} from '../constants/security-limits';
import { errorResponse } from './realtime-utils';
import type { CorsPattern } from '../utils/cors';

/**
 * Validate POST request body for /edits endpoint
 * Returns parsed body or error response
 */
export async function validateEditsBody(
  request: Request,
  origin: string | null,
  patterns: CorsPattern[],
): Promise<{ operations: unknown[]; actorId: string; editSessionId?: string } | Response> {
  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, patterns);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, patterns);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, patterns);
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate operations field
  if (!('operations' in bodyObj)) {
    return errorResponse(400, 'Missing required field: operations', origin, patterns);
  }

  if (!Array.isArray(bodyObj.operations)) {
    return errorResponse(400, 'operations must be an array', origin, patterns);
  }

  // Validate actorId field
  if (!('actorId' in bodyObj) || typeof bodyObj.actorId !== 'string' || bodyObj.actorId === '') {
    return errorResponse(400, 'Missing required field: actorId', origin, patterns);
  }

  // Pass through editSessionId if present (required for agents)
  const result: { operations: unknown[]; actorId: string; editSessionId?: string } = {
    operations: bodyObj.operations,
    actorId: bodyObj.actorId,
  };

  if ('editSessionId' in bodyObj && typeof bodyObj.editSessionId === 'string') {
    result.editSessionId = bodyObj.editSessionId;
  }

  return result;
}

/**
 * Valid trigger values for agent edit requests
 */
const VALID_TRIGGERS = ['human_requested', 'autonomous'] as const;

/**
 * Validate POST request body for /can-agent-edit and /agent-edit-start endpoints
 * Returns parsed body or error response
 *
 * Phase 7.3: Merges X-Agent-* headers with body params.
 * Body params take precedence over headers for backwards compatibility.
 */
export interface AgentEditRequestBody {
  agentId: string;
  trigger: string;
  intent: string;
  targetRegions: string[];
  operationType?: string;
}

export async function validateAgentEditBody(
  request: Request,
  origin: string | null,
  patterns: CorsPattern[],
): Promise<AgentEditRequestBody | Response> {
  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, patterns);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, patterns);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, patterns);
  }

  const bodyObj = body as Record<string, unknown>;

  // Phase 7.3: Parse X-Agent-* headers
  const headerContext: AgentContext | null = parseAgentContext(request.headers);

  // Merge headers with body params (body takes precedence)
  const agentId = typeof bodyObj.agentId === 'string' && bodyObj.agentId.length > 0
    ? bodyObj.agentId
    : headerContext?.agentId;

  const trigger = typeof bodyObj.trigger === 'string' && bodyObj.trigger.length > 0
    ? bodyObj.trigger
    : headerContext?.trigger;

  const intent = typeof bodyObj.intent === 'string' && bodyObj.intent.length > 0
    ? bodyObj.intent
    : headerContext?.intent;

  const operationType = typeof bodyObj.operationType === 'string' && bodyObj.operationType.length > 0
    ? bodyObj.operationType
    : headerContext?.operationType;

  // Merge targetRegions: body array takes precedence, otherwise use header regions
  // targetRegions is required - must be provided by either body or headers
  let targetRegions: string[] | undefined;
  if (Array.isArray(bodyObj.targetRegions) && bodyObj.targetRegions.length > 0) {
    targetRegions = bodyObj.targetRegions as string[];
  } else if (headerContext?.targetRegions !== undefined && headerContext.targetRegions.length > 0) {
    targetRegions = headerContext.targetRegions;
  } else if (Array.isArray(bodyObj.targetRegions)) {
    // Body provided empty array explicitly - use it (allows empty if intended)
    targetRegions = bodyObj.targetRegions as string[];
  } else {
    targetRegions = undefined; // Neither source provided targetRegions
  }

  // Validate required fields after merge
  if (agentId === undefined || agentId === '') {
    return errorResponse(400, 'Missing or invalid required field: agentId', origin, patterns);
  }

  if (agentId.length > MAX_AGENT_ID_LENGTH) {
    return errorResponse(
      400,
      `agentId must be 1-${String(MAX_AGENT_ID_LENGTH)} characters`,
      origin,
      patterns,
    );
  }

  if (trigger === undefined || trigger === '') {
    return errorResponse(400, 'Missing or invalid required field: trigger', origin, patterns);
  }

  if (!VALID_TRIGGERS.includes(trigger as typeof VALID_TRIGGERS[number])) {
    return errorResponse(
      400,
      'Invalid trigger value. Must be "human_requested" or "autonomous"',
      origin,
      patterns,
    );
  }

  if (intent === undefined || intent === '') {
    return errorResponse(400, 'Missing or invalid required field: intent', origin, patterns);
  }

  if (intent.length > MAX_INTENT_LENGTH) {
    return errorResponse(
      400,
      `intent must be 1-${String(MAX_INTENT_LENGTH)} characters`,
      origin,
      patterns,
    );
  }

  if (operationType !== undefined && operationType.length > MAX_OPERATION_TYPE_LENGTH) {
    return errorResponse(
      400,
      `operationType must be at most ${String(MAX_OPERATION_TYPE_LENGTH)} characters`,
      origin,
      patterns,
    );
  }

  // Validate targetRegions is provided (required field)
  if (targetRegions === undefined) {
    return errorResponse(400, 'Missing or invalid required field: targetRegions', origin, patterns);
  }

  // Validate targetRegions array size
  if (targetRegions.length > MAX_TARGET_REGIONS) {
    return errorResponse(
      400,
      `targetRegions cannot exceed ${String(MAX_TARGET_REGIONS)} entries`,
      origin,
      patterns,
    );
  }

  // Validate each region is a string with valid length
  for (const region of targetRegions) {
    if (typeof region !== 'string') {
      return errorResponse(400, 'Each targetRegion must be a string', origin, patterns);
    }
    if (region.length > MAX_REGION_PATH_LENGTH) {
      return errorResponse(
        400,
        `Each targetRegion must be at most ${String(MAX_REGION_PATH_LENGTH)} characters`,
        origin,
        patterns,
      );
    }
  }

  return {
    agentId,
    trigger,
    intent,
    targetRegions,
    operationType,
  };
}

/**
 * Validate POST request body for /agent-edit-complete and /agent-edit-abort endpoints
 * Returns parsed body or error response
 */
export async function validateEditSessionBody(
  request: Request,
  origin: string | null,
  patterns: CorsPattern[],
  requireReason = false,
): Promise<{ editSessionId: string; reason?: string } | Response> {
  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, patterns);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, patterns);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, patterns);
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate required fields
  if (!('editSessionId' in bodyObj) || typeof bodyObj.editSessionId !== 'string') {
    return errorResponse(400, 'Missing or invalid required field: editSessionId', origin, patterns);
  }

  if (bodyObj.editSessionId.length === 0 || bodyObj.editSessionId.length > MAX_EDIT_SESSION_ID_LENGTH) {
    return errorResponse(
      400,
      `editSessionId must be 1-${String(MAX_EDIT_SESSION_ID_LENGTH)} characters`,
      origin,
      patterns,
    );
  }

  if (requireReason && (!('reason' in bodyObj) || typeof bodyObj.reason !== 'string')) {
    return errorResponse(400, 'Missing or invalid required field: reason', origin, patterns);
  }

  // Validate reason length if provided
  if (typeof bodyObj.reason === 'string' && bodyObj.reason.length > MAX_REASON_LENGTH) {
    return errorResponse(
      400,
      `reason must be at most ${String(MAX_REASON_LENGTH)} characters`,
      origin,
      patterns,
    );
  }

  return {
    editSessionId: bodyObj.editSessionId,
    reason: typeof bodyObj.reason === 'string' ? bodyObj.reason : undefined,
  };
}

/**
 * Validate POST request body for /agent-stop endpoint (human-initiated stop)
 * Returns parsed body or error response
 */
export async function validateAgentStopBody(
  request: Request,
  origin: string | null,
  patterns: CorsPattern[],
): Promise<{ agentId: string; reason?: string } | Response> {
  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, patterns);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, patterns);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, patterns);
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate required fields
  if (!('agentId' in bodyObj) || typeof bodyObj.agentId !== 'string' || bodyObj.agentId === '') {
    return errorResponse(400, 'Missing or invalid required field: agentId', origin, patterns);
  }

  if (bodyObj.agentId.length > MAX_AGENT_ID_LENGTH) {
    return errorResponse(
      400,
      `agentId must be 1-${String(MAX_AGENT_ID_LENGTH)} characters`,
      origin,
      patterns,
    );
  }

  // Validate reason length if provided
  if (typeof bodyObj.reason === 'string' && bodyObj.reason.length > MAX_REASON_LENGTH) {
    return errorResponse(
      400,
      `reason must be at most ${String(MAX_REASON_LENGTH)} characters`,
      origin,
      patterns,
    );
  }

  return {
    agentId: bodyObj.agentId,
    reason: typeof bodyObj.reason === 'string' ? bodyObj.reason : undefined,
  };
}

/**
 * Validate POST request body for /focus-regions endpoint
 * Returns parsed body or error response
 */
export async function validateFocusRegionsBody(
  request: Request,
  origin: string | null,
  patterns: CorsPattern[],
): Promise<{ actorId: string; focusRegions: string[] } | Response> {
  // Check X-Actor-Type header - must be 'user'
  const actorType = request.headers.get('X-Actor-Type');
  if (actorType !== 'user') {
    return errorResponse(
      403,
      'Only users can update focus regions. Agents should use /agent-edit-start.',
      origin,
      patterns,
    );
  }

  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, patterns);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, patterns);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, patterns);
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate actorId
  if (typeof bodyObj.actorId !== 'string' || bodyObj.actorId === '') {
    return errorResponse(400, 'Missing or invalid required field: actorId', origin, patterns);
  }

  // Validate focusRegions
  if (!Array.isArray(bodyObj.focusRegions)) {
    return errorResponse(400, 'Missing or invalid required field: focusRegions', origin, patterns);
  }

  const focusRegions = bodyObj.focusRegions as unknown[];

  // Validate each region is a string
  for (const region of focusRegions) {
    if (typeof region !== 'string') {
      return errorResponse(400, 'Each focusRegion must be a string', origin, patterns);
    }
  }

  const validRegions = focusRegions as string[];

  // Enforce maximum limit (uses centralized constant)
  if (validRegions.length > MAX_FOCUS_REGIONS_PER_REQUEST) {
    return errorResponse(
      400,
      `focusRegions cannot exceed ${String(MAX_FOCUS_REGIONS_PER_REQUEST)} entries`,
      origin,
      patterns,
    );
  }

  return {
    actorId: bodyObj.actorId,
    focusRegions: validRegions,
  };
}
