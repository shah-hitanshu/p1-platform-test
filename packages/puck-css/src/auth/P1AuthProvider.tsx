/**
 * P1AuthProvider
 *
 * Reusable auth context for any React app integrating with P1.
 * Supports two auth modes: 'mock' and 'broker'.
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
  createBrokerAuth,
  validateToken,
  loginMockUser,
  hasPendingBrokerLogin,
  redeemPendingBrokerLogin,
} from '@pantheon-systems/css-client';
import type { OAuthSession, OAuthUserInfo, BrokerRedeemResult } from '@pantheon-systems/css-client';

export type AuthMode = 'mock' | 'broker';

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
  getToken: () => Promise<string | null>;
}

const P1AuthContext = createContext<P1AuthContextValue | null>(null);

/**
 * @internal Local-development only. These fixed UUIDs are only recognised by
 * the backend when `ENVIRONMENT === 'local'`.
 */
export const DEMO_USERS = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alice Developer' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Bob Teammate' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Carol Coder' },
];

const DEFAULT_TOKEN_KEY = 'p1_auth_token';

export interface P1AuthProviderProps {
  /** Auth mode: 'mock' for demo users, 'broker' for auth broker. */
  authMode: AuthMode;
  /** P1 backend base URL (e.g., "http://localhost:8787"). */
  p1BaseUrl: string;
  /** localStorage key for token persistence. Default: 'p1_auth_token'. */
  tokenStorageKey?: string;
  children: React.ReactNode;
}

function oauthUserToAuthUser(info: OAuthUserInfo): AuthUser {
  return {
    id: info.id,
    name: info.name ?? info.email ?? info.id,
    email: info.email,
    picture: info.picture,
  };
}

export function P1AuthProvider(props: P1AuthProviderProps): React.ReactElement {
  const { authMode, p1BaseUrl, tokenStorageKey, children } = props;
  const storageKey = tokenStorageKey ?? DEFAULT_TOKEN_KEY;

  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  const stateRef = useRef({ setUser, setToken, setIsLoading });
  stateRef.current = { setUser, setToken, setIsLoading };

  const redirectingRef = useRef(false);
  const redeemPromiseRef = useRef<Promise<BrokerRedeemResult | null> | null>(null);

  const [brokerSession] = useState<OAuthSession | null>(() => {
    if (typeof window === 'undefined') return null;
    if (authMode !== 'broker') return null;
    return createBrokerAuth({
      cssBaseUrl: props.p1BaseUrl,
      loginMode: 'redirect',
      onLoginUrl: (url) => { window.location.href = url; },
    });
  });

  const getToken = useCallback(async (): Promise<string | null> => {
    if (authMode === 'mock') {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
    }
    if (brokerSession) {
      const freshToken = await brokerSession.getToken();
      if (freshToken) {
        return freshToken;
      } else {
        setToken(null);
        setUser(null);
        setIsSessionExpired(true);
        return null;
      }
    }
    return null;
  }, [authMode, brokerSession, storageKey]);

  const isAuthenticated = user !== null && token !== null;

  useEffect(() => {
    let cancelled = false;

    async function checkExistingAuth() {
      setIsLoading(true);

      if (authMode === 'broker' && hasPendingBrokerLogin()) {
        if (!redeemPromiseRef.current) {
          redeemPromiseRef.current = redeemPendingBrokerLogin({
            cssBaseUrl: p1BaseUrl,
          });
        }
        try {
          const result = await redeemPromiseRef.current;
          if (result && !cancelled) {
            setToken(result.token);
            if (result.userInfo) {
              setUser(oauthUserToAuthUser(result.userInfo));
            }
            const validated = await validateToken(p1BaseUrl, result.token);
            if (!cancelled && validated) {
              setUser({
                id: validated.id,
                name: validated.name ?? validated.email ?? validated.id,
                email: validated.email,
                picture: validated.avatarUrl,
              });
            }
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Login failed');
          }
        }
        if (!cancelled) {
          setIsLoading(false);
          redeemPromiseRef.current = null;
        }
        return;
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
        }
      } else if (brokerSession) {
        if (brokerSession.isAuthenticated()) {
          const brokerToken = await brokerSession.getToken();
          if (!cancelled && brokerToken) {
            const validated = await validateToken(p1BaseUrl, brokerToken);
            if (!cancelled && validated) {
              const info = brokerSession.getUserInfo();
              setToken(brokerToken);
              setUser({
                id: validated.id,
                name: validated.name ?? validated.email ?? validated.id,
                email: validated.email,
                picture: validated.avatarUrl ?? info?.picture,
              });
            } else if (!cancelled) {
              const info = brokerSession.getUserInfo();
              if (info) {
                setToken(brokerToken);
                setUser(oauthUserToAuthUser(info));
              }
            }
          } else if (!cancelled) {
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
  }, [authMode, brokerSession, p1BaseUrl, storageKey]);

  const login = useCallback(
    async (userId?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        if (authMode === 'mock') {
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
        } else if (brokerSession) {
          await brokerSession.login();
          if (hasPendingBrokerLogin()) {
            redirectingRef.current = true;
            return;
          }
          const brokerToken = await brokerSession.getToken();
          if (brokerToken) {
            setToken(brokerToken);
            const info = brokerSession.getUserInfo();
            if (info) {
              setUser(oauthUserToAuthUser(info));
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Login failed';
        setError(msg);
      } finally {
        if (!redirectingRef.current) {
          setIsLoading(false);
        }
      }
    },
    [authMode, brokerSession, p1BaseUrl, storageKey],
  );

  const logout = useCallback(async () => {
    if (authMode === 'mock') {
      localStorage.removeItem(storageKey);
    } else if (brokerSession) {
      await brokerSession.logout();
    }

    setToken(null);
    setUser(null);
    setError(null);
    setIsSessionExpired(false);
  }, [authMode, brokerSession, storageKey]);

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
