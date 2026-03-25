/**
 * Wrangler Configuration Validation Tests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Wrangler Configuration', () => {
  const wranglerPath = resolve(__dirname, '../../wrangler.jsonc');
  const content = readFileSync(wranglerPath, 'utf-8');

  // Test 67: Valid JSONC syntax
  it('should have valid JSONC syntax', () => {
    const stripped = content.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (match, str) => str ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(() => JSON.parse(stripped)).not.toThrow();
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
    const stripped = content.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (match, str) => str ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const config = JSON.parse(stripped);
    expect(config.vars.ENVIRONMENT).toBeDefined();
    expect(config.vars.CSS_BACKEND_URL).toBeDefined();
    expect(config.vars.MCP_SERVER_NAME).toBeDefined();
    expect(config.vars.MCP_SERVER_VERSION).toBeDefined();
  });

  // Test 73: Main entry point
  it('should set main entry point to src/index.ts', () => {
    const stripped = content.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (match, str) => str ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const config = JSON.parse(stripped);
    expect(config.main).toBe('src/index.ts');
  });
});
