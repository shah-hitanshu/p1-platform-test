/**
 * Rate Limit Tests (PCC-3192 / red-team Finding 4)
 *
 * The MCP server has 13 tool handlers and 4 OAuth endpoints (/authorize,
 * /token, /register, /callback) that are completely unprotected today. A
 * single misbehaving agent or compromised token can flood the backend,
 * exhausting Hyperdrive connections (already known sensitivity per
 * docs/handoff-sbx1-500-errors.md).
 *
 * The wrappers in src/rate-limit.ts adapt the Cloudflare Rate Limiting binding
 * (GA 2025-09-19) to two patterns:
 *   - Per-tool checks: keyed by (tool, actingUserId) AND (tool, ip), both must
 *     pass. Mutation tools route to a tighter limiter than read-only tools.
 *   - Per-OAuth-endpoint checks: keyed by (path, ip).
 *
 * Failure-open: when the binding is undefined (local dev, misconfigured env)
 * the wrapper allows the request and warns. Mirrors the PCC-3193
 * binding-mode log pattern. Drift is visible in Workers Logs without taking
 * the service down.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub the Cloudflare RateLimit binding interface. Tests control success/fail
// per-call by pushing values into the queue.
interface StubLimiter {
  binding: { limit: (args: { key: string }) => Promise<{ success: boolean }> };
  calls: { key: string }[];
  enqueue: (success: boolean) => void;
}

function createStubLimiter(): StubLimiter {
  const calls: { key: string }[] = [];
  const queue: boolean[] = [];
  return {
    calls,
    enqueue: (success: boolean): void => { queue.push(success); },
    binding: {
      limit: (args: { key: string }): Promise<{ success: boolean }> => {
        calls.push(args);
        const success = queue.length > 0 ? queue.shift() : true;
        return Promise.resolve({ success: success ?? true });
      },
    },
  };
}

describe('checkToolRateLimit', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows when both user-scope and ip-scope pass (read tool)', async () => {
    const { checkToolRateLimit } = await import('../src/rate-limit.js');
    const read = createStubLimiter();
    const mutation = createStubLimiter();

    read.enqueue(true); // user-scope
    read.enqueue(true); // ip-scope

    const result = await checkToolRateLimit(
      { toolsRead: read.binding, toolsMutation: mutation.binding },
      'list_sites',
      false,
      { actingUserId: 'user-123', clientIp: '203.0.113.10' },
    );

    expect(result.allowed).toBe(true);
    expect(read.calls).toHaveLength(2);
    expect(read.calls[0].key).toContain('list_sites');
    expect(read.calls[0].key).toContain('user-123');
    expect(read.calls[1].key).toContain('list_sites');
    expect(read.calls[1].key).toContain('203.0.113.10');
    // Read tools must NOT consult the mutation limiter
    expect(mutation.calls).toHaveLength(0);
  });

  it('denies with scope=user when user-scope limit is exceeded', async () => {
    const { checkToolRateLimit } = await import('../src/rate-limit.js');
    const read = createStubLimiter();

    read.enqueue(false); // user-scope fails
    // ip-scope queue value irrelevant — implementation may short-circuit

    const result = await checkToolRateLimit(
      { toolsRead: read.binding },
      'list_sites',
      false,
      { actingUserId: 'user-123', clientIp: '203.0.113.10' },
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.scope).toBe('user');
      expect(result.tool).toBe('list_sites');
    }
  });

  it('denies with scope=ip when ip-scope limit is exceeded but user is OK', async () => {
    const { checkToolRateLimit } = await import('../src/rate-limit.js');
    const read = createStubLimiter();

    read.enqueue(true);  // user-scope passes
    read.enqueue(false); // ip-scope fails

    const result = await checkToolRateLimit(
      { toolsRead: read.binding },
      'list_sites',
      false,
      { actingUserId: 'user-123', clientIp: '203.0.113.10' },
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.scope).toBe('ip');
    }
  });

  it('routes mutation tools to the mutation limiter, not the read limiter', async () => {
    const { checkToolRateLimit } = await import('../src/rate-limit.js');
    const read = createStubLimiter();
    const mutation = createStubLimiter();

    mutation.enqueue(true);
    mutation.enqueue(true);

    const result = await checkToolRateLimit(
      {
        toolsRead: read.binding,
        toolsMutation: mutation.binding,
      },
      'apply_document_edits',
      true,
      { actingUserId: 'user-123', clientIp: '203.0.113.10' },
    );

    expect(result.allowed).toBe(true);
    expect(mutation.calls).toHaveLength(2);
    expect(read.calls).toHaveLength(0);
  });

  it('falls back to anon limiter (ip-only) when actingUserId is missing', async () => {
    const { checkToolRateLimit } = await import('../src/rate-limit.js');
    const read = createStubLimiter();
    const anon = createStubLimiter();

    anon.enqueue(true);

    const result = await checkToolRateLimit(
      {
        toolsRead: read.binding,
        toolsAnon: anon.binding,
      },
      'list_sites',
      false,
      { clientIp: '203.0.113.10' },
    );

    expect(result.allowed).toBe(true);
    // Without an actingUserId we can't do user-scope; only ip-scope on anon
    expect(anon.calls).toHaveLength(1);
    expect(anon.calls[0].key).toContain('203.0.113.10');
    expect(anon.calls[0].key).toContain('list_sites');
    // Read limiter not consulted at all in the anon path
    expect(read.calls).toHaveLength(0);
  });

  it('failure-open + warn when the relevant limiter binding is undefined', async () => {
    const { checkToolRateLimit } = await import('../src/rate-limit.js');

    const result = await checkToolRateLimit(
      {}, // no bindings at all (local dev / misconfigured env)
      'list_sites',
      false,
      { actingUserId: 'user-123', clientIp: '203.0.113.10' },
    );

    expect(result.allowed).toBe(true);
    // Surface the drift in Workers Logs
    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('rate-limit');
  });

  it('one-shot PER BINDING per isolate: same missing binding warns once, ' +
     'distinct missing bindings each warn once', async () => {
    const { checkToolRateLimit, checkOauthRateLimit } = await import('../src/rate-limit.js');

    // First three calls all funnel into the toolsAnon path (no actingUserId),
    // so the "toolsAnon" binding is the one missing each time → ONE warn.
    await checkToolRateLimit({}, 'list_sites', false, { clientIp: '1.2.3.4' });
    await checkToolRateLimit({}, 'get_document', false, { clientIp: '1.2.3.4' });
    await checkToolRateLimit({}, 'create_page', true, { clientIp: '1.2.3.4' });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // A call with an actingUserId for a READ tool exercises the toolsRead
    // path → distinct missing binding → SECOND warn fires.
    await checkToolRateLimit(
      {},
      'list_sites',
      false,
      { actingUserId: 'user-1', clientIp: '1.2.3.4' },
    );
    expect(warnSpy).toHaveBeenCalledTimes(2);

    // A mutation tool with actingUserId hits toolsMutation → THIRD warn.
    await checkToolRateLimit(
      {},
      'apply_document_edits',
      true,
      { actingUserId: 'user-1', clientIp: '1.2.3.4' },
    );
    expect(warnSpy).toHaveBeenCalledTimes(3);

    // OAuth limiter is yet another distinct binding → FOURTH warn.
    await checkOauthRateLimit(undefined, '/token', '1.2.3.4');
    expect(warnSpy).toHaveBeenCalledTimes(4);

    // Repeating any of the above does NOT add a warn (one-shot per binding).
    await checkToolRateLimit({}, 'list_sites', false, { clientIp: '1.2.3.4' });
    await checkOauthRateLimit(undefined, '/token', '1.2.3.4');
    expect(warnSpy).toHaveBeenCalledTimes(4);
  });

  it('uses different scope-key prefixes for user vs ip so a high-volume ' +
     'request from one user does not exhaust the ip bucket of another', async () => {
    // Regression guard for the cross-scope key shape: user-scope keys must
    // be unambiguous from ip-scope keys (otherwise a user with the same
    // string as an IP would collide).
    const { checkToolRateLimit } = await import('../src/rate-limit.js');
    const read = createStubLimiter();

    read.enqueue(true);
    read.enqueue(true);

    await checkToolRateLimit(
      { toolsRead: read.binding },
      'list_sites',
      false,
      { actingUserId: '1.2.3.4', clientIp: '1.2.3.4' },
    );

    expect(read.calls).toHaveLength(2);
    expect(read.calls[0].key).not.toBe(read.calls[1].key);
  });
});

describe('shouldBypassRateLimit', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // OPTIONS preflight must NEVER be rate-limited at any of our gates: a
  // 429 returned for an OPTIONS preflight would lack the CORS headers
  // OAuthProvider sets on the main fetch path, breaking browser-based
  // MCP clients. This contract is exercised by every OAuth endpoint guard
  // in src/index.ts.
  it('returns true only for OPTIONS preflight', async () => {
    const { shouldBypassRateLimit } = await import('../src/rate-limit.js');
    expect(shouldBypassRateLimit('OPTIONS')).toBe(true);
    expect(shouldBypassRateLimit('GET')).toBe(false);
    expect(shouldBypassRateLimit('POST')).toBe(false);
    expect(shouldBypassRateLimit('PUT')).toBe(false);
    expect(shouldBypassRateLimit('DELETE')).toBe(false);
    expect(shouldBypassRateLimit('PATCH')).toBe(false);
    expect(shouldBypassRateLimit('HEAD')).toBe(false);
  });
});

describe('checkOauthRateLimit', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes when under the limit', async () => {
    const { checkOauthRateLimit } = await import('../src/rate-limit.js');
    const oauth = createStubLimiter();
    oauth.enqueue(true);

    const result = await checkOauthRateLimit(
      oauth.binding,
      '/token',
      '203.0.113.99',
    );

    expect(result.allowed).toBe(true);
    expect(oauth.calls).toHaveLength(1);
    expect(oauth.calls[0].key).toContain('/token');
    expect(oauth.calls[0].key).toContain('203.0.113.99');
  });

  it('denies when over the limit', async () => {
    const { checkOauthRateLimit } = await import('../src/rate-limit.js');
    const oauth = createStubLimiter();
    oauth.enqueue(false);

    const result = await checkOauthRateLimit(
      oauth.binding,
      '/register',
      '203.0.113.99',
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.scope).toBe('ip');
    }
  });

  it('failure-open + warn when binding is undefined', async () => {
    const { checkOauthRateLimit } = await import('../src/rate-limit.js');

    const result = await checkOauthRateLimit(undefined, '/authorize', '203.0.113.99');

    expect(result.allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });
});
