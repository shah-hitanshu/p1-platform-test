export interface Env {
  // Non-secret env vars
  ENVIRONMENT: string;

  // Secrets (from .dev.vars or Cloudflare secrets)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  INTERNAL_SECRET: string;        // Shared with main CSS worker for service calls
  COOKIE_ENCRYPTION_KEY: string;

  // KV binding (used by @cloudflare/workers-oauth-provider for token storage)
  OAUTH_KV: KVNamespace;

  // Service binding to the main CSS worker (for site-auth-config lookups)
  // Optional for local development — wrangler dev supports service bindings locally
  // but the binding must be declared in wrangler.jsonc under the dev section.
  CSS_BACKEND?: Fetcher;
}
