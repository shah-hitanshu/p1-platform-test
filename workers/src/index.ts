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
  hasOAuthProviders,
  authenticate,
  getMASClient,
  handleAuthRoutes,
} from './middleware/authentication';
import { handleHealth } from './middleware/health';
import {
  jsonResponse,
  errorResponse,
  addCorsHeaders,
  handlePreflight,
} from './utils/http-helpers';

// Route handlers (still needed for auth/internal routes handled in handleRequest)
import { handleInternalRoutes } from './routes/internal-api';

// Inlined CSS OAuth provider (serves /auth/* before authenticate() runs)
import { authOAuthProvider } from './auth/oauth/oauth-provider-setup';
import type { AuthOAuthEnv } from './routes/auth-routes';

// Queue consumer (Phase 5.1)
import { handleSyncQueue } from './queues/sync-consumer';
import type { SyncQueueMessage } from './types/queue-messages';

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

export interface Env {
  // Environment variables
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  CORS_ORIGINS: string;
  WEBSOCKET_HEARTBEAT_INTERVAL: string;
  DOCUMENT_SYNC_BATCH_SIZE: string;
  PRESENCE_TTL_SECONDS: string;

  // Metrics configuration
  METRICS_ENABLED?: string;
  METRICS_PUSH_ENDPOINT?: string;
  METRICS_API_KEY?: string;
  APP_VERSION?: string;
  DO_ALARM_METRICS_ENABLED?: string; // Enable detailed DO alarm/cleanup metrics (can be high volume)

  // Secrets (from .dev.vars or Vault)
  POSTGRES_CONNECTION_STRING?: string; // Fallback for local dev without Hyperdrive
  FIRESTORE_PROJECT_ID: string;
  FIRESTORE_EMULATOR_HOST?: string;

  // Mock Identity Provider (local development only)
  MOCK_JWT_SECRET?: string;

  // Auth providers (Phase 2/3 - future)
  GOOGLE_CLIENT_ID?: string;
  AUTH0_ISSUER_BASE_URL?: string;
  AUTH0_NEW_ISSUER_BASE_URL?: string;
  AUTH0_AUDIENCE?: string;

  // MAS (Membership Authorization Service) integration
  MAS_ENABLED?: string;
  MAS_BASE_URL?: string;
  MAS_GCP_SERVICE_ACCOUNT_KEY?: string;
  MAS_CACHE_TTL_SECONDS?: string;

  // Internal API secret for Durable Object to PostgreSQL sync
  INTERNAL_SECRET?: string;

  // CSS Auth Server (workers/auth-server/) for puck-css browser client tokens
  CSS_AUTH_SERVER_URL?: string;   // Base URL of auth server (for URL construction when not using service binding)
  CSS_AUTH_SERVER?: Fetcher;      // Service binding to auth server (preferred — sub-ms latency)

  // Inlined CSS OAuth provider (replaces CSS_AUTH_SERVER service binding post-merge)
  GOOGLE_CLIENT_SECRET?: string;  // Google OAuth client secret for token exchange
  OAUTH_KV?: KVNamespace;         // Token storage for @cloudflare/workers-oauth-provider

  // Hyperdrive bindings (production/staging - handles connection pooling properly)
  // HYPERDRIVE: cached (short TTL) for document reads
  // HYPERDRIVE_NOCACHE: uncached for admin writes that need immediate consistency
  // See: https://developers.cloudflare.com/hyperdrive/
  HYPERDRIVE?: Hyperdrive;
  HYPERDRIVE_NOCACHE?: Hyperdrive;

  // Queue binding (Phase 5.1: Queue-Based Sync Decoupling)
  SYNC_QUEUE?: Queue;

  // Durable Object bindings
  DOCUMENT_STATE: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace;
  SESSION: DurableObjectNamespace;

  // KV bindings
  CONFIG_KV: KVNamespace;
  SESSION_KV: KVNamespace;
}

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
      throw error;
    } finally {
      // Flush metrics (fire-and-forget)
      await flushMetrics();
    }
  },

  /**
   * Phase 5.1: Queue handler for DO-to-PostgreSQL sync.
   * Processes batches of sync messages from Cloudflare Queues.
   */
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await handleSyncQueue(batch as MessageBatch<SyncQueueMessage>, env);
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
  ctx: ExecutionContext,
): Promise<Response> {
  // Health endpoint (no auth required)
  if (path === '/health' || path === '/health/') {
    const response = await handleHealth(env);
    return addCorsHeaders(response, origin, env);
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
  // Guard on ENVIRONMENT === 'local' rather than !hasOAuthProviders so the
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

  // CSS OAuth routes (/auth/*) — served by the inlined OAuthProvider.
  // Must run before authenticate() so the browser's OAuth redirect flows can
  // reach /auth/authorize and /auth/callback without a valid access token.
  // Runs inside runWithConnection so getSiteAllowedOrigins() has DB access.
  if (path.startsWith('/auth/')) {
    if (
      env.OAUTH_KV === undefined ||
      env.GOOGLE_CLIENT_ID === undefined ||
      env.GOOGLE_CLIENT_SECRET === undefined ||
      env.INTERNAL_SECRET === undefined
    ) {
      return errorResponse('Auth provider not configured', 503);
    }
    return authOAuthProvider.fetch(request, env as unknown as AuthOAuthEnv, ctx);
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

  // Allowlist check: if users table has entries, only listed users can access
  // Skip for mock auth mode (development ergonomics)
  // Skip for service principals (they authenticate via site API tokens, not user accounts)
  const isMockOnly = !hasOAuthProviders(env);

  if (!isMockOnly && principal.type !== 'service' && principal.email !== undefined) {
    const allowlistResult = await checkUserAllowlist(principal);
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
 */
async function checkUserAllowlist(principal: AuthenticatedPrincipal): Promise<Response | null> {
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
      [(principal.email ?? '').toLowerCase()],
    );

    const userRow = userResult.rows[0];
    if (userRow?.is_active !== true) {
      return errorResponse('User not authorized', 403);
    }

    // Link principal_id on first login, and update name/avatar_url
    if (userRow.principal_id === null) {
      await query(
        'UPDATE app.users SET principal_id = $1, auth_provider = $2, name = COALESCE($3, name), avatar_url = COALESCE($4, avatar_url), updated_at = NOW() WHERE id = $5',
        [principal.id, principal.authProvider ?? 'unknown', principal.name ?? null, principal.avatarUrl ?? null, userRow.id],
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
