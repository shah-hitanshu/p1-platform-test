import type { AuthMode } from './auth/CSSAuthProvider.js';

export interface CSSConfig {
  baseUrl: string;
  clientBaseUrl?: string;
  siteId: string;
  branchId?: string;
  authMode: AuthMode;
  googleClientId?: string;
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0Audience?: string;
  enableRealtime?: boolean;
  wsBaseUrl?: string;
  enablePresence?: boolean;
  autoSaveDelay?: number;
  maxRetries?: number;
}

const VALID_AUTH_MODES: AuthMode[] = ['mock', 'google', 'auth0'];

export function createCSSConfig(
  envSource: Record<string, string | undefined>,
  options?: {
    prefix?: string;
    overrides?: Partial<CSSConfig>;
  },
): CSSConfig {
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
  const authModeRaw = overrides.authMode ?? env('CSS_AUTH_MODE');

  if (!baseUrl) {
    throw new Error('Missing required config: CSS_BASE_URL');
  }
  if (!siteId) {
    throw new Error('Missing required config: CSS_SITE_ID');
  }
  if (!authModeRaw) {
    throw new Error('Missing required config: CSS_AUTH_MODE');
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
    enableRealtime: overrides.enableRealtime ?? envBool('CSS_ENABLE_REALTIME'),
    wsBaseUrl: overrides.wsBaseUrl ?? env('CSS_WS_BASE_URL'),
    enablePresence: overrides.enablePresence ?? envBool('CSS_ENABLE_PRESENCE'),
    autoSaveDelay: overrides.autoSaveDelay ?? envNum('CSS_AUTO_SAVE_DELAY'),
    maxRetries: overrides.maxRetries ?? envNum('CSS_MAX_RETRIES'),
  };
}
