import type { AuthProvider } from './auth.js';


/** User info returned from OAuth providers */
export interface OAuthUserInfo {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface OAuthSession {
  provider: 'broker';
  login(): Promise<void>;
  logout(): Promise<void>;
  isAuthenticated(): boolean;
  getUserInfo(): OAuthUserInfo | null;
  getToken(): Promise<string | null>;
}

/**
 * Create an AuthProvider from an OAuthSession.
 * The returned AuthProvider is compatible with P1Client's authProvider config option.
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

export interface AuthMeResponse {
  id: string;
  type: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  authProvider?: string;
  tokenExpiry?: string;
  providerSubjectId?: string;
}

/**
 * Validate a token against the P1 backend's /api/auth/me endpoint.
 * Framework-agnostic — works in any JS environment with fetch().
 *
 * @param baseUrl - P1 backend base URL (e.g., "http://localhost:8787")
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
 * @internal This is a local-development helper. The backend only enables
 * `/api/auth/token` when `ENVIRONMENT === 'local'`; mock tokens are rejected
 * by all other environments. Do not use in production deployments.
 *
 * @param baseUrl - P1 backend base URL
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
