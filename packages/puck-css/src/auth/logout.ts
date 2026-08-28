import { brokerLogout } from '@pantheon-systems/css-client';
import type { LogoutOutcome } from '@pantheon-systems/css-client';
import { DEFAULT_TOKEN_KEY, P1_LOGGED_IN_KEY } from './storage-keys.js';

export type { LogoutOutcome };

export interface PerformLogoutConfig {
  cssBaseUrl: string;
  siteApiToken?: string;
  /**
   * The puck-css token key, matching P1AuthProvider's `tokenStorageKey` prop.
   * Not the broker JWT key — css-client owns that one and resolves it itself.
   */
  tokenStorageKey?: string;
}

/**
 * Canonical logout for P1 broker-mode apps. Owns the full sequence:
 *   1. POST to CCR to obtain the Auth0 logout URL (token still present).
 *   2. On success: clear broker token (inside brokerLogout) and puck-css keys.
 *   3. Return the outcome — caller navigates on `signed_out`.
 *
 * On `error`, credentials are left intact so the caller can retry or fall back.
 * Puck-css keys are cleared on `no_session` too — the broker session is gone,
 * so local state should match.
 */
export async function performLogout(config: PerformLogoutConfig): Promise<LogoutOutcome> {
  // Only the fields css-client owns are forwarded. Passing the whole config
  // would hand it the puck-css token key, and it would hunt the broker JWT
  // under a key that never holds one — logging nobody out, silently.
  const { tokenStorageKey, ...brokerConfig } = config;
  const outcome = await brokerLogout(brokerConfig);

  if (outcome.status === 'signed_out' || outcome.status === 'no_session') {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(tokenStorageKey ?? DEFAULT_TOKEN_KEY);
      window.localStorage.removeItem(P1_LOGGED_IN_KEY);
    }
  }

  return outcome;
}
