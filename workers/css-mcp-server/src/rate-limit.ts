/**
 * Rate Limit wrappers (PCC-3192 / red-team Finding 4)
 *
 * Adapts the Cloudflare Rate Limiting binding (GA 2025-09-19) to two
 * patterns used by the MCP server:
 *
 * 1. checkToolRateLimit — per-tool checks scoped to BOTH (tool, actingUserId)
 *    and (tool, ip). Both must pass; either failing returns denied.
 *    Mutation tools route to a tighter limiter than read-only tools. When
 *    no actingUserId is present (rare — e.g. ctx.props missing) we fall
 *    back to a per-(tool, ip) check on the dedicated anon limiter.
 *
 * 2. checkOauthRateLimit — per-OAuth-endpoint check scoped to (path, ip).
 *    Used by /authorize, /token, /register, /callback to throttle
 *    credential-stuffing / registration flooding from a single IP.
 *
 * Failure-open: when the binding is undefined (local dev or future env
 * misconfig) the wrapper allows the request and warns ONCE per isolate.
 * Mirrors the PCC-3193 binding-mode log pattern. Drift becomes visible in
 * Workers Logs without taking the service down.
 */

export interface RateLimitContext {
  actingUserId?: string;
  clientIp: string;
}

export interface RateLimiters {
  toolsRead?: RateLimit;
  toolsMutation?: RateLimit;
  toolsAnon?: RateLimit;
  oauth?: RateLimit;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; tool: string; scope: 'user' | 'ip' };

// One-shot warn PER BINDING per isolate so a misconfigured env can't spam
// Workers Logs on every request, but a partial-misconfig (one binding
// present, another missing) still surfaces every missing binding exactly
// once. Originally a single boolean — the boolean version meant the first
// missing-binding warn silenced ALL subsequent missing-binding warns,
// hiding partial drift. Caught in pre-push review.
const warnedBindings = new Set<string>();
function warnMissingBindingOnce(binding: string): void {
  if (warnedBindings.has(binding)) return;
  warnedBindings.add(binding);
  console.warn(
    `rate-limit: binding undefined (${binding}) — failing OPEN. ` +
    'This is expected in local dev; investigate if seen in sbx1/prod.',
  );
}

// Test-only — reset the warn set so the warn-once test can be asserted
// against a fresh isolate-state.
export function resetWarnFlagForTesting(): void {
  warnedBindings.clear();
}

/**
 * Check the per-tool rate limit. Returns an allowed/denied verdict; the
 * caller (a tool handler) is responsible for translating denied into a
 * user-facing 429-equivalent.
 *
 * Key shapes (kept here so a future refactor can find them all in one place):
 *   user-scope: rl:tool:<tool>:user:<actingUserId>
 *   ip-scope:   rl:tool:<tool>:ip:<clientIp>
 *   anon-scope: rl:tool:<tool>:anon:<clientIp>
 *
 * The "rl:" prefix and the explicit ":user:" / ":ip:" / ":anon:" tags
 * disambiguate keys when the actingUserId looks like an IP (or vice
 * versa) — without them, "1.2.3.4" as a user would collide with
 * "1.2.3.4" as an IP and they'd share a counter.
 */
export async function checkToolRateLimit(
  limiters: RateLimiters,
  tool: string,
  isMutation: boolean,
  ctx: RateLimitContext,
): Promise<RateLimitResult> {
  const limiter = isMutation ? limiters.toolsMutation : limiters.toolsRead;

  // No actingUserId → fall back to the anon (ip-only) limiter.
  if (ctx.actingUserId === undefined || ctx.actingUserId === '') {
    if (!limiters.toolsAnon) {
      warnMissingBindingOnce('toolsAnon');
      return { allowed: true };
    }
    const anonResult = await limiters.toolsAnon.limit({
      key: `rl:tool:${tool}:anon:${ctx.clientIp}`,
    });
    return anonResult.success
      ? { allowed: true }
      : { allowed: false, tool, scope: 'ip' };
  }

  if (!limiter) {
    warnMissingBindingOnce(isMutation ? 'toolsMutation' : 'toolsRead');
    return { allowed: true };
  }

  // User-scope first — catches a compromised token regardless of source IP.
  const userResult = await limiter.limit({
    key: `rl:tool:${tool}:user:${ctx.actingUserId}`,
  });
  if (!userResult.success) {
    return { allowed: false, tool, scope: 'user' };
  }

  // IP-scope — catches a misconfigured client looping or a wide pool of
  // stolen tokens from one host.
  const ipResult = await limiter.limit({
    key: `rl:tool:${tool}:ip:${ctx.clientIp}`,
  });
  if (!ipResult.success) {
    return { allowed: false, tool, scope: 'ip' };
  }

  return { allowed: true };
}

/**
 * Whether a request method should bypass rate-limit checks entirely.
 *
 * OPTIONS preflight requests must NEVER be rate-limited at any of our
 * gates: a 429 returned for an OPTIONS preflight would lack the CORS
 * headers OAuthProvider sets on the main fetch path, which breaks
 * browser-based MCP clients. Preflight is cheap; the real request will
 * be rate-limited if needed.
 *
 * Exported (rather than inlined at each call-site) so all OAuth-endpoint
 * gates and any future ones share one definition.
 */
export function shouldBypassRateLimit(method: string): boolean {
  return method === 'OPTIONS';
}

/**
 * Check the per-OAuth-endpoint rate limit. Throttles a single IP
 * across /authorize, /token, /register, /callback.
 */
export async function checkOauthRateLimit(
  limiter: RateLimit | undefined,
  endpoint: string,
  clientIp: string,
): Promise<RateLimitResult> {
  if (!limiter) {
    warnMissingBindingOnce('oauth');
    return { allowed: true };
  }
  const result = await limiter.limit({
    key: `rl:oauth:${endpoint}:ip:${clientIp}`,
  });
  if (!result.success) {
    return { allowed: false, tool: endpoint, scope: 'ip' };
  }
  return { allowed: true };
}
