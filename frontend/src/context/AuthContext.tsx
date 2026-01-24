/**
 * Auth Provider Component
 *
 * Provides authentication state and functions throughout the app.
 */

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';
import { loginAsUser } from '../api/auth';
import { setToken, clearToken, getToken } from '../api/client';
import { AuthContext } from './AuthContextType';

interface AuthProviderProps {
  children: ReactNode;
}

const USER_KEY = 'css_auth_user';

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for stored user on mount using lazy initialization
  useEffect(() => {
    let isMounted = true;

    const loadStoredAuth = () => {
      const storedUser = localStorage.getItem(USER_KEY);
      const token = getToken();

      if (storedUser && token && isMounted) {
        try {
          const parsed = JSON.parse(storedUser) as User;
          setUser(parsed);
        } catch {
          // Invalid stored data, clear it
          localStorage.removeItem(USER_KEY);
          clearToken();
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

  const login = async (userId: string) => {
    const response = await loginAsUser(userId);
    setToken(response.token);
    setUser(response.user);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  };

  const logout = () => {
    clearToken();
    setUser(null);
    localStorage.removeItem(USER_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
