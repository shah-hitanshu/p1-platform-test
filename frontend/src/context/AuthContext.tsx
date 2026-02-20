/**
 * Auth Provider Component
 *
 * Provides multi-provider authentication state and functions throughout the app.
 * Supports Google, Auth0, and mock identity providers.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';
import type { AuthProvider as AuthProviderType } from './AuthContextType';
import { loginAsUser } from '../api/auth';
import { setToken, clearToken, getToken } from '../api/client';
import { decodeJwtPayload, isTokenExpired } from '../utils/jwt';
import { AuthContext } from './AuthContextType';

interface AuthProviderProps {
  children: ReactNode;
}

const USER_KEY = 'css_auth_user';
const PROVIDER_KEY = 'css_auth_provider';

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeProvider, setActiveProvider] = useState<AuthProviderType | null>(null);

  // Check for stored session on mount
  useEffect(() => {
    let isMounted = true;

    const loadStoredAuth = () => {
      const storedUser = localStorage.getItem(USER_KEY);
      const storedProvider = localStorage.getItem(PROVIDER_KEY) as AuthProviderType | null;
      const token = getToken();

      if (storedUser && token && isMounted) {
        // Check if token is expired
        if (isTokenExpired(token)) {
          localStorage.removeItem(USER_KEY);
          localStorage.removeItem(PROVIDER_KEY);
          clearToken();
        } else {
          try {
            const parsed = JSON.parse(storedUser) as User;
            setUser(parsed);
            setActiveProvider(storedProvider);
          } catch {
            localStorage.removeItem(USER_KEY);
            localStorage.removeItem(PROVIDER_KEY);
            clearToken();
          }
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    };

    loadStoredAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const storeSession = useCallback((sessionUser: User, provider: AuthProviderType) => {
    setUser(sessionUser);
    setActiveProvider(provider);
    localStorage.setItem(USER_KEY, JSON.stringify(sessionUser));
    localStorage.setItem(PROVIDER_KEY, provider);
  }, []);

  /**
   * Mock login: calls POST /api/auth/token and stores the returned mock JWT.
   */
  const loginWithMock = useCallback(async (userId: string) => {
    const response = await loginAsUser(userId);
    setToken(response.token);
    storeSession(response.user, 'mock');
  }, [storeSession]);

  /**
   * Google login: stores the Google-issued ID token directly.
   * The backend validates it via JWKS. We decode the JWT to extract display info.
   */
  const loginWithGoogle = useCallback(async (credential: string) => {
    const payload = decodeJwtPayload(credential);
    if (!payload) {
      throw new Error('Unable to decode Google credential');
    }

    setToken(credential);

    const googleUser: User = {
      id: (payload.sub as string) ?? '',
      email: (payload.email as string) ?? '',
      name: (payload.name as string) ?? (payload.email as string) ?? '',
      avatarUrl: (payload.picture as string) ?? undefined,
      siteRoles: {},
    };

    storeSession(googleUser, 'google');
  }, [storeSession]);

  /**
   * Auth0 login: stores the Auth0 access token.
   * User profile is passed separately (from Auth0 SDK's getUser()).
   */
  const loginWithAuth0Token = useCallback(async (
    token: string,
    profile: { sub: string; email?: string; name?: string },
  ) => {
    setToken(token);

    const auth0User: User = {
      id: profile.sub,
      email: profile.email ?? '',
      name: profile.name ?? profile.email ?? '',
      siteRoles: {},
    };

    storeSession(auth0User, 'auth0');
  }, [storeSession]);

  /**
   * Logout: clears all stored auth state.
   */
  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setActiveProvider(null);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PROVIDER_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        activeProvider,
        loginWithMock,
        loginWithGoogle,
        loginWithAuth0Token,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
