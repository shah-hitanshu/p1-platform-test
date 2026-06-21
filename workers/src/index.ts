/**
 * Collaborative State System - Cloudflare Worker Entry Point
 *
 * Provides HTTP API for the collaborative state system.
 * Routes requests to appropriate handlers with CORS and authentication.
 */

import {
  runWithConnection,
  query,
} from './db';
import type { AuthenticatedPrincipal } from './types';
import { AuthorizationError } from './auth/authorization';
import { isServicePrincipalAllowed } from './auth/service-principal';
import { extractActingUser } from './auth/acting-user';

// Extracted modules
import { parseRoute } from './routes/route-parser';
import { dispatchRoute } from './routes/route-dispatch';
import {
  hasRealAuthProviders,
  authenticate,
  getMASClient,
  handleAuthRoutes,
} from './middleware/authentication';
import { handleHealth } from './middleware/health';
import { handleDocsRoute, handleDocsSpecRoute } from './routes/docs-handler';
import {
  jsonResponse,
  errorResponse,
  addCorsHeaders,
  handlePreflight,
} from './utils/http-helpers';

// Route handlers (still needed for auth/internal routes handled in handleRequest)
import { handleInternalRoutes } from './routes/internal-api';
import { handleBrokerRoutes } from './routes/broker-routes';

// Queue consumer (Phase 5.1)
import { handleSyncQueue } from './queues/sync-consumer';
import { handleScreenshotQueue } from './queues/screenshot-consumer';
import { runWeeklyScreenshotRefresh } from './scheduled/screenshot-refresh';
import type { SyncQueueMessage, ScreenshotQueueMessage } from './types/queue-messages';

// Metrics
import {
  initializeMetrics,
  incrementCounter,
  recordTiming,
  flushMetrics,
  normalizePathPattern,
  classifyError,
  getStatusClass,
} from './services/metrics-service';

// Export Durable Objects for wrangler
export { DocumentState, PresenceManager, SessionManager } from './durable-objects';

// Re-export Env from dedicated module (avoids circular dependency)
export type { Env } from './env';
import type { Env } from './env';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin');
    const requestStart = Date.now();

    // Initialize metrics for this request
    initializeMetrics({
      enabled: env.METRICS_ENABLED === 'true',
      pushEndpoint: env.METRICS_PUSH_ENDPOINT,
      apiKey: env.METRICS_API_KEY,
      environment: env.ENVIRONMENT,
      version: env.APP_VERSION ?? 'dev',
    });

    // Handle CORS preflight (no database needed, no metrics)
    if (request.method === 'OPTIONS') {
      return handlePreflight(request, env);
    }

    // Determine connection string and options
    // Prefer Hyperdrive (production) over direct connection (local dev)
    // Admin routes use HYPERDRIVE_NOCACHE for immediate read-after-write consistency
    let connectionString: string;
    let isHyperdrive = false;
    const isAdminRoute = path.startsWith('/api/admin/');
    const hyperdrive = isAdminRoute && env.HYPERDRIVE_NOCACHE
      ? env.HYPERDRIVE_NOCACHE
      : env.HYPERDRIVE;

    if (hyperdrive !== undefined) {
      connectionString = hyperdrive.connectionString;
      isHyperdrive = true;
    } else if (
      env.POSTGRES_CONNECTION_STRING !== undefined &&
      env.POSTGRES_CONNECTION_STRING !== ''
    ) {
      connectionString = env.POSTGRES_CONNECTION_STRING;
    } else {
      return new Response(
        JSON.stringify({ error: 'No database connection configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Run request with isolated database connection using AsyncLocalStorage
    // This ensures concurrent requests don't interfere with each other's connections
    try {
      const response = await runWithConnection(
        connectionString,
        { isHyperdrive },
        async () => {
          const resp = await handleRequest(request, env, path, origin, ctx);

          // Record successful request metrics
          const durationMs = Date.now() - requestStart;
          const pathPattern = normalizePathPattern(path);
          const statusClass = getStatusClass(resp.status);

          incrementCounter('css_http_request_total', {
            method: request.method,
            path_pattern: pathPattern,
            status_class: statusClass,
          });
          recordTiming('css_http_request_duration_ms', durationMs, {
            method: request.method,
            path_pattern: pathPattern,
            status_class: statusClass,
          });

          return resp;
        },
      );

      return response;
    } catch (error) {
      // Record error metrics
      incrementCounter('css_http_errors_total', {
        error_type: classifyError(error),
      });
      // Log so the error appears in wrangler tail for diagnosis
      console.error('[fetch] unhandled error:', error instanceof Error ? error.message : String(error));
      // Return a CORS-allowed error response rather than re-throwing.
      // Re-throwing causes the Workers runtime to generate a bare 500 with no CORS
      // headers, which the browser sees as a network failure rather than an API error.
      const message = error instanceof Error ? error.message : 'Internal server error';
      return addCorsHeaders(errorResponse(message, 500), origin, env);
    } finally {
      // Flush metrics (fire-and-forget)
      await flushMetrics();
    }
  },

  /**
   * Queue dispatcher. Routes a batch to its handler based on the queue name.
   */
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    if (batch.queue.startsWith('css-screenshot-queue')) {
      await handleScreenshotQueue(batch as MessageBatch<ScreenshotQueueMessage>, env);
      return;
    }
    await handleSyncQueue(batch as MessageBatch<SyncQueueMessage>, env);
  },

  /**
   * Cron handler. Currently runs the weekly screenshot refresh.
   */
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runWeeklyScreenshotRefresh(env));
  },
};

/**
 * Handle the actual request after database initialization.
 * Separated to allow proper try/finally structure for connection cleanup.
 */
async function handleRequest(
  request: Request,
  env: Env,
  path: string,
  origin: string | null,
  _ctx: ExecutionContext,
): Promise<Response> {
  // Health endpoint (no auth required)
  if (path === '/health' || path === '/health/') {
    const response = await handleHealth(env);
    return addCorsHeaders(response, origin, env);
  }

  // API documentation (no auth required so the surface is publicly browseable)
  if (path === '/docs' || path === '/docs/') {
    return addCorsHeaders(handleDocsRoute(request), origin, env);
  }
  if (path === '/docs/openapi.yaml') {
    return addCorsHeaders(handleDocsSpecRoute(request), origin, env);
  }

  // GET /api/auth/me - Return authenticated principal info (requires auth)
  if (path === '/api/auth/me' && request.method === 'GET') {
    const principal = await authenticate(request, env);
    if (!principal) {
      return addCorsHeaders(
        errorResponse('Authentication required', 401),
        origin,
        env,
      );
    }
    return addCorsHeaders(
      jsonResponse({
        id: principal.id,
        type: principal.type,
        email: principal.email,
        name: principal.name,
        avatarUrl: principal.avatarUrl,
        authProvider: principal.authProvider,
        tokenExpiry: principal.tokenExpiry,
        providerSubjectId: principal.providerSubjectId,
      }),
      origin,
      env,
    );
  }

  // Mock auth endpoints (local development only)
  // Guard on ENVIRONMENT === 'local' rather than !hasRealAuthProviders so the
  // endpoint is unreachable on sbx1/production even when OAuth secrets are
  // absent — consistent with how getIdentityProvider gates the MockIdentityProvider.
  if (path.startsWith('/api/auth')) {
    if (env.ENVIRONMENT === 'local') {
      const response = await handleAuthRoutes(request, path, env);
      if (response) {
        return addCorsHeaders(response, origin, env);
      }
    }
    return addCorsHeaders(errorResponse('Not found', 404), origin, env);
  }

  // Internal API endpoints (uses X-Internal-Secret auth, not user/agent tokens)
  if (path.startsWith('/internal/')) {
    const internalSecret = env.INTERNAL_SECRET ?? 'development-internal-secret';
    const response = await handleInternalRoutes(request, { internalSecret });
    return addCorsHeaders(response, origin, env);
  }

  // Broker routes (/broker/*) — brokered auth flow for third-party panels.
  // Runs before parseRoute() since broker endpoints have their own auth model.
  if (path.startsWith('/broker/') || path === '/auth/callback') {
    const response = await handleBrokerRoutes(request, env as unknown as Record<string, unknown>, path);
    if (response !== null) {
      return addCorsHeaders(response, origin, env);
    }
  }

  // Parse route
  const route = parseRoute(path);
  if (!route) {
    return addCorsHeaders(
      jsonResponse(
        {
          error: 'Not Found',
          message: `No handler for ${request.method} ${path}`,
          availableEndpoints: [
            '/health', '/api/sites', '/api/admin/users', '/api/auth/me',
            ...(env.ENVIRONMENT === 'local' ? ['/api/auth/users', '/api/auth/token'] : []),
          ],
        },
        404,
      ),
      origin,
      env,
    );
  }

  // Authenticate request for API routes
  const principal = await authenticate(request, env);
  if (!principal) {
    return addCorsHeaders(
      errorResponse('Authentication required', 401),
      origin,
      env,
    );
  }

  // Extract acting-user identity from agent requests (MCP server forwarding)
  const actingUser = extractActingUser(request.headers, principal);
  if (actingUser) {
    principal.actingUserId = actingUser.actingUserId;
    principal.actingUserEmail = actingUser.actingUserEmail;
    principal.actingUserName = actingUser.actingUserName;
  }

  // Service principal scope enforcement
  if (principal.type === 'service') {
    // Service principals must always target a specific site
    if (route.params.siteId === undefined) {
      return addCorsHeaders(
        errorResponse('Service principals can only access site-scoped routes', 403),
        origin,
        env,
      );
    }
    // Determine if the request targets the main branch for scope enforcement.
    // If ?branch= is present, assume non-main (conservative for read:published).
    // If absent, the route handler will default to main branch.
    const requestUrl = new URL(request.url);
    const branchParam = requestUrl.searchParams.get('branch');
    const branchIsMain = branchParam === null || branchParam === '' ? undefined : false;
    const scopeCheck = isServicePrincipalAllowed(
      principal, route.params.siteId, request.method, route.handler, branchIsMain,
    );
    if (!scopeCheck.allowed) {
      return addCorsHeaders(
        errorResponse(scopeCheck.reason ?? 'Access denied', 403),
        origin,
        env,
      );
    }
  }

  // Allowlist check: if users table has entries, only listed users can access.
  // Skip for mock auth mode (development ergonomics).
  // Skip for service principals (they authenticate via site API tokens, not user accounts).
  //
  // PCC-3190: agent principals carry no email of their own, so the previous
  // `principal.email !== undefined` guard caused the gate to be skipped
  // entirely for agent traffic — letting any authenticated Google user
  // reach handlers via the MCP server's acting-user forwarding without
  // being checked against the allowlist. When an agent forwards an
  // acting user, treat the acting user's email as the allowlist subject.
  const isMockOnly = !hasRealAuthProviders(env);
  const subjectEmail =
    principal.email
    ?? (principal.type === 'agent' ? principal.actingUserEmail : undefined);

  if (!isMockOnly && principal.type !== 'service' && subjectEmail !== undefined) {
    const allowlistResult = await checkUserAllowlist(principal, subjectEmail);
    if (allowlistResult !== null) {
      return addCorsHeaders(allowlistResult, origin, env);
    }
  }

  // Initialize MAS client (undefined when not enabled)
  const masClient = getMASClient(env);

  try {
    const response = await dispatchRoute(request, route, principal, env, masClient);
    return addCorsHeaders(response, origin, env);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return addCorsHeaders(errorResponse(error.message, 403), origin, env);
    }
    console.error('Request handler error:', error);
    return addCorsHeaders(
      errorResponse('Internal server error', 500),
      origin,
      env,
    );
  }
}

/**
 * Check user against allowlist in database.
 * Returns an error response if user is not authorized, or null if authorized.
 *
 * `subjectEmail` is the email to check against app.users. For user
 * principals this is principal.email; for agent principals forwarding an
 * acting user (PCC-3190), it is principal.actingUserEmail.
 *
 * Agent principals are NOT enriched (dbUserId/systemRole/etc.) from the
 * acting user's row — downstream agent-keyed authorization expects
 * principal.id to remain the agent identity. Acting-user permissions
 * are applied per-site via getEffectiveRole's intersection logic.
 */
async function checkUserAllowlist(
  principal: AuthenticatedPrincipal,
  subjectEmail: string,
): Promise<Response | null> {
  const userCountResult = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM app.users',
  );
  const countRow = userCountResult.rows[0];
  const userCount = countRow !== undefined ? parseInt(countRow.count, 10) : 0;

  if (userCount > 0) {
    const userResult = await query<{
      id: string;
      principal_id: string | null;
      system_role: string;
      is_active: boolean;
      name: string | null;
      avatar_url: string | null;
    }>(
      'SELECT id, principal_id, system_role, is_active, name, avatar_url FROM app.users WHERE email = $1',
      [subjectEmail.toLowerCase()],
    );

    const userRow = userResult.rows[0];
    if (userRow?.is_active !== true) {
      return errorResponse('User not authorized', 403);
    }

    // Agent principals must not adopt the acting user's DB identity.
    // The allowlist check above is sufficient; per-site authorization
    // already intersects agent and acting-user roles via getEffectiveRole.
    if (principal.type !== 'user') {
      return null;
    }

    // Link principal_id on first login, and update name/avatar_url
    if (userRow.principal_id === null) {
      await query(
        'UPDATE app.users SET principal_id = $1, auth_provider = $2, name = COALESCE($3, name), avatar_url = COALESCE($4, avatar_url), updated_at = NOW() WHERE id = $5',
        [principal.id, principal.authProvider ?? 'unknown', principal.name ?? null, principal.avatarUrl ?? null, userRow.id],
      );

      // Self-heal orphan user_site_roles rows from before dbUserId was used.
      // Historical writes stored principal.id where users.id was expected.
      // Now that this user has been linked, rewrite
      // those rows so authorization and listing queries find them.
      // Drop orphans that would collide with an existing canonical row first
      // to satisfy the (user_id, site_id, source) unique constraint.
      await query(
        `DELETE FROM app.user_site_roles orphan
         USING app.user_site_roles canonical
         WHERE orphan.user_id = $1
           AND canonical.user_id = $2
           AND canonical.site_id = orphan.site_id
           AND canonical.source = orphan.source`,
        [principal.id, userRow.id],
      );
      await query(
        'UPDATE app.user_site_roles SET user_id = $1 WHERE user_id = $2',
        [userRow.id, principal.id],
      );
    }

    // Refresh DB name/avatar when returning user's JWT has newer values
    if (userRow.principal_id !== null) {
      const nameChanged = principal.name !== undefined && principal.name !== userRow.name;
      const avatarChanged = principal.avatarUrl !== undefined && principal.avatarUrl !== userRow.avatar_url;
      if (nameChanged || avatarChanged) {
        await query(
          'UPDATE app.users SET name = COALESCE($1, name), avatar_url = COALESCE($2, avatar_url), updated_at = NOW() WHERE id = $3',
          [principal.name ?? null, principal.avatarUrl ?? null, userRow.id],
        );
      }
    }

    // Enrich principal from database when JWT claims are missing
    if (principal.name === undefined && userRow.name !== null) {
      principal.name = userRow.name;
    }
    if (principal.avatarUrl === undefined && userRow.avatar_url !== null) {
      principal.avatarUrl = userRow.avatar_url;
    }

    // Store DB user ID for authorization queries (role tables reference users.id, not the UUIDv5 principal id)
    principal.dbUserId = userRow.id;
    // Attach system role to principal for downstream use
    principal.systemRole = userRow.system_role;
  }

  return null;
}
