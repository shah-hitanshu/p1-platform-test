import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createP1Config, createNextConfig, createNextContentClient } from '../core/config.js';

vi.mock('@pantheon-systems/css-client', () => {
  const MockP1ContentClient = vi.fn();
  return { P1ContentClient: MockP1ContentClient };
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

  it('derives p1AuthServerUrl from baseUrl when css-authserver mode is set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'css-authserver';

    const config = createNextConfig();
    expect(config.p1AuthServerUrl).toBe('https://css.example.com/auth');
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

describe('createP1Config with css-authserver mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts css-authserver as a valid auth mode', () => {
    const config = createP1Config(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'css-authserver',
          p1AuthServerUrl: 'https://auth.css.example.com',
        },
      },
    );

    expect(config.authMode).toBe('css-authserver');
    expect(config.p1AuthServerUrl).toBe('https://auth.css.example.com');
  });

  it('parses CSS_AUTH_SERVER_URL and P1_AUTH_REDIRECT_URI from env', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'css-authserver';
    process.env.NEXT_PUBLIC_CSS_AUTH_SERVER_URL = 'https://auth.css.example.com';
    process.env.NEXT_PUBLIC_CSS_AUTH_REDIRECT_URI = 'https://mysite.com/auth/callback';

    const config = createNextConfig();

    expect(config.authMode).toBe('css-authserver');
    expect(config.p1AuthServerUrl).toBe('https://auth.css.example.com');
    expect(config.p1AuthRedirectUri).toBe('https://mysite.com/auth/callback');
  });

  it('reads CSS_AUTH_SERVER_URL from prefixed env source', () => {
    const config = createP1Config(
      {
        VITE_CSS_AUTH_SERVER_URL: 'https://auth.css.example.com',
        VITE_CSS_BASE_URL: 'https://css.example.com',
        VITE_CSS_SITE_ID: 'site-123',
        VITE_CSS_AUTH_MODE: 'css-authserver',
      },
      { prefix: 'VITE_' },
    );

    expect(config.p1AuthServerUrl).toBe('https://auth.css.example.com');
  });

  it('defaults p1AuthServerUrl to ${baseUrl}/auth when css-authserver mode and no URL provided', () => {
    const config = createP1Config(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'css-authserver',
          // No p1AuthServerUrl provided — should default to baseUrl + /auth
        },
      },
    );

    expect(config.p1AuthServerUrl).toBe('https://css.example.com/auth');
  });

  it('derives ws:// wsBaseUrl from http:// baseUrl', () => {
    const config = createP1Config(
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
    const config = createP1Config(
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
    const config = createP1Config(
      {
        VITE_CSS_BASE_URL: 'https://css.example.com',
        VITE_CSS_SITE_ID: 'site-123',
      },
      { prefix: 'VITE_' },
    );
    expect(config.authMode).toBe('p1');
  });

  it('defaults enableRealtime and enablePresence to true', () => {
    const config = createP1Config(
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

  it('does not default p1AuthServerUrl for non-css-authserver modes', () => {
    const config = createP1Config(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'mock',
        },
      },
    );

    expect(config.p1AuthServerUrl).toBeUndefined();
  });

  it('explicit p1AuthServerUrl override takes precedence over default', () => {
    const config = createP1Config(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'css-authserver',
          p1AuthServerUrl: 'https://custom-auth.example.com/auth',
        },
      },
    );

    expect(config.p1AuthServerUrl).toBe('https://custom-auth.example.com/auth');
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

  it('returns a P1ContentClient when required env vars are set', () => {
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

    const { P1ContentClient } = vi.mocked(
      await import('@pantheon-systems/css-client')
    );

    const client = createNextContentClient({
      baseUrl: 'https://override.example.com',
      apiToken: 'override-token',
    });

    expect(client).not.toBeNull();
    expect(P1ContentClient).toHaveBeenCalledWith({
      baseUrl: 'https://override.example.com',
      apiToken: 'override-token',
      siteId: 'site-123',
      branchId: undefined,
    });
  });
});
