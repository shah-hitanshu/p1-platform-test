/**
 * Collaborative State System - Cloudflare Worker Entry Point
 *
 * This is a placeholder that will be replaced with the full implementation.
 * It exists to allow TypeScript compilation and testing to proceed.
 */

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
    return new Response('Collaborative State System - Not Yet Implemented', {
      status: 501,
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
