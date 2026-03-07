/**
 * Auth Configuration
 *
 * Reads OAuth provider settings from the unified config module,
 * which supports runtime injection (deployed) and import.meta.env (local dev).
 * Exports helper functions to detect which providers are enabled.
 */

import { getConfig } from '../config';

export interface GoogleConfig {
  enabled: boolean;
  clientId: string;
}

export interface Auth0Config {
  enabled: boolean;
  domain: string;
  clientId: string;
  audience?: string;
}

export interface MockConfig {
  enabled: boolean;
}

export interface AuthConfig {
  google: GoogleConfig;
  auth0: Auth0Config;
  mock: MockConfig;
}

/**
 * Build the full auth configuration from the unified config module.
 */
export function getAuthConfig(): AuthConfig {
  const config = getConfig();
  const googleClientId = config.googleClientId;
  const auth0Domain = config.auth0Domain;
  const auth0ClientId = config.auth0ClientId;
  const auth0Audience = config.auth0Audience;
  const mockExplicit = config.enableMockLogin;

  const googleEnabled = googleClientId.length > 0;
  const auth0Enabled = auth0Domain.length > 0 && auth0ClientId.length > 0;

  // Mock is enabled when no OAuth providers are configured,
  // or when explicitly set to 'true'
  const anyOAuthEnabled = googleEnabled || auth0Enabled;
  const mockEnabled = mockExplicit || !anyOAuthEnabled;

  return {
    google: {
      enabled: googleEnabled,
      clientId: googleClientId,
    },
    auth0: {
      enabled: auth0Enabled,
      domain: auth0Domain,
      clientId: auth0ClientId,
      audience: auth0Audience || undefined,
    },
    mock: {
      enabled: mockEnabled,
    },
  };
}

/** Check if Google login is available */
export function isGoogleEnabled(): boolean {
  return getAuthConfig().google.enabled;
}

/** Check if Auth0 login is available */
export function isAuth0Enabled(): boolean {
  return getAuthConfig().auth0.enabled;
}

/** Check if mock login is available */
export function isMockEnabled(): boolean {
  return getAuthConfig().mock.enabled;
}
