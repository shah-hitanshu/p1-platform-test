/**
 * OAuth integration helpers for CSS Client.
 * Provides Google and Auth0 OAuth flows that work with CSSClient's AuthProvider.
 */

import type { AuthProvider } from './auth.js';

/** Configuration for Google OAuth */
export interface GoogleOAuthConfig {
  clientId: string;
  /** Storage key for token persistence. Default: 'css_google_token' */
  storageKey?: string;
  /**
   * Called whenever a credential is received (from One Tap or renderButton).
   * Use this to update app state when login happens outside the `login()` promise.
   */
  onCredential?: (userInfo: OAuthUserInfo, token: string) => void;
}

/** Configuration for Auth0 OAuth */
export interface Auth0OAuthConfig {
  domain: string;
  clientId: string;
  audience?: string;
  redirectUri?: string;
  /** Storage key for token persistence. Default: 'css_auth0_token' */
  storageKey?: string;
}

/** User info returned from OAuth providers */
export interface OAuthUserInfo {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
}

/** OAuth session interface for managing login state */
export interface OAuthSession {
  /** The OAuth provider type */
  provider: 'google' | 'auth0';
  /** Login/authenticate the user */
  login(): Promise<void>;
  /** Logout the user */
  logout(): Promise<void>;
  /** Check if user is currently authenticated */
  isAuthenticated(): boolean;
  /** Get the current user info (null if not authenticated) */
  getUserInfo(): OAuthUserInfo | null;
  /**
   * Get a valid token, refreshing if near expiry.
   * Returns null if the token is expired and cannot be silently refreshed
   * (e.g., Google tokens require re-login).
   */
  getToken(): Promise<string | null>;
  /**
   * Render a provider-hosted sign-in button into the given container.
   * For Google, this renders the official GSI button (avoids One Tap cooldown issues).
   * Returns a cleanup function to remove the button.
   * Not all providers support this — returns null if unsupported.
   */
  renderButton?(container: HTMLElement): (() => void) | null;
}

/** Buffer before expiry at which we attempt a token refresh (5 minutes). */
const TOKEN_REFRESH_BUFFER_SECONDS = 300;

/**
 * Extract the `exp` claim from a JWT (seconds since epoch).
 * Returns null if the token is not a valid JWT or has no `exp`.
 */
function getTokenExpiry(token: string): number | null {
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp;
}

/**
 * Check if a token is expired or will expire within the refresh buffer.
 */
function isTokenExpiredOrExpiring(token: string): boolean {
  const exp = getTokenExpiry(token);
  if (exp === null) return false; // Can't determine expiry — assume valid
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds >= exp - TOKEN_REFRESH_BUFFER_SECONDS;
}

/**
 * Declare the Google Identity Services global types.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            use_fedcm_for_prompt?: boolean;
          }): void;
          prompt(callback?: (notification: { isNotDisplayed(): boolean; isSkippedMoment(): boolean }) => void): void;
          renderButton(parent: HTMLElement, options: { type?: string; theme?: string; size?: string; text?: string; width?: number }): void;
          revoke(hint: string, callback?: () => void): void;
          disableAutoSelect(): void;
        };
        oauth2: {
          initCodeClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { code?: string; error?: string }) => void;
            ux_mode?: string;
          }): { requestCode(): void };
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken(): void };
        };
      };
    };
  }
}

/**
 * Parse a JWT payload without verification (for display purposes only).
 * The token is NOT validated cryptographically — only decoded.
 */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    const payload = parts[1];
    if (!payload) return null;
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Load a script tag into the document head.
 * Returns a promise that resolves when the script loads.
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('loadScript requires a browser environment'));
      return;
    }

    // Check if the script is already loaded
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

const GOOGLE_GSI_SCRIPT = 'https://accounts.google.com/gsi/client';

/**
 * Create a Google OAuth session using Google Identity Services.
 *
 * @param config - Google OAuth configuration
 * @returns OAuthSession for managing Google sign-in
 */
export function createGoogleOAuth(config: GoogleOAuthConfig): OAuthSession {
  const storageKey = config.storageKey ?? 'css_google_token';
  let userInfo: OAuthUserInfo | null = null;
  let loginResolve: (() => void) | null = null;
  let loginReject: ((err: Error) => void) | null = null;

  // Restore user info from stored token on creation
  const existingToken =
    typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
  if (existingToken) {
    const payload = parseJwtPayload(existingToken);
    if (payload) {
      userInfo = {
        id: (payload.sub as string) ?? '',
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
        picture: payload.picture as string | undefined,
      };
    }
  }

  function handleCredentialResponse(response: { credential: string }): void {
    const token = response.credential;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, token);
    }

    const payload = parseJwtPayload(token);
    if (payload) {
      userInfo = {
        id: (payload.sub as string) ?? '',
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
        picture: payload.picture as string | undefined,
      };
    }

    // Notify via callback (for renderButton flow where login() wasn't called)
    if (config.onCredential && userInfo) {
      config.onCredential(userInfo, token);
    }

    if (loginResolve) {
      loginResolve();
      loginResolve = null;
      loginReject = null;
    }
  }

  let initialized = false;
  async function waitForGoogle(timeoutMs = 5000): Promise<void> {
    if (window.google?.accounts?.id) return;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Google Identity Services failed to load'));
        }
      }, 50);
    });
  }

  async function ensureInitialized(): Promise<void> {
    await loadScript(GOOGLE_GSI_SCRIPT);
    await waitForGoogle();
    if (!initialized) {
      window.google!.accounts.id.initialize({
        client_id: config.clientId,
        callback: handleCredentialResponse,
        use_fedcm_for_prompt: false,
      });
      initialized = true;
    }
  }

  const session: OAuthSession = {
    provider: 'google',

    async login(): Promise<void> {
      await ensureInitialized();

      return new Promise<void>((resolve, reject) => {
        loginResolve = resolve;
        loginReject = reject;

        window.google!.accounts.id.prompt((notification) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            // One Tap was suppressed (cooldown, browser restrictions, FedCM issues).
            // Consumers should use renderButton() as a more reliable alternative.
            if (loginReject) {
              loginReject(new Error('Google sign-in prompt was not displayed. The One Tap prompt may be in cooldown.'));
              loginResolve = null;
              loginReject = null;
            }
          }
        });
      });
    },

    renderButton(container: HTMLElement): (() => void) | null {
      let cancelled = false;

      ensureInitialized()
        .then(() => {
          if (cancelled || !window.google) return;
          window.google.accounts.id.renderButton(container, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            width: 300,
          });
        })
        .catch(() => {
          // GSI failed to load; button simply won't render.
          // User can still retry via page refresh.
        });

      return () => {
        cancelled = true;
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
      };
    },

    async logout(): Promise<void> {
      // Revoke before clearing state so we still have the email hint
      if (typeof window !== 'undefined' && window.google) {
        if (userInfo?.email) {
          window.google.accounts.id.revoke(userInfo.email);
        }
        window.google.accounts.id.disableAutoSelect();
      }

      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey);
      }
      userInfo = null;
    },

    isAuthenticated(): boolean {
      if (typeof localStorage === 'undefined') return false;
      const token = localStorage.getItem(storageKey);
      if (!token) return false;
      // Google ID tokens can't be silently refreshed, so expired = not authenticated
      return !isTokenExpiredOrExpiring(token);
    },

    getUserInfo(): OAuthUserInfo | null {
      return userInfo;
    },

    async getToken(): Promise<string | null> {
      if (typeof localStorage === 'undefined') return null;
      const token = localStorage.getItem(storageKey);
      if (!token) return null;
      // Google ID tokens cannot be silently refreshed.
      // Return null when expired so the caller can trigger re-login.
      if (isTokenExpiredOrExpiring(token)) {
        return null;
      }
      return token;
    },
  };

  return session;
}

/**
 * Create an Auth0 OAuth session using @auth0/auth0-spa-js.
 *
 * The @auth0/auth0-spa-js package is an optional peer dependency.
 * It will be dynamically imported at runtime.
 *
 * @param config - Auth0 OAuth configuration
 * @returns OAuthSession for managing Auth0 sign-in
 */
export function createAuth0OAuth(config: Auth0OAuthConfig): OAuthSession {
  const storageKey = config.storageKey ?? 'css_auth0_token';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let auth0Client: any = null;
  let userInfo: OAuthUserInfo | null = null;

  async function getClient(): Promise<unknown> {
    if (auth0Client) return auth0Client;

    try {
      // Dynamic import of the optional peer dependency
      const { Auth0Client } = await import('@auth0/auth0-spa-js');
      auth0Client = new Auth0Client({
        domain: config.domain,
        clientId: config.clientId,
        authorizationParams: {
          audience: config.audience,
          redirect_uri: config.redirectUri ?? window.location.origin,
        },
      });

      // Handle redirect callback if we're returning from a login redirect
      if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
        await (auth0Client as { handleRedirectCallback(): Promise<void> }).handleRedirectCallback();
        // Clean up the URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      return auth0Client;
    } catch {
      throw new Error(
        '@auth0/auth0-spa-js is required for Auth0 OAuth. Install it with: npm install @auth0/auth0-spa-js'
      );
    }
  }

  const session: OAuthSession = {
    provider: 'auth0',

    async login(): Promise<void> {
      const client = (await getClient()) as {
        loginWithPopup(): Promise<void>;
        getUser(): Promise<Record<string, unknown> | undefined>;
        getTokenSilently(): Promise<string>;
      };

      await client.loginWithPopup();

      const user = await client.getUser();
      if (user) {
        userInfo = {
          id: (user.sub as string) ?? '',
          email: user.email as string | undefined,
          name: user.name as string | undefined,
          picture: user.picture as string | undefined,
        };
      }

      // Cache the token
      const token = await client.getTokenSilently();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, token);
      }
    },

    async logout(): Promise<void> {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey);
      }
      userInfo = null;

      if (auth0Client) {
        await (auth0Client as { logout(opts: { logoutParams: { returnTo: string } }): Promise<void> }).logout({
          logoutParams: {
            returnTo: window.location.origin,
          },
        });
      }
    },

    isAuthenticated(): boolean {
      if (typeof localStorage === 'undefined') return false;
      const token = localStorage.getItem(storageKey);
      return token !== null;
    },

    getUserInfo(): OAuthUserInfo | null {
      return userInfo;
    },

    async getToken(): Promise<string | null> {
      if (typeof localStorage === 'undefined') return null;

      const cachedToken = localStorage.getItem(storageKey);

      // If we have a cached token that's not near expiry, return it directly
      if (cachedToken && !isTokenExpiredOrExpiring(cachedToken)) {
        return cachedToken;
      }

      // Token is missing or expiring — try silent refresh via Auth0 SDK
      if (!auth0Client) {
        // SDK not initialized yet; return cached token (may be stale) or null
        return cachedToken;
      }

      try {
        const freshToken = await (auth0Client as { getTokenSilently(): Promise<string> }).getTokenSilently();
        localStorage.setItem(storageKey, freshToken);
        return freshToken;
      } catch {
        // Silent refresh failed; clear cached token
        localStorage.removeItem(storageKey);
        return null;
      }
    },
  };

  return session;
}

/**
 * Create an AuthProvider from an OAuthSession.
 * The returned AuthProvider is compatible with CSSClient's authProvider config option.
 *
 * @param session - The OAuth session to derive the auth provider from
 * @returns AuthProvider function that returns `Bearer <token>`
 */
export function createOAuthAuthProvider(session: OAuthSession): AuthProvider {
  return async () => {
    const token = await session.getToken();
    if (!token) {
      throw new Error('No OAuth token available. Please log in first.');
    }
    return `Bearer ${token}`;
  };
}

/** Response from the /api/auth/me endpoint */
export interface AuthMeResponse {
  id: string;
  type: string;
  email?: string;
  authProvider?: string;
  tokenExpiry?: string;
  providerSubjectId?: string;
}

/**
 * Validate a token against the CSS backend's /api/auth/me endpoint.
 * Framework-agnostic — works in any JS environment with fetch().
 *
 * @param baseUrl - CSS backend base URL (e.g., "http://localhost:8787")
 * @param token - Bearer token to validate
 * @returns The authenticated user info, or null if the token is invalid
 */
export async function validateToken(
  baseUrl: string,
  token: string,
): Promise<AuthMeResponse | null> {
  try {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as AuthMeResponse;
  } catch {
    return null;
  }
}

/**
 * Login as a mock/demo user via POST /api/auth/token.
 * Framework-agnostic — works in any JS environment with fetch().
 *
 * @param baseUrl - CSS backend base URL
 * @param userId - The mock user ID to log in as
 * @returns Token and user info
 */
export async function loginMockUser(
  baseUrl: string,
  userId: string,
): Promise<{ token: string; user: { id: string; name: string; email: string } }> {
  const response = await fetch(`${baseUrl}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' }));
    throw new Error((error as { error?: string }).error ?? 'Login failed');
  }

  return response.json() as Promise<{
    token: string;
    user: { id: string; name: string; email: string };
  }>;
}
