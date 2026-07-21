/**
 * Runtime Configuration
 *
 * Reads config from window.__CSS_CONFIG__ (injected by the Cloudflare Worker
 * at serve time) with fallback to import.meta.env.VITE_* for local development.
 *
 * This enables "one build, any environment" — the same Vite build artifact
 * can be deployed to sbx1 or production, with the Worker injecting the
 * correct config at request time via HTMLRewriter.
 */

export interface CSSConfig {
  apiBaseUrl: string;
  googleClientId: string;
  auth0Domain: string;
  auth0ClientId: string;
  auth0Audience: string;
  enableMockLogin: boolean;
}

interface WindowConfig {
  apiBaseUrl?: string;
  googleClientId?: string;
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0Audience?: string;
  enableMockLogin?: boolean | string;
}

/**
 * Parse enableMockLogin from either boolean or string representation.
 */
function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return false;
}

/**
 * Get the application configuration.
 *
 * Priority: window.__CSS_CONFIG__ (Worker-injected) > import.meta.env (Vite)
 */
export function getConfig(): CSSConfig {
  const w = (window as unknown as { __CSS_CONFIG__?: WindowConfig }).__CSS_CONFIG__;

  return {
    apiBaseUrl: w?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '',
    googleClientId: w?.googleClientId ?? import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
    auth0Domain: w?.auth0Domain ?? import.meta.env.VITE_AUTH0_DOMAIN ?? '',
    auth0ClientId: w?.auth0ClientId ?? import.meta.env.VITE_AUTH0_CLIENT_ID ?? '',
    auth0Audience: w?.auth0Audience ?? import.meta.env.VITE_AUTH0_AUDIENCE ?? '',
    enableMockLogin: parseBool(
      w?.enableMockLogin ?? import.meta.env.VITE_ENABLE_MOCK_LOGIN,
    ),
  };
}
