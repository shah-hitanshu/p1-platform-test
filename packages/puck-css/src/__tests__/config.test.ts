/**
 * Tests for createCSSConfig()
 *
 * Validates environment variable parsing, prefix handling,
 * type coercion, and override behavior.
 */
import { describe, it, expect } from 'vitest';
import { createCSSConfig } from '../config';
import type { CSSConfig } from '../config';

describe('createCSSConfig', () => {
  const validEnv: Record<string, string> = {
    CSS_BASE_URL: 'http://localhost:8787',
    CSS_SITE_ID: 'test-site',
    CSS_AUTH_MODE: 'mock',
  };

  it('returns valid CSSConfig with all required fields from env', () => {
    const config: CSSConfig = createCSSConfig(validEnv);

    expect(config.baseUrl).toBe('http://localhost:8787');
    expect(config.siteId).toBe('test-site');
    expect(config.authMode).toBe('mock');
  });

  it('throws when CSS_BASE_URL is missing', () => {
    const env = { ...validEnv };
    delete env.CSS_BASE_URL;

    expect(() => createCSSConfig(env)).toThrow(/CSS_BASE_URL/);
  });

  it('throws when CSS_SITE_ID is missing', () => {
    const env = { ...validEnv };
    delete env.CSS_SITE_ID;

    expect(() => createCSSConfig(env)).toThrow(/CSS_SITE_ID/);
  });

  it('throws when CSS_AUTH_MODE is missing', () => {
    const env = { ...validEnv };
    delete env.CSS_AUTH_MODE;

    expect(() => createCSSConfig(env)).toThrow(/CSS_AUTH_MODE/);
  });

  it('applies prefix when extracting env vars', () => {
    const env: Record<string, string> = {
      VITE_CSS_BASE_URL: 'http://vite.localhost:8787',
      VITE_CSS_SITE_ID: 'vite-site',
      VITE_CSS_AUTH_MODE: 'google',
    };

    const config = createCSSConfig(env, { prefix: 'VITE_' });

    expect(config.baseUrl).toBe('http://vite.localhost:8787');
    expect(config.siteId).toBe('vite-site');
    expect(config.authMode).toBe('google');
  });

  it('overrides win over env values', () => {
    const config = createCSSConfig(validEnv, {
      overrides: {
        baseUrl: 'http://override.example.com',
        siteId: 'override-site',
      },
    });

    expect(config.baseUrl).toBe('http://override.example.com');
    expect(config.siteId).toBe('override-site');
    // authMode should still come from env
    expect(config.authMode).toBe('mock');
  });

  it('parses boolean values: "true" becomes true, "false" becomes false', () => {
    const env: Record<string, string> = {
      ...validEnv,
      CSS_ENABLE_REALTIME: 'true',
      CSS_ENABLE_PRESENCE: 'false',
    };

    const config = createCSSConfig(env);

    expect(config.enableRealtime).toBe(true);
    expect(config.enablePresence).toBe(false);
  });

  it('parses numeric values for autoSaveDelay and maxRetries', () => {
    const env: Record<string, string> = {
      ...validEnv,
      CSS_AUTO_SAVE_DELAY: '5000',
      CSS_MAX_RETRIES: '10',
    };

    const config = createCSSConfig(env);

    expect(config.autoSaveDelay).toBe(5000);
    expect(config.maxRetries).toBe(10);
  });

  it('leaves optional fields undefined when not provided in env', () => {
    const config = createCSSConfig(validEnv);

    expect(config.clientBaseUrl).toBeUndefined();
    expect(config.branchId).toBeUndefined();
    expect(config.googleClientId).toBeUndefined();
    expect(config.auth0Domain).toBeUndefined();
    expect(config.auth0ClientId).toBeUndefined();
    expect(config.auth0Audience).toBeUndefined();
    expect(config.enableRealtime).toBeUndefined();
    expect(config.wsBaseUrl).toBeUndefined();
    expect(config.enablePresence).toBeUndefined();
    expect(config.autoSaveDelay).toBeUndefined();
    expect(config.maxRetries).toBeUndefined();
  });

  it('throws when authMode is an invalid value', () => {
    const env: Record<string, string> = {
      ...validEnv,
      CSS_AUTH_MODE: 'invalid',
    };

    expect(() => createCSSConfig(env)).toThrow();
  });

  it('reads CSS_BASE_URL directly when no prefix is provided', () => {
    const config = createCSSConfig(validEnv);

    expect(config.baseUrl).toBe('http://localhost:8787');
  });
});
