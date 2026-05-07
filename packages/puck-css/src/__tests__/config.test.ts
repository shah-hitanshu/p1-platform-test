import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCSSConfig, createNextConfig, createNextContentClient } from '../core/config.js';

vi.mock('@pantheon-systems/css-client', () => {
  const MockCSSContentClient = vi.fn();
  return { CSSContentClient: MockCSSContentClient };
});

describe('createNextConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a valid config when all NEXT_PUBLIC_CSS_* env vars are set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'google';
    process.env.NEXT_PUBLIC_CSS_GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.NEXT_PUBLIC_CSS_BRANCH_ID = 'branch-456';
    process.env.NEXT_PUBLIC_CSS_ENABLE_REALTIME = 'true';
    process.env.NEXT_PUBLIC_CSS_WS_BASE_URL = 'wss://ws.example.com';
    process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE = 'true';

    const config = createNextConfig();

    expect(config.baseUrl).toBe('https://css.example.com');
    expect(config.siteId).toBe('site-123');
    expect(config.authMode).toBe('google');
    expect(config.googleClientId).toBe('google-client-id');
    expect(config.branchId).toBe('branch-456');
    expect(config.enableRealtime).toBe(true);
    expect(config.wsBaseUrl).toBe('wss://ws.example.com');
    expect(config.enablePresence).toBe(true);
  });

  it('allows overrides to take precedence over env vars', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'google';

    const config = createNextConfig({
      baseUrl: 'https://override.example.com',
      siteId: 'override-site',
    });

    expect(config.baseUrl).toBe('https://override.example.com');
    expect(config.siteId).toBe('override-site');
    expect(config.authMode).toBe('google');
  });

  it('throws when required env vars are missing', () => {
    expect(() => createNextConfig()).toThrow('Missing required config: CSS_BASE_URL');

    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    expect(() => createNextConfig()).toThrow('Missing required config: CSS_SITE_ID');
  });

  it('defaults authMode to p1 when not set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';

    const config = createNextConfig();
    expect(config.authMode).toBe('p1');
  });

  it('defaults enableRealtime and enablePresence to true when env vars are not set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';

    const config = createNextConfig();
    expect(config.enableRealtime).toBe(true);
    expect(config.enablePresence).toBe(true);
  });

  it('respects explicit false for enableRealtime and enablePresence', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_ENABLE_REALTIME = 'false';
    process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE = 'false';

    const config = createNextConfig();
    expect(config.enableRealtime).toBe(false);
    expect(config.enablePresence).toBe(false);
  });

  it('derives wsBaseUrl from baseUrl when not explicitly set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';

    const config = createNextConfig();
    expect(config.wsBaseUrl).toBe('wss://css.example.com');
  });

  it('uses explicit wsBaseUrl when provided', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_WS_BASE_URL = 'wss://custom-ws.example.com';

    const config = createNextConfig();
    expect(config.wsBaseUrl).toBe('wss://custom-ws.example.com');
  });

  it('derives cssAuthServerUrl from baseUrl when css-authserver mode is set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'css-authserver';

    const config = createNextConfig();
    expect(config.cssAuthServerUrl).toBe('https://css.example.com/auth');
  });

  it('correctly parses boolean env vars', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'mock';
    process.env.NEXT_PUBLIC_CSS_ENABLE_REALTIME = 'false';
    process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE = 'false';

    const config = createNextConfig();

    expect(config.enableRealtime).toBe(false);
    expect(config.enablePresence).toBe(false);

    process.env.NEXT_PUBLIC_CSS_ENABLE_REALTIME = 'true';
    process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE = 'true';

    const config2 = createNextConfig();
    expect(config2.enableRealtime).toBe(true);
    expect(config2.enablePresence).toBe(true);
  });
});

describe('createCSSConfig with css-authserver mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts css-authserver as a valid auth mode', () => {
    const config = createCSSConfig(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'css-authserver',
          cssAuthServerUrl: 'https://auth.css.example.com',
        },
      },
    );

    expect(config.authMode).toBe('css-authserver');
    expect(config.cssAuthServerUrl).toBe('https://auth.css.example.com');
  });

  it('parses CSS_AUTH_SERVER_URL and CSS_AUTH_REDIRECT_URI from env', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'css-authserver';
    process.env.NEXT_PUBLIC_CSS_AUTH_SERVER_URL = 'https://auth.css.example.com';
    process.env.NEXT_PUBLIC_CSS_AUTH_REDIRECT_URI = 'https://mysite.com/auth/callback';

    const config = createNextConfig();

    expect(config.authMode).toBe('css-authserver');
    expect(config.cssAuthServerUrl).toBe('https://auth.css.example.com');
    expect(config.cssAuthRedirectUri).toBe('https://mysite.com/auth/callback');
  });

  it('reads CSS_AUTH_SERVER_URL from prefixed env source', () => {
    const config = createCSSConfig(
      {
        VITE_CSS_AUTH_SERVER_URL: 'https://auth.css.example.com',
        VITE_CSS_BASE_URL: 'https://css.example.com',
        VITE_CSS_SITE_ID: 'site-123',
        VITE_CSS_AUTH_MODE: 'css-authserver',
      },
      { prefix: 'VITE_' },
    );

    expect(config.cssAuthServerUrl).toBe('https://auth.css.example.com');
  });

  it('defaults cssAuthServerUrl to ${baseUrl}/auth when css-authserver mode and no URL provided', () => {
    const config = createCSSConfig(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'css-authserver',
          // No cssAuthServerUrl provided — should default to baseUrl + /auth
        },
      },
    );

    expect(config.cssAuthServerUrl).toBe('https://css.example.com/auth');
  });

  it('derives ws:// wsBaseUrl from http:// baseUrl', () => {
    const config = createCSSConfig(
      {},
      {
        overrides: {
          baseUrl: 'http://localhost:8787',
          siteId: 'site-1',
          authMode: 'mock',
        },
      },
    );
    expect(config.wsBaseUrl).toBe('ws://localhost:8787');
  });

  it('derives wss:// wsBaseUrl from https:// baseUrl', () => {
    const config = createCSSConfig(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-1',
          authMode: 'mock',
        },
      },
    );
    expect(config.wsBaseUrl).toBe('wss://css.example.com');
  });

  it('defaults authMode to p1 when not provided via env or overrides', () => {
    const config = createCSSConfig(
      {
        VITE_CSS_BASE_URL: 'https://css.example.com',
        VITE_CSS_SITE_ID: 'site-123',
      },
      { prefix: 'VITE_' },
    );
    expect(config.authMode).toBe('p1');
  });

  it('defaults enableRealtime and enablePresence to true', () => {
    const config = createCSSConfig(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'mock',
        },
      },
    );
    expect(config.enableRealtime).toBe(true);
    expect(config.enablePresence).toBe(true);
  });

  it('does not default cssAuthServerUrl for non-css-authserver modes', () => {
    const config = createCSSConfig(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'mock',
        },
      },
    );

    expect(config.cssAuthServerUrl).toBeUndefined();
  });

  it('explicit cssAuthServerUrl override takes precedence over default', () => {
    const config = createCSSConfig(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'css-authserver',
          cssAuthServerUrl: 'https://custom-auth.example.com/auth',
        },
      },
    );

    expect(config.cssAuthServerUrl).toBe('https://custom-auth.example.com/auth');
  });
});

describe('createNextContentClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a CSSContentClient when required env vars are set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.CSS_API_KEY = 'api-token-123';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_BRANCH_ID = 'branch-456';

    const client = createNextContentClient();

    expect(client).not.toBeNull();
  });

  it('returns null when required env vars are missing', () => {
    expect(createNextContentClient()).toBeNull();

    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    expect(createNextContentClient()).toBeNull();

    process.env.CSS_API_KEY = 'api-token-123';
    expect(createNextContentClient()).toBeNull();
  });

  it('allows overrides to take precedence over env vars', async () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.CSS_API_KEY = 'api-token-123';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';

    const { CSSContentClient } = vi.mocked(
      await import('@pantheon-systems/css-client')
    );

    const client = createNextContentClient({
      baseUrl: 'https://override.example.com',
      apiToken: 'override-token',
    });

    expect(client).not.toBeNull();
    expect(CSSContentClient).toHaveBeenCalledWith({
      baseUrl: 'https://override.example.com',
      apiToken: 'override-token',
      siteId: 'site-123',
      branchId: undefined,
    });
  });
});
