/**
 * Collaborative State System - Cloudflare Worker Entry Point
 *
 * Provides HTTP API for the collaborative state system.
 * Currently implements minimal infrastructure validation endpoints.
 */

import { initializeDatabaseFromConnectionString, query } from './db';

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

  // Secrets (from .dev.vars or Vault)
  POSTGRES_CONNECTION_STRING: string;
  FIRESTORE_PROJECT_ID: string;
  FIRESTORE_EMULATOR_HOST?: string;

  // Mock Identity Provider (local development only)
  MOCK_JWT_SECRET?: string;

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
 * Handle health check endpoint.
 * Validates database connectivity.
 */
async function handleHealth(env: Env): Promise<Response> {
  const health: HealthResponse = {
    status: 'healthy',
    environment: env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  };

  // Test database connection
  try {
    initializeDatabaseFromConnectionString(env.POSTGRES_CONNECTION_STRING);
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
  } catch (error) {
    health.status = 'unhealthy';
    health.database = {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  return new Response(JSON.stringify(health, null, 2), {
    status: health.status === 'healthy' ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route requests
    if (path === '/health' || path === '/health/') {
      return handleHealth(env);
    }

    // Default: not implemented
    return new Response(
      JSON.stringify({
        error: 'Not Found',
        message: `No handler for ${request.method} ${path}`,
        availableEndpoints: ['/health'],
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
};
