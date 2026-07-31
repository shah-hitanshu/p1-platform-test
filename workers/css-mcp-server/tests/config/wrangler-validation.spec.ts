/**
 * Wrangler Configuration Invariants
 *
 * Asserts cross-cutting properties the config does not state in one place:
 * rate-limit namespace_ids are unique within an env and disjoint across envs,
 * and the mutation limiter is tighter than the read limiter.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Strip JSONC line + block comments (preserving comment-like contents inside
// strings) and parse.
const parseConfig = (raw: string): unknown => JSON.parse(
  raw
    .replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (_match, str) => str ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ''),
);

interface RateLimitBinding {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}
interface EnvStanza { ratelimits?: RateLimitBinding[] }
interface WranglerConfig {
  ratelimits?: RateLimitBinding[];
  env?: Record<string, EnvStanza | undefined>;
}

const REQUIRED_RATE_LIMIT_BINDINGS = [
  'RL_TOOLS_READ',
  'RL_TOOLS_MUTATION',
  'RL_OAUTH',
  'RL_TOOLS_ANON',
] as const;

const DEPLOYABLE_ENVS = ['staging', 'production'] as const;

describe('Wrangler Configuration', () => {
  const wranglerPath = resolve(__dirname, '../../wrangler.jsonc');
  const content = readFileSync(wranglerPath, 'utf-8');

  it('is valid JSONC', () => {
    expect(() => parseConfig(content)).not.toThrow();
  });

  for (const envName of DEPLOYABLE_ENVS) {
    it(`gives every rate-limit binding a unique namespace_id in the ${envName} env`, () => {
      const config = parseConfig(content) as WranglerConfig;
      const ids = (config.env?.[envName]?.ratelimits ?? [])
        .filter((rl) => (REQUIRED_RATE_LIMIT_BINDINGS as readonly string[]).includes(rl.name))
        .map((rl) => rl.namespace_id);
      expect(ids).toHaveLength(REQUIRED_RATE_LIMIT_BINDINGS.length);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`keeps the mutation limiter tighter than the read limiter in the ${envName} env`, () => {
      const config = parseConfig(content) as WranglerConfig;
      const rateLimits = config.env?.[envName]?.ratelimits ?? [];
      const read = rateLimits.find((rl) => rl.name === 'RL_TOOLS_READ');
      const mutation = rateLimits.find((rl) => rl.name === 'RL_TOOLS_MUTATION');
      expect(read?.simple.limit).toBeGreaterThan(0);
      expect(mutation?.simple.limit).toBeGreaterThan(0);
      expect(mutation?.simple.limit).toBeLessThan(read?.simple.limit ?? Infinity);
    });
  }

  // Cloudflare rate-limit namespaces are account-scoped, so any two bindings
  // sharing a namespace_id share counters across workers and envs. Every id in
  // the file must be unique or one env's traffic burns another's budget.
  it('uses disjoint namespace_id sets across every env', () => {
    const config = parseConfig(content) as WranglerConfig;
    const idsFor = (rls: RateLimitBinding[] | undefined): string[] =>
      (rls ?? []).map((rl) => rl.namespace_id);
    const all = [
      ...idsFor(config.ratelimits),
      ...DEPLOYABLE_ENVS.flatMap((e) => idsFor(config.env?.[e]?.ratelimits)),
    ];
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length);
  });
});
