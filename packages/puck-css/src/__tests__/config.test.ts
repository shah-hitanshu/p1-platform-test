import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createP1Config, createNextConfig, createNextContentClient, PRODUCTION_BASE_URL } from '../core/config.js';

vi.mock('@pantheon-systems/css-client', () => {
  const MockP1ContentClient = vi.fn();
  return { P1ContentClient: MockP1ContentClient };
});

describe('PRODUCTION_BASE_URL', () => {
  it('is a resolvable production hostname ending in .io, not a bare TLD-less string', () => {
    expect(PRODUCTION_BASE_URL).toBe('https://ccr.p1.pantheon.io');
  });
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
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'broker';
    process.env.NEXT_PUBLIC_CSS_BRANCH_ID = 'branch-456';
    process.env.NEXT_PUBLIC_CSS_ENABLE_REALTIME = 'true';
    process.env.NEXT_PUBLIC_CSS_WS_BASE_URL = 'wss://ws.example.com';
    process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE = 'true';

    const config = createNextConfig();

    expect(config.baseUrl).toBe('https://css.example.com');
    expect(config.siteId).toBe('site-123');
    expect(config.authMode).toBe('broker');
    expect(config.branchId).toBe('branch-456');
    expect(config.enableRealtime).toBe(true);
    expect(config.wsBaseUrl).toBe('wss://ws.example.com');
    expect(config.enablePresence).toBe(true);
  });

  it('allows overrides to take precedence over env vars', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'broker';

    const config = createNextConfig({
      baseUrl: 'https://override.example.com',
      siteId: 'override-site',
    });

    expect(config.baseUrl).toBe('https://override.example.com');
    expect(config.siteId).toBe('override-site');
    expect(config.authMode).toBe('broker');
  });

  it('throws when CSS_SITE_ID is missing', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    expect(() => createNextConfig()).toThrow('Missing required config: CSS_SITE_ID');
  });

  // Left undefined on purpose: the provider owns branch precedence (deep link →
  // explicit config → the branch the user switched to → the site's main branch), and a
  // config-level default would outrank the user's own selection.
  it('leaves branchId unset when NEXT_PUBLIC_CSS_BRANCH_ID is not set', () => {
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    delete process.env.NEXT_PUBLIC_CSS_BRANCH_ID;

    const config = createNextConfig();
    expect(config.branchId).toBeUndefined();
  });

  it('treats a blank NEXT_PUBLIC_CSS_BRANCH_ID as unset', () => {
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_BRANCH_ID = '   ';

    const config = createNextConfig();
    expect(config.branchId).toBeUndefined();
  });

  it('keeps an explicit NEXT_PUBLIC_CSS_BRANCH_ID over the main default', () => {
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_BRANCH_ID = 'feature-x';

    const config = createNextConfig();
    expect(config.branchId).toBe('feature-x');
  });

  it('uses production base URL when NEXT_PUBLIC_CSS_BASE_URL is not set', () => {
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';

    const config = createNextConfig();
    expect(config.baseUrl).toBe(PRODUCTION_BASE_URL);
  });

  it('overrides production default when NEXT_PUBLIC_CSS_BASE_URL is set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://staging.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';

    const config = createNextConfig();
    expect(config.baseUrl).toBe('https://staging.example.com');
  });

  it('defaults authMode to broker when not set', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';

    const config = createNextConfig();
    expect(config.authMode).toBe('broker');
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

describe('createNextContentClient branch normalization', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // A whitespace value is truthy, so it reaches `?branch=` and 404s every published page.
  it('treats a whitespace NEXT_PUBLIC_CSS_BRANCH_ID as unset', async () => {
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.CSS_API_KEY = 'key';
    process.env.NEXT_PUBLIC_CSS_BRANCH_ID = '   ';

    const { P1ContentClient } = vi.mocked(await import('@pantheon-systems/css-client'));
    createNextContentClient();

    expect(P1ContentClient).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: undefined }),
    );
  });

  it('still passes an explicitly configured branch through', async () => {
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.CSS_API_KEY = 'key';
    process.env.NEXT_PUBLIC_CSS_BRANCH_ID = 'branch-456';

    const { P1ContentClient } = vi.mocked(await import('@pantheon-systems/css-client'));
    createNextContentClient();

    expect(P1ContentClient).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-456' }),
    );
  });
});

describe('createP1Config', () => {
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

  it('leaves branchId unset when no branch is configured', () => {
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
    expect(config.branchId).toBeUndefined();
  });

  it('prefers the prefixed CSS_BRANCH_ID env var over the main default', () => {
    const config = createP1Config(
      {
        VITE_CSS_SITE_ID: 'site-123',
        VITE_CSS_BRANCH_ID: 'branch-789',
      },
      { prefix: 'VITE_' },
    );
    expect(config.branchId).toBe('branch-789');
  });

  it('defaults authMode to broker when not provided via env or overrides', () => {
    const config = createP1Config(
      {
        VITE_CSS_BASE_URL: 'https://css.example.com',
        VITE_CSS_SITE_ID: 'site-123',
      },
      { prefix: 'VITE_' },
    );
    expect(config.authMode).toBe('broker');
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

  it('accepts broker as a valid auth mode', () => {
    const config = createP1Config(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'broker',
        },
      },
    );

    expect(config.authMode).toBe('broker');
  });

  it('uses production base URL when no baseUrl override or env var is provided', () => {
    const config = createP1Config(
      { CSS_SITE_ID: 'site-123' },
      {},
    );
    expect(config.baseUrl).toBe(PRODUCTION_BASE_URL);
  });

  it('overrides production default when baseUrl is provided via env', () => {
    const config = createP1Config(
      { CSS_BASE_URL: 'https://staging.example.com', CSS_SITE_ID: 'site-123' },
      {},
    );
    expect(config.baseUrl).toBe('https://staging.example.com');
  });

  it('overrides production default when baseUrl is provided via overrides', () => {
    const config = createP1Config(
      { CSS_SITE_ID: 'site-123' },
      {
        overrides: {
          baseUrl: 'https://local.example.com',
        },
      },
    );
    expect(config.baseUrl).toBe('https://local.example.com');
  });

  it('rejects invalid auth modes', () => {
    expect(() =>
      createP1Config(
        {},
        {
          overrides: {
            baseUrl: 'https://css.example.com',
            siteId: 'site-123',
            authMode: 'google' as 'mock',
          },
        },
      ),
    ).toThrow('Invalid CSS_AUTH_MODE');
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

  it('returns null when apiToken or siteId is missing', () => {
    expect(createNextContentClient()).toBeNull();

    process.env.CSS_API_KEY = 'api-token-123';
    expect(createNextContentClient()).toBeNull();
  });

  it('uses production base URL when NEXT_PUBLIC_CSS_BASE_URL is not set', () => {
    process.env.CSS_API_KEY = 'api-token-123';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';

    const client = createNextContentClient();
    expect(client).not.toBeNull();
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
