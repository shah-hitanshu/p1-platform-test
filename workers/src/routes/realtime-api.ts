/**
 * Phase 4.2: Real-Time API Routes
 *
 * Worker-level routing that proxies real-time collaboration requests
 * to the DocumentSession Durable Object.
 *
 * Endpoints:
 * - GET /api/sites/{siteId}/branches/{branchId}/documents/{documentPath} - Get document state
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/edits - Apply edits
 * - GET/WebSocket /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/connect - Real-time
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/can-agent-edit - Check agent permission
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-start - Start agent edit
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-complete - Complete agent edit
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-edit-abort - Abort agent edit
 * - OPTIONS /api/sites/{siteId}/branches/{branchId}/documents/* - CORS preflight
 *
 * Phase 7.3: Agent Context Headers Integration
 * Agent context can be provided via X-Agent-* headers in addition to body params:
 * - X-Agent-Id: agent UUID
 * - X-Agent-Trigger: human_requested | autonomous
 * - X-Agent-Requested-By: user UUID (when human_requested)
 * - X-Agent-Intent: description of what agent is doing
 * - X-Agent-Operation-Type: category
 * - X-Agent-Target-Regions: comma-separated JSON paths
 *
 * Headers are merged with body params, with body params taking precedence.
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
  MAX_SITE_ID_LENGTH,
  MAX_BRANCH_ID_LENGTH,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_EDIT_SESSION_ID_LENGTH,
  MAX_REASON_LENGTH,
  MAX_FOCUS_REGIONS_PER_REQUEST,
} from '../constants/security-limits';
import { checkAgentStatus } from '../middleware/agent-status-middleware';
import { getDocumentByPath } from '../services/document-service';

/**
 * Environment interface for Durable Object bindings
 */
interface RealtimeEnv {
  DOCUMENT_STATE: DurableObjectNamespace;
  CORS_ORIGINS?: string; // Comma-separated list of allowed origins
}

/**
 * Route parameters extracted from URL
 */
interface RouteParams {
  siteId: string;
  branchId: string;
  documentPath: string;
  action?: 'edits' | 'connect' | 'can-agent-edit' | 'agent-edit-start' | 'agent-edit-complete' | 'agent-edit-abort' | 'focus-regions';
}

/** Default allowed origins for development */
const DEFAULT_CORS_ORIGINS = 'http://localhost:3000,http://localhost:8787';

/**
 * Get CORS headers for a specific origin
 */
function getCorsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  // Check if origin is in allowed list
  const allowedOrigin = origin !== null && allowedOrigins.includes(origin) ? origin : '';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      'Content-Type',
      'X-Actor-Id',
      'X-Actor-Type',
      'Upgrade',
      // Phase 7.3: Agent context headers
      'X-Agent-Id',
      'X-Agent-Trigger',
      'X-Agent-Requested-By',
      'X-Agent-Intent',
      'X-Agent-Operation-Type',
      'X-Agent-Target-Regions',
    ].join(', '),
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Parse allowed origins from environment variable
 */
function parseAllowedOrigins(corsOrigins: string | undefined): string[] {
  const origins = corsOrigins ?? DEFAULT_CORS_ORIGINS;
  return origins.split(',').map((o) => o.trim()).filter((o) => o !== '');
}

/**
 * Validate URL parameter lengths
 * Returns error message if invalid, null if valid
 */
function validateParamLengths(params: RouteParams): string | null {
  if (params.siteId.length > MAX_SITE_ID_LENGTH) {
    return `siteId exceeds maximum length of ${String(MAX_SITE_ID_LENGTH)}`;
  }
  if (params.branchId.length > MAX_BRANCH_ID_LENGTH) {
    return `branchId exceeds maximum length of ${String(MAX_BRANCH_ID_LENGTH)}`;
  }
  if (params.documentPath.length > MAX_DOCUMENT_PATH_LENGTH) {
    return `documentPath exceeds maximum length of ${String(MAX_DOCUMENT_PATH_LENGTH)}`;
  }
  return null;
}

/**
 * Parse route from URL pathname
 * Returns null if the route doesn't match the expected pattern
 */
function parseRoute(pathname: string): RouteParams | null {
  // Pattern: /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}[/action]
  // Actions: edits, connect, can-agent-edit, agent-edit-start, agent-edit-complete, agent-edit-abort, focus-regions
  const actionPattern = 'edits|connect|can-agent-edit|agent-edit-start|agent-edit-complete|agent-edit-abort|focus-regions';
  const pattern = new RegExp(
    `^/api/sites/([^/]+)/branches/([^/]+)/documents/(.+?)(?:/(${actionPattern}))?$`,
  );

  const match = pattern.exec(pathname);
  if (match === null) {
    return null;
  }

  const [, siteId, branchId, documentPath, action] = match;

  // Validate required parameters are not empty
  if (
    siteId === undefined ||
    siteId === '' ||
    branchId === undefined ||
    branchId === '' ||
    documentPath === undefined ||
    documentPath === ''
  ) {
    return null;
  }

  return {
    siteId: decodeURIComponent(siteId),
    branchId: decodeURIComponent(branchId),
    documentPath: decodeURIComponent(documentPath),
    action: action as RouteParams['action'],
  };
}

/**
 * Generate session ID for Durable Object
 * Format: {siteId}:{documentId}:{branchId}
 *
 * Uses documentId (UUID) instead of documentPath to ensure stable session IDs
 * that survive document renames and match the presence-rollup-service format.
 */
function generateSessionId(siteId: string, documentId: string, branchId: string): string {
  return `${siteId}:${documentId}:${branchId}`;
}

/**
 * Add CORS headers to a response
 */
function addCorsHeaders(
  response: Response,
  origin: string | null,
  allowedOrigins: string[],
): Response {
  // WebSocket upgrade responses cannot be modified
  // Return them as-is since CORS doesn't apply to WebSocket connections
  // Note: Cloudflare Workers Response has a webSocket property for WebSocket upgrades
  if ('webSocket' in response && (response as { webSocket: unknown }).webSocket != null) {
    return response;
  }

  const corsHeaders = getCorsHeaders(origin, allowedOrigins);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create JSON error response with CORS headers
 */
function errorResponse(
  status: number,
  error: string,
  origin: string | null,
  allowedOrigins: string[],
): Response {
  const corsHeaders = getCorsHeaders(origin, allowedOrigins);
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * Handle CORS preflight OPTIONS request
 */
function handleOptions(origin: string | null, allowedOrigins: string[]): Response {
  const corsHeaders = getCorsHeaders(origin, allowedOrigins);
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Phase 7.4: Validate agent status at Worker level.
 * Returns error response if agent is suspended/disabled/not found,
 * or null to allow the request to proceed.
 *
 * @param agentId - Agent ID to validate (may be undefined/empty)
 * @param origin - Request origin for CORS headers
 * @param allowedOrigins - List of allowed CORS origins
 * @returns Error response if agent rejected, or null to allow through
 */
async function validateAgentStatusForEdit(
  agentId: string | undefined,
  origin: string | null,
  allowedOrigins: string[],
): Promise<Response | null> {
  // No agent ID - no validation needed
  if (agentId === undefined || agentId === '') {
    return null;
  }

  // Create agent context for status check
  const agentContext: AgentContext = { agentId };
  const result = await checkAgentStatus(agentContext);

  // Allowed - let request proceed
  if (result.allowed) {
    return null;
  }

  // Determine HTTP status based on denial reason
  let status: number;
  switch (result.reason) {
    case 'agent_not_found':
      status = 404;
      break;
    case 'agent_suspended':
    case 'agent_disabled':
      status = 403;
      break;
    case 'lookup_error':
    default:
      status = 500;
      break;
  }

  // Return error response with CORS headers
  return errorResponse(
    status,
    result.message ?? 'Agent access denied',
    origin,
    allowedOrigins,
  );
}

/**
 * Validate POST request body for /edits endpoint
 * Returns parsed body or error response
 */
async function validateEditsBody(
  request: Request,
  origin: string | null,
  allowedOrigins: string[],
): Promise<{ operations: unknown[]; actorId: string; editSessionId?: string } | Response> {
  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, allowedOrigins);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, allowedOrigins);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, allowedOrigins);
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate operations field
  if (!('operations' in bodyObj)) {
    return errorResponse(400, 'Missing required field: operations', origin, allowedOrigins);
  }

  if (!Array.isArray(bodyObj.operations)) {
    return errorResponse(400, 'operations must be an array', origin, allowedOrigins);
  }

  // Validate actorId field
  if (!('actorId' in bodyObj) || typeof bodyObj.actorId !== 'string' || bodyObj.actorId === '') {
    return errorResponse(400, 'Missing required field: actorId', origin, allowedOrigins);
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
interface AgentEditRequestBody {
  agentId: string;
  trigger: string;
  intent: string;
  targetRegions: string[];
  operationType?: string;
}

async function validateAgentEditBody(
  request: Request,
  origin: string | null,
  allowedOrigins: string[],
): Promise<AgentEditRequestBody | Response> {
  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, allowedOrigins);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, allowedOrigins);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, allowedOrigins);
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
    return errorResponse(400, 'Missing or invalid required field: agentId', origin, allowedOrigins);
  }

  if (agentId.length > MAX_AGENT_ID_LENGTH) {
    return errorResponse(
      400,
      `agentId must be 1-${String(MAX_AGENT_ID_LENGTH)} characters`,
      origin,
      allowedOrigins,
    );
  }

  if (trigger === undefined || trigger === '') {
    return errorResponse(400, 'Missing or invalid required field: trigger', origin, allowedOrigins);
  }

  if (!VALID_TRIGGERS.includes(trigger as typeof VALID_TRIGGERS[number])) {
    return errorResponse(
      400,
      'Invalid trigger value. Must be "human_requested" or "autonomous"',
      origin,
      allowedOrigins,
    );
  }

  if (intent === undefined || intent === '') {
    return errorResponse(400, 'Missing or invalid required field: intent', origin, allowedOrigins);
  }

  if (intent.length > MAX_INTENT_LENGTH) {
    return errorResponse(
      400,
      `intent must be 1-${String(MAX_INTENT_LENGTH)} characters`,
      origin,
      allowedOrigins,
    );
  }

  if (operationType !== undefined && operationType.length > MAX_OPERATION_TYPE_LENGTH) {
    return errorResponse(
      400,
      `operationType must be at most ${String(MAX_OPERATION_TYPE_LENGTH)} characters`,
      origin,
      allowedOrigins,
    );
  }

  // Validate targetRegions is provided (required field)
  if (targetRegions === undefined) {
    return errorResponse(400, 'Missing or invalid required field: targetRegions', origin, allowedOrigins);
  }

  // Validate targetRegions array size
  if (targetRegions.length > MAX_TARGET_REGIONS) {
    return errorResponse(
      400,
      `targetRegions cannot exceed ${String(MAX_TARGET_REGIONS)} entries`,
      origin,
      allowedOrigins,
    );
  }

  // Validate each region is a string with valid length
  for (const region of targetRegions) {
    if (typeof region !== 'string') {
      return errorResponse(400, 'Each targetRegion must be a string', origin, allowedOrigins);
    }
    if (region.length > MAX_REGION_PATH_LENGTH) {
      return errorResponse(
        400,
        `Each targetRegion must be at most ${String(MAX_REGION_PATH_LENGTH)} characters`,
        origin,
        allowedOrigins,
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
async function validateEditSessionBody(
  request: Request,
  origin: string | null,
  allowedOrigins: string[],
  requireReason = false,
): Promise<{ editSessionId: string; reason?: string } | Response> {
  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, allowedOrigins);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, allowedOrigins);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, allowedOrigins);
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate required fields
  if (!('editSessionId' in bodyObj) || typeof bodyObj.editSessionId !== 'string') {
    return errorResponse(400, 'Missing or invalid required field: editSessionId', origin, allowedOrigins);
  }

  if (bodyObj.editSessionId.length === 0 || bodyObj.editSessionId.length > MAX_EDIT_SESSION_ID_LENGTH) {
    return errorResponse(
      400,
      `editSessionId must be 1-${String(MAX_EDIT_SESSION_ID_LENGTH)} characters`,
      origin,
      allowedOrigins,
    );
  }

  if (requireReason && (!('reason' in bodyObj) || typeof bodyObj.reason !== 'string')) {
    return errorResponse(400, 'Missing or invalid required field: reason', origin, allowedOrigins);
  }

  // Validate reason length if provided
  if (typeof bodyObj.reason === 'string' && bodyObj.reason.length > MAX_REASON_LENGTH) {
    return errorResponse(
      400,
      `reason must be at most ${String(MAX_REASON_LENGTH)} characters`,
      origin,
      allowedOrigins,
    );
  }

  return {
    editSessionId: bodyObj.editSessionId,
    reason: typeof bodyObj.reason === 'string' ? bodyObj.reason : undefined,
  };
}

/**
 * Validate POST request body for /focus-regions endpoint
 * Returns parsed body or error response
 */
async function validateFocusRegionsBody(
  request: Request,
  origin: string | null,
  allowedOrigins: string[],
): Promise<{ actorId: string; focusRegions: string[] } | Response> {
  // Check X-Actor-Type header - must be 'user'
  const actorType = request.headers.get('X-Actor-Type');
  if (actorType !== 'user') {
    return errorResponse(
      403,
      'Only users can update focus regions. Agents should use /agent-edit-start.',
      origin,
      allowedOrigins,
    );
  }

  // Check Content-Type
  const contentType = request.headers.get('Content-Type');
  const isJsonContentType = contentType?.includes('application/json') === true;
  if (!isJsonContentType) {
    return errorResponse(415, 'Content-Type must be application/json', origin, allowedOrigins);
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON in request body', origin, allowedOrigins);
  }

  // Validate body structure
  if (typeof body !== 'object' || body === null) {
    return errorResponse(400, 'Request body must be an object', origin, allowedOrigins);
  }

  const bodyObj = body as Record<string, unknown>;

  // Validate actorId
  if (typeof bodyObj.actorId !== 'string' || bodyObj.actorId === '') {
    return errorResponse(400, 'Missing or invalid required field: actorId', origin, allowedOrigins);
  }

  // Validate focusRegions
  if (!Array.isArray(bodyObj.focusRegions)) {
    return errorResponse(400, 'Missing or invalid required field: focusRegions', origin, allowedOrigins);
  }

  const focusRegions = bodyObj.focusRegions as unknown[];

  // Validate each region is a string
  for (const region of focusRegions) {
    if (typeof region !== 'string') {
      return errorResponse(400, 'Each focusRegion must be a string', origin, allowedOrigins);
    }
  }

  const validRegions = focusRegions as string[];

  // Enforce maximum limit (uses centralized constant)
  if (validRegions.length > MAX_FOCUS_REGIONS_PER_REQUEST) {
    return errorResponse(
      400,
      `focusRegions cannot exceed ${String(MAX_FOCUS_REGIONS_PER_REQUEST)} entries`,
      origin,
      allowedOrigins,
    );
  }

  return {
    actorId: bodyObj.actorId,
    focusRegions: validRegions,
  };
}

/**
 * Handle real-time API routes
 *
 * @param request - Incoming request
 * @param env - Worker environment with Durable Object bindings
 * @returns Response or null if route doesn't match
 */
export async function handleRealtimeRoutes(
  request: Request,
  env: RealtimeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Parse CORS configuration
  const origin = request.headers.get('Origin');
  const allowedOrigins = parseAllowedOrigins(env.CORS_ORIGINS);

  // Parse route parameters
  const params = parseRoute(pathname);
  if (params === null) {
    // Route doesn't match - let other handlers try
    return null;
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions(origin, allowedOrigins);
  }

  // Validate parameter lengths (security: prevent oversized inputs)
  const paramError = validateParamLengths(params);
  if (paramError !== null) {
    return errorResponse(400, paramError, origin, allowedOrigins);
  }

  // Validate WebSocket origin for connect endpoint
  if (params.action === 'connect' && origin !== null) {
    if (!allowedOrigins.includes(origin)) {
      return errorResponse(403, 'Origin not allowed', origin, allowedOrigins);
    }
  }

  // Determine the target endpoint and validate method
  let targetEndpoint: string;
  let forwardedRequest: Request;

  if (params.action === 'connect') {
    // WebSocket connect endpoint
    if (request.method !== 'GET') {
      return errorResponse(405, 'Method not allowed. Use GET for WebSocket connection.', origin, allowedOrigins);
    }
    targetEndpoint = '/connect';

    // Preserve query parameters (for actorId, actorType, apiKey, etc.)
    const queryString = url.search;

    // For WebSocket upgrade requests, use new Request(url, originalRequest) syntax
    // This preserves WebSocket-related headers (Upgrade, Connection, Sec-WebSocket-*)
    // that would otherwise be stripped as "forbidden headers"
    forwardedRequest = new Request(
      `http://internal${targetEndpoint}${queryString}`,
      request,
    );
  } else if (params.action === 'edits') {
    // Apply edits endpoint
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for edits.', origin, allowedOrigins);
    }

    // Validate request body
    const bodyResult = await validateEditsBody(request, origin, allowedOrigins);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    targetEndpoint = '/apply';

    // Forward with original body and headers
    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(bodyResult),
    });
  } else if (params.action === 'can-agent-edit') {
    // Check if agent can edit endpoint
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for can-agent-edit.', origin, allowedOrigins);
    }

    // Validate request body
    const bodyResult = await validateAgentEditBody(request, origin, allowedOrigins);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Phase 7.4: Validate agent status before forwarding to DO
    const statusError = await validateAgentStatusForEdit(
      bodyResult.agentId,
      origin,
      allowedOrigins,
    );
    if (statusError !== null) {
      return statusError;
    }

    targetEndpoint = '/can-agent-edit';

    // Forward with validated body and original headers
    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(bodyResult),
    });
  } else if (params.action === 'agent-edit-start') {
    // Start agent edit endpoint
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for agent-edit-start.', origin, allowedOrigins);
    }

    // Validate request body
    const bodyResult = await validateAgentEditBody(request, origin, allowedOrigins);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Phase 7.4: Validate agent status before forwarding to DO
    const statusError = await validateAgentStatusForEdit(
      bodyResult.agentId,
      origin,
      allowedOrigins,
    );
    if (statusError !== null) {
      return statusError;
    }

    targetEndpoint = '/agent-edit-start';

    // Forward with validated body and original headers
    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(bodyResult),
    });
  } else if (params.action === 'agent-edit-complete') {
    // Complete agent edit endpoint
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for agent-edit-complete.', origin, allowedOrigins);
    }

    // Validate request body
    const bodyResult = await validateEditSessionBody(request, origin, allowedOrigins);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Phase 7.4: Validate agent status if X-Agent-Id header present
    const headerAgentId = request.headers.get('X-Agent-Id') ?? request.headers.get('x-agent-id');
    if (headerAgentId !== null && headerAgentId !== '') {
      const statusError = await validateAgentStatusForEdit(
        headerAgentId,
        origin,
        allowedOrigins,
      );
      if (statusError !== null) {
        return statusError;
      }
    }

    targetEndpoint = '/agent-edit-complete';

    // Forward with validated body and original headers
    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(bodyResult),
    });
  } else if (params.action === 'agent-edit-abort') {
    // Abort agent edit endpoint
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for agent-edit-abort.', origin, allowedOrigins);
    }

    // Validate request body (reason is optional)
    const bodyResult = await validateEditSessionBody(request, origin, allowedOrigins, false);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Phase 7.4: Validate agent status if X-Agent-Id header present
    const headerAgentId = request.headers.get('X-Agent-Id') ?? request.headers.get('x-agent-id');
    if (headerAgentId !== null && headerAgentId !== '') {
      const statusError = await validateAgentStatusForEdit(
        headerAgentId,
        origin,
        allowedOrigins,
      );
      if (statusError !== null) {
        return statusError;
      }
    }

    targetEndpoint = '/agent-edit-abort';

    // Forward with validated body and original headers
    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(bodyResult),
    });
  } else if (params.action === 'focus-regions') {
    // Update focus regions endpoint
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for focus-regions.', origin, allowedOrigins);
    }

    // Validate request body
    const bodyResult = await validateFocusRegionsBody(request, origin, allowedOrigins);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    targetEndpoint = '/update-focus-regions';

    // Forward with validated body and original headers
    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(bodyResult),
    });
  } else {
    // Get document state endpoint
    if (request.method !== 'GET') {
      return errorResponse(405, 'Method not allowed. Use GET to retrieve document state.', origin, allowedOrigins);
    }
    targetEndpoint = '/snapshot';

    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'GET',
      headers: request.headers,
    });
  }

  // Look up document by path to get stable document ID
  // This ensures session IDs survive document renames and match presence-rollup-service
  const document = await getDocumentByPath(params.siteId, params.documentPath);
  if (document === null) {
    return errorResponse(404, `Document not found: ${params.documentPath}`, origin, allowedOrigins);
  }

  // Generate Durable Object ID and get stub using document UUID
  const sessionId = generateSessionId(params.siteId, document.id, params.branchId);
  const durableObjectId = env.DOCUMENT_STATE.idFromName(sessionId);
  const stub = env.DOCUMENT_STATE.get(durableObjectId);

  // Add session ID header to forwarded request so DO can parse it
  // (state.id.name is not available in Miniflare local emulator)
  // For WebSocket upgrade requests, we must pass the original request to preserve
  // WebSocket-specific headers (Upgrade, Connection, Sec-WebSocket-*)
  const isWebSocketUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

  let requestWithSessionId: Request;
  if (isWebSocketUpgrade) {
    // For WebSocket: clone the forwarded request and add session header
    // Using Request constructor with request object preserves WebSocket headers
    const headersWithSession = new Headers(forwardedRequest.headers);
    headersWithSession.set('X-Session-Id', sessionId);
    requestWithSessionId = new Request(forwardedRequest.url, forwardedRequest);
    // Note: We can't modify headers on a cloned request, so we need a workaround
    // Pass session ID via URL query parameter instead for WebSocket
    const urlWithSession = new URL(forwardedRequest.url);
    urlWithSession.searchParams.set('_sessionId', sessionId);
    requestWithSessionId = new Request(urlWithSession.toString(), forwardedRequest);
  } else {
    // For regular HTTP requests: create new request with session header
    const headersWithSession = new Headers(forwardedRequest.headers);
    headersWithSession.set('X-Session-Id', sessionId);
    // Note: duplex is required when request has a streaming body
    const requestInit: RequestInit = {
      method: forwardedRequest.method,
      headers: headersWithSession,
      body: forwardedRequest.body,
    };
    // Add duplex option for streaming bodies (required by spec)
    if (forwardedRequest.body !== null) {
      (requestInit as RequestInit & { duplex: string }).duplex = 'half';
    }
    requestWithSessionId = new Request(forwardedRequest.url, requestInit);
  }

  // Forward request to Durable Object
  try {
    const response = await stub.fetch(requestWithSessionId);
    return addCorsHeaders(response, origin, allowedOrigins);
  } catch (error) {
    console.error('Durable Object error:', error);
    return errorResponse(
      503,
      'Service temporarily unavailable. Please try again.',
      origin,
      allowedOrigins,
    );
  }
}
