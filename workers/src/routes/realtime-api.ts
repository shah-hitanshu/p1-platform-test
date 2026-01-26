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
 * - OPTIONS /api/sites/{siteId}/branches/{branchId}/documents/* - CORS preflight
 */

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
  action?: 'edits' | 'connect';
}

// =============================================================================
// Security Limits
// =============================================================================

/** Maximum length for siteId parameter */
const MAX_SITE_ID_LENGTH = 128;

/** Maximum length for branchId parameter */
const MAX_BRANCH_ID_LENGTH = 128;

/** Maximum length for documentPath parameter */
const MAX_DOCUMENT_PATH_LENGTH = 512;

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
    'Access-Control-Allow-Headers': 'Content-Type, X-Actor-Id, X-Actor-Type, Upgrade',
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
  // Pattern: /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}[/edits|/connect]
  const pattern =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/(.+?)(?:\/(edits|connect))?$/;

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
    action: action as 'edits' | 'connect' | undefined,
  };
}

/**
 * Generate session ID for Durable Object
 * Format: {siteId}:{documentPath}:{branchId}
 */
function generateSessionId(params: RouteParams): string {
  return `${params.siteId}:${params.documentPath}:${params.branchId}`;
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
 * Validate POST request body for /edits endpoint
 * Returns parsed body or error response
 */
async function validateEditsBody(
  request: Request,
  origin: string | null,
  allowedOrigins: string[],
): Promise<{ operations: unknown[] } | Response> {
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

  return { operations: bodyObj.operations };
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

  // Generate Durable Object ID and get stub
  const sessionId = generateSessionId(params);
  const durableObjectId = env.DOCUMENT_STATE.idFromName(sessionId);
  const stub = env.DOCUMENT_STATE.get(durableObjectId);

  // Forward request to Durable Object
  try {
    const response = await stub.fetch(forwardedRequest);
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
