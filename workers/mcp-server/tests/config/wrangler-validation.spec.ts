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
interface EnvStanza {
  services?: ServiceBinding[];
  observability?: { logs?: { enabled?: boolean } };
}
interface WranglerConfig {
  main?: string;
  vars?: Record<string, unknown>;
  env?: Record<string, EnvStanza | undefined>;
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
  it('should bind production CSS_BACKEND to collaborative-state-worker-prod', () => {
    const config = parseConfig(content) as WranglerConfig;
    const services = config.env?.production?.services ?? [];
    const cssBackend = services.find((s) => s.binding === 'CSS_BACKEND');
    expect(cssBackend?.service).toBe('collaborative-state-worker-prod');
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
});
