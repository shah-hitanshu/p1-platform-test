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
 * - POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/agent-stop - Stop agent (human-initiated)
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
  type RealtimeEnv,
  type RealtimeRouteContext,
  parseRoute,
  parseCorsPatterns,
  validateParamLengths,
  generateSessionId,
  errorResponse,
  handleOptions,
  addCorsHeaders,
  validateAgentStatusForEdit,
  getRequiredPermission,
  isOriginAllowed,
} from './realtime-utils';
import {
  validateEditsBody,
  validateAgentEditBody,
  validateEditSessionBody,
  validateAgentStopBody,
  validateFocusRegionsBody,
} from './realtime-validators';
import { getDocumentByPath } from '../services/document-service';
import { hasPermission } from '../auth/authorization';

// Re-export for consumers
export type { RealtimeRouteContext } from './realtime-utils';

/**
 * Handle real-time API routes
 *
 * @param request - Incoming request
 * @param env - Worker environment with Durable Object bindings
 * @param context - Auth Phase 4: Authenticated principal context
 * @returns Response or null if route doesn't match
 */
export async function handleRealtimeRoutes(
  request: Request,
  env: RealtimeEnv,
  context: RealtimeRouteContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Parse CORS configuration
  const origin = request.headers.get('Origin');
  const patterns = parseCorsPatterns(env.CORS_ORIGINS);

  // Parse route parameters
  const params = parseRoute(pathname);
  if (params === null) {
    // Route doesn't match - let other handlers try
    return null;
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions(origin, patterns);
  }

  // Validate parameter lengths (security: prevent oversized inputs)
  const paramError = validateParamLengths(params);
  if (paramError !== null) {
    return errorResponse(400, paramError, origin, patterns);
  }

  // Validate WebSocket origin for connect endpoint
  if (params.action === 'connect' && origin !== null) {
    if (!isOriginAllowed(origin, patterns)) {
      return errorResponse(403, 'Origin not allowed', origin, patterns);
    }
  }

  // ==========================================================================
  // Auth Phase 4: Cross-validate actorId against authenticated principal
  // ==========================================================================
  const clientActorId = request.headers.get('X-Actor-Id')
    ?? url.searchParams.get('actorId');

  if (
    clientActorId !== null
    && clientActorId !== ''
    && clientActorId !== context.principal.id
    && clientActorId !== context.principal.providerSubjectId
  ) {
    return errorResponse(403, 'Actor ID does not match authenticated identity', origin, patterns);
  }

  // ==========================================================================
  // Auth Phase 4: Authorization check using effective role
  // ==========================================================================
  const requiredPermission = getRequiredPermission(params.action);
  const permitted = await hasPermission(
    context.principal, params.siteId, params.branchId, requiredPermission,
  );
  if (!permitted) {
    return errorResponse(403, `Missing permission: ${requiredPermission}`, origin, patterns);
  }

  // Determine the target endpoint and validate method
  let targetEndpoint: string;
  let forwardedRequest: Request;

  if (params.action === 'connect') {
    // WebSocket connect endpoint
    if (request.method !== 'GET') {
      return errorResponse(405, 'Method not allowed. Use GET for WebSocket connection.', origin, patterns);
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
      return errorResponse(405, 'Method not allowed. Use POST for edits.', origin, patterns);
    }

    // Validate request body
    const bodyResult = await validateEditsBody(request, origin, patterns);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Auth Phase 4: Cross-validate body actorId against principal
    if (
      bodyResult.actorId !== context.principal.id
      && bodyResult.actorId !== context.principal.providerSubjectId
    ) {
      return errorResponse(403, 'Actor ID in request body does not match authenticated identity', origin, patterns);
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
      return errorResponse(405, 'Method not allowed. Use POST for can-agent-edit.', origin, patterns);
    }

    // Validate request body
    const bodyResult = await validateAgentEditBody(request, origin, patterns);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Phase 7.4: Validate agent status before forwarding to DO
    const statusError = await validateAgentStatusForEdit(
      bodyResult.agentId,
      origin,
      patterns,
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
      return errorResponse(405, 'Method not allowed. Use POST for agent-edit-start.', origin, patterns);
    }

    // Validate request body
    const bodyResult = await validateAgentEditBody(request, origin, patterns);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Phase 7.4: Validate agent status before forwarding to DO
    const statusError = await validateAgentStatusForEdit(
      bodyResult.agentId,
      origin,
      patterns,
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
      return errorResponse(405, 'Method not allowed. Use POST for agent-edit-complete.', origin, patterns);
    }

    // Validate request body
    const bodyResult = await validateEditSessionBody(request, origin, patterns);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Phase 7.4: Validate agent status if X-Agent-Id header present
    const headerAgentId = request.headers.get('X-Agent-Id') ?? request.headers.get('x-agent-id');
    if (headerAgentId !== null && headerAgentId !== '') {
      const statusError = await validateAgentStatusForEdit(
        headerAgentId,
        origin,
        patterns,
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
      return errorResponse(405, 'Method not allowed. Use POST for agent-edit-abort.', origin, patterns);
    }

    // Validate request body (reason is optional)
    const bodyResult = await validateEditSessionBody(request, origin, patterns, false);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    // Phase 7.4: Validate agent status if X-Agent-Id header present
    const headerAgentId = request.headers.get('X-Agent-Id') ?? request.headers.get('x-agent-id');
    if (headerAgentId !== null && headerAgentId !== '') {
      const statusError = await validateAgentStatusForEdit(
        headerAgentId,
        origin,
        patterns,
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
  } else if (params.action === 'agent-stop') {
    // Stop agent edit endpoint (human-initiated)
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for agent-stop.', origin, patterns);
    }

    // Validate request body - requires agentId
    const bodyResult = await validateAgentStopBody(request, origin, patterns);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    targetEndpoint = '/agent-stop';

    // Forward with validated body and original headers
    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(bodyResult),
    });
  } else if (params.action === 'focus-regions') {
    // Update focus regions endpoint
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for focus-regions.', origin, patterns);
    }

    // Validate request body
    const bodyResult = await validateFocusRegionsBody(request, origin, patterns);
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
      return errorResponse(405, 'Method not allowed. Use GET to retrieve document state.', origin, patterns);
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
    return errorResponse(404, `Document not found: ${params.documentPath}`, origin, patterns);
  }

  // Generate Durable Object ID and get stub using document UUID
  const sessionId = generateSessionId(params.siteId, document.id, params.branchId);
  const durableObjectId = env.DOCUMENT_STATE.idFromName(sessionId);
  const stub = env.DOCUMENT_STATE.get(durableObjectId);

  // ==========================================================================
  // Auth Phase 4: Inject verified headers and strip sensitive data
  // ==========================================================================
  const isWebSocketUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

  let requestWithSessionId: Request;
  if (isWebSocketUpgrade) {
    // For WebSocket: pass verified identity and session ID via query params
    // (headers cannot be modified on cloned WebSocket requests)
    const urlWithVerified = new URL(forwardedRequest.url);
    urlWithVerified.searchParams.set('_sessionId', sessionId);
    urlWithVerified.searchParams.set('_verifiedActorId', context.principal.id);
    urlWithVerified.searchParams.set('_verifiedActorType', context.principal.type);
    if (context.principal.authProvider !== undefined) {
      urlWithVerified.searchParams.set('_verifiedAuthProvider', context.principal.authProvider);
    }
    if (context.principal.email !== undefined) {
      urlWithVerified.searchParams.set('_verifiedEmail', context.principal.email);
    }
    if (context.principal.name !== undefined) {
      urlWithVerified.searchParams.set('_verifiedName', context.principal.name);
    }
    if (context.principal.avatarUrl !== undefined) {
      urlWithVerified.searchParams.set('_verifiedAvatarUrl', context.principal.avatarUrl);
    }
    // Auth Phase 4: Strip apiKey from query params (don't leak tokens to DO)
    urlWithVerified.searchParams.delete('apiKey');
    requestWithSessionId = new Request(urlWithVerified.toString(), forwardedRequest);
  } else {
    // For regular HTTP requests: add verified headers and session ID
    const headersWithVerified = new Headers(forwardedRequest.headers);
    headersWithVerified.set('X-Session-Id', sessionId);
    headersWithVerified.set('X-Verified-Actor-Id', context.principal.id);
    headersWithVerified.set('X-Verified-Actor-Type', context.principal.type);
    if (context.principal.authProvider !== undefined) {
      headersWithVerified.set('X-Verified-Auth-Provider', context.principal.authProvider);
    }
    if (context.principal.email !== undefined) {
      headersWithVerified.set('X-Verified-Email', context.principal.email);
    }
    if (context.principal.name !== undefined) {
      headersWithVerified.set('X-Verified-Name', context.principal.name);
    }
    if (context.principal.avatarUrl !== undefined) {
      headersWithVerified.set('X-Verified-Avatar-Url', context.principal.avatarUrl);
    }
    // Note: duplex is required when request has a streaming body
    const requestInit: RequestInit = {
      method: forwardedRequest.method,
      headers: headersWithVerified,
      body: forwardedRequest.body,
    };
    // Add duplex option for streaming bodies (required by spec)
    if (forwardedRequest.body !== null) {
      (requestInit as RequestInit & { duplex: string }).duplex = 'half';
    }
    // Auth Phase 4: Strip apiKey from query params on non-WebSocket too
    const cleanUrl = new URL(forwardedRequest.url);
    cleanUrl.searchParams.delete('apiKey');
    requestWithSessionId = new Request(cleanUrl.toString(), requestInit);
  }

  // Forward request to Durable Object
  try {
    const response = await stub.fetch(requestWithSessionId);
    return addCorsHeaders(response, origin, patterns);
  } catch (error) {
    console.error('Durable Object error:', error);
    return errorResponse(
      503,
      'Service temporarily unavailable. Please try again.',
      origin,
      patterns,
    );
  }
}
