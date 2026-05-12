import type { AuthMode } from '../auth/P1AuthProvider.js';
import { P1ContentClient } from '@pantheon-systems/css-client';

export interface P1Config {
  baseUrl: string;
  clientBaseUrl?: string;
  siteId: string;
  branchId?: string;
  authMode: AuthMode;
  googleClientId?: string;
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0Audience?: string;
  p1AuthServerUrl?: string;
  p1AuthRedirectUri?: string;
  enableRealtime?: boolean;
  wsBaseUrl?: string;
  enablePresence?: boolean;
  autoSaveDelay?: number;
  maxRetries?: number;
}

const VALID_AUTH_MODES: AuthMode[] = ['mock', 'google', 'auth0', 'css-authserver', 'p1'];
const DEFAULT_AUTH_MODE: AuthMode = 'p1';

function httpToWs(url: string): string {
  return url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

export function createP1Config(
  envSource: Record<string, string | undefined>,
  options?: {
    prefix?: string;
    overrides?: Partial<P1Config>;
  },
): P1Config {
  const prefix = options?.prefix ?? '';
  const overrides = options?.overrides ?? {};

  function env(key: string): string | undefined {
    return envSource[`${prefix}${key}`];
  }

  function envBool(key: string): boolean | undefined {
    const val = env(key);
    if (val === undefined) return undefined;
    return val === 'true';
  }

  function envNum(key: string): number | undefined {
    const val = env(key);
    if (val === undefined) return undefined;
    const num = parseInt(val, 10);
    return isNaN(num) ? undefined : num;
  }

  const baseUrl = overrides.baseUrl ?? env('CSS_BASE_URL');
  const siteId = overrides.siteId ?? env('CSS_SITE_ID');
  const authModeRaw = overrides.authMode ?? env('CSS_AUTH_MODE') ?? DEFAULT_AUTH_MODE;

  if (!baseUrl) {
    throw new Error('Missing required config: CSS_BASE_URL');
  }
  if (!siteId) {
    throw new Error('Missing required config: CSS_SITE_ID');
  }
  if (!VALID_AUTH_MODES.includes(authModeRaw as AuthMode)) {
    throw new Error(`Invalid CSS_AUTH_MODE: "${authModeRaw}". Must be one of: ${VALID_AUTH_MODES.join(', ')}`);
  }

  return {
    baseUrl,
    siteId,
    authMode: authModeRaw as AuthMode,
    clientBaseUrl: overrides.clientBaseUrl ?? env('CSS_CLIENT_BASE_URL'),
    branchId: overrides.branchId ?? env('CSS_BRANCH_ID'),
    googleClientId: overrides.googleClientId ?? env('CSS_GOOGLE_CLIENT_ID'),
    auth0Domain: overrides.auth0Domain ?? env('CSS_AUTH0_DOMAIN'),
    auth0ClientId: overrides.auth0ClientId ?? env('CSS_AUTH0_CLIENT_ID'),
    auth0Audience: overrides.auth0Audience ?? env('CSS_AUTH0_AUDIENCE'),
    // Default p1AuthServerUrl to ${baseUrl}/auth when using css-authserver mode.
    // The P1 OAuth server is now inlined at /auth/* on the main worker, so the
    // auth URL can be derived from baseUrl without requiring explicit configuration.
    p1AuthServerUrl: overrides.p1AuthServerUrl ?? env('CSS_AUTH_SERVER_URL') ??
      (authModeRaw === 'css-authserver' ? `${baseUrl}/auth` : undefined),
    p1AuthRedirectUri: overrides.p1AuthRedirectUri ?? env('CSS_AUTH_REDIRECT_URI'),
    enableRealtime: overrides.enableRealtime ?? envBool('CSS_ENABLE_REALTIME') ?? true,
    wsBaseUrl: overrides.wsBaseUrl ?? env('CSS_WS_BASE_URL') ?? httpToWs(baseUrl),
    enablePresence: overrides.enablePresence ?? envBool('CSS_ENABLE_PRESENCE') ?? true,
    autoSaveDelay: overrides.autoSaveDelay ?? envNum('CSS_AUTO_SAVE_DELAY'),
    maxRetries: overrides.maxRetries ?? envNum('CSS_MAX_RETRIES'),
  };
}

export function createNextConfig(overrides?: Partial<P1Config>): P1Config {
  return createP1Config({}, {
    overrides: {
      baseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL,
      siteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
      authMode: process.env.NEXT_PUBLIC_CSS_AUTH_MODE as AuthMode | undefined,
      googleClientId: process.env.NEXT_PUBLIC_CSS_GOOGLE_CLIENT_ID,
      branchId: process.env.NEXT_PUBLIC_CSS_BRANCH_ID,
      p1AuthServerUrl: process.env.NEXT_PUBLIC_CSS_AUTH_SERVER_URL,
      p1AuthRedirectUri: process.env.NEXT_PUBLIC_CSS_AUTH_REDIRECT_URI,
      enableRealtime: process.env.NEXT_PUBLIC_CSS_ENABLE_REALTIME !== undefined
        ? process.env.NEXT_PUBLIC_CSS_ENABLE_REALTIME === 'true'
        : undefined,
      wsBaseUrl: process.env.NEXT_PUBLIC_CSS_WS_BASE_URL,
      enablePresence: process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE !== undefined
        ? process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE === 'true'
        : undefined,
      ...overrides,
    },
  });
}

export function createNextContentClient(overrides?: {
  baseUrl?: string;
  apiToken?: string;
  siteId?: string;
  branchId?: string;
}): P1ContentClient | null {
  const baseUrl = overrides?.baseUrl ?? process.env.NEXT_PUBLIC_CSS_BASE_URL;
  const apiToken = overrides?.apiToken ?? process.env.CSS_API_KEY;
  const siteId = overrides?.siteId ?? process.env.NEXT_PUBLIC_CSS_SITE_ID;
  const branchId = overrides?.branchId ?? process.env.NEXT_PUBLIC_CSS_BRANCH_ID;

  if (!baseUrl || !apiToken || !siteId) return null;

  return new P1ContentClient({ baseUrl, apiToken, siteId, branchId });
}
