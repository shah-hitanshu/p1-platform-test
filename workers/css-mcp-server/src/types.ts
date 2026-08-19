export interface Env {
  // Non-secret env vars
  ENVIRONMENT: string;
  CSS_BACKEND_URL: string;
  MCP_SERVER_NAME: string;
  MCP_SERVER_VERSION: string;

  // Logger config — see telemetry.ts.
  LOG_LEVEL?: string;
  APP_VERSION?: string;
  /** Local ndjson collector, e.g. `http://127.0.0.1:8799`. Unset in every deployed env. */
  P1_LOG_SINK?: string;

  /** The public-facing origin of this MCP server (e.g. https://mcp.example.com). */
  PUBLIC_ORIGIN: string;

  // Auth0 application credentials for the upstream sign-in flow.
  // AUTH0_CLIENT_SECRET is set via `wrangler secret put`; CLIENT_ID and ISSUER are vars.
  AUTH0_CLIENT_ID: string;
  AUTH0_CLIENT_SECRET: string;
  AUTH0_ISSUER_BASE_URL: string;

  /**
   * HMAC key for signing the OAuth state parameter. Set via `wrangler secret put`.
   * Local to this worker; unrelated to the backend's shared INTERNAL_SECRET.
   */
  MCP_STATE_SIGNING_SECRET?: string;

  /** Auth0 API audience; becomes the access token's `aud`, which the backend verifies. */
  AUTH0_AUDIENCE?: string;

  // KV binding (used by @cloudflare/workers-oauth-provider)
  OAUTH_KV: KVNamespace;

  // Service binding to the API worker (avoids worker-to-worker fetch 1042 errors)
  CSS_BACKEND?: Fetcher;

  // PCC-3192 — Rate Limiting bindings (red-team Finding 4). All four are
  // optional so the rate-limit wrapper can fail OPEN with a one-shot warn
  // when a binding is missing.
  RL_TOOLS_READ?: RateLimit;
  RL_TOOLS_MUTATION?: RateLimit;
  RL_TOOLS_ANON?: RateLimit;
  RL_OAUTH?: RateLimit;
}
