/**
 * CSSAuthProvider
 *
 * Reusable auth context for any React app integrating with CSS.
 * Supports four auth modes: 'mock', 'google', 'auth0', and 'css-authserver'.
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
  createCSSAuthServerOAuth,
  validateToken,
  loginMockUser,
} from '@pantheon/css-client';
import type { OAuthSession, OAuthUserInfo } from '@pantheon/css-client';

export type AuthMode = 'mock' | 'google' | 'auth0' | 'css-authserver';

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  picture?: string;
}

export interface CSSAuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  token: string | null;
  error: string | null;
  authMode: AuthMode;
  login(userId?: string): Promise<void>;
  logout(): Promise<void>;
  /** Render a provider-hosted login button into the given container (Google only). */
  renderLoginButton?(container: HTMLElement): (() => void) | null;
}

const CSSAuthContext = createContext<CSSAuthContextValue | null>(null);

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

const DEFAULT_TOKEN_KEY = 'css_auth_token';

// Module-level: persists across React StrictMode's double-mount in development.
// OAuth authorization codes are single-use — only one concurrent handleCallback()
// must exchange the code. The second effect awaits the same shared promise rather
// than making a duplicate /token request (which would fail with invalid_grant).
let cssAuthCallbackPromise: Promise<void> | null = null;

export interface CSSAuthProviderProps {
  /** Auth mode: 'mock' for demo users, 'google' or 'auth0' for OAuth. */
  authMode: AuthMode;
  /** CSS backend base URL (e.g., "http://localhost:8787"). */
  cssBaseUrl: string;
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
  /** CSS Auth Server URL (required when authMode is 'css-authserver'). */
  cssAuthServerUrl?: string;
  /** Redirect URI for CSS Auth Server callback (optional). */
  cssAuthRedirectUri?: string;
  /** localStorage key for token persistence. Default: 'css_auth_token'. */
  tokenStorageKey?: string;
  children: React.ReactNode;
}

function createOAuthSession(
  authMode: AuthMode,
  props: CSSAuthProviderProps,
  onCredential?: (info: OAuthUserInfo, token: string) => void,
): OAuthSession | null {
  if (authMode === 'google') {
    if (!props.googleClientId) {
      console.warn('CSSAuthProvider: googleClientId is required for google auth mode');
      return null;
    }
    return createGoogleOAuth({ clientId: props.googleClientId, onCredential });
  }

  if (authMode === 'auth0') {
    if (!props.auth0Domain || !props.auth0ClientId) {
      console.warn('CSSAuthProvider: auth0Domain and auth0ClientId are required for auth0 auth mode');
      return null;
    }
    return createAuth0OAuth({
      domain: props.auth0Domain,
      clientId: props.auth0ClientId,
      audience: props.auth0Audience,
    });
  }

  if (authMode === 'css-authserver') {
    if (!props.cssAuthServerUrl) {
      console.warn('CSSAuthProvider: cssAuthServerUrl is required for css-authserver auth mode');
      return null;
    }
    if (!props.siteId) {
      console.warn('CSSAuthProvider: siteId is required for css-authserver auth mode (used as OAuth client_id)');
      return null;
    }
    return createCSSAuthServerOAuth({
      authServerUrl: props.cssAuthServerUrl,
      siteId: props.siteId,
      redirectUri: props.cssAuthRedirectUri,
      cssBaseUrl: props.cssBaseUrl,
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

export function CSSAuthProvider(props: CSSAuthProviderProps): React.ReactElement {
  const { authMode, cssBaseUrl, tokenStorageKey, children } = props;
  const storageKey = tokenStorageKey ?? DEFAULT_TOKEN_KEY;

  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const isAuthenticated = user !== null && token !== null;

  // Validate existing token on mount
  useEffect(() => {
    let cancelled = false;

    async function checkExistingAuth() {
      setIsLoading(true);

      // Handle OAuth callback if returning from a CSS Auth Server redirect.
      // Uses a shared module-level Promise to deduplicate concurrent handleCallback()
      // calls that arise from React StrictMode's double useEffect invocation in dev.
      // Authorization codes are single-use — only one /token fetch must occur.
      if (authMode === 'css-authserver' && oauthSession?.handleCallback) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('code') && urlParams.has('state')) {
          if (!cssAuthCallbackPromise) {
            // First effect to reach this point initiates the exchange.
            // .finally() clears the URL and resets the shared promise so that
            // future navigations (with a fresh ?code=) are handled correctly.
            cssAuthCallbackPromise = oauthSession.handleCallback().finally(() => {
              window.history.replaceState({}, document.title, window.location.pathname);
              cssAuthCallbackPromise = null;
            });
          }
          // Both effects await the same promise — only one /token request is made.
          try {
            await cssAuthCallbackPromise;
            // getToken() reads from localStorage, which handleCallback() populated.
            const callbackToken = await oauthSession.getToken();
            if (!cancelled && callbackToken) {
              setToken(callbackToken);
              const validated = await validateToken(cssBaseUrl, callbackToken);
              if (!cancelled && validated) {
                setUser({
                  id: validated.id,
                  name: validated.email ?? validated.id,
                  email: validated.email,
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
          const validated = await validateToken(cssBaseUrl, storedToken);
          if (!cancelled && validated) {
            setToken(storedToken);
            setUser({
              id: validated.id,
              name: validated.email ?? validated.id,
              email: validated.email,
            });
          } else if (!cancelled) {
            localStorage.removeItem(storageKey);
          }
        }
      } else if (oauthSession) {
        if (oauthSession.isAuthenticated()) {
          const oauthToken = await oauthSession.getToken();
          if (!cancelled && oauthToken) {
            const validated = await validateToken(cssBaseUrl, oauthToken);
            if (!cancelled && validated) {
              setToken(oauthToken);
              setUser({
                id: validated.id,
                name: validated.email ?? validated.id,
                email: validated.email,
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
    };
  }, [authMode, oauthSession, cssBaseUrl, storageKey]);

  const login = useCallback(
    async (userId?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        if (authMode === 'mock') {
          const id = userId ?? DEMO_USERS[0]?.id ?? '11111111-1111-1111-1111-111111111111';
          const result = await loginMockUser(cssBaseUrl, id);
          localStorage.setItem(storageKey, result.token);
          setToken(result.token);
          setUser({
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
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
    [authMode, oauthSession, cssBaseUrl, storageKey],
  );

  const logout = useCallback(async () => {
    if (authMode === 'mock') {
      localStorage.removeItem(storageKey);
    } else if (oauthSession) {
      await oauthSession.logout();
    }

    setToken(null);
    setUser(null);
    setError(null);
  }, [authMode, oauthSession, storageKey]);

  const renderLoginButton = oauthSession?.renderButton
    ? (container: HTMLElement) => oauthSession.renderButton!(container)
    : undefined;

  const value: CSSAuthContextValue = {
    isAuthenticated,
    isLoading,
    user,
    token,
    error,
    authMode,
    login,
    logout,
    renderLoginButton,
  };

  return (
    <CSSAuthContext.Provider value={value}>{children}</CSSAuthContext.Provider>
  );
}

/**
 * Hook to access the CSS auth context.
 * Must be used within a CSSAuthProvider.
 */
export function useCSSAuth(): CSSAuthContextValue {
  const ctx = useContext(CSSAuthContext);
  if (!ctx) {
    throw new Error('useCSSAuth must be used within a CSSAuthProvider');
  }
  return ctx;
}
