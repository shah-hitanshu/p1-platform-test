/**
 * P1AuthProvider
 *
 * Reusable auth context for any React app integrating with P1.
 * Supports five auth modes: 'mock', 'google', 'auth0', 'css-authserver', and 'p1'.
 * Handles token lifecycle, validation, and expiry across all modes.
 *
 * Framework-agnostic within React — works with Next.js, Remix, Vite, CRA, etc.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  createGoogleOAuth,
  createAuth0OAuth,
  createP1AuthServerOAuth,
  validateToken,
  loginMockUser,
} from '@pantheon-systems/css-client';
import type { OAuthSession, OAuthUserInfo } from '@pantheon-systems/css-client';
import {
  getStoredTokens,
  getValidTokens,
  getUserInfo as getP1UserInfo,
  clearTokens as clearP1Tokens,
  storeTokens as storeP1Tokens,
  startDeviceFlow,
  pollForToken,
  isTokenExpired,
} from '../data/auth.js';
import type { AuthTokens } from '../data/auth.js';

export type AuthMode = 'mock' | 'google' | 'auth0' | 'css-authserver' | 'p1';

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  picture?: string;
}

export interface P1AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  token: string | null;
  error: string | null;
  authMode: AuthMode;
  isSessionExpired: boolean;
  login(userId?: string): Promise<void>;
  logout(): Promise<void>;
  /** Get a valid token, refreshing if needed. Returns null if session cannot be refreshed. */
  getToken: () => Promise<string | null>;
  /** Render a provider-hosted login button into the given container (Google only). */
  renderLoginButton?(container: HTMLElement): (() => void) | null;
}

const P1AuthContext = createContext<P1AuthContextValue | null>(null);

/**
 * Default demo users for mock auth mode.
 *
 * @internal Local-development only. These fixed UUIDs are only recognised by
 * the backend when `ENVIRONMENT === 'local'`. Do not rely on these identities
 * in production deployments.
 */
export const DEMO_USERS = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alice Developer' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Bob Teammate' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Carol Coder' },
];

const DEFAULT_TOKEN_KEY = 'p1_auth_token';

// Module-level: persists across React StrictMode's double-mount in development.
// OAuth authorization codes are single-use — only one concurrent handleCallback()
// must exchange the code. The second effect awaits the same shared promise rather
// than making a duplicate /token request (which would fail with invalid_grant).
let p1AuthCallbackPromise: Promise<void> | null = null;

export interface P1AuthProviderProps {
  /** Auth mode: 'mock' for demo users, 'google' or 'auth0' for OAuth. */
  authMode: AuthMode;
  /** P1 backend base URL (e.g., "http://localhost:8787"). */
  p1BaseUrl: string;
  /** Google OAuth client ID (required when authMode is 'google'). */
  googleClientId?: string;
  /** Auth0 domain (required when authMode is 'auth0'). */
  auth0Domain?: string;
  /** Auth0 client ID (required when authMode is 'auth0'). */
  auth0ClientId?: string;
  /** Auth0 audience (optional). */
  auth0Audience?: string;
  /** CSS site ID (used as OAuth client_id for css-authserver mode). */
  siteId?: string;
  /** P1 Auth Server URL (required when authMode is 'css-authserver'). */
  p1AuthServerUrl?: string;
  /** Redirect URI for P1 Auth Server callback (optional). */
  p1AuthRedirectUri?: string;
  /** localStorage key for token persistence. Default: 'p1_auth_token'. */
  tokenStorageKey?: string;
  children: React.ReactNode;
}

function createOAuthSession(
  authMode: AuthMode,
  props: P1AuthProviderProps,
  onCredential?: (info: OAuthUserInfo, token: string) => void,
): OAuthSession | null {
  if (authMode === 'google') {
    if (!props.googleClientId) {
      console.warn('P1AuthProvider: googleClientId is required for google auth mode');
      return null;
    }
    return createGoogleOAuth({ clientId: props.googleClientId, onCredential });
  }

  if (authMode === 'auth0') {
    if (!props.auth0Domain || !props.auth0ClientId) {
      console.warn('P1AuthProvider: auth0Domain and auth0ClientId are required for auth0 auth mode');
      return null;
    }
    return createAuth0OAuth({
      domain: props.auth0Domain,
      clientId: props.auth0ClientId,
      audience: props.auth0Audience,
    });
  }

  if (authMode === 'css-authserver') {
    if (!props.p1AuthServerUrl) {
      console.warn('P1AuthProvider: p1AuthServerUrl is required for css-authserver auth mode');
      return null;
    }
    if (!props.siteId) {
      console.warn('P1AuthProvider: siteId is required for css-authserver auth mode (used as OAuth client_id)');
      return null;
    }
    return createP1AuthServerOAuth({
      authServerUrl: props.p1AuthServerUrl,
      siteId: props.siteId,
      redirectUri: props.p1AuthRedirectUri,
      p1BaseUrl: props.p1BaseUrl,
    });
  }

  return null;
}

function oauthUserToAuthUser(info: OAuthUserInfo): AuthUser {
  return {
    id: info.id,
    name: info.name ?? info.email ?? info.id,
    email: info.email,
    picture: info.picture,
  };
}

function p1TokensToAuthUser(tokens: AuthTokens): AuthUser | null {
  const info = getP1UserInfo(tokens);
  try {
    const parts = tokens.id_token.split('.');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return {
      id: (payload.sub as string) ?? '',
      name: info.name ?? info.email ?? (payload.sub as string) ?? 'Unknown',
      email: info.email,
      picture: info.picture,
    };
  } catch {
    return null;
  }
}

export function P1AuthProvider(props: P1AuthProviderProps): React.ReactElement {
  const { authMode, p1BaseUrl, tokenStorageKey, children } = props;
  const storageKey = tokenStorageKey ?? DEFAULT_TOKEN_KEY;

  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  // Ref-based callback so the OAuthSession (created once) can update React state
  const stateRef = useRef({ setUser, setToken, setIsLoading });
  stateRef.current = { setUser, setToken, setIsLoading };

  const [oauthSession] = useState<OAuthSession | null>(() =>
    createOAuthSession(authMode, props, (info, credentialToken) => {
      stateRef.current.setToken(credentialToken);
      stateRef.current.setUser(oauthUserToAuthUser(info));
      stateRef.current.setIsLoading(false);
    }),
  );

  const getToken = useCallback(async (): Promise<string | null> => {
    if (authMode === 'p1') {
      const tokens = await getValidTokens();
      if (tokens) return tokens.access_token;
      setToken(null);
      setUser(null);
      setIsSessionExpired(true);
      return null;
    }
    if (authMode === 'mock') {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
    }
    if (oauthSession) {
      const freshToken = await oauthSession.getToken();
      if (freshToken) {
        return freshToken;
      } else {
        // Token refresh failed — session is expired
        setToken(null);
        setUser(null);
        setIsSessionExpired(true);
        return null;
      }
    }
    return null;
  }, [authMode, oauthSession, storageKey]);

  const isAuthenticated = user !== null && token !== null;

  // Validate existing token on mount
  useEffect(() => {
    let cancelled = false;

    function handleP1AuthChange() {
      const tokens = getStoredTokens();
      if (tokens && !isTokenExpired(tokens)) {
        const authUser = p1TokensToAuthUser(tokens);
        if (authUser) {
          setToken(tokens.access_token);
          setUser(authUser);
        }
      } else {
        setToken(null);
        setUser(null);
      }
    }

    if (authMode === 'p1') {
      window.addEventListener('p1-auth-change', handleP1AuthChange);
    }

    async function checkExistingAuth() {
      setIsLoading(true);

      if (authMode === 'p1') {
        const tokens = await getValidTokens();
        if (!cancelled && tokens) {
          const authUser = p1TokensToAuthUser(tokens);
          if (authUser) {
            setToken(tokens.access_token);
            setUser(authUser);
          }
        }
        if (!cancelled) setIsLoading(false);
        return;
      }

      // Handle OAuth callback if returning from a P1 Auth Server redirect.
      // Uses a shared module-level Promise to deduplicate concurrent handleCallback()
      // calls that arise from React StrictMode's double useEffect invocation in dev.
      // Authorization codes are single-use — only one /token fetch must occur.
      if (authMode === 'css-authserver' && oauthSession?.handleCallback) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('code') && urlParams.has('state')) {
          if (!p1AuthCallbackPromise) {
            // First effect to reach this point initiates the exchange.
            // .finally() clears the URL and resets the shared promise so that
            // future navigations (with a fresh ?code=) are handled correctly.
            p1AuthCallbackPromise = oauthSession.handleCallback().finally(() => {
              window.history.replaceState({}, document.title, window.location.pathname);
              p1AuthCallbackPromise = null;
            });
          }
          // Both effects await the same promise — only one /token request is made.
          try {
            await p1AuthCallbackPromise;
            // getToken() reads from localStorage, which handleCallback() populated.
            const callbackToken = await oauthSession.getToken();
            if (!cancelled && callbackToken) {
              setToken(callbackToken);
              const validated = await validateToken(p1BaseUrl, callbackToken);
              if (!cancelled && validated) {
                const info = oauthSession.getUserInfo();
                setUser({
                  id: validated.id,
                  name: validated.name ?? validated.email ?? validated.id,
                  email: validated.email,
                  picture: validated.avatarUrl ?? info?.picture,
                });
              }
            }
            if (!cancelled) setIsLoading(false);
            return;
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : 'OAuth callback failed');
              setIsLoading(false);
            }
            return;
          }
        }
      }

      if (authMode === 'mock') {
        const storedToken = localStorage.getItem(storageKey);
        if (storedToken) {
          const validated = await validateToken(p1BaseUrl, storedToken);
          if (!cancelled && validated) {
            setToken(storedToken);
            setUser({
              id: validated.id,
              name: validated.name ?? validated.email ?? validated.id,
              email: validated.email,
              picture: validated.avatarUrl,
            });
          }
          // Note: we intentionally do NOT remove from localStorage when validation fails.
          // getToken() in mock mode reads directly from localStorage, so the raw token
          // must remain available for retry / offline scenarios.
        }
      } else if (oauthSession) {
        if (oauthSession.isAuthenticated()) {
          const oauthToken = await oauthSession.getToken();
          if (!cancelled && oauthToken) {
            const validated = await validateToken(p1BaseUrl, oauthToken);
            if (!cancelled && validated) {
              const info = oauthSession.getUserInfo();
              setToken(oauthToken);
              setUser({
                id: validated.id,
                name: validated.name ?? validated.email ?? validated.id,
                email: validated.email,
                picture: validated.avatarUrl ?? info?.picture,
              });
            } else if (!cancelled) {
              // Use OAuth user info as fallback if /api/auth/me isn't reachable
              const info = oauthSession.getUserInfo();
              if (info) {
                setToken(oauthToken);
                setUser(oauthUserToAuthUser(info));
              }
            }
          } else if (!cancelled) {
            // Token expired (getToken returned null) — clear state for re-login
            setToken(null);
            setUser(null);
          }
        }
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    }

    void checkExistingAuth();

    return () => {
      cancelled = true;
      if (authMode === 'p1') {
        window.removeEventListener('p1-auth-change', handleP1AuthChange);
      }
    };
  }, [authMode, oauthSession, p1BaseUrl, storageKey]);

  const login = useCallback(
    async (userId?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        if (authMode === 'p1') {
          const deviceCode = await startDeviceFlow();
          window.open(
            deviceCode.verification_uri_complete || deviceCode.verification_uri,
            '_blank',
          );
          const tokens = await pollForToken(
            deviceCode.device_code,
            deviceCode.interval || 5,
          );
          storeP1Tokens(tokens);
          const authUser = p1TokensToAuthUser(tokens);
          if (authUser) {
            setToken(tokens.access_token);
            setUser(authUser);
          }
        } else if (authMode === 'mock') {
          const id = userId ?? DEMO_USERS[0]?.id ?? '11111111-1111-1111-1111-111111111111';
          const result = await loginMockUser(p1BaseUrl, id);
          localStorage.setItem(storageKey, result.token);
          const validated = await validateToken(p1BaseUrl, result.token);
          setToken(result.token);
          setUser({
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            picture: validated?.avatarUrl,
          });
        } else if (oauthSession) {
          await oauthSession.login();
          const oauthToken = await oauthSession.getToken();
          if (oauthToken) {
            setToken(oauthToken);
            const info = oauthSession.getUserInfo();
            if (info) {
              setUser(oauthUserToAuthUser(info));
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Login failed';
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [authMode, oauthSession, p1BaseUrl, storageKey],
  );

  const logout = useCallback(async () => {
    if (authMode === 'p1') {
      clearP1Tokens();
    } else if (authMode === 'mock') {
      localStorage.removeItem(storageKey);
    } else if (oauthSession) {
      await oauthSession.logout();
    }

    setToken(null);
    setUser(null);
    setError(null);
    setIsSessionExpired(false);
  }, [authMode, oauthSession, storageKey]);

  const renderLoginButton = oauthSession?.renderButton
    ? (container: HTMLElement) => oauthSession.renderButton?.(container) ?? null
    : undefined;

  const value: P1AuthContextValue = {
    isAuthenticated,
    isLoading,
    user,
    token,
    error,
    authMode,
    isSessionExpired,
    login,
    logout,
    getToken,
    renderLoginButton,
  };

  return (
    <P1AuthContext.Provider value={value}>{children}</P1AuthContext.Provider>
  );
}

/**
 * Hook to access the P1 auth context.
 * Must be used within a P1AuthProvider.
 */
export function useP1Auth(): P1AuthContextValue {
  const ctx = useContext(P1AuthContext);
  if (!ctx) {
    throw new Error('useP1Auth must be used within a P1AuthProvider');
  }
  return ctx;
}

/**
 * Like useP1Auth but returns null when used outside a P1AuthProvider.
 * Use this in internal components that need to subscribe to auth state
 * but may be rendered in contexts where the provider is absent.
 */
export function useOptionalP1Auth(): P1AuthContextValue | null {
  return useContext(P1AuthContext);
}
