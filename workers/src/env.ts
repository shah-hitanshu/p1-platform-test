import type { ScreenshotQueueMessage } from './types/queue-messages';

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
  DO_ALARM_METRICS_ENABLED?: string;

  // Secrets (from .dev.vars or Vault)
  POSTGRES_CONNECTION_STRING?: string;
  FIRESTORE_PROJECT_ID: string;
  FIRESTORE_EMULATOR_HOST?: string;

  // Mock Identity Provider (local development only)
  MOCK_JWT_SECRET?: string;

  // Public-facing origin for URL generation (e.g. Auth0 callback URLs)
  PUBLIC_ORIGIN?: string;

  // Auth providers
  AUTH0_ISSUER_BASE_URL?: string;
  AUTH0_AUDIENCE?: string;
  AUTH0_CLIENT_ID?: string;
  AUTH0_CLIENT_SECRET?: string;

  // Broker JWT (RS256 via GCP Cloud KMS)
  GCP_KMS_KEY_RESOURCE?: string;
  BROKER_JWT_AUDIENCE?: string;
  BROKER_JWT_ISSUER?: string;

  // MAS (Membership Authorization Service) integration
  MAS_ENABLED?: string;
  MAS_BASE_URL?: string;
  MAS_GCP_SERVICE_ACCOUNT_KEY?: string;
  MAS_CACHE_TTL_SECONDS?: string;

  // Internal API secret for Durable Object to PostgreSQL sync
  INTERNAL_SECRET?: string;

  // KV namespace for broker login transactions
  BROKER_KV?: KVNamespace;

  // Hyperdrive bindings
  HYPERDRIVE?: Hyperdrive;
  HYPERDRIVE_NOCACHE?: Hyperdrive;

  // Queue binding (Phase 5.1: Queue-Based Sync Decoupling)
  SYNC_QUEUE?: Queue;

  // Site screenshot pipeline
  SCREENSHOT_QUEUE?: Queue<ScreenshotQueueMessage>;
  R2_SCREENSHOTS?: R2Bucket;
  R2_SCREENSHOTS_BUCKET?: string;
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_API_TOKEN?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;

  // R2 bundle storage for site export/import
  R2_BUNDLES?: R2Bucket;
  R2_BUNDLES_BUCKET?: string;

  // Durable Object bindings
  DOCUMENT_STATE: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace;
  SESSION: DurableObjectNamespace;

  // KV bindings
  CONFIG_KV: KVNamespace;
  SESSION_KV: KVNamespace;
}
