import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOAuthAuthProvider, validateToken, loginMockUser } from '../src/oauth.js';
import type { OAuthSession } from '../src/oauth.js';

describe('createOAuthAuthProvider', () => {
  it('returns Bearer token from session', async () => {
    const mockSession: OAuthSession = {
      provider: 'broker',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUserInfo: vi.fn().mockReturnValue({ id: 'user-1' }),
      getToken: vi.fn().mockResolvedValue('my-oauth-token'),
    };

    const authProvider = createOAuthAuthProvider(mockSession);
    const result = await authProvider();
    expect(result).toBe('Bearer my-oauth-token');
  });

  it('throws if no token is available', async () => {
    const mockSession: OAuthSession = {
      provider: 'broker',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      getUserInfo: vi.fn().mockReturnValue(null),
      getToken: vi.fn().mockResolvedValue(null),
    };

    const authProvider = createOAuthAuthProvider(mockSession);
    await expect(authProvider()).rejects.toThrow('No OAuth token available');
  });

  it('is compatible with P1Client authProvider interface', async () => {
    const mockSession: OAuthSession = {
      provider: 'broker',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUserInfo: vi.fn().mockReturnValue({ id: 'user-1' }),
      getToken: vi.fn().mockResolvedValue('test-token'),
    };

    const authProvider = createOAuthAuthProvider(mockSession);
    const headerValue = await authProvider();
    expect(typeof headerValue).toBe('string');
    expect(headerValue.startsWith('Bearer ')).toBe(true);
  });
});

describe('validateToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns user info on a successful response', async () => {
    const userInfo = { id: 'user-1', type: 'user', email: 'a@b.com' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(userInfo), { status: 200 }),
    );

    const result = await validateToken('https://api.example.com', 'valid-token');
    expect(result).toEqual(userInfo);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/api/auth/me', {
      headers: { Authorization: 'Bearer valid-token' },
    });
  });

  it('returns null on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    const result = await validateToken('https://api.example.com', 'bad-token');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const result = await validateToken('https://api.example.com', 'any-token');
    expect(result).toBeNull();
  });
});

describe('loginMockUser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns token and user on success', async () => {
    const body = { token: 'mock-jwt', user: { id: 'u1', name: 'Alice', email: 'a@b.com' } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const result = await loginMockUser('https://api.example.com', 'u1');
    expect(result).toEqual(body);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1' }),
    });
  });

  it('throws with error message from response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'User not found' }), { status: 404 }),
    );

    await expect(loginMockUser('https://api.example.com', 'bad-id'))
      .rejects.toThrow('User not found');
  });

  it('throws with fallback message when response body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } }),
    );

    await expect(loginMockUser('https://api.example.com', 'u1'))
      .rejects.toThrow('Login failed');
  });
});
