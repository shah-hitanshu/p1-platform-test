/**
 * CCR_BACKEND binding-mode cold-start log (PCC-3193 / red-team Finding 6).
 *
 * The MCP server's api-client falls back to global fetch() whenever
 * env.CCR_BACKEND is undefined, which means the shared agent API key
 * transits the public Internet to *.workers.dev. The actual fix is
 * wiring the service binding in wrangler.jsonc; this helper makes any
 * future drift visible: a missing-binding cold start emits a warn so
 * future env additions can't silently regress the trust boundary.
 *
 * Module-scoped flag → fires once per isolate (cold start), not per
 * request, so a misconfigured env doesn't spam logs.
 *
 * Extracted to its own module for the same reason as health.ts: importing
 * src/index.ts would pull in @cloudflare/workers-oauth-provider and its
 * cloudflare:-protocol deps, which doesn't load under vitest.
 */

let bindingModeLogged = false;

export function logBindingModeOnce(env: { CCR_BACKEND?: Fetcher }): void {
  if (bindingModeLogged) return;
  bindingModeLogged = true;

  if (env.CCR_BACKEND !== undefined) {
    console.log('CCR_BACKEND binding: service-binding (fetcher present)');
  } else {
    console.warn(
      'CCR_BACKEND binding: public-fetch (CCR_BACKEND fetcher MISSING ' +
      '— agent key transits public Internet)',
    );
  }
}
