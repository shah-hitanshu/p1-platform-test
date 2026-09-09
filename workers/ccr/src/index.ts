/**
 * Collaborative Content Repository - Cloudflare Worker Entry Point
 *
 * Provides HTTP API for the collaborative content repository.
 * Routes requests to appropriate handlers with CORS and authentication.
 */

import {
  runWithConnection,
  query,
} from './db';
import { resolveConnection } from './db/resolve-connection';
import { forwardToCachedContent, isCacheableContentRequest } from './routes/cached-content-forward';
import type { AuthenticatedPrincipal } from './types';
import { AuthorizationError, hasPermission } from './auth/authorization';
import { resolveBranch } from './routes/content-api';
import type { MASClient } from './services/mas-client';
import { HttpError } from './services/errors';
import { servicePrincipalScopeDecision } from './auth/service-principal';
import { extractActingUser } from './auth/acting-user';
import { normalizePrincipalIdForDb } from './auth/principal-id-normalization';

// Extracted modules
import { parseRoute } from './routes/route-parser';
import { dispatchRoute } from './routes/route-dispatch';
import {
  hasRealAuthProviders,
  authenticate,
  getMASClient,
} from './middleware/authentication';
import { handleAuthRoutes } from './auth/mock-auth';
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
import { getCachedSiteAllowedOrigins } from './services/site-service';
import { isFeatureFlagEnabled } from './services/feature-flag-service';
import { stripInboundTrustedHeaders } from './utils/trusted-headers';
import {
  contextForTask,
  contextFromRequest,
  enrichContext,
  getLogger,
  withRequestContext,
  P1_TELEMETRY_HEADERS,
} from '@pantheon-systems/p1-telemetry';
import { P1FeatureFlagService } from '@pantheon-systems/p1-feature-flags';

import { ensureLogger } from './telemetry';

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
export { DocumentState, PresenceManager, SessionManager, BrokerTransaction } from './durable-objects';
export { CachedContent } from './entrypoints/cached-content';
export { MergeWorkflow } from './workflows/merge-workflow';

// Re-export Env from dedicated module (avoids circular dependency)
export type { Env } from './env';
import type { Env } from './env';

/**
 * Echo the correlation id so a client can quote it in a support request. Responses are
 * immutable, so this rebuilds rather than mutating — skipped for 101 (WebSocket
 * upgrade), whose body and headers can't be re-wrapped.
 */
function withRequestId(response: Response, requestId: string): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set(P1_TELEMETRY_HEADERS.requestId, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Collapse runs of "/" in the path so routing tolerates malformed
    // base-URL joins like "host//broker/login". A leading "//" matches no
    // route prefix and would otherwise fall through to a 404. Document paths
    // travel URL-encoded (%2F), so no legitimate route has an empty segment.
    const normalizedPathname = url.pathname.replace(/\/{2,}/g, '/');
    let req = request;
    if (normalizedPathname !== url.pathname) {
      url.pathname = normalizedPathname;
      req = new Request(url.toString(), request);
    }

    // Trusted identity headers are injected by this Worker after authentication;
    // drop any a client supplied so they can never reach a Durable Object.
    req = stripInboundTrustedHeaders(req);

    const path = normalizedPathname;
    const origin = req.headers.get('Origin');
    const requestStart = Date.now();
    const pathPattern = normalizePathPattern(path);

    // Initialize metrics for this request
    initializeMetrics({
      enabled: env.METRICS_ENABLED === 'true',
      pushEndpoint: env.METRICS_PUSH_ENDPOINT,
      apiKey: env.METRICS_API_KEY,
      environment: env.ENVIRONMENT,
      version: env.APP_VERSION ?? 'dev',
    });

    let connectionString: string;
    let isHyperdrive: boolean;
    try {
      ({ connectionString, isHyperdrive } = resolveConnection(env, path));
    } catch {
      return new Response(
        JSON.stringify({ error: 'No database connection configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const logger = ensureLogger(env);
    // Passing ctx keeps initialization off the critical path: without it the first merge in a
    // cold isolate pays the LaunchDarkly initialization wait.
    P1FeatureFlagService.init(env, ctx);
    // Parsed rather than pulled off the path with a regex of its own: the router already
    // knows which routes carry a site and where, and `pathPattern` has had the id
    // normalized out of it by the time it exists. handleRequest parses again — the
    // function is a pure regex chain, and threading the result through the /internal and
    // /broker branches that run before it buys nothing.
    const telemetry = contextFromRequest(req, {
      route: pathPattern,
      siteId: parseRoute(path)?.params.siteId,
    });

    // Run request with isolated database connection using AsyncLocalStorage
    // This ensures concurrent requests don't interfere with each other's connections
    return withRequestContext(telemetry, async () => {
      try {
        const response = await runWithConnection(
          connectionString,
          { isHyperdrive },
          async () => {
            // OPTIONS preflight runs inside runWithConnection so we can look up
            // per-site allowed_origins for site-scoped paths (e.g. /api/sites/{id}).
            if (req.method === 'OPTIONS') {
              const siteId = /^\/api\/sites\/([^/]+)/.exec(path)?.[1];
              let siteOrigins: string[] = [];
              if (siteId !== undefined) {
                try {
                  siteOrigins = (await getCachedSiteAllowedOrigins(siteId)) ?? [];
                } catch (err) {
                  // Fail open: system defaults still apply so Pantheon-hosted
                  // sites keep working; per-site custom domains are blocked
                  // until the DB recovers.
                  logger.warn('failed to load site origins for preflight', {
                    reason: err instanceof Error ? err.name : 'unknown',
                    outcome: 'fail_open',
                  });
                }
              }
              return handlePreflight(req, env, siteOrigins);
            }

            const resp = await handleRequest(req, env, path, origin, ctx);

            // Record successful request metrics
            const durationMs = Date.now() - requestStart;
            const statusClass = getStatusClass(resp.status);

            incrementCounter('ccr_http_request_total', {
              method: req.method,
              path_pattern: pathPattern,
              status_class: statusClass,
            });
            recordTiming('ccr_http_request_duration_ms', durationMs, {
              method: req.method,
              path_pattern: pathPattern,
              status_class: statusClass,
            });

            logger.info('request complete', {
              'http.request.method': req.method,
              'http.response.status_code': resp.status,
              duration_ms: durationMs,
            });

            return withRequestId(resp, telemetry.requestId);
          },
        );

        return response;
      } catch (error) {
        // Record error metrics
        incrementCounter('ccr_http_errors_total', {
          error_type: classifyError(error),
        });
        // Nothing below this caught it, so it's a boundary failure — alert on
        // `unhandled=true` rather than on every error-level line.
        logger.unhandled('request failed', error, {
          'http.request.method': req.method,
          duration_ms: Date.now() - requestStart,
        });
        // Return a CORS-allowed error response rather than re-throwing.
        // Re-throwing causes the Workers runtime to generate a bare 500 with no CORS
        // headers, which the browser sees as a network failure rather than an API error.
        const message = error instanceof Error ? error.message : 'Internal server error';
        return withRequestId(
          addCorsHeaders(errorResponse(message, 500), origin, env),
          telemetry.requestId,
        );
      } finally {
        // Under `waitUntil` so the outbound metrics POST cannot delay the response.
        ctx.waitUntil(flushMetrics());
        // Drains the local ndjson sink when `P1_LOG_SINK` is set; a no-op when console is
        // the only sink. Under `waitUntil` so it cannot delay the response.
        ctx.waitUntil(logger.flush());
      }
    });
  },

  /**
   * Queue dispatcher. Routes a batch to its handler based on the queue name.
   */
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const logger = ensureLogger(env);
    // No `ctx` on a queue batch, so no prewarm — the first gate read pays initialization.
    P1FeatureFlagService.init(env);

    // A fresh trace per batch: producers do not yet stamp `taskTraceFields` into the
    // message body, so there is no enqueuing trace to continue. Joining the producer's
    // trace needs per-message context, which means reworking the batch handlers below —
    // until then a queue batch is its own root and does not link back to the request that
    // caused it.
    const telemetry = contextForTask({ route: `queue:${batch.queue}` });

    await withRequestContext(telemetry, async () => {
      try {
        logger.info('queue batch start', { queue: batch.queue, count: batch.messages.length });
        if (batch.queue.startsWith('css-screenshot-queue')) {
          await handleScreenshotQueue(batch as MessageBatch<ScreenshotQueueMessage>, env);
          return;
        }
        await handleSyncQueue(batch as MessageBatch<SyncQueueMessage>, env);
      } catch (error) {
        logger.unhandled('queue batch failed', error, { queue: batch.queue });
        throw error;
      } finally {
        await logger.flush();
      }
    });
  },

  /**
   * Cron handler. Currently runs the weekly screenshot refresh.
   */
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const logger = ensureLogger(env);
    P1FeatureFlagService.init(env, ctx);
    const telemetry = contextForTask({ route: 'cron:screenshot-refresh' });

    ctx.waitUntil(
      withRequestContext(telemetry, async () => {
        try {
          await runWeeklyScreenshotRefresh(env);
        } catch (error) {
          logger.unhandled('scheduled run failed', error);
          throw error;
        } finally {
          await logger.flush();
        }
      }),
    );
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
  // Resolve per-site allowed_origins once for this request.
  // Used to build per-site CORS patterns merged with system defaults and env origins.
  // Only runs for site-scoped paths (e.g. /api/sites/{id}); falls back to [] otherwise.
  let siteOrigins: string[] = [];
  const siteIdFromPath = /^\/api\/sites\/([^/]+)/.exec(path)?.[1];
  if (siteIdFromPath !== undefined) {
    try {
      siteOrigins = (await getCachedSiteAllowedOrigins(siteIdFromPath)) ?? [];
    } catch (err) {
      // Fail open: system defaults still apply so Pantheon-hosted sites keep
      // working; per-site custom domains are blocked until the DB recovers.
      getLogger().warn('failed to load site origins', {
        reason: err instanceof Error ? err.name : 'unknown',
        outcome: 'fail_open',
      });
    }
  }

  // Scoped helper so every addCorsHeaders call in this function gets
  // the merged (system + env + per-site) pattern set without threading siteOrigins manually.
  const cors = (resp: Response): Response => addCorsHeaders(resp, origin, env, siteOrigins);

  // Health endpoint (no auth required)
  if (path === '/health' || path === '/health/') {
    const response = await handleHealth(env);
    return cors(response);
  }

  // API documentation (no auth required so the surface is publicly browseable)
  if (path === '/docs' || path === '/docs/') {
    return cors(handleDocsRoute(request));
  }
  if (path === '/docs/openapi.yaml') {
    return cors(handleDocsSpecRoute(request));
  }

  // GET /api/auth/me - Return authenticated principal info (requires auth)
  if (path === '/api/auth/me' && request.method === 'GET') {
    const principal = await authenticate(request, env);
    if (!principal) {
      return cors(errorResponse('Authentication required', 401));
    }
    // Gates user principals only. extractActingUser runs on the dispatched path
    // below, so an agent — which carries no email of its own — no-ops here.
    const allowlistResult = await gateAndEnrichPrincipal(request, env, principal);
    if (allowlistResult !== null) {
      return cors(allowlistResult);
    }
    return cors(jsonResponse({
      id: principal.id,
      type: principal.type,
      email: principal.email,
      name: principal.name,
      avatarUrl: principal.avatarUrl,
      authProvider: principal.authProvider,
      tokenExpiry: principal.tokenExpiry,
      providerSubjectId: principal.providerSubjectId,
    }));
  }

  // Mock auth endpoints (local development only)
  // Guard on ENVIRONMENT === 'local' rather than !hasRealAuthProviders so the
  // endpoint is unreachable on sbx1/production even when OAuth secrets are
  // absent — consistent with how getIdentityProvider gates the MockIdentityProvider.
  if (path.startsWith('/api/auth')) {
    if (env.ENVIRONMENT === 'local') {
      const response = await handleAuthRoutes(request, path, env);
      if (response) {
        return cors(response);
      }
    }
    return cors(errorResponse('Not found', 404));
  }

  // Internal API endpoints (uses X-Internal-Secret auth, not user/agent tokens)
  if (path.startsWith('/internal/')) {
    // The local default is a published value, so it must never stand in for a
    // missing secret in a deployed environment — these routes report on real
    // users. Unset anywhere but local means the surface is closed.
    const internalSecret = env.ENVIRONMENT === 'local'
      ? env.INTERNAL_SECRET ?? 'development-internal-secret'
      : env.INTERNAL_SECRET;
    if (internalSecret === undefined || internalSecret === '') {
      getLogger().error('INTERNAL_SECRET is not configured; refusing /internal/ request', new Error('INTERNAL_SECRET missing'), {});
      return cors(errorResponse('Internal API not configured', 503));
    }
    const response = await handleInternalRoutes(request, { internalSecret });
    return cors(response);
  }

  // Broker routes (/broker/*) — brokered auth flow for third-party panels.
  // Runs before parseRoute() since broker endpoints have their own auth model.
  if (path.startsWith('/broker/') || path === '/auth/callback') {
    const response = await handleBrokerRoutes(request, env, path);
    if (response !== null) {
      return cors(response);
    }
  }

  // Parse route
  const route = parseRoute(path);
  if (!route) {
    return cors(jsonResponse(
      {
        error: 'Not Found',
        message: `No handler for ${request.method} ${path}`,
        availableEndpoints: [
          '/health', '/api/sites', '/api/admin/users', '/api/auth/me',
          ...(env.ENVIRONMENT === 'local' ? ['/api/auth/users', '/api/auth/token'] : []),
        ],
      },
      404,
    ));
  }

  // Authenticate request for API routes
  const principal = await authenticate(request, env);
  if (!principal) {
    return cors(errorResponse('Authentication required', 401));
  }

  // What kind of caller this is is only knowable here, so every line from this point on
  // gains it. It is derived from the credential we just validated rather than claimed by
  // the caller, which is what makes it worth grouping on.
  enrichContext({ principalType: principal.type, authProvider: principal.authProvider });

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
      return cors(errorResponse('Service principals can only access site-scoped routes', 403));
    }
    const decision = servicePrincipalScopeDecision(
      principal, route.params.siteId, request.method, route.handler,
    );
    if (decision.outcome === 'denied') {
      return cors(errorResponse(decision.reason, 403));
    }
    if (decision.outcome === 'requires-main-branch') {
      const denied = await assertServiceTokenOnMainBranch(request, route.params.siteId, route.handler);
      if (denied !== null) {
        return cors(denied);
      }
    }
  }

  // Access gate: the caller must have a row in app.users.
  // Skip for mock auth mode (development ergonomics).
  // Skip for service principals (they authenticate via site API tokens, not user accounts).
  //
  // PCC-3190: agent principals carry no email of their own, so the previous
  // `principal.email !== undefined` guard caused the gate to be skipped
  // entirely for agent traffic — letting any authenticated Google user
  // reach handlers via the MCP server's acting-user forwarding without
  // being checked. When an agent forwards an acting user, treat the acting
  // user's email as the subject.
  //
  // PCC-3479: a missing row is no longer an automatic refusal. A signed-in
  // user whose P1V0 LaunchDarkly flag is on provisions themselves on the spot.
  const accessResult = await gateAndEnrichPrincipal(request, env, principal);
  if (accessResult !== null) {
    return cors(accessResult);
  }

  // Initialize MAS client (undefined when not enabled)
  const masClient = getMASClient(env);

  try {
    // PCC-3676: non-main (unpublished) branch content is member-only. Enforce it
    // here — before the cached-content forward — so the check runs on every
    // request (handleRequest runs even on a cache hit) and a non-member is
    // refused before the shared, URL-keyed cache is consulted or populated.
    // Reuses isCacheableContentRequest so the gated set can never drift from the
    // cached set. Main/published content carries no ?branch= and is public;
    // service principals are already scope-checked above (isServicePrincipalAllowed).
    // Kept inside this try so a resolveBranch/hasPermission failure maps to the
    // generic 500 below rather than leaking a DB error at the fetch() boundary.
    if (
      principal.type !== 'service' &&
      isCacheableContentRequest(route, request.method) &&
      route.params.siteId !== undefined
    ) {
      const denied = await assertContentBranchAccess(request, route.params.siteId, principal, masClient);
      if (denied !== null) {
        return cors(denied);
      }
    }

    // Past this point the response depends only on the URL, which is what makes
    // the cached entrypoint safe. The cache layer must never be a point of
    // failure for content serving [PCC-3666]: a null forward (loopback binding
    // unavailable) or a throw from the forward both fall through to the uncached
    // dispatch below. Entrypoint-level failures return as Response objects and
    // pass through untouched — only transport failures land in the catch.
    if (isCacheableContentRequest(route, request.method)) {
      try {
        const cached = await forwardToCachedContent(request);
        if (cached !== null) {
          return cors(cached);
        }
      } catch (error) {
        getLogger().error('cached content forward failed, serving uncached', error, {
          site_id: route.params.siteId,
          doc_path: route.params.documentPath,
          outcome: 'fail_open',
        });
      }
    }

    const response = await dispatchRoute(request, route, principal, env, masClient, ctx);
    return cors(response);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return cors(errorResponse(error.message, 403));
    }
    if (error instanceof HttpError) {
      return cors(errorResponse(error.message, error.status));
    }
    getLogger().error('Request handler error', error instanceof Error ? error : new Error(String(error)), {});
    return cors(errorResponse('Internal server error', 500));
  }
}

/** Columns the access gate reads and enriches the principal from. */
interface AccessUserRow {
  id: string;
  principal_id: string | null;
  system_role: string;
  is_active: boolean;
  name: string | null;
  avatar_url: string | null;
}

const ACCESS_USER_COLUMNS = 'id, principal_id, system_role, is_active, name, avatar_url';

/**
 * PCC-3479: self-service onboarding.
 *
 * A signed-in user with no app.users row used to be refused outright. Now, if
 * their P1V0 LaunchDarkly flag is on, they get a row created here and carry on.
 * Deliberately narrow:
 *   - user principals only — an agent forwarding an acting user has no token we
 *     could evaluate the flag against, and must not conjure the user it claims
 *     to act for.
 *   - no organization is created. Business accounts come from Content
 *     Publisher space setup (see linkOrCreateOrgForSpace), and minting one here
 *     would give every invitee a business account of their own — exactly what
 *     PCC-3479 removes.
 *
 * Returns the new row, or undefined when the flag is off or provisioning failed.
 */
async function provisionUserFromFeatureFlag(
  request: Request,
  env: Env,
  principal: AuthenticatedPrincipal,
  subjectEmail: string,
): Promise<AccessUserRow | undefined> {
  if (principal.type !== 'user') {
    return undefined;
  }

  const enabled = await isFeatureFlagEnabled(
    env,
    request.headers.get('Authorization'),
    subjectEmail,
  );
  if (!enabled) {
    return undefined;
  }

  const email = subjectEmail.toLowerCase();

  try {
    // PCC-3457: stamp the normalized (UUIDv5) principal id, never the raw
    // OAuth subject — the persistence actor resolver looks this column up by
    // UUIDv5 (incident PCC-3464).
    const inserted = await query<AccessUserRow>(
      `INSERT INTO app.users (email, name, avatar_url, principal_id, auth_provider, system_role, is_active)
       VALUES ($1, $2, $3, $4, $5, 'member', true)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${ACCESS_USER_COLUMNS}`,
      [
        email,
        principal.name ?? null,
        principal.avatarUrl ?? null,
        await normalizePrincipalIdForDb(principal.id),
        principal.authProvider ?? 'unknown',
      ],
    );

    if (inserted.rows[0] !== undefined) {
      return inserted.rows[0];
    }

    // Lost a race with a concurrent first request — read the winner's row.
    const existing = await query<AccessUserRow>(
      `SELECT ${ACCESS_USER_COLUMNS} FROM app.users WHERE email = $1`,
      [email],
    );
    return existing.rows[0];
  } catch (error) {
    getLogger().error('Self-service user provisioning failed', error instanceof Error ? error : new Error(String(error)), {});
    return undefined;
  }
}

/**
 * The main-branch half of service-principal scope enforcement [PCC-3898].
 *
 * `?branch=` carries either a UUID or a branch name, so the parameter's text
 * alone cannot say whether it names main: the previous rule of "any value is
 * non-main" denied `?branch=main` on published content a read:published token
 * is entitled to. Resolving the ref costs a branch lookup, so this runs only
 * for the one decision that turns on the answer — a token whose every matching
 * clause is main-branch-only. A request refused on site, method, or handler
 * never reaches it, and neither does one a branch-agnostic scope already
 * allows.
 *
 * An absent parameter still means main (the handlers default to it) and costs
 * no query. resolveBranch is the content handler's own resolver, so
 * enforcement and serving agree on which branch a ref names.
 *
 * An unresolvable ref is refused with the same 403 as a real non-main branch,
 * not a 404: a published-only token has no business distinguishing a branch
 * that exists from one that doesn't (branch names carry ticket ids and
 * unreleased campaign names — see the PCC-3676 gate below for the same
 * reasoning), and neither ref names main, so the refusal is true either way.
 */
async function assertServiceTokenOnMainBranch(
  request: Request,
  siteId: string,
  routeHandler: string,
): Promise<Response | null> {
  const branchRef = new URL(request.url).searchParams.get('branch');
  if (branchRef === null || branchRef === '') {
    return null;
  }

  let branch: { id: string; name: string; isMain: boolean } | null;
  try {
    branch = await resolveBranch(request, siteId);
  } catch (error) {
    // This runs outside handleRequest's try, so an escaping throw would reach
    // the fetch() boundary and be logged as an alerting `unhandled` failure. A
    // lookup that didn't answer is not a policy decision — report it as one
    // server error instead of turning it into a denial.
    getLogger().error(
      'branch resolution for service token scope check failed',
      error instanceof Error ? error : new Error(String(error)),
      { site_id: siteId, outcome: 'error' },
    );
    return errorResponse('Internal server error', 500);
  }

  if (branch?.isMain === true) {
    return null;
  }

  getLogger().info('service token denied on non-main branch', {
    site_id: siteId,
    branch_id: branch?.id,
    outcome: 'denied',
  });
  return errorResponse(
    `Insufficient scope for this operation: ${request.method} on '${routeHandler}' is limited to `
    + 'the main branch by the scopes on this token',
    403,
  );
}

/**
 * PCC-3676 branch read gate. Non-main branch content is unpublished
 * (draft/preview) and visible only to principals with canView on the site.
 * Returns a Response to block the read, or null to allow it to proceed.
 *
 * Only an explicit `?branch=` is considered — the default (main) is published
 * and public, and skipping resolution there keeps the hot public path free of
 * an extra branch lookup. resolveBranch is the content handler's own resolver,
 * so the gate and the serve agree on which branch a ref names.
 *
 * A denial returns 404, identical to a nonexistent branch: a 403 here would
 * turn the status code into a branch-existence oracle (branch names carry
 * ticket ids and unreleased feature/campaign names) for a caller who is not a
 * member. The denial is logged at info (a deliberate, served outcome — not
 * degraded) so rollout blast radius is measurable, and it is returned before
 * the forward, so it is never cached and can't be served to a member.
 */
async function assertContentBranchAccess(
  request: Request,
  siteId: string,
  principal: AuthenticatedPrincipal,
  masClient: MASClient | undefined,
): Promise<Response | null> {
  const branchRef = new URL(request.url).searchParams.get('branch');
  if (branchRef === null || branchRef === '') {
    return null;
  }
  const branch = await resolveBranch(request, siteId);
  if (branch === null || branch.isMain) {
    return null;
  }
  const allowed = await hasPermission(principal, siteId, branch.id, 'canView', masClient);
  if (allowed) {
    return null;
  }
  getLogger().info('non-main branch read denied', {
    site_id: siteId,
    branch_id: branch.id,
    outcome: 'denied',
  });
  return errorResponse('Branch not found', 404);
}

/**
 * Applies the access gate, returning an error Response only when the caller may
 * not use P1. Skipped for mock-only deployments and for service principals,
 * which authenticate with site API tokens rather than user accounts.
 */
async function gateAndEnrichPrincipal(
  request: Request,
  env: Env,
  principal: AuthenticatedPrincipal,
): Promise<Response | null> {
  // Agent principals carry no email of their own. When an agent forwards an
  // acting user, that user's email is the subject the gate checks.
  const subjectEmail =
    principal.email
    ?? (principal.type === 'agent' ? principal.actingUserEmail : undefined);

  if (
    !hasRealAuthProviders(env)
    || principal.type === 'service'
    || subjectEmail === undefined
  ) {
    return null;
  }

  return checkUserAccess(request, env, principal, subjectEmail);
}

/**
 * Decide whether the caller may use P1 at all, and enrich their principal
 * from app.users. Returns an error response to refuse, or null to continue.
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
async function checkUserAccess(
  request: Request,
  env: Env,
  principal: AuthenticatedPrincipal,
  subjectEmail: string,
): Promise<Response | null> {
  // EXISTS, not COUNT(*): this only asks whether the allowlist is populated,
  // and /api/auth/me now runs it on every editor mount and token refresh.
  const allowlistProbe = await query<{ populated: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM app.users) AS populated',
  );

  if (allowlistProbe.rows[0]?.populated === true) {
    const userResult = await query<AccessUserRow>(
      `SELECT ${ACCESS_USER_COLUMNS} FROM app.users WHERE email = $1`,
      [subjectEmail.toLowerCase()],
    );

    let userRow: AccessUserRow | undefined = userResult.rows[0];

    // No row at all: the P1V0 flag decides, not the allowlist (PCC-3479).
    // A row that exists but is deactivated is a deliberate revocation — the
    // flag must not undo it, so only the absent case falls through here.
    userRow ??= await provisionUserFromFeatureFlag(
      request,
      env,
      principal,
      subjectEmail,
    );

    if (userRow?.is_active !== true) {
      return errorResponse('User not authorized', 403);
    }

    // Agent principals must not adopt the acting user's DB identity.
    // The allowlist check above is sufficient; per-site authorization
    // already intersects agent and acting-user roles via getEffectiveRole.
    if (principal.type !== 'user') {
      return null;
    }

    // Only the broker JWT carries the upstream photo, so an absent avatar there
    // means it was removed and the column is cleared; other providers have no
    // opinion and fall back to the stored value.
    principal.name ??= userRow.name ?? undefined;
    const resolvedAvatarUrl =
      principal.authProvider === 'broker'
        ? principal.avatarUrl ?? null
        : principal.avatarUrl ?? userRow.avatar_url;
    principal.avatarUrl = resolvedAvatarUrl ?? undefined;

    // Link principal_id on first login, and update name/avatar_url.
    // PCC-3457: stamp the normalized (UUIDv5) form, never a raw OAuth
    // subject — the persistence actor resolver looks this column up by
    // UUIDv5, and a raw stamp recreates the unmatchable rows migration 045
    // backfills (incident PCC-3464).
    if (userRow.principal_id === null) {
      await query(
        'UPDATE app.users SET principal_id = $1, auth_provider = $2, name = COALESCE($3, name), avatar_url = $4, updated_at = NOW() WHERE id = $5',
        [await normalizePrincipalIdForDb(principal.id), principal.authProvider ?? 'unknown', principal.name ?? null, resolvedAvatarUrl, userRow.id],
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
      const avatarChanged = resolvedAvatarUrl !== userRow.avatar_url;
      if (nameChanged || avatarChanged) {
        await query(
          'UPDATE app.users SET name = COALESCE($1, name), avatar_url = $2, updated_at = NOW() WHERE id = $3',
          [principal.name ?? null, resolvedAvatarUrl, userRow.id],
        );
      }
    }

    // Store DB user ID for authorization queries (role tables reference users.id, not the UUIDv5 principal id)
    principal.dbUserId = userRow.id;
    // Attach system role to principal for downstream use
    principal.systemRole = userRow.system_role;
  }

  return null;
}
