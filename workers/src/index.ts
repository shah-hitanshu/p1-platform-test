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
import { MockIdentityProvider } from './auth/mock-identity-provider';
import {
  MultiProviderIdentityProvider,
  MockIdentityProviderAdapter,
} from './auth/identity-provider';
import { GoogleIdentityProvider } from './auth/google-identity-provider';
import { Auth0IdentityProvider } from './auth/auth0-identity-provider';
import type { AuthenticatedPrincipal, MockIdentityConfig } from './types';
import { AuthorizationError } from './auth/authorization';

// Route handlers
import { handleSiteRoutes } from './routes/site-api';
import { handleBranchRoutes } from './routes/branch-api';
import { handleDocumentRoutes } from './routes/document-api';
import { handleCheckpointRoutes } from './routes/checkpoint-api';
import { handleMergeRoutes } from './routes/merge-api';
import { handleGrantRoutes } from './routes/grant-api';
import { handleCollaboratorRoutes } from './routes/collaborator-api';
import { handleUsersRoutes } from './routes/users-api';
import { handleStructureRoutes } from './routes/structure-api';
import { handleNodeRoutes } from './routes/node-api';
import { handleMetadataRoutes } from './routes/metadata-api';
import { handleRealtimeRoutes } from './routes/realtime-api';
import { handleInternalRoutes } from './routes/internal-api';
import { handlePresenceRoutes } from './routes/presence-api';
import { handleSiteTokenRoutes } from './routes/site-token-api';
import { handleSiteSettingsRoutes } from './routes/site-settings-api';
import { handleContentRoutes } from './routes/content-api';

// Auth providers
import { SiteApiTokenProvider } from './auth/site-token-provider';
import { isServicePrincipalAllowed } from './auth/service-principal';

// MAS client
import { MASClient } from './services/mas-client';
import { getMainBranch } from './services/branch-service';

// Queue consumer (Phase 5.1)
import { handleSyncQueue } from './queues/sync-consumer';
import type { SyncQueueMessage } from './types/queue-messages';

// CORS
import {
  parseOriginPatterns,
  addCorsHeaders as sharedAddCorsHeaders,
  handlePreflight as sharedHandlePreflight,
} from './utils/cors';

// Metrics
import {
  initializeMetrics,
  incrementCounter,
  recordTiming,
  setGauge,
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

/**
 * Health check response type.
 */
interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  environment: string;
  timestamp: string;
  database?: {
    connected: boolean;
    latencyMs?: number;
    error?: string;
  };
}

/**
 * Default mock identity configuration for development.
 * User/agent IDs must be valid UUIDs to match database schema.
 */
const DEFAULT_MOCK_CONFIG: MockIdentityConfig = {
  tokenExpiry: '24h',
  users: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'alice@example.com',
      name: 'Alice Developer',
      siteRoles: {
        'site-123': 'admin',
        'site-456': 'developer',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'bob@example.com',
      name: 'Bob Reviewer',
      siteRoles: {
        'site-123': 'team_member',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'carol@example.com',
      name: 'Carol Editor',
      siteRoles: {
        'site-123': 'developer',
        'site-456': 'admin',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
  ],
  agents: [
    {
      // ID must match database: a0000000-0000-0000-0000-000000000001 (Zappy)
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Zappy AI Assistant',
      apiKey: 'test-agent-key-zappy',
      siteRoles: {
        'site-123': 'editor',
        '5da7f0d0-81d8-4e92-9a4b-a4cb07090768': 'admin',
        '35b800c4-6010-4908-a724-f1512e2a2144': 'admin',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin',
        '03499be6-0236-47d8-9076-64b71c420e1e': 'admin',
      },
    },
    {
      // ID must match database: a0000000-0000-0000-0000-000000000002 (Helper)
      id: 'a0000000-0000-0000-0000-000000000002',
      name: 'Helper Bot',
      apiKey: 'test-agent-key-helper',
      siteRoles: { 'site-123': 'viewer', 'site-456': 'editor' },
    },
  ],
};

/**
 * Build a MultiProviderIdentityProvider with registered providers.
 * Mock provider is always available in non-production environments.
 * Google and Auth0 providers will be added in Phases 2 and 3.
 */
/**
 * Check whether any real OAuth provider is configured.
 * When true, mock authentication should be disabled.
 */
function hasOAuthProviders(env: Env): boolean {
  const hasGoogle = env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_ID !== '';
  const hasAuth0 =
    env.AUTH0_ISSUER_BASE_URL !== undefined &&
    env.AUTH0_ISSUER_BASE_URL !== '' &&
    env.AUTH0_AUDIENCE !== undefined &&
    env.AUTH0_AUDIENCE !== '';
  return hasGoogle || hasAuth0;
}

function getIdentityProvider(env: Env): MultiProviderIdentityProvider {
  const providers = [];

  // Mock provider: available only in local development for token validation.
  // Sandboxes and production are internet-facing and must use real auth.
  if (env.ENVIRONMENT === 'local') {
    providers.push(new MockIdentityProviderAdapter(
      new MockIdentityProvider({
        config: DEFAULT_MOCK_CONFIG,
        jwtSecret: env.MOCK_JWT_SECRET ?? 'development-secret-must-be-at-least-32-characters',
        tokenExpiry: '24h',
      }),
    ));
  }

  // Google OAuth provider (activated when client ID is configured)
  if (env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_ID !== '') {
    providers.push(new GoogleIdentityProvider({
      clientId: env.GOOGLE_CLIENT_ID,
    }));
  }

  // Auth0 provider (activated when issuer and audience are configured)
  if (
    env.AUTH0_ISSUER_BASE_URL !== undefined &&
    env.AUTH0_ISSUER_BASE_URL !== '' &&
    env.AUTH0_AUDIENCE !== undefined &&
    env.AUTH0_AUDIENCE !== ''
  ) {
    providers.push(new Auth0IdentityProvider({
      issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
      newIssuerBaseUrl: env.AUTH0_NEW_ISSUER_BASE_URL,
      audience: env.AUTH0_AUDIENCE,
    }));
  }

  // Site API token provider (always available — validates sat_ tokens against DB)
  providers.push(new SiteApiTokenProvider());

  return new MultiProviderIdentityProvider(providers);
}

/**
 * Create a MASClient instance when MAS integration is enabled.
 * Returns undefined when MAS_ENABLED is not 'true' or MAS_BASE_URL is missing.
 */
function getMASClient(env: Env): MASClient | undefined {
  if (env.MAS_ENABLED !== 'true' || env.MAS_BASE_URL === undefined || env.MAS_BASE_URL === '') {
    return undefined;
  }

  return new MASClient({
    baseUrl: env.MAS_BASE_URL,
    gcpServiceAccountKey: env.MAS_GCP_SERVICE_ACCOUNT_KEY,
    cacheTtlSeconds: env.MAS_CACHE_TTL_SECONDS !== undefined && env.MAS_CACHE_TTL_SECONDS !== ''
      ? parseInt(env.MAS_CACHE_TTL_SECONDS, 10)
      : undefined,
  });
}

/**
 * JSON response helper.
 */
function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Error response helper.
 */
function errorResponse(
  error: string,
  status: number,
  details?: unknown,
): Response {
  return jsonResponse({ error, details }, status);
}

/** Allowed headers for main API routes */
const MAIN_ALLOWED_HEADERS =
  'Content-Type, Authorization, X-API-Key, X-Principal-Id, X-Principal-Type, X-Actor-Id, X-Actor-Type';

/**
 * Add CORS headers to response based on request origin.
 * Delegates to shared CORS utility with wildcard pattern support.
 */
function addCorsHeaders(
  response: Response,
  origin: string | null,
  env: Env,
): Response {
  const patterns = parseOriginPatterns(env.CORS_ORIGINS);
  return sharedAddCorsHeaders(response, origin, patterns, MAIN_ALLOWED_HEADERS);
}

/**
 * Handle CORS preflight requests.
 * Delegates to shared CORS utility with wildcard pattern support.
 */
function handlePreflight(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin');
  const patterns = parseOriginPatterns(env.CORS_ORIGINS);
  return sharedHandlePreflight(origin, patterns, MAIN_ALLOWED_HEADERS);
}

/**
 * Authenticate request and return principal.
 */
async function authenticate(
  request: Request,
  env: Env,
): Promise<AuthenticatedPrincipal | null> {
  const identityProvider = getIdentityProvider(env);

  // Try Bearer token first
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ') === true) {
    const token = authHeader.substring(7);
    return await identityProvider.validateToken(token);
  }

  // Try API key from header
  const apiKey = request.headers.get('X-API-Key');
  if (apiKey !== null && apiKey !== '') {
    // Site API tokens (sat_ prefix) are validated as tokens, not agent keys
    if (apiKey.startsWith('sat_')) {
      return await identityProvider.validateToken(apiKey);
    }
    return await identityProvider.validateAgentKey(apiKey);
  }

  // Try from query params (for WebSocket - browsers can't send custom headers)
  const url = new URL(request.url);
  const queryApiKey = url.searchParams.get('apiKey');
  if (queryApiKey !== null && queryApiKey !== '') {
    // Site API tokens (sat_ prefix) are validated as tokens
    if (queryApiKey.startsWith('sat_')) {
      return await identityProvider.validateToken(queryApiKey);
    }
    // Try as JWT token first (for human users), then as agent API key
    // JWTs are longer and contain dots, agent keys are shorter alphanumeric
    if (queryApiKey.includes('.')) {
      // Looks like a JWT token (header.payload.signature format)
      const tokenResult = await identityProvider.validateToken(queryApiKey);
      if (tokenResult !== null) {
        return tokenResult;
      }
    }
    // Try as agent API key
    return await identityProvider.validateAgentKey(queryApiKey);
  }

  return null;
}

/**
 * Handle health check endpoint.
 * Validates database connectivity.
 */
async function handleHealth(env: Env): Promise<Response> {
  const health: HealthResponse = {
    status: 'healthy',
    environment: env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  };

  // Test database connection (connection is already established via runWithConnection)
  try {
    const start = Date.now();
    const result = await query<{ now: string }>('SELECT NOW() as now');
    const latencyMs = Date.now() - start;

    health.database = {
      connected: true,
      latencyMs,
    };

    // Verify we got a result
    if (result.rows.length === 0) {
      throw new Error('No result from database');
    }

    // Record database health metrics
    setGauge('css_db_health_status', 1);
    recordTiming('css_db_health_latency_ms', latencyMs);
  } catch (error) {
    health.status = 'unhealthy';
    health.database = {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    // Record unhealthy database status
    setGauge('css_db_health_status', 0);
  }

  // Record worker info gauge
  setGauge('css_worker_info', 1, {
    version: env.APP_VERSION ?? 'dev',
    environment: env.ENVIRONMENT,
  });

  return new Response(JSON.stringify(health, null, 2), {
    status: health.status === 'healthy' ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Get the MockIdentityProvider for development-only auth endpoints.
 * These endpoints (token issuance, user listing) are mock-specific.
 */
function getMockIdentityProvider(env: Env): MockIdentityProvider {
  return new MockIdentityProvider({
    config: DEFAULT_MOCK_CONFIG,
    jwtSecret: env.MOCK_JWT_SECRET ?? 'development-secret-must-be-at-least-32-characters',
    tokenExpiry: '24h',
  });
}

/**
 * Handle mock auth endpoints for frontend login (development only).
 */
async function handleAuthRoutes(
  request: Request,
  path: string,
  env: Env,
): Promise<Response | null> {
  const mockProvider = getMockIdentityProvider(env);

  // GET /api/auth/users - List available users
  if (path === '/api/auth/users' && request.method === 'GET') {
    return jsonResponse({
      users: DEFAULT_MOCK_CONFIG.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        siteRoles: u.siteRoles,
      })),
      agents: DEFAULT_MOCK_CONFIG.agents.map((a) => ({
        id: a.id,
        name: a.name,
        siteRoles: a.siteRoles,
      })),
    });
  }

  // POST /api/auth/token - Issue token for user
  if (path === '/api/auth/token' && request.method === 'POST') {
    const rawBody: unknown = await request.json();
    const body = rawBody as { userId?: string; agentApiKey?: string };

    // Try user token
    if (typeof body.userId === 'string' && body.userId.length > 0) {
      const user = mockProvider.getUser(body.userId);
      if (user === undefined) {
        return errorResponse('User not found', 404);
      }
      const token = await mockProvider.issueToken(body.userId);
      return jsonResponse({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          siteRoles: user.siteRoles,
        },
      });
    }

    return errorResponse('userId is required', 400);
  }

  return null;
}

/**
 * Parse route parameters from path.
 */
interface RouteParams {
  siteId?: string;
  branchId?: string;
  documentId?: string;
  documentPath?: string;
  checkpointId?: string;
  structureId?: string;
  nodeId?: string;
  grantId?: string;
  userId?: string;
  mergeRequestId?: string;
  action?: string;
  versionsPath?: string;
  versionAction?: string;
  versionId?: string;
  organizationId?: string;
  agentId?: string;
  tokenId?: string;
}

function parseRoute(path: string): { handler: string; params: RouteParams } | null {
  // Remove trailing slash
  const normalizedPath = path.replace(/\/$/, '');

  // Auth routes (no authentication required)
  if (normalizedPath.startsWith('/api/auth')) {
    return { handler: 'auth', params: {} };
  }

  // Admin users routes
  const adminUsersMatch = /^\/api\/admin\/users(?:\/([^/]+))?$/.exec(normalizedPath);
  if (adminUsersMatch) {
    return {
      handler: 'admin-users',
      params: { userId: adminUsersMatch[1] },
    };
  }

  // Site settings routes (must come before generic site routes)
  const siteSettingsMatch = /^\/api\/sites\/([^/]+)\/settings$/.exec(normalizedPath);
  if (siteSettingsMatch) {
    return {
      handler: 'site-settings',
      params: { siteId: siteSettingsMatch[1] },
    };
  }

  // Content pages route (must come before content route)
  const contentPagesMatch = /^\/api\/sites\/([^/]+)\/content-pages$/.exec(normalizedPath);
  if (contentPagesMatch) {
    return {
      handler: 'content',
      params: { siteId: contentPagesMatch[1], action: 'content-pages' },
    };
  }

  // Content delivery route (documentPath may contain slashes)
  const contentMatch = /^\/api\/sites\/([^/]+)\/content\/(.+)$/.exec(normalizedPath);
  if (contentMatch) {
    return {
      handler: 'content',
      params: { siteId: contentMatch[1], documentPath: contentMatch[2], action: 'content' },
    };
  }

  // Site token routes (must come before generic site routes)
  const siteTokenMatch = /^\/api\/sites\/([^/]+)\/tokens(?:\/([^/]+))?$/.exec(normalizedPath);
  if (siteTokenMatch) {
    return {
      handler: 'site-tokens',
      params: { siteId: siteTokenMatch[1], tokenId: siteTokenMatch[2] },
    };
  }

  // Site routes
  const siteMatch = /^\/api\/sites(?:\/([^/]+))?$/.exec(normalizedPath);
  if (siteMatch) {
    return {
      handler: 'sites',
      params: { siteId: siteMatch[1] },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/publish
  const publishRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/([^/]+)\/publish$/;
  const publishMatch = publishRe.exec(normalizedPath);
  if (publishMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: publishMatch[1],
        branchId: publishMatch[2],
        documentId: publishMatch[3],
        action: 'publish',
      },
    };
  }

  // Document version routes (must come before branch-scoped document routes)
  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/latest
  const versionLatestRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/([^/]+)\/versions\/latest$/;
  const versionLatestMatch = versionLatestRe.exec(normalizedPath);
  if (versionLatestMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: versionLatestMatch[1],
        branchId: versionLatestMatch[2],
        documentId: versionLatestMatch[3],
        versionsPath: 'true',
        versionAction: 'latest',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/{versionId}
  // Uses UUID pattern [0-9a-f-]{36} to avoid matching 'latest'
  const versionByIdRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/([^/]+)\/versions\/([0-9a-f-]{36})$/;
  const versionByIdMatch = versionByIdRe.exec(normalizedPath);
  if (versionByIdMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: versionByIdMatch[1],
        branchId: versionByIdMatch[2],
        documentId: versionByIdMatch[3],
        versionId: versionByIdMatch[4],
        versionsPath: 'true',
        versionAction: 'by-id',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions
  const versionsRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/([^/]+)\/versions$/;
  const versionsMatch = versionsRe.exec(normalizedPath);
  if (versionsMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: versionsMatch[1],
        branchId: versionsMatch[2],
        documentId: versionsMatch[3],
        versionsPath: 'true',
      },
    };
  }

  // Realtime routes (must come before document routes)
  // /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}[/action]
  // Note: These routes handle WebSocket connections, real-time document access, and agent edit workflows
  // Actions: edits, connect, can-agent-edit, agent-edit-start,
  // agent-edit-complete, agent-edit-abort, agent-stop, focus-regions
  const realtimeActions = 'edits|connect|can-agent-edit|agent-edit-start|agent-edit-complete|agent-edit-abort|agent-stop|focus-regions';
  const realtimeRe = new RegExp(
    `^/api/sites/([^/]+)/branches/([^/]+)/documents/(.+?)/(${realtimeActions})$`,
  );
  const realtimeConnectMatch = realtimeRe.exec(normalizedPath);
  if (realtimeConnectMatch) {
    const docPath = realtimeConnectMatch[3] ?? '';
    const action = realtimeConnectMatch[4] ?? '';
    return {
      handler: 'realtime',
      params: {
        siteId: realtimeConnectMatch[1],
        branchId: realtimeConnectMatch[2],
        documentPath: `${docPath}/${action}`,
      },
    };
  }

  // Branch-scoped document routes (must come before site-scoped document routes)
  // /api/sites/{siteId}/branches/{branchId}/documents/{documentIdOrPath}?
  // If the parameter looks like a UUID, route to document handler
  // Otherwise, treat it as a document path and route to realtime handler
  const branchDocMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents(?:\/([^/]+))?$/.exec(normalizedPath);
  if (branchDocMatch) {
    const docIdOrPath = branchDocMatch[3];
    // UUID pattern: 8-4-4-4-12 hex characters
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = docIdOrPath !== undefined && uuidPattern.test(docIdOrPath);

    if (docIdOrPath === undefined || isUuid) {
      // No doc specified, or it's a UUID - use document handler
      return {
        handler: 'documents',
        params: {
          siteId: branchDocMatch[1],
          branchId: branchDocMatch[2],
          documentId: branchDocMatch[3],
        },
      };
    } else {
      // It's a document path - use realtime handler for document state
      return {
        handler: 'realtime',
        params: {
          siteId: branchDocMatch[1],
          branchId: branchDocMatch[2],
          documentPath: docIdOrPath,
        },
      };
    }
  }

  // Document routes
  // /api/sites/{siteId}/documents/{documentId}/restore
  const docRestoreMatch = /^\/api\/sites\/([^/]+)\/documents\/([^/]+)\/restore$/.exec(normalizedPath);
  if (docRestoreMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: docRestoreMatch[1],
        documentId: docRestoreMatch[2],
        action: 'restore',
      },
    };
  }

  // /api/sites/{siteId}/documents/by-path/{documentPath}
  // Note: documentPath may contain encoded slashes (%2F) for nested paths like "products/rsq8"
  const docByPathMatch = /^\/api\/sites\/([^/]+)\/documents\/by-path\/(.+)$/.exec(normalizedPath);
  if (docByPathMatch) {
    try {
      return {
        handler: 'documents',
        params: {
          siteId: docByPathMatch[1],
          documentPath: decodeURIComponent(docByPathMatch[2]),
        },
      };
    } catch {
      // Invalid URL encoding - route doesn't match
      return null;
    }
  }

  // /api/sites/{siteId}/documents/{documentId}?
  const docMatch = /^\/api\/sites\/([^/]+)\/documents(?:\/([^/]+))?$/.exec(normalizedPath);
  if (docMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: docMatch[1],
        documentId: docMatch[2],
      },
    };
  }

  // Checkpoint routes
  // /api/sites/{siteId}/branches/{branchId}/checkpoints/{checkpointId}/revert
  const checkpointRevertRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/checkpoints\/([^/]+)\/revert$/;
  const checkpointRevertMatch = checkpointRevertRe.exec(normalizedPath);
  if (checkpointRevertMatch) {
    return {
      handler: 'checkpoints',
      params: {
        siteId: checkpointRevertMatch[1],
        branchId: checkpointRevertMatch[2],
        checkpointId: checkpointRevertMatch[3],
        action: 'revert',
      },
    };
  }

  // /api/sites/{siteId}/checkpoints/{checkpointId}/documents
  const checkpointDocsMatch = /^\/api\/sites\/([^/]+)\/checkpoints\/([^/]+)\/documents$/.exec(normalizedPath);
  if (checkpointDocsMatch) {
    return {
      handler: 'checkpoints',
      params: {
        siteId: checkpointDocsMatch[1],
        checkpointId: checkpointDocsMatch[2],
        action: 'documents',
      },
    };
  }

  // /api/sites/{siteId}/checkpoints/{checkpointId}/structures/{structureId}
  const checkpointStructRe =
    /^\/api\/sites\/([^/]+)\/checkpoints\/([^/]+)\/structures\/([^/]+)$/;
  const checkpointStructureMatch = checkpointStructRe.exec(normalizedPath);
  if (checkpointStructureMatch) {
    return {
      handler: 'structures',
      params: {
        siteId: checkpointStructureMatch[1],
        checkpointId: checkpointStructureMatch[2],
        structureId: checkpointStructureMatch[3],
      },
    };
  }

  // /api/sites/{siteId}/checkpoints/{checkpointId}
  const singleCheckpointMatch = /^\/api\/sites\/([^/]+)\/checkpoints\/([^/]+)$/.exec(normalizedPath);
  if (singleCheckpointMatch) {
    return {
      handler: 'checkpoints',
      params: {
        siteId: singleCheckpointMatch[1],
        checkpointId: singleCheckpointMatch[2],
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/checkpoints
  const branchCheckpointsMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/checkpoints$/.exec(normalizedPath);
  if (branchCheckpointsMatch) {
    return {
      handler: 'checkpoints',
      params: {
        siteId: branchCheckpointsMatch[1],
        branchId: branchCheckpointsMatch[2],
      },
    };
  }

  // Metadata routes (must come before node routes)
  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/state
  const structureStateRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/state$/;
  const structureStateMatch = structureStateRe.exec(normalizedPath);
  if (structureStateMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: structureStateMatch[1],
        branchId: structureStateMatch[2],
        structureId: structureStateMatch[3],
        action: 'state',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/schema
  const schemaRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/schema$/;
  const schemaMatch = schemaRe.exec(normalizedPath);
  if (schemaMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: schemaMatch[1],
        branchId: schemaMatch[2],
        structureId: schemaMatch[3],
        action: 'schema',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/validate
  const validateRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/validate$/;
  const validateMatch = validateRe.exec(normalizedPath);
  if (validateMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: validateMatch[1],
        branchId: validateMatch[2],
        structureId: validateMatch[3],
        action: 'validate',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/metadata
  const listMetaRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/metadata$/;
  const listMetadataMatch = listMetaRe.exec(normalizedPath);
  if (listMetadataMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: listMetadataMatch[1],
        branchId: listMetadataMatch[2],
        structureId: listMetadataMatch[3],
        action: 'list',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/documents/{docId}/metadata
  const docMetaRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/documents\/([^/]+)\/metadata$/;
  const docMetadataMatch = docMetaRe.exec(normalizedPath);
  if (docMetadataMatch) {
    return {
      handler: 'metadata',
      params: {
        siteId: docMetadataMatch[1],
        branchId: docMetadataMatch[2],
        structureId: docMetadataMatch[3],
        documentId: docMetadataMatch[4],
      },
    };
  }

  // Node routes
  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/navigation
  const navRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/navigation$/;
  const navigationMatch = navRe.exec(normalizedPath);
  if (navigationMatch) {
    return {
      handler: 'nodes',
      params: {
        siteId: navigationMatch[1],
        branchId: navigationMatch[2],
        structureId: navigationMatch[3],
        action: 'navigation',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}/move
  const nodeMoveRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/nodes\/([^/]+)\/move$/;
  const nodeMoveMatch = nodeMoveRe.exec(normalizedPath);
  if (nodeMoveMatch) {
    return {
      handler: 'nodes',
      params: {
        siteId: nodeMoveMatch[1],
        branchId: nodeMoveMatch[2],
        structureId: nodeMoveMatch[3],
        nodeId: nodeMoveMatch[4],
        action: 'move',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/reorder
  const reorderRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/nodes\/reorder$/;
  const reorderMatch = reorderRe.exec(normalizedPath);
  if (reorderMatch) {
    return {
      handler: 'nodes',
      params: {
        siteId: reorderMatch[1],
        branchId: reorderMatch[2],
        structureId: reorderMatch[3],
        action: 'reorder',
      },
    };
  }

  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}?
  const nodeRe =
    /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures\/([^/]+)\/nodes(?:\/([^/]+))?$/;
  const nodeMatch = nodeRe.exec(normalizedPath);
  if (nodeMatch) {
    return {
      handler: 'nodes',
      params: {
        siteId: nodeMatch[1],
        branchId: nodeMatch[2],
        structureId: nodeMatch[3],
        nodeId: nodeMatch[4],
      },
    };
  }

  // Structure routes
  // /api/sites/{siteId}/branches/{branchId}/structures/{structureId}?
  const structureMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/structures(?:\/([^/]+))?$/.exec(normalizedPath);
  if (structureMatch) {
    return {
      handler: 'structures',
      params: {
        siteId: structureMatch[1],
        branchId: structureMatch[2],
        structureId: structureMatch[3],
      },
    };
  }

  // Grant routes
  // /api/sites/{siteId}/branches/{branchId}/grants/{grantId}?
  const grantMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/grants(?:\/([^/]+))?$/.exec(normalizedPath);
  if (grantMatch) {
    return {
      handler: 'grants',
      params: {
        siteId: grantMatch[1],
        branchId: grantMatch[2],
        grantId: grantMatch[3],
      },
    };
  }

  // Collaborator routes
  // /api/sites/{siteId}/collaborators/{userId}?
  const collaboratorMatch = /^\/api\/sites\/([^/]+)\/collaborators(?:\/([^/]+))?$/.exec(normalizedPath);
  if (collaboratorMatch) {
    return {
      handler: 'collaborators',
      params: {
        siteId: collaboratorMatch[1],
        userId: collaboratorMatch[2],
      },
    };
  }

  // Branch routes
  // /api/sites/{siteId}/branches/{branchId}?
  const branchMatch = /^\/api\/sites\/([^/]+)\/branches(?:\/([^/]+))?$/.exec(normalizedPath);
  if (branchMatch) {
    return {
      handler: 'branches',
      params: {
        siteId: branchMatch[1],
        branchId: branchMatch[2],
      },
    };
  }

  // Merge routes
  // /api/sites/{siteId}/merge/{operation}
  const mergeOpMatch = /^\/api\/sites\/([^/]+)\/merge\/(check|execute|preview|crdt-preview)$/.exec(normalizedPath);
  if (mergeOpMatch) {
    return {
      handler: 'merge',
      params: {
        siteId: mergeOpMatch[1],
        action: mergeOpMatch[2],
      },
    };
  }

  // /api/sites/{siteId}/merge-requests/{requestId}/execute
  const mergeRequestExecuteMatch = /^\/api\/sites\/([^/]+)\/merge-requests\/([^/]+)\/execute$/.exec(normalizedPath);
  if (mergeRequestExecuteMatch) {
    return {
      handler: 'merge',
      params: {
        siteId: mergeRequestExecuteMatch[1],
        mergeRequestId: mergeRequestExecuteMatch[2],
        action: 'execute-request',
      },
    };
  }

  // /api/sites/{siteId}/merge-requests/{requestId}?
  const mergeRequestMatch = /^\/api\/sites\/([^/]+)\/merge-requests(?:\/([^/]+))?$/.exec(normalizedPath);
  if (mergeRequestMatch) {
    return {
      handler: 'merge',
      params: {
        siteId: mergeRequestMatch[1],
        mergeRequestId: mergeRequestMatch[2],
        action: 'requests',
      },
    };
  }

  // Presence routes (Phase 8)
  // Site presence: /api/sites/{siteId}/presence
  const sitePresenceMatch = /^\/api\/sites\/([^/]+)\/presence$/.exec(normalizedPath);
  if (sitePresenceMatch) {
    return {
      handler: 'presence',
      params: { siteId: sitePresenceMatch[1] },
    };
  }

  // Branch presence: /api/sites/{siteId}/branches/{branchId}/presence
  const branchPresenceMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/presence$/.exec(normalizedPath);
  if (branchPresenceMatch) {
    return {
      handler: 'presence',
      params: { siteId: branchPresenceMatch[1], branchId: branchPresenceMatch[2] },
    };
  }

  // Agent presence: /api/organizations/{orgId}/agents/{agentId}/presence
  const agentPresenceMatch = /^\/api\/organizations\/([^/]+)\/agents\/([^/]+)\/presence$/.exec(normalizedPath);
  if (agentPresenceMatch) {
    return {
      handler: 'presence',
      params: { organizationId: agentPresenceMatch[1], agentId: agentPresenceMatch[2] },
    };
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
          const resp = await handleRequest(request, env, path, origin);

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

  // Mock auth endpoints (only when no real OAuth providers are configured)
  if (path.startsWith('/api/auth')) {
    if (!hasOAuthProviders(env)) {
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
            ...(!hasOAuthProviders(env) ? ['/api/auth/users', '/api/auth/token'] : []),
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
        [principal.email.toLowerCase()],
      );

      const userRow = userResult.rows[0];
      if (userRow?.is_active !== true) {
        return addCorsHeaders(
          errorResponse('User not authorized', 403),
          origin,
          env,
        );
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
  }

  // Initialize MAS client (undefined when not enabled)
  const masClient = getMASClient(env);

  try {
    let response: Response;

    switch (route.handler) {
      case 'site-settings':
        response = await handleSiteSettingsRoutes(request, {
          siteId: route.params.siteId,
          principal,
        });
        break;

      case 'content':
        response = await handleContentRoutes(request, {
          siteId: route.params.siteId ?? '',
          documentPath: route.params.documentPath,
          action: route.params.action as 'content' | 'content-pages',
          principal,
        });
        break;

      case 'site-tokens':
        response = await handleSiteTokenRoutes(request, {
          siteId: route.params.siteId,
          tokenId: route.params.tokenId,
          principal,
        });
        break;

      case 'sites':
        response = await handleSiteRoutes(request, {
          siteId: route.params.siteId,
          principal,
        });
        break;

      case 'branches':
        response = await handleBranchRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId,
          principal,
        });
        break;

      case 'documents':
        response = await handleDocumentRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId,
          documentId: route.params.documentId,
          documentPath: route.params.documentPath,
          action: route.params.action as 'restore' | 'publish' | undefined,
          versionsPath: route.params.versionsPath === 'true',
          versionAction: route.params.versionAction as 'latest' | 'by-id' | undefined,
          versionId: route.params.versionId,
          principal,
        });

        // After a successful publish, notify the main branch DO to reload
        if (
          route.params.action === 'publish' &&
          response.status === 200 &&
          route.params.documentId !== undefined &&
          route.params.siteId !== undefined
        ) {
          try {
            const mainBranch = await getMainBranch(route.params.siteId);
            if (mainBranch !== null) {
              const sessionId = `${route.params.siteId}:${route.params.documentId}:${mainBranch.id}`;
              const doId = env.DOCUMENT_STATE.idFromName(sessionId);
              const stub = env.DOCUMENT_STATE.get(doId);
              await stub.fetch(new Request('http://internal/reload', {
                method: 'POST',
                headers: { 'X-Session-Id': sessionId },
              }));
            }
          } catch (reloadError) {
            console.error('Failed to reload DO after publish:', reloadError);
          }
        }
        break;

      case 'checkpoints':
        response = await handleCheckpointRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId,
          checkpointId: route.params.checkpointId,
          documentsPath: route.params.action === 'documents',
          revert: route.params.action === 'revert',
          principal,
        });
        break;

      case 'merge':
        response = await handleMergeRoutes(request, {
          siteId: route.params.siteId ?? '',
          operation: ['check', 'execute', 'preview', 'crdt-preview'].includes(route.params.action ?? '')
            ? (route.params.action as 'check' | 'execute' | 'preview' | 'crdt-preview')
            : undefined,
          mergeRequests: route.params.action === 'requests',
          executeRequest: route.params.action === 'execute-request',
          mergeRequestId: route.params.mergeRequestId,
          principal,
        });
        break;

      case 'grants':
        response = await handleGrantRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId ?? '',
          grantId: route.params.grantId,
          principal,
        });
        break;

      case 'admin-users':
        response = await handleUsersRoutes(request, {
          userId: route.params.userId,
          principal,
        });
        break;

      case 'collaborators':
        response = await handleCollaboratorRoutes(request, {
          siteId: route.params.siteId ?? '',
          userId: route.params.userId,
          principal,
          masClient,
        });
        break;

      case 'structures':
        response = await handleStructureRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId,
          checkpointId: route.params.checkpointId,
          structureId: route.params.structureId,
          principal,
        });
        break;

      case 'nodes':
        response = await handleNodeRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId ?? '',
          structureId: route.params.structureId ?? '',
          nodeId: route.params.nodeId,
          action: route.params.action as 'move' | 'reorder' | 'navigation' | undefined,
          principal,
        });
        break;

      case 'metadata':
        response = await handleMetadataRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId ?? '',
          structureId: route.params.structureId ?? '',
          documentId: route.params.documentId,
          action: route.params.action as 'state' | 'schema' | 'validate' | 'list' | undefined,
          principal,
        });
        break;

      case 'realtime':
        response = await handleRealtimeRoutes(request, env, {
          principal,
        }) ?? errorResponse('Not found', 404);
        break;

      case 'presence':
        response = await handlePresenceRoutes(request, {
          siteId: route.params.siteId,
          branchId: route.params.branchId,
          organizationId: route.params.organizationId,
          agentId: route.params.agentId,
          principal,
        }, env);
        break;

      default:
        response = errorResponse('Handler not implemented', 501);
    }

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
