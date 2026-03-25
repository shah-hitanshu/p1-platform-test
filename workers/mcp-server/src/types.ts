export interface Env {
  // Non-secret env vars
  ENVIRONMENT: string;
  CSS_BACKEND_URL: string;
  MCP_SERVER_NAME: string;
  MCP_SERVER_VERSION: string;

  // Secrets
  AGENT_API_KEY: string;
  AGENT_ID: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;

  // KV binding (used by @cloudflare/workers-oauth-provider)
  OAUTH_KV: KVNamespace;

  // Service binding to the API worker (avoids worker-to-worker fetch 1042 errors)
  CSS_BACKEND?: Fetcher;
}
