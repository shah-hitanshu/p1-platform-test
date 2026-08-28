/**
 * Broker Authentication
 *
 * Implements the brokered auth flow. Supports two modes:
 *
 * **Proxy mode** (default): calls go to /p1/auth/login and /p1/auth/redeem
 * on the app's own server, which proxies to the CCR backend with the API key.
 *
 * **Direct mode**: when siteApiToken is provided, calls go straight to the
 * CCR backend with a Bearer token. Used for standalone (non-Next.js) apps.
 *
 * Flow:
 * 1. POST login endpoint → { transactionId, loginUrl }
 * 2. Open loginUrl for the user (via onLoginUrl callback)
 * 3. Poll POST redeem endpoint with transactionId until approved
 * 4. Store the broker JWT and populate user info
 */

import type { OAuthSession, OAuthUserInfo } from './oauth.js';
import { isTokenExpiredOrExpiring, extractUserInfo } from './jwt-utils.js';
import { sleep, trimTrailingSlash } from './utils.js';

export interface BrokerAuthConfig {
  cssBaseUrl: string;
  siteApiToken?: string;
  onLoginUrl: (url: string) => void;
  storageKey?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  signal?: AbortSignal;
  loginMode?: 'popup' | 'redirect';
}

export interface BrokerRedeemResult {
  token: string;
  userInfo: OAuthUserInfo | null;
}

export interface BrokerLogoutConfig {
  cssBaseUrl: string;
  siteApiToken?: string;
  storageKey?: string;
}

export type LogoutOutcome =
  | { status: 'signed_out'; logoutUrl: string }
  | { status: 'no_session' }
  | { status: 'error'; message: string };

export interface BrokerRedeemConfig {
  cssBaseUrl: string;
  siteApiToken?: string;
  storageKey?: string;
}

const PENDING_TX_KEY = 'ccr_broker_pending_tx';
const DEFAULT_TOKEN_KEY = 'ccr_broker_token';

// Pre-rename key names (PCC-3216). Migrated on read; drop after a release cycle.
const LEGACY_PENDING_TX_KEY = 'css_broker_pending_tx';
const LEGACY_TOKEN_KEY = 'css_broker_token';

function migrateLegacyKey(storage: Storage, legacyKey: string, key: string): void {
  const legacy = storage.getItem(legacyKey);
  if (legacy !== null) {
    if (storage.getItem(key) === null) {
      storage.setItem(key, legacy);
    }
    storage.removeItem(legacyKey);
  }
}

function resolveTokenKey(config: { storageKey?: string }): string {
  const storageKey = config.storageKey ?? DEFAULT_TOKEN_KEY;
  if (typeof window !== 'undefined' && storageKey === DEFAULT_TOKEN_KEY) {
    migrateLegacyKey(window.localStorage, LEGACY_TOKEN_KEY, storageKey);
  }
  return storageKey;
}

function migratePendingTxKey(): void {
  if (typeof window !== 'undefined') {
    migrateLegacyKey(window.sessionStorage, LEGACY_PENDING_TX_KEY, PENDING_TX_KEY);
  }
}

const PROXY_PATH = '/p1/auth';

function brokerEndpoint(config: BrokerAuthConfig, action: 'login' | 'redeem'): string {
  if (config.siteApiToken) {
    return `${trimTrailingSlash(config.cssBaseUrl)}/broker/${action}`;
  }
  return `${PROXY_PATH}/${action}`;
}

function brokerLogoutEndpoint(config: BrokerLogoutConfig): string {
  if (config.siteApiToken) {
    return `${trimTrailingSlash(config.cssBaseUrl)}/broker/logout`;
  }
  return `${PROXY_PATH}/logout`;
}

function brokerHeaders(config: BrokerAuthConfig): Record<string, string> {
  if (config.siteApiToken) {
    return { 'Authorization': `Bearer ${config.siteApiToken}` };
  }
  return {};
}

/**
 * Initiates broker logout by calling the CCR backend and returning the Auth0
 * logout URL. Does NOT navigate — the caller is responsible for redirecting.
 *
 * Outcomes:
 *   signed_out  — CCR returned a logout URL; caller should navigate there.
 *   no_session  — No stored broker token; nothing to sign out of.
 *   error       — CCR unreachable or returned an error; credentials left intact
 *                 so the caller can retry or fall back gracefully.
 *
 * The broker token is removed from storage only on `signed_out`, after the
 * URL is successfully obtained. On `error`, the token is preserved for retry.
 */
export async function brokerLogout(config: BrokerLogoutConfig): Promise<LogoutOutcome> {
  if (typeof window === 'undefined') {
    return { status: 'no_session' };
  }

  const storageKey = resolveTokenKey(config);
  const token = window.localStorage.getItem(storageKey);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(brokerLogoutEndpoint(config), {
      method: 'POST',
      headers,
      body: JSON.stringify({ returnTo: window.location.origin }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { status: 'error', message: `Broker logout failed (${response.status})` };
    }

    const { logoutUrl } = (await response.json()) as { logoutUrl?: string };
    if (typeof logoutUrl !== 'string') {
      return { status: 'error', message: 'Broker logout response missing logoutUrl' };
    }

    // Callers assign this to window.location, so a javascript: or data: URL
    // would run in the page's own origin. Only https: leaves this function.
    let parsedLogoutUrl: URL;
    try {
      parsedLogoutUrl = new URL(logoutUrl);
    } catch {
      return { status: 'error', message: 'Broker logout response has a malformed logoutUrl' };
    }
    if (parsedLogoutUrl.protocol !== 'https:') {
      return { status: 'error', message: 'Broker logout response has a non-HTTPS logoutUrl' };
    }

    // Clear the token only after successfully obtaining the Auth0 logout URL.
    if (token) window.localStorage.removeItem(storageKey);
    return { status: 'signed_out', logoutUrl };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Broker logout request failed',
    };
  }
}

/**
 * State the browser's origin so the server side can propose it as the post-login
 * redirect target (PCC-3531). Makes no security decision — CCR validates it.
 *
 * Two shapes because the hops differ: proxy mode sends `origin` only, since the
 * app's route composes the full URL from that plus its own base path; direct mode
 * has no server hop, so it sends the complete URL. Undefined with no location, so
 * the request stays as it was before this existed.
 */
function buildLoginBody(config: BrokerAuthConfig): Record<string, string> | undefined {
  const location = typeof window === 'undefined' ? undefined : window.location;
  const origin = location?.origin;
  if (!origin) {
    return undefined;
  }

  if (config.siteApiToken) {
    return { proposedRedirectUrl: `${origin}${location?.pathname ?? ''}` };
  }
  return { origin };
}

export function createBrokerAuth(config: BrokerAuthConfig): OAuthSession {
  const storageKey = resolveTokenKey(config);
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const maxPollAttempts = config.maxPollAttempts ?? 150;
  const loginMode = config.loginMode ?? 'popup';
  let userInfo: OAuthUserInfo | null = null;

  const existingToken =
    typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
  if (existingToken) {
    userInfo = extractUserInfo(existingToken);
  }

  const session: OAuthSession = {
    provider: 'broker',

    async login(): Promise<void> {
      const loginBody = buildLoginBody(config);
      const loginResponse = await fetch(brokerEndpoint(config, 'login'), {
        method: 'POST',
        headers: loginBody
          ? { ...brokerHeaders(config), 'Content-Type': 'application/json' }
          : brokerHeaders(config),
        ...(loginBody ? { body: JSON.stringify(loginBody) } : {}),
      });

      if (!loginResponse.ok) {
        let detail = '';
        try {
          const body = (await loginResponse.json()) as { error?: string };
          if (body.error) detail = `: ${body.error}`;
        } catch {
          // non-JSON body — status code alone is still useful
        }
        throw new Error(`Broker login failed (${loginResponse.status})${detail}`);
      }

      const { transactionId, loginUrl } = (await loginResponse.json()) as {
        transactionId: string;
        loginUrl: string;
      };

      if (loginMode === 'redirect') {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(
            PENDING_TX_KEY,
            JSON.stringify({ transactionId }),
          );
        }
        config.onLoginUrl(loginUrl);
        return;
      }

      config.onLoginUrl(loginUrl);

      for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
        if (config.signal?.aborted) {
          throw new Error('Broker login aborted');
        }

        const redeemResponse = await fetch(brokerEndpoint(config, 'redeem'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...brokerHeaders(config),
          },
          body: JSON.stringify({ transactionId }),
        });

        if (redeemResponse.ok) {
          const { token } = (await redeemResponse.json()) as { token: string };

          if (typeof window !== 'undefined') {
            window.localStorage.setItem(storageKey, token);
          }
          userInfo = extractUserInfo(token);
          return;
        }

        if (redeemResponse.status === 410) {
          throw new Error('Broker login failed: transaction expired');
        }
        if (redeemResponse.status === 400) {
          throw new Error('Broker login failed: transaction rejected');
        }

        if (attempt < maxPollAttempts - 1) {
          await sleep(pollIntervalMs, config.signal);
        }
      }

      throw new Error('Broker login timed out waiting for user approval');
    },

    async logout(): Promise<LogoutOutcome> {
      const outcome = await brokerLogout({
        cssBaseUrl: config.cssBaseUrl,
        storageKey,
        ...(config.siteApiToken !== undefined ? { siteApiToken: config.siteApiToken } : {}),
      });
      if (outcome.status === 'error') {
        // The token is kept for retry, so the identity that goes with it stays
        // too — otherwise the session reads as authenticated but anonymous.
        return outcome;
      }
      userInfo = null;
      if (outcome.status === 'signed_out' && typeof window !== 'undefined') {
        window.location.href = outcome.logoutUrl;
      }
      return outcome;
    },

    isAuthenticated(): boolean {
      if (typeof window === 'undefined') return false;
      const token = window.localStorage.getItem(storageKey);
      if (!token) return false;
      return !isTokenExpiredOrExpiring(token);
    },

    getUserInfo(): OAuthUserInfo | null {
      return userInfo;
    },

    async getToken(): Promise<string | null> {
      if (typeof window === 'undefined') return null;
      const token = window.localStorage.getItem(storageKey);
      if (!token) return null;
      if (isTokenExpiredOrExpiring(token)) return null;
      return token;
    },
  };

  return session;
}

export function hasPendingBrokerLogin(): boolean {
  if (typeof window === 'undefined') return false;
  migratePendingTxKey();
  return window.sessionStorage.getItem(PENDING_TX_KEY) !== null;
}

export async function redeemPendingBrokerLogin(
  config: BrokerRedeemConfig,
): Promise<BrokerRedeemResult | null> {
  if (typeof window === 'undefined') return null;

  migratePendingTxKey();
  const raw = window.sessionStorage.getItem(PENDING_TX_KEY);
  if (!raw) return null;

  let transactionId: string;
  try {
    ({ transactionId } = JSON.parse(raw) as { transactionId: string });
  } catch {
    window.sessionStorage.removeItem(PENDING_TX_KEY);
    return null;
  }

  const storageKey = resolveTokenKey(config);

  const endpoint = config.siteApiToken
    ? `${trimTrailingSlash(config.cssBaseUrl)}/broker/redeem`
    : `${PROXY_PATH}/redeem`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.siteApiToken) {
    headers['Authorization'] = `Bearer ${config.siteApiToken}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transactionId }),
  });

  if (response.status === 410) {
    window.sessionStorage.removeItem(PENDING_TX_KEY);
    throw new Error('Broker login failed: transaction expired');
  }
  if (response.status === 400) {
    window.sessionStorage.removeItem(PENDING_TX_KEY);
    throw new Error('Broker login failed: transaction rejected');
  }
  if (!response.ok) {
    throw new Error(`Broker redeem failed (${response.status})`);
  }

  window.sessionStorage.removeItem(PENDING_TX_KEY);
  const { token } = (await response.json()) as { token: string };
  window.localStorage.setItem(storageKey, token);

  return {
    token,
    userInfo: extractUserInfo(token),
  };
}
