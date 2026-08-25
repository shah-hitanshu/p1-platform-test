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
 * Agent Context
 * The acting agent's identity comes from the authenticated principal. Callers
 * supply only declarative context, via X-Agent-* headers or body params (body
 * takes precedence):
 * - X-Agent-Trigger: human_requested | autonomous
 * - X-Agent-Requested-By: user UUID (when human_requested)
 * - X-Agent-Intent: description of what agent is doing
 * - X-Agent-Operation-Type: category
 * - X-Agent-Target-Regions: comma-separated JSON paths
 */

import {
  type RealtimeEnv,
  type RealtimeRouteContext,
  type CorsPattern,
  parseRoute,
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
import { loadCanonicalComponentNames } from '../services/component-type-registry';
import { findComponentTypeViolations } from '../services/component-type-validation';
import { getBranch, getBranchByName } from '../services/branch-service';
import { hasPermission } from '../auth/authorization';
import { getAgentById } from '../services/agent-service';
import { getCachedSiteAllowedOrigins } from '../services/site-service';
import { buildCorsPatterns } from '../utils/cors';
import { UUID_RE } from '../utils/branch-ref';

// Re-export for consumers
export type { RealtimeRouteContext } from './realtime-utils';

/**
 * Edit sessions belong to an actor that can be held accountable for them: a
 * registered agent, or a signed-in person. A service credential is shared, so it
 * identifies no one and cannot own a session. Returns a 403 response for any
 * other principal, or null to proceed.
 */
function requireSessionOwnerPrincipal(
  context: RealtimeRouteContext,
  origin: string | null,
  patterns: CorsPattern[],
): Response | null {
  if (context.principal.type !== 'agent' && context.principal.type !== 'user') {
    return errorResponse(
      403,
      'An edit session requires an authenticated agent or user',
      origin,
      patterns,
    );
  }
  return null;
}

/**
 * Rejects edits that would put an unknown or mis-cased component type into a
 * document. Returns a 422 naming every violation, or null to proceed.
 *
 * A registry read failure fails open: the registry is a convenience index, and
 * a transient database problem must not make every document unwritable. The
 * MCP-side check still applies in that window.
 */
async function rejectBadComponentTypes(
  operations: unknown[],
  branchId: string,
  origin: string | null,
  patterns: CorsPattern[],
): Promise<Response | null> {
  let canonical;
  try {
    canonical = await loadCanonicalComponentNames(branchId);
  } catch (error) {
    console.warn(
      '[realtime-api] Component type validation skipped — registry read failed:',
      error,
    );
    return null;
  }

  if (canonical.size === 0) {
    // A site whose editor has never opened (and whose CI sync has never run)
    // has no registry to check against. Failing closed here would block every
    // agent write to a brand-new site, so this stays open — but it is the one
    // remaining path by which an unknown type can still land.
    console.warn(
      `[realtime-api] Component type validation skipped for branch ${branchId}: `
      + 'no components registered.',
    );
    return null;
  }

  const violations = findComponentTypeViolations(operations, canonical);
  if (violations.length === 0) {
    return null;
  }

  return errorResponse(
    422,
    'Rejected: '
    + violations.map((v) => `[${v.code}] ${v.message}`).join(' '),
    origin,
    patterns,
  );
}

/**
 * Agent registry status gates an agent and has no counterpart for a person,
 * whose authority is the role check every realtime action already runs.
 */
async function validateOwnerStatus(
  context: RealtimeRouteContext,
  origin: string | null,
  patterns: CorsPattern[],
): Promise<Response | null> {
  if (context.principal.type !== 'agent') {
    return null;
  }
  return validateAgentStatusForEdit(context.principal.id, origin, patterns);
}

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

  // Parse route parameters first; bail early if path doesn't match
  const params = parseRoute(pathname);
  if (params === null) {
    return null;
  }

  const origin = request.headers.get('Origin');

  // Validate parameter lengths before any DB lookup — the length guard must
  // run pre-auth so an unauthenticated caller cannot force arbitrary-length
  // strings into getSiteAllowedOrigins via the URL path.
  const paramError = validateParamLengths(params);
  if (paramError !== null) {
    // Use global + system patterns only: param is invalid so per-site lookup
    // would be wasted work (and potentially unsafe if siteId is oversized).
    return errorResponse(400, paramError, origin, buildCorsPatterns(env.CORS_ORIGINS));
  }

  // Fetch per-site allowed_origins and merge with system/env patterns.
  // Runs after length validation so siteId is guaranteed within bounds.
  let siteOrigins: string[] = [];
  try {
    siteOrigins = (await getCachedSiteAllowedOrigins(params.siteId)) ?? [];
  } catch (err) {
    // Fail open: system defaults still apply; per-site custom domains blocked
    // until DB recovers.
    console.warn('[cors] failed to load site origins for realtime route:', err);
  }
  const patterns = buildCorsPatterns(env.CORS_ORIGINS, siteOrigins);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions(origin, patterns);
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
  // PCC-3458: Resolve the branch ref (UUID or name) to the canonical branch
  // BEFORE any permission check or DO key generation. Keying the DocumentState
  // DO with the raw ref means a branch NAME like "main" creates an orphan DO
  // divergent from the UUID-keyed one used by the rest of the system
  // (post-publish /reload, CRDT loading, presence rollup). Mirrors
  // content-api's resolveBranch and the route-dispatch resolve-then-authorize
  // pattern; all realtime actions flow through this exactly once.
  // ==========================================================================
  const branch = UUID_RE.test(params.branchId)
    ? await getBranch(params.branchId)
    : await getBranchByName(params.siteId, params.branchId);
  if (branch?.siteId !== params.siteId) {
    return errorResponse(404, `Branch not found: ${params.branchId}`, origin, patterns);
  }

  // ==========================================================================
  // Auth Phase 4: Authorization check using effective role
  // ==========================================================================
  // Pass the resolved branch UUID: the branch_grants lookup inside
  // getEffectiveRole compares against the UUID-typed branch_id column, so the
  // canonical UUID is the form its semantics have always assumed.
  const requiredPermission = getRequiredPermission(params.action);
  const permitted = await hasPermission(
    context.principal, params.siteId, branch.id, requiredPermission,
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

    // Default the actor to the authenticated principal when the client omits it;
    // cross-validate only an explicitly supplied actor id.
    if (bodyResult.actorId === undefined || bodyResult.actorId === '') {
      bodyResult.actorId = context.principal.id;
    } else if (
      bodyResult.actorId !== context.principal.id
      && bodyResult.actorId !== context.principal.providerSubjectId
    ) {
      return errorResponse(403, 'Actor ID in request body does not match authenticated identity', origin, patterns);
    }

    // Component-type identity is enforced here, not only in the MCP servers:
    // their check is per-process, skippable, and has two implementations, so it
    // cannot be the guarantee. Puck resolves `type` by exact key lookup, so a
    // mis-cased type writes a document that validates cleanly and then renders
    // nowhere — reject it before it reaches the DO.
    const typeError = await rejectBadComponentTypes(
      bodyResult.operations, branch.id, origin, patterns,
    );
    if (typeError !== null) {
      return typeError;
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

    const notOwnerError = requireSessionOwnerPrincipal(context, origin, patterns);
    if (notOwnerError !== null) {
      return notOwnerError;
    }

    const bodyResult = await validateAgentEditBody(
      request, origin, patterns, context.principal.id,
    );
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    const statusError = await validateOwnerStatus(context, origin, patterns);
    if (statusError !== null) {
      return statusError;
    }

    targetEndpoint = '/can-agent-edit';

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

    const notOwnerError = requireSessionOwnerPrincipal(context, origin, patterns);
    if (notOwnerError !== null) {
      return notOwnerError;
    }

    const bodyResult = await validateAgentEditBody(
      request, origin, patterns, context.principal.id,
    );
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    const statusError = await validateOwnerStatus(context, origin, patterns);
    if (statusError !== null) {
      return statusError;
    }

    targetEndpoint = '/agent-edit-start';

    // X-Agent-Name is Worker-set, so a caller-supplied value never survives.
    // An agent's display name comes from the registry, resolved here because the
    // DO cannot query it; a person's comes from the verified identity headers.
    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.delete('X-Agent-Name');
    if (context.principal.type === 'agent') {
      let resolvedAgentName = context.principal.id;
      try {
        const agent = await getAgentById(context.principal.id);
        resolvedAgentName = agent?.name ?? context.principal.id;
      } catch (error) {
        console.warn('Failed to look up agent name, falling back to agentId:', error);
      }
      forwardedHeaders.set('X-Agent-Name', resolvedAgentName);
    }

    forwardedRequest = new Request(`http://internal${targetEndpoint}`, {
      method: 'POST',
      headers: forwardedHeaders,
      body: JSON.stringify(bodyResult),
    });
  } else if (params.action === 'agent-edit-complete') {
    // Complete agent edit endpoint
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST for agent-edit-complete.', origin, patterns);
    }

    const notOwnerError = requireSessionOwnerPrincipal(context, origin, patterns);
    if (notOwnerError !== null) {
      return notOwnerError;
    }

    const bodyResult = await validateEditSessionBody(request, origin, patterns);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    const statusError = await validateOwnerStatus(context, origin, patterns);
    if (statusError !== null) {
      return statusError;
    }

    targetEndpoint = '/agent-edit-complete';

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

    const notOwnerError = requireSessionOwnerPrincipal(context, origin, patterns);
    if (notOwnerError !== null) {
      return notOwnerError;
    }

    // Validate request body (reason is optional)
    const bodyResult = await validateEditSessionBody(request, origin, patterns, false);
    if (bodyResult instanceof Response) {
      return bodyResult;
    }

    const statusError = await validateOwnerStatus(context, origin, patterns);
    if (statusError !== null) {
      return statusError;
    }

    targetEndpoint = '/agent-edit-abort';

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
  const document = await getDocumentByPath(params.siteId, params.documentPath, branch.id);
  if (document === null) {
    return errorResponse(404, `Document not found: ${params.documentPath}`, origin, patterns);
  }

  // Generate Durable Object ID and get stub using document UUID and the
  // canonical branch UUID (PCC-3458: never the raw client-supplied ref)
  const sessionId = generateSessionId(params.siteId, document.id, branch.id);
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
    // PCC-3457 (B1 hardening): strip any client-supplied verified-identity
    // params before setting worker values — these are the DO's only trusted
    // identity channel on the WS path and now feed JIT user provisioning.
    for (const p of [
      '_sessionId', '_verifiedActorId', '_verifiedActorType',
      '_verifiedAuthProvider', '_verifiedEmail', '_verifiedName',
      '_verifiedAvatarUrl', '_verifiedDbUserId',
    ]) {
      urlWithVerified.searchParams.delete(p);
    }
    urlWithVerified.searchParams.set('_sessionId', sessionId);
    urlWithVerified.searchParams.set('_verifiedActorId', context.principal.id);
    urlWithVerified.searchParams.set('_verifiedActorType', context.principal.type);
    // _verifiedActorId is the presence identity (the OAuth subject); dbUserId
    // is the app.users.id persistence attributes to, written to created_by_id.
    if (context.principal.dbUserId !== undefined) {
      urlWithVerified.searchParams.set('_verifiedDbUserId', context.principal.dbUserId);
    }
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
    // For regular HTTP requests: add verified headers and session ID.
    // PCC-3457 (B1 hardening): delete ALL inbound X-Verified-* headers first —
    // conditional set() calls below would otherwise let a client-forged header
    // survive when the principal lacks that field (same idiom as the
    // X-Agent-Name spoofing guard above). Verified identity now feeds JIT
    // user provisioning, so a forged email is a row-claiming credential.
    const headersWithVerified = new Headers(forwardedRequest.headers);
    for (const h of [
      'X-Verified-Actor-Id', 'X-Verified-Actor-Type',
      'X-Verified-Auth-Provider', 'X-Verified-Email',
      'X-Verified-Name', 'X-Verified-Avatar-Url', 'X-Verified-Db-User-Id',
      'X-Verified-Requested-By-Id', 'X-Verified-Requested-By-Name',
    ]) {
      headersWithVerified.delete(h);
    }
    headersWithVerified.set('X-Session-Id', sessionId);
    headersWithVerified.set('X-Verified-Actor-Id', context.principal.id);
    headersWithVerified.set('X-Verified-Actor-Type', context.principal.type);
    if (context.principal.dbUserId !== undefined) {
      headersWithVerified.set('X-Verified-Db-User-Id', context.principal.dbUserId);
    }
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
    // The person an agent is acting for. extractActingUser resolves this from
    // the request only for an agent principal, so a person acting for
    // themselves carries none and the DO names them from the verified actor.
    if (context.principal.actingUserId !== undefined) {
      headersWithVerified.set('X-Verified-Requested-By-Id', context.principal.actingUserId);
    }
    if (context.principal.actingUserName !== undefined) {
      headersWithVerified.set('X-Verified-Requested-By-Name', context.principal.actingUserName);
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
