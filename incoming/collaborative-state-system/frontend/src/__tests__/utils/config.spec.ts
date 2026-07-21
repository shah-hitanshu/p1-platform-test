/**
 * Config Module Tests (TDD - Red Phase)
 *
 * Tests for runtime config injection via window.__CSS_CONFIG__
 * with fallback to import.meta.env.VITE_* for local development.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env
const originalEnv = { ...import.meta.env };

beforeEach(() => {
  vi.resetModules();
  // Clear window config
  delete (window as unknown as Record<string, unknown>).__CSS_CONFIG__;
  // Clear relevant VITE_ env vars
  delete import.meta.env.VITE_API_BASE_URL;
  delete import.meta.env.VITE_GOOGLE_CLIENT_ID;
  delete import.meta.env.VITE_AUTH0_DOMAIN;
  delete import.meta.env.VITE_AUTH0_CLIENT_ID;
  delete import.meta.env.VITE_AUTH0_AUDIENCE;
  delete import.meta.env.VITE_ENABLE_MOCK_LOGIN;
});

afterEach(() => {
  Object.assign(import.meta.env, originalEnv);
  delete (window as unknown as Record<string, unknown>).__CSS_CONFIG__;
});

async function loadConfig(): Promise<typeof import('../../config')> {
  return import('../../config');
}

describe('getConfig', () => {
  it('should return empty defaults when no config source is available', async () => {
    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.apiBaseUrl).toBe('');
    expect(config.googleClientId).toBe('');
    expect(config.auth0Domain).toBe('');
    expect(config.auth0ClientId).toBe('');
    expect(config.auth0Audience).toBe('');
    expect(config.enableMockLogin).toBe(false);
  });

  it('should read from window.__CSS_CONFIG__ when available (deployed mode)', async () => {
    (window as unknown as Record<string, unknown>).__CSS_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com',
      googleClientId: 'injected-google-id',
      auth0Domain: 'injected.auth0.com',
      auth0ClientId: 'injected-auth0-id',
      auth0Audience: 'https://injected-api',
      enableMockLogin: true,
    };

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.apiBaseUrl).toBe('https://api.example.com');
    expect(config.googleClientId).toBe('injected-google-id');
    expect(config.auth0Domain).toBe('injected.auth0.com');
    expect(config.auth0ClientId).toBe('injected-auth0-id');
    expect(config.auth0Audience).toBe('https://injected-api');
    expect(config.enableMockLogin).toBe(true);
  });

  it('should fall back to import.meta.env.VITE_* when window config is absent (local dev)', async () => {
    import.meta.env.VITE_API_BASE_URL = 'http://localhost:8787';
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'local-google-id';
    import.meta.env.VITE_AUTH0_DOMAIN = 'local.auth0.com';
    import.meta.env.VITE_AUTH0_CLIENT_ID = 'local-auth0-id';
    import.meta.env.VITE_AUTH0_AUDIENCE = 'https://local-api';
    import.meta.env.VITE_ENABLE_MOCK_LOGIN = 'true';

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.apiBaseUrl).toBe('http://localhost:8787');
    expect(config.googleClientId).toBe('local-google-id');
    expect(config.auth0Domain).toBe('local.auth0.com');
    expect(config.auth0ClientId).toBe('local-auth0-id');
    expect(config.auth0Audience).toBe('https://local-api');
    expect(config.enableMockLogin).toBe(true);
  });

  it('should prefer window.__CSS_CONFIG__ over import.meta.env', async () => {
    (window as unknown as Record<string, unknown>).__CSS_CONFIG__ = {
      apiBaseUrl: 'https://deployed.example.com',
      googleClientId: 'deployed-google-id',
    };
    import.meta.env.VITE_API_BASE_URL = 'http://localhost:8787';
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'local-google-id';

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.apiBaseUrl).toBe('https://deployed.example.com');
    expect(config.googleClientId).toBe('deployed-google-id');
  });

  it('should handle enableMockLogin as string "true" from window config', async () => {
    (window as unknown as Record<string, unknown>).__CSS_CONFIG__ = {
      enableMockLogin: 'true',
    };

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.enableMockLogin).toBe(true);
  });

  it('should handle enableMockLogin as string "false" from window config', async () => {
    (window as unknown as Record<string, unknown>).__CSS_CONFIG__ = {
      enableMockLogin: 'false',
    };

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.enableMockLogin).toBe(false);
  });

  it('should handle partial window config with env fallbacks for missing fields', async () => {
    (window as unknown as Record<string, unknown>).__CSS_CONFIG__ = {
      apiBaseUrl: 'https://deployed.example.com',
    };
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'fallback-google-id';

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.apiBaseUrl).toBe('https://deployed.example.com');
    expect(config.googleClientId).toBe('fallback-google-id');
  });
});
