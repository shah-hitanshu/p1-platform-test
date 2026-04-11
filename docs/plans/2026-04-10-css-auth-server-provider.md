# CSS Auth Server Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Add `authMode: 'css-authserver'` to the puck-css-integration monorepo so consuming sites authenticate via the CSS Auth Server (OAuth 2.0 Authorization Code + PKCE) instead of registering directly with Google or Auth0.

**Architecture:** The CSS Auth Server (a standalone Cloudflare Worker at `workers/auth-server/` in the `collaborative-state-system` repo) acts as an OAuth 2.0 Authorization Server, issuing opaque tokens in `userId:grantId:secret` format (no dots). This provider implements a standard browser-based Authorization Code + PKCE flow: redirect to `/authorize`, handle callback with code exchange via POST `/token`, store the resulting opaque access token + optional refresh token in localStorage. The new mode is purely additive — existing `google`, `auth0`, and `mock` modes are unchanged.

**Tech Stack:** TypeScript, Vitest, React, Web Crypto API (for PKCE S256), `@testing-library/react` (for component tests)

**Key design decisions:**
1. **PKCE S256 only** — `code_challenge_method` is always `S256`. The CSS Auth Server enforces `allowPlainPKCE: false`.
2. **Opaque tokens** — CSS Auth Server tokens are `userId:grantId:secret` format (no dots, not JWTs). The `OAuthSession.getToken()` returns these as-is. No JWT parsing for expiry — instead rely on the auth server's token TTL and attempt refresh when `getToken()` is called.
3. **State parameter** — random 32-byte hex string stored in `sessionStorage`, validated on callback. Not HMAC-signed (matches the auth server's current approach; HMAC signing is a future TODO on both sides).
4. **PKCE verifier/challenge storage** — stored in `sessionStorage` alongside state, cleared after callback.
5. **Token refresh** — if a `refresh_token` is returned by the token exchange, store it in localStorage and use it to refresh the access token when `getToken()` is called and the access token is missing or expired.
6. **User info** — after obtaining the access token, call `GET /api/auth/me` on the CSS backend (the same `validateToken()` helper already in the codebase) to populate `OAuthUserInfo`. Opaque tokens contain no user claims.
7. **`OAuthSession.provider`** — extend the union type from `'google' | 'auth0'` to `'google' | 'auth0' | 'css-authserver'`.
8. **`renderButton`** — returns `null` for `css-authserver` mode. The login UI is a redirect-based "Sign in" button rendered by `CSSLoginPage`, not a provider-hosted widget.
9. **Redirect URI default** — `window.location.origin + '/auth/callback'` unless `CSS_AUTH_REDIRECT_URI` is configured.
10. **`handleCallback()` as a separate method** — the session exposes `handleCallback()` so that consuming apps can call it on the callback route. The `CSSAuthProvider` calls it automatically on mount if `code` + `state` are present in the URL query string.

---

### Task 1: PKCE Utility Functions

**Files:**
- Modify: `packages/css-client/src/oauth.ts` (add exports at bottom of file)
- Test: `packages/css-client/tests/oauth.spec.ts` (add new describe block)

These are pure functions with no dependencies beyond Web Crypto API.

**Step 1: Write the failing tests**

Add the following to `packages/css-client/tests/oauth.spec.ts`:

```typescript
import { generateCodeVerifier, computeS256Challenge, generateState } from '../src/oauth.js';

describe('PKCE utility functions', () => {
  it('generateCodeVerifier returns a string between 43 and 128 characters', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('generateCodeVerifier uses only URL-safe characters (no +, /, =)', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('generateCodeVerifier produces unique values on successive calls', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });

  it('computeS256Challenge produces a 43-character base64url string', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await computeS256Challenge(verifier);
    // S256 challenge is SHA-256 (32 bytes) base64url-encoded = 43 chars (no padding)
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('computeS256Challenge matches RFC 7636 Appendix B test vector', async () => {
    // RFC 7636 Appendix B test vector:
    // code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // code_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const challenge = await computeS256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generateState returns a 64-character hex string', () => {
    const state = generateState();
    expect(state).toHaveLength(64);
    expect(state).toMatch(/^[0-9a-f]+$/);
  });

  it('generateState produces unique values on successive calls', () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).not.toBe(s2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/css-client test -- --run tests/oauth.spec.ts`
Expected: FAIL — `generateCodeVerifier`, `computeS256Challenge`, `generateState` are not exported from `../src/oauth.js`

**Step 3: Write minimal implementation**

Add the following to the bottom of `packages/css-client/src/oauth.ts` (before the closing of the file, after the `loginMockUser` function):

```typescript
/**
 * Generate a PKCE code verifier (RFC 7636 Section 4.1).
 * Produces a 64-character URL-safe random string.
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Compute the S256 code challenge from a code verifier (RFC 7636 Section 4.2).
 * Returns the SHA-256 hash of the verifier, base64url-encoded without padding.
 */
export async function computeS256Challenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Generate a random state parameter for CSRF protection.
 * Returns a 64-character hex string (32 random bytes).
 */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Base64url-encode a Uint8Array without padding (RFC 4648 Section 5).
 */
function base64UrlEncode(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/css-client test -- --run tests/oauth.spec.ts`
Expected: ALL PASS (existing 14 tests + 7 new PKCE tests)

**Step 5: Commit**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
git add packages/css-client/src/oauth.ts packages/css-client/tests/oauth.spec.ts
git commit -m "feat: add PKCE utility functions (generateCodeVerifier, computeS256Challenge, generateState)"
```

---

### Task 2: Extend OAuthSession Interface for `css-authserver`

**Files:**
- Modify: `packages/css-client/src/oauth.ts:39-63` (update `OAuthSession` interface)
- Test: `packages/css-client/tests/oauth.spec.ts` (interface conformance test)

The `OAuthSession.provider` type must be extended to include `'css-authserver'`, and a `handleCallback` method must be added for redirect-based OAuth flows.

**Step 1: Write the failing test**

Add to `packages/css-client/tests/oauth.spec.ts`:

```typescript
describe('OAuthSession interface conformance for css-authserver', () => {
  it('accepts css-authserver as a valid provider value', () => {
    const session: OAuthSession = {
      provider: 'css-authserver',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      getUserInfo: vi.fn().mockReturnValue(null),
      getToken: vi.fn().mockResolvedValue(null),
      handleCallback: vi.fn().mockResolvedValue(undefined),
    };
    expect(session.provider).toBe('css-authserver');
    expect(session.handleCallback).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/css-client test -- --run tests/oauth.spec.ts`
Expected: FAIL — TypeScript error: `'css-authserver'` is not assignable to `'google' | 'auth0'`; `handleCallback` does not exist on type `OAuthSession`

**Step 3: Write minimal implementation**

In `packages/css-client/src/oauth.ts`, update the `OAuthSession` interface:

Change the `provider` field from:
```typescript
provider: 'google' | 'auth0';
```
to:
```typescript
provider: 'google' | 'auth0' | 'css-authserver';
```

Add after the `renderButton` method:
```typescript
/**
 * Handle the OAuth callback after redirect.
 * Extracts the authorization code from the URL, validates the state parameter,
 * and exchanges the code for tokens.
 * Only used by redirect-based flows (css-authserver). No-op for others.
 */
handleCallback?(): Promise<void>;
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/css-client test -- --run tests/oauth.spec.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
git add packages/css-client/src/oauth.ts packages/css-client/tests/oauth.spec.ts
git commit -m "feat: extend OAuthSession interface with css-authserver provider and handleCallback"
```

---

### Task 3: Implement `createCSSAuthServerOAuth`

**Files:**
- Modify: `packages/css-client/src/oauth.ts` (add config interface + factory function)
- Test: `packages/css-client/tests/oauth.spec.ts` (session lifecycle tests)

This is the core implementation — a factory function that returns an `OAuthSession` implementing the full Authorization Code + PKCE flow against the CSS Auth Server.

**Step 1: Write the failing tests**

Add to `packages/css-client/tests/oauth.spec.ts`:

```typescript
import { createCSSAuthServerOAuth } from '../src/oauth.js';
import type { CSSAuthServerOAuthConfig } from '../src/oauth.js';

// --- CSS Auth Server tests ---
// IMPORTANT: The mocks below (sessionStorage, location, history) must be scoped
// to avoid polluting the existing Google/Auth0 tests above. We save and restore
// the originals in beforeAll/afterAll for this describe block.

const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((_index: number) => null),
  };
})();

const locationMock = {
  origin: 'https://mysite.com',
  href: 'https://mysite.com/editor',
  search: '',
};

const replaceStateMock = vi.fn();

const defaultConfig: CSSAuthServerOAuthConfig = {
  authServerUrl: 'https://auth.css.example.com',
  siteId: 'site-abc-123',
  redirectUri: 'https://mysite.com/auth/callback',
  cssBaseUrl: 'https://api.css.example.com',
};

describe('createCSSAuthServerOAuth', () => {
  // Save originals so we don't pollute other test blocks
  const savedSessionStorage = global.sessionStorage;
  const savedLocation = global.location;
  const savedHistory = global.history;
  const savedFetch = global.fetch;

  beforeAll(() => {
    Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock, writable: true, configurable: true });
    Object.defineProperty(global, 'location', { value: locationMock, writable: true, configurable: true });
    Object.defineProperty(global, 'history', { value: { replaceState: replaceStateMock }, writable: true, configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(global, 'sessionStorage', { value: savedSessionStorage, writable: true, configurable: true });
    Object.defineProperty(global, 'location', { value: savedLocation, writable: true, configurable: true });
    Object.defineProperty(global, 'history', { value: savedHistory, writable: true, configurable: true });
    global.fetch = savedFetch;
  });

  beforeEach(() => {
    localStorageMock.clear();
    sessionStorageMock.clear();
    locationMock.href = 'https://mysite.com/editor';
    locationMock.search = '';
    vi.restoreAllMocks();
  });

  it('creates a session with provider set to css-authserver', () => {
    const session = createCSSAuthServerOAuth(defaultConfig);
    expect(session.provider).toBe('css-authserver');
  });

  it('is not authenticated initially with no stored token', () => {
    const session = createCSSAuthServerOAuth(defaultConfig);
    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
  });

  it('restores token from localStorage on creation', () => {
    localStorageMock.setItem('css_authserver_token', 'user123:grant456:secretxyz');
    const session = createCSSAuthServerOAuth(defaultConfig);
    expect(session.isAuthenticated()).toBe(true);
  });

  it('returns stored opaque token from getToken', async () => {
    localStorageMock.setItem('css_authserver_token', 'user123:grant456:secretxyz');
    const session = createCSSAuthServerOAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBe('user123:grant456:secretxyz');
  });

  it('returns null from getToken when not authenticated', async () => {
    const session = createCSSAuthServerOAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBeNull();
  });

  it('login() sets location.href to auth server /authorize with correct params', async () => {
    const session = createCSSAuthServerOAuth(defaultConfig);
    await session.login();

    // Verify redirect URL structure
    const redirectUrl = new URL(locationMock.href);
    expect(redirectUrl.origin).toBe('https://auth.css.example.com');
    expect(redirectUrl.pathname).toBe('/authorize');
    expect(redirectUrl.searchParams.get('client_id')).toBe('site-abc-123');
    expect(redirectUrl.searchParams.get('redirect_uri')).toBe('https://mysite.com/auth/callback');
    expect(redirectUrl.searchParams.get('response_type')).toBe('code');
    expect(redirectUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirectUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(redirectUrl.searchParams.get('state')).toBeTruthy();
  });

  it('login() stores state and code_verifier in sessionStorage', async () => {
    const session = createCSSAuthServerOAuth(defaultConfig);
    await session.login();

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'css_authserver_state',
      expect.any(String),
    );
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'css_authserver_verifier',
      expect.any(String),
    );
  });

  it('handleCallback() exchanges code for tokens on valid callback', async () => {
    // Pre-populate sessionStorage with state + verifier
    const state = 'abc123def456';
    sessionStorageMock.setItem('css_authserver_state', state);
    sessionStorageMock.setItem('css_authserver_verifier', 'test-verifier');

    // Set URL to callback with code + state
    locationMock.search = `?code=auth-code-xyz&state=${state}`;

    // Mock fetch for token exchange
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'user1:grant1:secret1',
          token_type: 'bearer',
          refresh_token: 'refresh-token-abc',
        }),
    });
    global.fetch = mockFetch;

    const session = createCSSAuthServerOAuth(defaultConfig);
    await session.handleCallback!();

    // Verify token exchange request
    expect(mockFetch).toHaveBeenCalledWith(
      'https://auth.css.example.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    // Verify body params
    const callArgs = mockFetch.mock.calls[0];
    const body = callArgs[1].body as string;
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('auth-code-xyz');
    expect(params.get('redirect_uri')).toBe('https://mysite.com/auth/callback');
    expect(params.get('client_id')).toBe('site-abc-123');
    expect(params.get('code_verifier')).toBe('test-verifier');

    // Verify tokens stored
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'css_authserver_token',
      'user1:grant1:secret1',
    );
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'css_authserver_refresh_token',
      'refresh-token-abc',
    );

    // Verify sessionStorage cleanup
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('css_authserver_state');
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('css_authserver_verifier');
  });

  it('handleCallback() rejects on state mismatch (CSRF protection)', async () => {
    sessionStorageMock.setItem('css_authserver_state', 'correct-state');
    sessionStorageMock.setItem('css_authserver_verifier', 'test-verifier');
    locationMock.search = '?code=auth-code-xyz&state=wrong-state';

    const session = createCSSAuthServerOAuth(defaultConfig);
    await expect(session.handleCallback!()).rejects.toThrow('state mismatch');
  });

  it('handleCallback() rejects on token exchange failure', async () => {
    const state = 'valid-state';
    sessionStorageMock.setItem('css_authserver_state', state);
    sessionStorageMock.setItem('css_authserver_verifier', 'test-verifier');
    locationMock.search = `?code=auth-code-xyz&state=${state}`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_grant' }),
    });

    const session = createCSSAuthServerOAuth(defaultConfig);
    await expect(session.handleCallback!()).rejects.toThrow();
  });

  it('handleCallback() rejects when code is missing from URL', async () => {
    sessionStorageMock.setItem('css_authserver_state', 'some-state');
    sessionStorageMock.setItem('css_authserver_verifier', 'test-verifier');
    locationMock.search = '?state=some-state';

    const session = createCSSAuthServerOAuth(defaultConfig);
    await expect(session.handleCallback!()).rejects.toThrow('code');
  });

  it('logout() clears all stored tokens and user info', async () => {
    localStorageMock.setItem('css_authserver_token', 'user1:grant1:secret1');
    localStorageMock.setItem('css_authserver_refresh_token', 'refresh-abc');
    const session = createCSSAuthServerOAuth(defaultConfig);

    await session.logout();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.getUserInfo()).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('css_authserver_token');
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('css_authserver_refresh_token');
  });

  it('getToken() attempts refresh when access token is missing but refresh token exists', async () => {
    localStorageMock.setItem('css_authserver_refresh_token', 'refresh-token-abc');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-user1:new-grant1:new-secret1',
          token_type: 'bearer',
        }),
    });

    const session = createCSSAuthServerOAuth(defaultConfig);
    const token = await session.getToken();

    expect(token).toBe('new-user1:new-grant1:new-secret1');

    // Verify refresh request
    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = new URLSearchParams(callArgs[1].body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token-abc');
    expect(body.get('client_id')).toBe('site-abc-123');
  });

  it('getToken() returns null when refresh fails', async () => {
    localStorageMock.setItem('css_authserver_refresh_token', 'expired-refresh');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_grant' }),
    });

    const session = createCSSAuthServerOAuth(defaultConfig);
    const token = await session.getToken();
    expect(token).toBeNull();
    // Refresh token should be cleared on failure
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('css_authserver_refresh_token');
  });

  it('renderButton returns null (css-authserver uses redirect, not provider widget)', () => {
    const session = createCSSAuthServerOAuth(defaultConfig);
    expect(session.renderButton).toBeDefined();
    // css-client tests run in Node environment (no DOM), so pass a mock element
    const cleanup = session.renderButton!({} as HTMLElement);
    expect(cleanup).toBeNull();
  });

  it('uses custom storageKey when provided', () => {
    localStorageMock.setItem('my_custom_key', 'user1:grant1:secret1');
    const session = createCSSAuthServerOAuth({
      ...defaultConfig,
      storageKey: 'my_custom_key',
    });
    expect(session.isAuthenticated()).toBe(true);
  });
});

describe('createOAuthAuthProvider with css-authserver', () => {
  it('returns Bearer token from css-authserver session', async () => {
    const mockSession: OAuthSession = {
      provider: 'css-authserver',
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUserInfo: vi.fn().mockReturnValue({ id: 'user-1' }),
      getToken: vi.fn().mockResolvedValue('user1:grant1:secret1'),
    };

    const authProvider = createOAuthAuthProvider(mockSession);
    const result = await authProvider();
    expect(result).toBe('Bearer user1:grant1:secret1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/css-client test -- --run tests/oauth.spec.ts`
Expected: FAIL — `createCSSAuthServerOAuth` not exported, `CSSAuthServerOAuthConfig` type not found

**Step 3: Write minimal implementation**

Add the following to `packages/css-client/src/oauth.ts` after the `Auth0OAuthConfig` interface:

```typescript
/** Configuration for CSS Auth Server OAuth */
export interface CSSAuthServerOAuthConfig {
  /** Base URL of the CSS Auth Server (e.g., "https://auth.css.example.com") */
  authServerUrl: string;
  /** Site ID used as the OAuth client_id */
  siteId: string;
  /** Redirect URI for the OAuth callback. Default: window.location.origin + '/auth/callback' */
  redirectUri?: string;
  /** CSS backend base URL for token validation via /api/auth/me */
  cssBaseUrl: string;
  /** Storage key prefix for token persistence. Default: 'css_authserver' */
  storageKey?: string;
}
```

Add the factory function after `createAuth0OAuth`:

```typescript
/**
 * Create a CSS Auth Server OAuth session using Authorization Code + PKCE.
 *
 * The CSS Auth Server is an OAuth 2.0 Authorization Server that proxies
 * Google/Auth0 authentication. Consuming sites never register with Google
 * directly — they authenticate against the CSS Auth Server using the site ID
 * as the client_id.
 *
 * @param config - CSS Auth Server OAuth configuration
 * @returns OAuthSession for managing CSS Auth Server sign-in
 */
export function createCSSAuthServerOAuth(config: CSSAuthServerOAuthConfig): OAuthSession {
  const keyPrefix = config.storageKey ?? 'css_authserver';
  const tokenKey = `${keyPrefix}_token`;
  const refreshKey = `${keyPrefix}_refresh_token`;
  const stateKey = `${keyPrefix}_state`;
  const verifierKey = `${keyPrefix}_verifier`;
  // Use globalThis instead of window so this works in both browser and Node test environments
  const redirectUri = config.redirectUri ?? `${globalThis.location?.origin ?? ''}/auth/callback`;
  let userInfo: OAuthUserInfo | null = null;

  function hasToken(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(tokenKey) !== null;
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (typeof localStorage === 'undefined') return null;
    const refreshToken = localStorage.getItem(refreshKey);
    if (!refreshToken) return null;

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.siteId,
      });

      const response = await fetch(`${config.authServerUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        // Refresh token is no longer valid — clear it
        localStorage.removeItem(refreshKey);
        return null;
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        token_type: string;
      };

      localStorage.setItem(tokenKey, data.access_token);
      if (data.refresh_token) {
        localStorage.setItem(refreshKey, data.refresh_token);
      }
      return data.access_token;
    } catch {
      localStorage.removeItem(refreshKey);
      return null;
    }
  }

  const session: OAuthSession = {
    provider: 'css-authserver',

    async login(): Promise<void> {
      const verifier = generateCodeVerifier();
      const challenge = await computeS256Challenge(verifier);
      const state = generateState();

      // Store PKCE verifier and state in sessionStorage for callback validation
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(stateKey, state);
        sessionStorage.setItem(verifierKey, verifier);
      }

      const params = new URLSearchParams({
        client_id: config.siteId,
        redirect_uri: redirectUri,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      });

      // Redirect to the auth server's authorization endpoint
      globalThis.location.href = `${config.authServerUrl}/authorize?${params.toString()}`;
    },

    async handleCallback(): Promise<void> {
      const urlParams = new URLSearchParams(globalThis.location.search);
      const code = urlParams.get('code');
      const returnedState = urlParams.get('state');

      if (!code) {
        throw new Error('OAuth callback missing authorization code');
      }

      // Validate state parameter (CSRF protection)
      const storedState =
        typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(stateKey) : null;
      if (!storedState || storedState !== returnedState) {
        throw new Error('OAuth callback state mismatch — possible CSRF attack');
      }

      const storedVerifier =
        typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(verifierKey) : null;
      if (!storedVerifier) {
        throw new Error('OAuth callback missing PKCE code verifier');
      }

      // Exchange authorization code for tokens
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.siteId,
        code_verifier: storedVerifier,
      });

      const response = await fetch(`${config.authServerUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(`Token exchange failed: ${errorData.error ?? response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        token_type: string;
      };

      // Store tokens
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(tokenKey, data.access_token);
        if (data.refresh_token) {
          localStorage.setItem(refreshKey, data.refresh_token);
        }
      }

      // Clean up sessionStorage
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(stateKey);
        sessionStorage.removeItem(verifierKey);
      }
    },

    renderButton(_container: HTMLElement): (() => void) | null {
      // CSS Auth Server uses redirect-based login, not a provider-hosted button
      return null;
    },

    async logout(): Promise<void> {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(refreshKey);
      }
      userInfo = null;
    },

    isAuthenticated(): boolean {
      return hasToken();
    },

    getUserInfo(): OAuthUserInfo | null {
      return userInfo;
    },

    async getToken(): Promise<string | null> {
      if (typeof localStorage === 'undefined') return null;
      const token = localStorage.getItem(tokenKey);
      if (token) return token;

      // No access token — try refreshing
      return refreshAccessToken();
    },
  };

  return session;
}
```

Also update the `index.ts` exports to include the new function and type:

In `packages/css-client/src/index.ts`, add to the OAuth utilities export:
```typescript
export {
  createGoogleOAuth,
  createAuth0OAuth,
  createCSSAuthServerOAuth,
  createOAuthAuthProvider,
  validateToken,
  loginMockUser,
  generateCodeVerifier,
  computeS256Challenge,
  generateState,
} from './oauth.js';
export type {
  GoogleOAuthConfig,
  Auth0OAuthConfig,
  CSSAuthServerOAuthConfig,
  OAuthUserInfo,
  OAuthSession,
  AuthMeResponse,
} from './oauth.js';
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/css-client test -- --run tests/oauth.spec.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
git add packages/css-client/src/oauth.ts packages/css-client/src/index.ts packages/css-client/tests/oauth.spec.ts
git commit -m "feat: implement createCSSAuthServerOAuth with PKCE, token exchange, and refresh"
```

---

### Task 4: Extend CSSConfig for `css-authserver` Mode

**Files:**
- Modify: `packages/puck-css/src/config.ts` (add config fields + validation)
- Modify: `packages/puck-css/src/auth/CSSAuthProvider.tsx:27` (update `AuthMode` type)
- Test: `packages/puck-css/src/__tests__/config.test.ts` (add validation tests)

**Step 1: Write the failing tests**

Add to `packages/puck-css/src/__tests__/config.test.ts`:

```typescript
describe('createCSSConfig with css-authserver mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts css-authserver as a valid auth mode', () => {
    const config = createCSSConfig(
      {},
      {
        overrides: {
          baseUrl: 'https://css.example.com',
          siteId: 'site-123',
          authMode: 'css-authserver',
          cssAuthServerUrl: 'https://auth.css.example.com',
        },
      },
    );

    expect(config.authMode).toBe('css-authserver');
    expect(config.cssAuthServerUrl).toBe('https://auth.css.example.com');
  });

  it('parses CSS_AUTH_SERVER_URL and CSS_AUTH_SERVER_SITE_ID from env', () => {
    process.env.NEXT_PUBLIC_CSS_BASE_URL = 'https://css.example.com';
    process.env.NEXT_PUBLIC_CSS_SITE_ID = 'site-123';
    process.env.NEXT_PUBLIC_CSS_AUTH_MODE = 'css-authserver';
    process.env.NEXT_PUBLIC_CSS_AUTH_SERVER_URL = 'https://auth.css.example.com';
    process.env.NEXT_PUBLIC_CSS_AUTH_REDIRECT_URI = 'https://mysite.com/auth/callback';

    const config = createNextConfig();

    expect(config.authMode).toBe('css-authserver');
    expect(config.cssAuthServerUrl).toBe('https://auth.css.example.com');
    expect(config.cssAuthRedirectUri).toBe('https://mysite.com/auth/callback');
  });

  it('reads CSS_AUTH_SERVER_URL from prefixed env source', () => {
    const config = createCSSConfig(
      {
        VITE_CSS_AUTH_SERVER_URL: 'https://auth.css.example.com',
        VITE_CSS_BASE_URL: 'https://css.example.com',
        VITE_CSS_SITE_ID: 'site-123',
        VITE_CSS_AUTH_MODE: 'css-authserver',
      },
      { prefix: 'VITE_' },
    );

    expect(config.cssAuthServerUrl).toBe('https://auth.css.example.com');
  });
});
```

Also update the import at the top of `config.test.ts` to include `createCSSConfig`:

The existing import is: `import { createNextConfig, createNextContentClient } from '../config.js';`
Change to: `import { createCSSConfig, createNextConfig, createNextContentClient } from '../config.js';`

**Step 2: Run test to verify it fails**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/puck-css test -- --run src/__tests__/config.test.ts`
Expected: FAIL — `css-authserver` not in `VALID_AUTH_MODES`, `cssAuthServerUrl` not on `CSSConfig`

**Step 3: Write minimal implementation**

In `packages/puck-css/src/auth/CSSAuthProvider.tsx`, update the `AuthMode` type:

```typescript
export type AuthMode = 'mock' | 'google' | 'auth0' | 'css-authserver';
```

In `packages/puck-css/src/config.ts`:

1. Add `'css-authserver'` to `VALID_AUTH_MODES`:
```typescript
const VALID_AUTH_MODES: AuthMode[] = ['mock', 'google', 'auth0', 'css-authserver'];
```

2. Add fields to `CSSConfig` interface:
```typescript
cssAuthServerUrl?: string;
cssAuthRedirectUri?: string;
```

3. Add to the `return` block of `createCSSConfig`:
```typescript
cssAuthServerUrl: overrides.cssAuthServerUrl ?? env('CSS_AUTH_SERVER_URL'),
cssAuthRedirectUri: overrides.cssAuthRedirectUri ?? env('CSS_AUTH_REDIRECT_URI'),
```

4. Add to `createNextConfig` overrides:
```typescript
cssAuthServerUrl: process.env.NEXT_PUBLIC_CSS_AUTH_SERVER_URL,
cssAuthRedirectUri: process.env.NEXT_PUBLIC_CSS_AUTH_REDIRECT_URI,
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/puck-css test -- --run src/__tests__/config.test.ts`
Expected: ALL PASS (existing tests + 3 new)

**Step 5: Verify existing config tests still pass**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/puck-css test -- --run src/__tests__/config.test.ts`

Note: The existing test `'throws when required env vars are missing'` checks the error message for `CSS_AUTH_MODE` validity. Since we added `'css-authserver'` to `VALID_AUTH_MODES`, the error message will now include it. Verify the test still passes (it checks exact throw messages, and the `VALID_AUTH_MODES.join(', ')` will now include `css-authserver`).

**Step 6: Commit**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
git add packages/puck-css/src/config.ts packages/puck-css/src/auth/CSSAuthProvider.tsx packages/puck-css/src/__tests__/config.test.ts
git commit -m "feat: extend CSSConfig and AuthMode to support css-authserver"
```

---

### Task 5: Wire `CSSAuthProvider` for `css-authserver` Mode

**Files:**
- Modify: `packages/puck-css/src/auth/CSSAuthProvider.tsx` (add css-authserver case)
- Modify: `packages/puck-css/src/CSSApp.tsx` (pass new config props)
- Test: `packages/puck-css/src/__tests__/CSSApp.test.tsx` (add css-authserver variant)

**Step 1: Write the failing tests**

Add to `packages/puck-css/src/__tests__/CSSApp.test.tsx`:

```typescript
it('shows default login page when not authenticated in css-authserver mode', () => {
  mockAuthState.isAuthenticated = false;
  mockAuthState.isLoading = false;
  mockAuthState.authMode = 'css-authserver' as 'mock';

  render(
    <CSSApp config={{ ...testConfig, authMode: 'css-authserver' as 'mock' }}>
      <div data-testid="child">Hello</div>
    </CSSApp>
  );

  expect(screen.getByTestId('css-login-page')).toBeVisible();
});
```

Note: The cast `as 'mock'` is needed because the mock type hasn't been updated yet. After Task 4, `AuthMode` will include `'css-authserver'` and the cast won't be needed for new tests. The key test is that the component renders without error.

**Step 2: Run test to verify it fails**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/puck-css test -- --run src/__tests__/CSSApp.test.tsx`
Expected: The test should pass with the cast since CSSApp delegates to mocked CSSAuthProvider. If it fails, it means the config props aren't being passed through.

**Step 3: Write the implementation**

In `packages/puck-css/src/auth/CSSAuthProvider.tsx`:

1. Add the import:
```typescript
import {
  createGoogleOAuth,
  createAuth0OAuth,
  createCSSAuthServerOAuth,
  validateToken,
  loginMockUser,
} from '@pantheon/css-client';
```

2. Add `cssAuthServerUrl`, `cssAuthRedirectUri` to `CSSAuthProviderProps`:
```typescript
/** CSS Auth Server URL (required when authMode is 'css-authserver'). */
cssAuthServerUrl?: string;
/** Redirect URI for CSS Auth Server callback (optional). */
cssAuthRedirectUri?: string;
```

3. Add the `css-authserver` case to `createOAuthSession`:
```typescript
if (authMode === 'css-authserver') {
  if (!props.cssAuthServerUrl) {
    console.warn('CSSAuthProvider: cssAuthServerUrl is required for css-authserver auth mode');
    return null;
  }
  return createCSSAuthServerOAuth({
    authServerUrl: props.cssAuthServerUrl,
    siteId: props.cssBaseUrl, // Will be overridden — see below
    redirectUri: props.cssAuthRedirectUri,
    cssBaseUrl: props.cssBaseUrl,
  });
}
```

Wait — the `siteId` for the OAuth client_id is the CSS site ID, not the base URL. The `CSSAuthProvider` doesn't receive `siteId` directly today. Looking at `CSSApp.tsx:173-180`, `CSSAuthProvider` receives `cssBaseUrl` but not `siteId`. The config's `siteId` is only passed to `CSSPuckProvider`. 

We need to pass `siteId` through to `CSSAuthProvider` for the `css-authserver` case. This is a necessary change. The cleanest approach: add a `siteId` prop to `CSSAuthProviderProps` and pass it from `CSSApp`.

Updated plan for `createOAuthSession`:
```typescript
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
```

4. Add `siteId` to `CSSAuthProviderProps`:
```typescript
/** CSS site ID (used as OAuth client_id for css-authserver mode). */
siteId?: string;
```

5. Handle callback on mount — update the `useEffect` in `CSSAuthProvider` to auto-detect callback URL:

In the `checkExistingAuth` function, before the existing OAuth session check, add:
```typescript
// Handle OAuth callback if we're returning from a CSS Auth Server redirect
if (authMode === 'css-authserver' && oauthSession?.handleCallback) {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('code') && urlParams.has('state')) {
    try {
      await oauthSession.handleCallback();
      // After successful callback, get the token
      const callbackToken = await oauthSession.getToken();
      if (!cancelled && callbackToken) {
        setToken(callbackToken);
        // Validate against CSS backend to get user info
        const validated = await validateToken(cssBaseUrl, callbackToken);
        if (!cancelled && validated) {
          setUser({
            id: validated.id,
            name: validated.email ?? validated.id,
            email: validated.email,
          });
        }
      }
      // Clean up the URL
      window.history.replaceState({}, document.title, window.location.pathname);
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
```

6. In `CSSApp.tsx`, pass the new props to `CSSAuthProvider`:
```typescript
<CSSAuthProvider
  authMode={config.authMode}
  cssBaseUrl={config.baseUrl}
  siteId={config.siteId}
  googleClientId={config.googleClientId}
  auth0Domain={config.auth0Domain}
  auth0ClientId={config.auth0ClientId}
  auth0Audience={config.auth0Audience}
  cssAuthServerUrl={config.cssAuthServerUrl}
  cssAuthRedirectUri={config.cssAuthRedirectUri}
>
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/puck-css test -- --run src/__tests__/CSSApp.test.tsx`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
git add packages/puck-css/src/auth/CSSAuthProvider.tsx packages/puck-css/src/CSSApp.tsx packages/puck-css/src/__tests__/CSSApp.test.tsx
git commit -m "feat: wire CSSAuthProvider and CSSApp for css-authserver mode with callback handling"
```

---

### Task 6: Add `CSSLoginPage` UI for `css-authserver` Mode

**Files:**
- Modify: `packages/puck-css/src/auth/CSSLoginPage.tsx` (add CSSAuthServerLogin component)
- Test: (CSSLoginPage component tests — add to a new test or extend existing)

Since the puck-css package uses jsdom for testing and has `@testing-library/react`, we can write component tests.

**Step 1: Write the failing test**

Create `packages/puck-css/src/__tests__/CSSLoginPage.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const mockLogin = vi.fn();
const mockAuthState = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
  token: null,
  error: null as string | null,
  authMode: 'css-authserver' as string,
  login: mockLogin,
  logout: vi.fn(),
};

vi.mock('../auth/CSSAuthProvider', () => ({
  useCSSAuth: () => mockAuthState,
  DEMO_USERS: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Alice Developer' },
  ],
}));

import { CSSLoginPage } from '../auth/CSSLoginPage';

describe('CSSLoginPage with css-authserver mode', () => {
  beforeEach(() => {
    mockAuthState.isLoading = false;
    mockAuthState.error = null;
    mockAuthState.authMode = 'css-authserver';
    mockLogin.mockClear();
  });

  it('renders a Sign in button for css-authserver mode', () => {
    render(<CSSLoginPage />);
    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).toBeInTheDocument();
  });

  it('calls login() when the Sign in button is clicked', () => {
    render(<CSSLoginPage />);
    const button = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(button);
    expect(mockLogin).toHaveBeenCalled();
  });

  it('shows loading text when isLoading is true', () => {
    mockAuthState.isLoading = true;
    render(<CSSLoginPage />);
    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
  });

  it('shows CSS Auth Server label in subtitle', () => {
    render(<CSSLoginPage />);
    expect(screen.getByText(/CSS Auth Server/)).toBeInTheDocument();
  });

  it('displays error message when error is present', () => {
    mockAuthState.error = 'Something went wrong';
    render(<CSSLoginPage />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/puck-css test -- --run src/__tests__/CSSLoginPage.test.tsx`
Expected: FAIL — no css-authserver case in CSSLoginPage, `getAuthModeLabel` returns nothing for it

**Step 3: Write the implementation**

In `packages/puck-css/src/auth/CSSLoginPage.tsx`:

1. Add the `CSSAuthServerLogin` component:
```typescript
function CSSAuthServerLogin() {
  const { login, isLoading } = useCSSAuth();

  return (
    <button
      className="pds-button pds-button--primary pds-button--full-width"
      onClick={() => void login()}
      disabled={isLoading}
    >
      {isLoading ? 'Signing in...' : 'Sign in'}
    </button>
  );
}
```

2. Update `getAuthModeLabel`:
```typescript
function getAuthModeLabel(mode: AuthMode): string {
  switch (mode) {
    case 'mock':
      return 'Demo Mode';
    case 'google':
      return 'Google';
    case 'auth0':
      return 'Auth0';
    case 'css-authserver':
      return 'CSS Auth Server';
  }
}
```

3. Add the rendering case in `CSSLoginPage` JSX:
```typescript
{authMode === 'css-authserver' && <CSSAuthServerLogin />}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/puck-css test -- --run src/__tests__/CSSLoginPage.test.tsx`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
git add packages/puck-css/src/auth/CSSLoginPage.tsx packages/puck-css/src/__tests__/CSSLoginPage.test.tsx
git commit -m "feat: add CSSLoginPage UI for css-authserver mode"
```

---

### Task 7: Update Demo App .env.example

**Files:**
- Modify: `apps/demo/.env.example`

**Step 1: Add CSS Auth Server env vars**

Add the following to `apps/demo/.env.example`:

```
# CSS Auth Server (when VITE_AUTH_MODE=css-authserver)
# The CSS Auth Server URL — the OAuth 2.0 Authorization Server endpoint
VITE_CSS_AUTH_SERVER_URL=
# Redirect URI for OAuth callback (defaults to origin + /auth/callback)
# VITE_CSS_AUTH_REDIRECT_URI=
```

**Step 2: Update the auth mode comment**

Change:
```
# Auth mode: 'mock' (default), 'google', or 'auth0'
```
to:
```
# Auth mode: 'mock' (default), 'google', 'auth0', or 'css-authserver'
```

**Step 3: Update demo App.tsx auth mode type**

In `apps/demo/src/App.tsx:35`, update the type assertion:

```typescript
authMode: (import.meta.env.VITE_AUTH_MODE || 'mock') as 'mock' | 'google' | 'auth0' | 'css-authserver',
```

Note: `cssAuthServerUrl` and `cssAuthRedirectUri` do NOT need explicit overrides in the demo app. The demo app uses `createCSSConfig(import.meta.env, { prefix: 'VITE_' })`, so env vars like `VITE_CSS_AUTH_SERVER_URL` are automatically resolved via `env('CSS_AUTH_SERVER_URL')` after prefix stripping. Overrides are only needed for env vars that don't follow the `VITE_CSS_*` naming convention (like `VITE_AUTH_MODE` instead of `VITE_CSS_AUTH_MODE`).

**Step 4: Commit**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
git add apps/demo/.env.example apps/demo/src/App.tsx
git commit -m "feat: add css-authserver env vars to demo app"
```

---

### Task 8: Run Full Test Suite and Lint

**Step 1: Run all css-client tests**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/css-client test -- --run`
Expected: ALL PASS (existing 14 + ~25 new tests)

**Step 2: Run all puck-css tests**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/puck-css test -- --run`
Expected: ALL PASS (existing tests + new CSSLoginPage tests + new config tests)

Note: There may be pre-existing failures in puck-css tests (25 were mentioned in the testing strategy). These are not caused by our changes. Verify that the same set of pre-existing failures exists and no new failures were introduced.

**Step 3: Run lint**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm lint`
Expected: 0 errors. Fix any issues before proceeding.

**Step 4: Run TypeScript type checking**

Run: `cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider && pnpm --filter @pantheon/css-client exec tsc --noEmit && pnpm --filter @pantheon/puck-css exec tsc --noEmit`
Expected: No type errors.

**Step 5: Commit any lint/type fixes**

If any fixes were needed:
```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
git add -A
git commit -m "fix: lint and type fixes for css-authserver provider"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `packages/css-client/src/oauth.ts` | Add `CSSAuthServerOAuthConfig`, `createCSSAuthServerOAuth()`, `generateCodeVerifier()`, `computeS256Challenge()`, `generateState()`, `base64UrlEncode()`. Extend `OAuthSession.provider` to include `'css-authserver'`. Add `handleCallback?()` to `OAuthSession`. |
| `packages/css-client/src/index.ts` | Export new function, types, and PKCE utilities |
| `packages/css-client/tests/oauth.spec.ts` | ~25 new tests: PKCE utilities (7), session lifecycle (16), interface conformance (2) |
| `packages/puck-css/src/config.ts` | Add `cssAuthServerUrl`, `cssAuthRedirectUri` to `CSSConfig`. Add `'css-authserver'` to `VALID_AUTH_MODES`. Parse from env/overrides. |
| `packages/puck-css/src/auth/CSSAuthProvider.tsx` | Add `'css-authserver'` to `AuthMode`. Add `siteId`, `cssAuthServerUrl`, `cssAuthRedirectUri` props. Wire `createCSSAuthServerOAuth` in `createOAuthSession`. Handle callback on mount. |
| `packages/puck-css/src/auth/CSSLoginPage.tsx` | Add `CSSAuthServerLogin` component and `'css-authserver'` case in `getAuthModeLabel`. |
| `packages/puck-css/src/CSSApp.tsx` | Pass `siteId`, `cssAuthServerUrl`, `cssAuthRedirectUri` to `CSSAuthProvider`. |
| `packages/puck-css/src/__tests__/config.test.ts` | 3 new tests for css-authserver config parsing |
| `packages/puck-css/src/__tests__/CSSApp.test.tsx` | 1 new test for css-authserver mode rendering |
| `packages/puck-css/src/__tests__/CSSLoginPage.test.tsx` | New file: 5 tests for CSSLoginPage css-authserver mode |
| `apps/demo/.env.example` | Add `VITE_CSS_AUTH_SERVER_URL`, `VITE_CSS_AUTH_REDIRECT_URI` |
| `apps/demo/src/App.tsx` | Add `'css-authserver'` to auth mode type, pass auth server config |
