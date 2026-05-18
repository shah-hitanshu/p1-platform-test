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
}

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
