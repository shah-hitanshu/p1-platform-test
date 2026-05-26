/**
 * Broker Authentication
 *
 * Implements the brokered auth flow. Supports two modes:
 *
 * **Proxy mode** (default): calls go to /p1/auth/login and /p1/auth/redeem
 * on the app's own server, which proxies to the CSS backend with the API key.
 *
 * **Direct mode**: when siteApiToken is provided, calls go straight to the
 * CSS backend with a Bearer token. Used for standalone (non-Next.js) apps.
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

export interface BrokerRedeemConfig {
  cssBaseUrl: string;
  siteApiToken?: string;
  storageKey?: string;
}

const PENDING_TX_KEY = 'css_broker_pending_tx';

const PROXY_PATH = '/p1/auth';

function brokerEndpoint(config: BrokerAuthConfig, action: 'login' | 'redeem'): string {
  if (config.siteApiToken) {
    return `${trimTrailingSlash(config.cssBaseUrl)}/broker/${action}`;
  }
  return `${PROXY_PATH}/${action}`;
}

function brokerHeaders(config: BrokerAuthConfig): Record<string, string> {
  if (config.siteApiToken) {
    return { 'Authorization': `Bearer ${config.siteApiToken}` };
  }
  return {};
}

export function createBrokerAuth(config: BrokerAuthConfig): OAuthSession {
  const storageKey = config.storageKey ?? 'css_broker_token';
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
      const loginResponse = await fetch(brokerEndpoint(config, 'login'), {
        method: 'POST',
        headers: brokerHeaders(config),
      });

      if (!loginResponse.ok) {
        let detail = '';
        try {
          const body = await loginResponse.json() as { error?: string };
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

    async logout(): Promise<void> {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(storageKey);
      }
      userInfo = null;
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
  return window.sessionStorage.getItem(PENDING_TX_KEY) !== null;
}

export async function redeemPendingBrokerLogin(
  config: BrokerRedeemConfig,
): Promise<BrokerRedeemResult | null> {
  if (typeof window === 'undefined') return null;

  const raw = window.sessionStorage.getItem(PENDING_TX_KEY);
  if (!raw) return null;

  let transactionId: string;
  try {
    ({ transactionId } = JSON.parse(raw) as { transactionId: string });
  } catch {
    window.sessionStorage.removeItem(PENDING_TX_KEY);
    return null;
  }

  const storageKey = config.storageKey ?? 'css_broker_token';

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
