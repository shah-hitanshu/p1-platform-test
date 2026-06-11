/**
 * Wrangler Configuration Validation Tests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Strip JSONC line + block comments (preserving comment-like contents inside
// strings) and parse. Centralised so the regex can't drift between tests.
const parseConfig = (raw: string): unknown => JSON.parse(
  raw
    .replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (_match, str) => str ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ''),
);

interface ServiceBinding { binding: string; service: string }
interface RateLimitBinding {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}
interface EnvStanza {
  services?: ServiceBinding[];
  observability?: { logs?: { enabled?: boolean } };
  ratelimits?: RateLimitBinding[];
}
interface WranglerConfig {
  main?: string;
  vars?: Record<string, unknown>;
  ratelimits?: RateLimitBinding[];
  env?: Record<string, EnvStanza | undefined>;
}

// PCC-3192: the four rate-limit bindings every deployable env must wire.
// Centralised so a typo in one assertion can't drift from the others.
const REQUIRED_RATE_LIMIT_BINDINGS = [
  'RL_TOOLS_READ',
  'RL_TOOLS_MUTATION',
  'RL_OAUTH',
  'RL_TOOLS_ANON',
] as const;

// Resolve the effective ratelimits for an env. Wrangler does NOT inherit
// top-level `ratelimits` into env stanzas the way `vars` work — bindings must
// be declared per-env. So we read whichever the env declares.
function ratelimitsFor(config: WranglerConfig, envName: 'sbx1' | 'production'): RateLimitBinding[] {
  return config.env?.[envName]?.ratelimits ?? config.ratelimits ?? [];
}

describe('Wrangler Configuration', () => {
  const wranglerPath = resolve(__dirname, '../../wrangler.jsonc');
  const content = readFileSync(wranglerPath, 'utf-8');

  // Test 67: Valid JSONC syntax
  it('should have valid JSONC syntax', () => {
    expect(() => parseConfig(content)).not.toThrow();
  });

  // Test 68: OAUTH_KV binding
  it('should configure OAUTH_KV binding', () => {
    expect(content).toContain('OAUTH_KV');
  });

  // Test 69: sbx1 environment
  it('should configure sbx1 environment', () => {
    expect(content).toContain('"sbx1"');
  });

  // Test 70: production environment
  it('should configure production environment', () => {
    expect(content).toContain('"production"');
  });

  // Test 71: Port 8788
  it('should set a different port than the main worker (8787)', () => {
    expect(content).toContain('8788');
  });

  // Test 72: Required vars
  it('should specify required vars for each environment', () => {
    const config = parseConfig(content) as WranglerConfig;
    expect(config.vars?.ENVIRONMENT).toBeDefined();
    expect(config.vars?.CSS_BACKEND_URL).toBeDefined();
    expect(config.vars?.MCP_SERVER_NAME).toBeDefined();
    expect(config.vars?.MCP_SERVER_VERSION).toBeDefined();
  });

  // Test 73: Main entry point
  it('should set main entry point to src/index.ts', () => {
    const config = parseConfig(content) as WranglerConfig;
    expect(config.main).toBe('src/index.ts');
  });

  // PCC-3193: production env must wire the CSS_BACKEND service binding so the
  // shared agent API key never leaves Cloudflare's internal worker-to-worker path.
  // Without this, api-client.ts:doFetch falls back to global fetch() over the
  // public Internet carrying X-API-Key in headers (red-team Finding 6).
  it('should declare a CSS_BACKEND service binding in the production env', () => {
    const config = parseConfig(content) as WranglerConfig;
    const services = config.env?.production?.services;
    expect(Array.isArray(services)).toBe(true);
    const cssBackend = services?.find((s) => s.binding === 'CSS_BACKEND');
    expect(cssBackend).toBeDefined();
  });

  // PCC-3193: pin the actual prod backend worker name so a typo or rename
  // can't silently route the binding to the wrong worker (or to nothing).
  it('should bind production CSS_BACKEND to collaborative-state-worker-production', () => {
    const config = parseConfig(content) as WranglerConfig;
    const services = config.env?.production?.services ?? [];
    const cssBackend = services.find((s) => s.binding === 'CSS_BACKEND');
    expect(cssBackend?.service).toBe('collaborative-state-worker-production');
  });

  // PCC-3193: regression guard — sbx1 already wires this binding (the only env
  // that ever did pre-fix). If someone removes it under the assumption "we have
  // the binding everywhere now", sbx1 silently regresses to public-fetch.
  it('should retain the CSS_BACKEND service binding in the sbx1 env', () => {
    const config = parseConfig(content) as WranglerConfig;
    const services = config.env?.sbx1?.services ?? [];
    const cssBackend = services.find((s) => s.binding === 'CSS_BACKEND');
    expect(cssBackend?.service).toBe('collaborative-state-worker-sbx1');
  });

  // PCC-3193 (observability follow-up): the binding-mode cold-start log added
  // alongside the prod-binding fix is only useful if it shows up somewhere
  // queryable. Without observability.logs enabled, the warn is only visible
  // via reactive `wrangler tail` — defeating the "future drift is visible"
  // intent. Both deployable envs must have it on.
  for (const envName of ['sbx1', 'production'] as const) {
    it(`should enable Workers Logs observability in the ${envName} env`, () => {
      const config = parseConfig(content) as WranglerConfig;
      const obs = config.env?.[envName]?.observability;
      expect(obs?.logs?.enabled).toBe(true);
    });
  }

  // =====================================================================
  // PCC-3192 — Rate Limiting bindings (red-team Finding 4)
  //
  // The MCP server has 4 OAuth endpoints and 13 tool handlers that are
  // entirely unprotected today. Without the rate-limit bindings declared,
  // src/rate-limit.ts fails OPEN (drift visible in Workers Logs but no
  // protection in effect). These tests pin the bindings so a future env
  // edit can't silently drop them.
  // =====================================================================
  for (const envName of ['sbx1', 'production'] as const) {
    it(`declares all 4 PCC-3192 rate-limit bindings in the ${envName} env`, () => {
      const config = parseConfig(content) as WranglerConfig;
      const rateLimits = ratelimitsFor(config, envName);
      const names = rateLimits.map((rl) => rl.name);
      for (const required of REQUIRED_RATE_LIMIT_BINDINGS) {
        expect(names).toContain(required);
      }
    });

    it(`uses unique namespace_id for each rate-limit binding in the ${envName} env`, () => {
      const config = parseConfig(content) as WranglerConfig;
      const rateLimits = ratelimitsFor(config, envName);
      const namespaceIds = rateLimits
        .filter((rl) => (REQUIRED_RATE_LIMIT_BINDINGS as readonly string[]).includes(rl.name))
        .map((rl) => rl.namespace_id);
      const unique = new Set(namespaceIds);
      // Shared namespace_id means two limiters share counters — that would
      // let an OAuth-endpoint flood eat into the per-tool budget, etc.
      expect(unique.size).toBe(namespaceIds.length);
    });

    it(`uses period=60 and a positive integer limit for each rate-limit binding in ${envName}`, () => {
      const config = parseConfig(content) as WranglerConfig;
      const rateLimits = ratelimitsFor(config, envName);
      for (const required of REQUIRED_RATE_LIMIT_BINDINGS) {
        const binding = rateLimits.find((rl) => rl.name === required);
        expect(binding, `missing ${required}`).toBeDefined();
        // Cloudflare Rate Limiting binding only supports period=10 or 60.
        // We standardise on 60 because per-minute matches the human-readable
        // intent in the plan (read=120/min, mutation=30/min, etc.).
        expect(binding?.simple.period).toBe(60);
        expect(binding?.simple.limit).toBeGreaterThan(0);
        expect(Number.isInteger(binding?.simple.limit)).toBe(true);
      }
    });

    it(`mutation limiter is tighter than read limiter in ${envName}`, () => {
      // The whole point of two separate limiters is that mutations cost more
      // than reads. If they ever drift to the same number, replace one with
      // the other in code — don't keep two for the sake of two.
      // Also assert both limits are non-zero — `0 < 0` is false but `mutation
      // < read` would silently pass for `mutation=0, read=0` if we didn't
      // pin both to positive ints (caught in pre-merge review).
      const config = parseConfig(content) as WranglerConfig;
      const rateLimits = ratelimitsFor(config, envName);
      const read = rateLimits.find((rl) => rl.name === 'RL_TOOLS_READ');
      const mutation = rateLimits.find((rl) => rl.name === 'RL_TOOLS_MUTATION');
      expect(read).toBeDefined();
      expect(mutation).toBeDefined();
      expect(read?.simple.limit).toBeGreaterThan(0);
      expect(mutation?.simple.limit).toBeGreaterThan(0);
      expect(mutation?.simple.limit).toBeLessThan(read?.simple.limit ?? Infinity);
    });
  }

  // PCC-3192 (pre-merge review): Cloudflare's Rate Limiting namespaces are
  // ACCOUNT-scoped, so any two bindings sharing a namespace_id share the
  // same counters even across different workers and envs. If we ever
  // copy-pasted a stanza wholesale and forgot to bump the namespace_ids,
  // a CI load-test against sbx1 from a runner IP would burn the prod
  // OAuth bucket for that same IP. This test catches that regression by
  // pulling EVERY namespace_id from EVERY env stanza (top-level, sbx1,
  // production) and asserting the three sets are pairwise disjoint.
  it('env stanzas use disjoint namespace_id sets across dev / sbx1 / production', () => {
    const config = parseConfig(content) as WranglerConfig;
    const dev = new Set((config.ratelimits ?? []).map((rl) => rl.namespace_id));
    const sbx1 = new Set((config.env?.sbx1?.ratelimits ?? []).map((rl) => rl.namespace_id));
    const prod = new Set((config.env?.production?.ratelimits ?? []).map((rl) => rl.namespace_id));

    expect(dev.size).toBeGreaterThan(0);
    expect(sbx1.size).toBeGreaterThan(0);
    expect(prod.size).toBeGreaterThan(0);

    const intersect = (a: Set<string>, b: Set<string>): string[] =>
      [...a].filter((x) => b.has(x));

    expect(intersect(dev, sbx1)).toEqual([]);
    expect(intersect(dev, prod)).toEqual([]);
    expect(intersect(sbx1, prod)).toEqual([]);
  });
});
