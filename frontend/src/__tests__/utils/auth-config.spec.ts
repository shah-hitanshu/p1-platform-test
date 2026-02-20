/**
 * Auth Config Utility Tests (TDD - Red Phase)
 *
 * Tests for provider detection based on environment variables.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthConfig } from '../../utils/auth-config';

/**
 * We dynamically import auth-config in each test so we can control
 * import.meta.env before the module evaluates. We use vi.resetModules()
 * between tests.
 */

// Store original env
const originalEnv = { ...import.meta.env };

beforeEach(() => {
  vi.resetModules();
  // Clear all VITE_ auth env vars
  delete import.meta.env.VITE_GOOGLE_CLIENT_ID;
  delete import.meta.env.VITE_AUTH0_DOMAIN;
  delete import.meta.env.VITE_AUTH0_CLIENT_ID;
  delete import.meta.env.VITE_AUTH0_AUDIENCE;
  delete import.meta.env.VITE_ENABLE_MOCK_LOGIN;
});

afterEach(() => {
  // Restore original env
  Object.assign(import.meta.env, originalEnv);
});

async function loadAuthConfig(): Promise<typeof import('../../utils/auth-config')> {
  return import('../../utils/auth-config');
}

describe('getAuthConfig', () => {
  it('should return config with all providers disabled when no env vars set', async () => {
    const { getAuthConfig } = await loadAuthConfig();

    const config = getAuthConfig();

    expect(config.google.enabled).toBe(false);
    expect(config.auth0.enabled).toBe(false);
  });

  it('should enable Google when VITE_GOOGLE_CLIENT_ID is set', async () => {
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

    const { getAuthConfig } = await loadAuthConfig();
    const config = getAuthConfig();

    expect(config.google.enabled).toBe(true);
    expect(config.google.clientId).toBe('test-client-id.apps.googleusercontent.com');
  });

  it('should enable Auth0 when domain and client ID are set', async () => {
    import.meta.env.VITE_AUTH0_DOMAIN = 'test-tenant.auth0.com';
    import.meta.env.VITE_AUTH0_CLIENT_ID = 'auth0-client-id';

    const { getAuthConfig } = await loadAuthConfig();
    const config = getAuthConfig();

    expect(config.auth0.enabled).toBe(true);
    expect(config.auth0.domain).toBe('test-tenant.auth0.com');
    expect(config.auth0.clientId).toBe('auth0-client-id');
  });

  it('should not enable Auth0 when only domain is set (missing clientId)', async () => {
    import.meta.env.VITE_AUTH0_DOMAIN = 'test-tenant.auth0.com';

    const { getAuthConfig } = await loadAuthConfig();
    const config = getAuthConfig();

    expect(config.auth0.enabled).toBe(false);
  });

  it('should include Auth0 audience when set', async () => {
    import.meta.env.VITE_AUTH0_DOMAIN = 'test-tenant.auth0.com';
    import.meta.env.VITE_AUTH0_CLIENT_ID = 'auth0-client-id';
    import.meta.env.VITE_AUTH0_AUDIENCE = 'https://my-api.example.com';

    const { getAuthConfig } = await loadAuthConfig();
    const config = getAuthConfig();

    expect(config.auth0.audience).toBe('https://my-api.example.com');
  });
});

describe('isGoogleEnabled', () => {
  it('should return false when no Google client ID is set', async () => {
    const { isGoogleEnabled } = await loadAuthConfig();

    expect(isGoogleEnabled()).toBe(false);
  });

  it('should return true when Google client ID is set', async () => {
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'test-client-id';

    const { isGoogleEnabled } = await loadAuthConfig();

    expect(isGoogleEnabled()).toBe(true);
  });
});

describe('isAuth0Enabled', () => {
  it('should return false when no Auth0 vars are set', async () => {
    const { isAuth0Enabled } = await loadAuthConfig();

    expect(isAuth0Enabled()).toBe(false);
  });

  it('should return true when Auth0 domain and client ID are set', async () => {
    import.meta.env.VITE_AUTH0_DOMAIN = 'test.auth0.com';
    import.meta.env.VITE_AUTH0_CLIENT_ID = 'client-123';

    const { isAuth0Enabled } = await loadAuthConfig();

    expect(isAuth0Enabled()).toBe(true);
  });

  it('should return false when only Auth0 client ID is set (missing domain)', async () => {
    import.meta.env.VITE_AUTH0_CLIENT_ID = 'client-123';

    const { isAuth0Enabled } = await loadAuthConfig();

    expect(isAuth0Enabled()).toBe(false);
  });
});

describe('isMockEnabled', () => {
  it('should return true when no OAuth providers are configured (default dev mode)', async () => {
    const { isMockEnabled } = await loadAuthConfig();

    expect(isMockEnabled()).toBe(true);
  });

  it('should return true when VITE_ENABLE_MOCK_LOGIN is explicitly true', async () => {
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'some-id';
    import.meta.env.VITE_ENABLE_MOCK_LOGIN = 'true';

    const { isMockEnabled } = await loadAuthConfig();

    expect(isMockEnabled()).toBe(true);
  });

  it('should return false when OAuth is configured and mock is not explicitly enabled', async () => {
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'some-id';

    const { isMockEnabled } = await loadAuthConfig();

    expect(isMockEnabled()).toBe(false);
  });

  it('should return true when VITE_ENABLE_MOCK_LOGIN is "true" alongside Auth0', async () => {
    import.meta.env.VITE_AUTH0_DOMAIN = 'test.auth0.com';
    import.meta.env.VITE_AUTH0_CLIENT_ID = 'client-123';
    import.meta.env.VITE_ENABLE_MOCK_LOGIN = 'true';

    const { isMockEnabled } = await loadAuthConfig();

    expect(isMockEnabled()).toBe(true);
  });
});

describe('AuthConfig type', () => {
  it('should have the expected shape', async () => {
    const { getAuthConfig } = await loadAuthConfig();
    const config: AuthConfig = getAuthConfig();

    // Verify structure
    expect(config).toHaveProperty('google');
    expect(config).toHaveProperty('auth0');
    expect(config).toHaveProperty('mock');
    expect(config.google).toHaveProperty('enabled');
    expect(config.auth0).toHaveProperty('enabled');
    expect(config.mock).toHaveProperty('enabled');
  });
});
