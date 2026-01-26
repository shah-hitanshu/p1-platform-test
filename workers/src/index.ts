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
import type { AuthenticatedPrincipal, MockIdentityConfig } from './types';

// Route handlers
import { handleSiteRoutes } from './routes/site-api';
import { handleBranchRoutes } from './routes/branch-api';
import { handleDocumentRoutes } from './routes/document-api';
import { handleCheckpointRoutes } from './routes/checkpoint-api';
import { handleMergeRoutes } from './routes/merge-api';
import { handleGrantRoutes } from './routes/grant-api';
import { handleStructureRoutes } from './routes/structure-api';
import { handleNodeRoutes } from './routes/node-api';
import { handleMetadataRoutes } from './routes/metadata-api';
import { handleRealtimeRoutes } from './routes/realtime-api';
import { handleInternalRoutes } from './routes/internal-api';

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

  // Secrets (from .dev.vars or Vault)
  POSTGRES_CONNECTION_STRING?: string; // Fallback for local dev without Hyperdrive
  FIRESTORE_PROJECT_ID: string;
  FIRESTORE_EMULATOR_HOST?: string;

  // Mock Identity Provider (local development only)
  MOCK_JWT_SECRET?: string;

  // Internal API secret for Durable Object to PostgreSQL sync
  INTERNAL_SECRET?: string;

  // Hyperdrive binding (production/staging - handles connection pooling properly)
  // See: https://developers.cloudflare.com/hyperdrive/
  HYPERDRIVE?: Hyperdrive;

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
 * Principal context passed to route handlers.
 */
interface Principal {
  id: string;
  type: 'user' | 'agent';
  email?: string;
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
      siteRoles: { 'site-123': 'admin', 'site-456': 'developer' },
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'bob@example.com',
      name: 'Bob Reviewer',
      siteRoles: { 'site-123': 'team_member' },
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'carol@example.com',
      name: 'Carol Editor',
      siteRoles: { 'site-123': 'developer', 'site-456': 'admin' },
    },
  ],
  agents: [
    {
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Zappy AI Assistant',
      apiKey: 'test-agent-key-zappy',
      siteRoles: { 'site-123': 'editor' },
    },
    {
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Helper Bot',
      apiKey: 'test-agent-key-helper',
      siteRoles: { 'site-123': 'viewer', 'site-456': 'editor' },
    },
  ],
};

/**
 * Get or create the MockIdentityProvider instance.
 */
function getIdentityProvider(env: Env): MockIdentityProvider {
  return new MockIdentityProvider({
    config: DEFAULT_MOCK_CONFIG,
    jwtSecret: env.MOCK_JWT_SECRET ?? 'development-secret-must-be-at-least-32-characters',
    tokenExpiry: '24h',
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

/**
 * Check if origin is allowed for CORS.
 */
function isOriginAllowed(origin: string | null, corsOrigins: string): boolean {
  if (origin === null || origin === '') return false;
  const allowedOrigins = corsOrigins.split(',').map((o) => o.trim());
  return allowedOrigins.includes(origin) || allowedOrigins.includes('*');
}

/**
 * Add CORS headers to response based on request origin.
 */
function addCorsHeaders(
  response: Response,
  origin: string | null,
  env: Env,
): Response {
  // WebSocket upgrade responses cannot be modified
  // Return them as-is since CORS doesn't apply to WebSocket connections
  // Note: Cloudflare Workers Response has a webSocket property for WebSocket upgrades
  if ('webSocket' in response && (response as { webSocket: unknown }).webSocket != null) {
    return response;
  }

  if (origin === null || origin === '' || !isOriginAllowed(origin, env.CORS_ORIGINS)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Principal-Id, X-Principal-Type');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Handle CORS preflight requests.
 */
function handlePreflight(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin');

  if (origin === null || origin === '' || !isOriginAllowed(origin, env.CORS_ORIGINS)) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Principal-Id, X-Principal-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
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
    return await identityProvider.validateAgentKey(apiKey);
  }

  // Try API key from query params (for WebSocket - browsers can't send custom headers)
  const url = new URL(request.url);
  const queryApiKey = url.searchParams.get('apiKey');
  if (queryApiKey !== null && queryApiKey !== '') {
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
 * Handle mock auth endpoints for frontend login (development only).
 */
async function handleAuthRoutes(
  request: Request,
  path: string,
  env: Env,
): Promise<Response | null> {
  const identityProvider = getIdentityProvider(env);

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
      const user = identityProvider.getUser(body.userId);
      if (user === undefined) {
        return errorResponse('User not found', 404);
      }
      const token = await identityProvider.issueToken(body.userId);
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
  mergeRequestId?: string;
  action?: string;
  versionsPath?: string;
  versionAction?: string;
  versionId?: string;
}

function parseRoute(path: string): { handler: string; params: RouteParams } | null {
  // Remove trailing slash
  const normalizedPath = path.replace(/\/$/, '');

  // Auth routes (no authentication required)
  if (normalizedPath.startsWith('/api/auth')) {
    return { handler: 'auth', params: {} };
  }

  // Site routes
  const siteMatch = /^\/api\/sites(?:\/([^/]+))?$/.exec(normalizedPath);
  if (siteMatch) {
    return {
      handler: 'sites',
      params: { siteId: siteMatch[1] },
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
  // /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}[/edits|/connect]
  // Note: These routes handle WebSocket connections and real-time document access
  const realtimeRe = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents\/(.+?)\/(edits|connect)$/;
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
  // /api/sites/{siteId}/branches/{branchId}/documents/{documentId}?
  const branchDocMatch = /^\/api\/sites\/([^/]+)\/branches\/([^/]+)\/documents(?:\/([^/]+))?$/.exec(normalizedPath);
  if (branchDocMatch) {
    return {
      handler: 'documents',
      params: {
        siteId: branchDocMatch[1],
        branchId: branchDocMatch[2],
        documentId: branchDocMatch[3],
      },
    };
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
  const mergeOpMatch = /^\/api\/sites\/([^/]+)\/merge\/(check|execute|preview)$/.exec(normalizedPath);
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
    let connectionString: string;
    let isHyperdrive = false;

    if (env.HYPERDRIVE !== undefined) {
      connectionString = env.HYPERDRIVE.connectionString;
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

  // Auth endpoints (no auth required)
  if (path.startsWith('/api/auth')) {
    const response = await handleAuthRoutes(request, path, env);
    if (response) {
      return addCorsHeaders(response, origin, env);
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
          availableEndpoints: ['/health', '/api/sites', '/api/auth/users', '/api/auth/token'],
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

  // Create principal context for route handlers
  const principalContext: Principal = {
    id: principal.id,
    type: principal.type as 'user' | 'agent',
    email: principal.email,
  };

  try {
    let response: Response;

    switch (route.handler) {
      case 'sites':
        response = await handleSiteRoutes(request, {
          siteId: route.params.siteId,
          principal: principalContext,
        });
        break;

      case 'branches':
        response = await handleBranchRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId,
          principal: principalContext,
        });
        break;

      case 'documents':
        response = await handleDocumentRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId,
          documentId: route.params.documentId,
          documentPath: route.params.documentPath,
          action: route.params.action as 'restore' | undefined,
          versionsPath: route.params.versionsPath === 'true',
          versionAction: route.params.versionAction as 'latest' | 'by-id' | undefined,
          versionId: route.params.versionId,
          principal: principalContext,
        });
        break;

      case 'checkpoints':
        response = await handleCheckpointRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId,
          checkpointId: route.params.checkpointId,
          documentsPath: route.params.action === 'documents',
          revert: route.params.action === 'revert',
          principal: principalContext,
        });
        break;

      case 'merge':
        response = await handleMergeRoutes(request, {
          siteId: route.params.siteId ?? '',
          operation: ['check', 'execute', 'preview'].includes(route.params.action ?? '')
            ? (route.params.action as 'check' | 'execute' | 'preview')
            : undefined,
          mergeRequests: route.params.action === 'requests',
          executeRequest: route.params.action === 'execute-request',
          mergeRequestId: route.params.mergeRequestId,
          principal: principalContext,
        });
        break;

      case 'grants':
        response = await handleGrantRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId ?? '',
          grantId: route.params.grantId,
          principal: principalContext,
        });
        break;

      case 'structures':
        response = await handleStructureRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId,
          checkpointId: route.params.checkpointId,
          structureId: route.params.structureId,
          principal: principalContext,
        });
        break;

      case 'nodes':
        response = await handleNodeRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId ?? '',
          structureId: route.params.structureId ?? '',
          nodeId: route.params.nodeId,
          action: route.params.action as 'move' | 'reorder' | 'navigation' | undefined,
          principal: principalContext,
        });
        break;

      case 'metadata':
        response = await handleMetadataRoutes(request, {
          siteId: route.params.siteId ?? '',
          branchId: route.params.branchId ?? '',
          structureId: route.params.structureId ?? '',
          documentId: route.params.documentId,
          action: route.params.action as 'state' | 'schema' | 'validate' | 'list' | undefined,
          principal: principalContext,
        });
        break;

      case 'realtime':
        response = await handleRealtimeRoutes(request, env) ?? errorResponse('Not found', 404);
        break;

      default:
        response = errorResponse('Handler not implemented', 501);
    }

    return addCorsHeaders(response, origin, env);
  } catch (error) {
    console.error('Request handler error:', error);
    return addCorsHeaders(
      errorResponse('Internal server error', 500),
      origin,
      env,
    );
  }
}
