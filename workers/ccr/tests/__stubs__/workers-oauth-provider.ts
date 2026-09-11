/**
 * Stub for @cloudflare/workers-oauth-provider in Vitest unit tests.
 *
 * The real package uses cloudflare: protocol imports (e.g. cloudflare:workers)
 * that are only available in the Cloudflare Workers runtime. This stub replaces
 * the package for Node-based unit tests so they don't fail at module load time.
 *
 * Integration tests use @cloudflare/vitest-pool-workers and load the real module.
 */

export class OAuthProvider {
  fetch(_request: Request, _env?: unknown, _ctx?: ExecutionContext): Response {
    return new Response('OAuth provider not available in unit test environment', {
      status: 503,
    });
  }
}

// Type-only exports — no runtime values needed
export type OAuthHelpers = object;
export type AuthRequest = object;
export type ClientInfo = object;
