/**
 * CSS Client Authentication Utilities
 *
 * Functions for creating authentication providers.
 */

/**
 * Authentication provider function type.
 * Returns the authorization header value.
 */
export type AuthProvider = () => Promise<string>;

/**
 * Creates an API key authentication provider.
 * Uses X-API-Key header format for agent API keys.
 *
 * @param apiKey - The API key to use
 * @returns Auth provider function
 */
export function createApiKeyAuth(apiKey: string): AuthProvider {
  return async () => `ApiKey ${apiKey}`;
}

/**
 * Token storage interface for user authentication.
 */
export interface TokenStorage {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

/**
 * Creates a token-based authentication provider.
 *
 * @param tokenStorage - Storage for the auth token
 * @returns Auth provider function
 */
export function createTokenAuth(tokenStorage: TokenStorage): AuthProvider {
  return async () => {
    const token = await tokenStorage.getToken();
    if (!token) {
      throw new Error('No authentication token available');
    }
    return `Bearer ${token}`;
  };
}

/**
 * In-memory token storage implementation.
 * Useful for testing or single-session apps.
 */
export class InMemoryTokenStorage implements TokenStorage {
  private token: string | null = null;

  async getToken(): Promise<string | null> {
    return this.token;
  }

  async setToken(token: string): Promise<void> {
    this.token = token;
  }

  async clearToken(): Promise<void> {
    this.token = null;
  }
}

/**
 * Browser localStorage token storage implementation.
 */
export class LocalStorageTokenStorage implements TokenStorage {
  constructor(private readonly key: string = 'css_auth_token') {}

  async getToken(): Promise<string | null> {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage.getItem(this.key);
  }

  async setToken(token: string): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.key, token);
    }
  }

  async clearToken(): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.key);
    }
  }
}
