/**
 * Auth Context Type
 *
 * Type definitions and context for multi-provider authentication.
 * Supports Google, Auth0, and mock identity providers.
 */

import { createContext } from 'react';
import type { User } from '../types';

export type AuthProvider = 'google' | 'auth0' | 'mock';

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  activeProvider: AuthProvider | null;
  loginWithMock: (userId: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  loginWithAuth0Token: (token: string, profile: { sub: string; email?: string; name?: string }) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
