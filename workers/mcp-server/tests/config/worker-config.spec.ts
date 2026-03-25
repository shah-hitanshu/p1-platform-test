/**
 * Worker Config Validation Tests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Worker Config', () => {
  // Test 85: Env type includes all required secret bindings
  it('should declare all required secrets in Env type', () => {
    const typesPath = resolve(__dirname, '../../src/types.ts');
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).toContain('AGENT_API_KEY');
    expect(content).toContain('AGENT_ID');
    expect(content).toContain('GOOGLE_CLIENT_ID');
    expect(content).toContain('GOOGLE_CLIENT_SECRET');
    expect(content).toContain('COOKIE_ENCRYPTION_KEY');
  });

  // Test 86: Env type includes OAUTH_KV binding
  it('should declare OAUTH_KV KV namespace binding', () => {
    const typesPath = resolve(__dirname, '../../src/types.ts');
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).toContain('OAUTH_KV: KVNamespace');
  });

  // Test 87: .dev.vars.example documents all secrets
  it('should document all required secrets in .dev.vars.example', () => {
    const devVarsPath = resolve(__dirname, '../../.dev.vars.example');
    const content = readFileSync(devVarsPath, 'utf-8');
    expect(content).toContain('AGENT_API_KEY');
    expect(content).toContain('AGENT_ID');
    expect(content).toContain('GOOGLE_CLIENT_ID');
    expect(content).toContain('GOOGLE_CLIENT_SECRET');
    expect(content).toContain('COOKIE_ENCRYPTION_KEY');
  });
});
