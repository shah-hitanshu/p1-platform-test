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

  // PCC-3192 — Rate Limiting bindings (red-team Finding 4). All four are
  // optional so the rate-limit wrapper can fail OPEN with a one-shot warn
  // when a binding is missing — mirrors the PCC-3193 binding-mode pattern.
  // Drift becomes visible in Workers Logs without taking the service down.
  RL_TOOLS_READ?: RateLimit;
  RL_TOOLS_MUTATION?: RateLimit;
  RL_TOOLS_ANON?: RateLimit;
  RL_OAUTH?: RateLimit;
}
