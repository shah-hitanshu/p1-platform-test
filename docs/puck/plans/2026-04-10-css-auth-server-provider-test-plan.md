# CSS Auth Server Provider - Test Plan

**Implementation plan:** `docs/plans/2026-04-10-css-auth-server-provider.md`
**Fidelity:** Medium (~30 Vitest tests, no Playwright e2e)
**Rationale:** Redirect-based OAuth flows cannot be fully exercised without a live auth server. Tests validate all non-redirect logic: PKCE crypto, session state management, config parsing, and component rendering.

---

## Test Files

| File | Package | Tests | Coverage Surface |
|------|---------|-------|-----------------|
| `packages/css-client/tests/oauth.spec.ts` | @pantheon/css-client | 25 new tests (added to existing file) | PKCE utilities, `createCSSAuthServerOAuth` lifecycle, `OAuthSession` interface conformance |
| `packages/puck-css/src/__tests__/config.test.ts` | @pantheon/puck-css | 3 new tests (added to existing file) | `createCSSConfig` + `createNextConfig` with `css-authserver` mode |
| `packages/puck-css/src/__tests__/CSSApp.test.tsx` | @pantheon/puck-css | 1 new test (added to existing file) | `CSSApp` renders login page in css-authserver mode |
| `packages/puck-css/src/__tests__/CSSLoginPage.test.tsx` | @pantheon/puck-css | 5 new tests (new file) | `CSSLoginPage` rendering for css-authserver mode |

**Total: ~34 new tests**

---

## Test Specifications

### 1. PKCE Utility Functions (7 tests)

**File:** `packages/css-client/tests/oauth.spec.ts`
**Added to existing file** -- new `describe('PKCE utility functions', ...)` block.
**Imports:** `generateCodeVerifier`, `computeS256Challenge`, `generateState` from `../src/oauth.js`

These are pure functions with no external dependencies beyond Web Crypto API (available in Node 18+/Vitest).

| # | Test name | What it validates |
|---|-----------|------------------|
| 1 | `generateCodeVerifier returns a string between 43 and 128 characters` | RFC 7636 Section 4.1 length requirement |
| 2 | `generateCodeVerifier uses only URL-safe characters (no +, /, =)` | base64url encoding correctness (RFC 4648 Section 5) |
| 3 | `generateCodeVerifier produces unique values on successive calls` | Randomness sanity check |
| 4 | `computeS256Challenge produces a 43-character base64url string` | SHA-256 hash (32 bytes) base64url-encoded = 43 chars without padding |
| 5 | `computeS256Challenge matches RFC 7636 Appendix B test vector` | Verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` must produce challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM` |
| 6 | `generateState returns a 64-character hex string` | 32 random bytes hex-encoded = 64 chars |
| 7 | `generateState produces unique values on successive calls` | Randomness sanity check |

**Mocks:** None (pure functions)
**Environment:** Node (Vitest default for css-client)

---

### 2. OAuthSession Interface Conformance (1 test)

**File:** `packages/css-client/tests/oauth.spec.ts`
**Added to existing file** -- new `describe('OAuthSession interface conformance for css-authserver', ...)` block.
**Imports:** `OAuthSession` type from `../src/oauth.js`

| # | Test name | What it validates |
|---|-----------|------------------|
| 8 | `accepts css-authserver as a valid provider value` | TypeScript compilation succeeds with `provider: 'css-authserver'` and `handleCallback` on `OAuthSession` |

**Mocks:** Uses `vi.fn()` for all session methods.

---

### 3. `createCSSAuthServerOAuth` Session Lifecycle (16 tests)

**File:** `packages/css-client/tests/oauth.spec.ts`
**Added to existing file** -- new `describe('createCSSAuthServerOAuth', ...)` block.
**Imports:** `createCSSAuthServerOAuth`, `CSSAuthServerOAuthConfig` from `../src/oauth.js`

**Environment setup:** This block requires `sessionStorage`, `location`, and `history` mocks scoped via `beforeAll`/`afterAll` to avoid polluting the existing Google/Auth0 tests. The existing `localStorageMock` (already module-scoped) is reused.

```typescript
// sessionStorage mock (same pattern as existing localStorageMock)
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((_index: number) => null),
  };
})();

const locationMock = {
  origin: 'https://mysite.com',
  href: 'https://mysite.com/editor',
  search: '',
};

const replaceStateMock = vi.fn();
```

**Default config:**
```typescript
const defaultConfig: CSSAuthServerOAuthConfig = {
  authServerUrl: 'https://auth.css.example.com',
  siteId: 'site-abc-123',
  redirectUri: 'https://mysite.com/auth/callback',
  cssBaseUrl: 'https://api.css.example.com',
};
```

| # | Test name | What it validates |
|---|-----------|------------------|
| 9 | `creates a session with provider set to css-authserver` | `session.provider === 'css-authserver'` |
| 10 | `is not authenticated initially with no stored token` | `isAuthenticated() === false`, `getUserInfo() === null` |
| 11 | `restores token from localStorage on creation` | Pre-populate `css_authserver_token`, verify `isAuthenticated() === true` |
| 12 | `returns stored opaque token from getToken` | `getToken()` returns `'user123:grant456:secretxyz'` (opaque format, no dots) |
| 13 | `returns null from getToken when not authenticated` | `getToken()` returns `null` with empty localStorage |
| 14 | `login() sets location.href to auth server /authorize with correct params` | Verify redirect URL: origin, pathname, `client_id`, `redirect_uri`, `response_type=code`, `code_challenge_method=S256`, presence of `code_challenge` and `state` |
| 15 | `login() stores state and code_verifier in sessionStorage` | `sessionStorage.setItem` called with `css_authserver_state` and `css_authserver_verifier` |
| 16 | `handleCallback() exchanges code for tokens on valid callback` | Mock `fetch` for `/token` POST, verify request body params (`grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`), verify tokens stored in localStorage, verify sessionStorage cleanup |
| 17 | `handleCallback() rejects on state mismatch (CSRF protection)` | Stored state differs from URL state -- must throw containing "state mismatch" |
| 18 | `handleCallback() rejects on token exchange failure` | Mock `fetch` returning `ok: false` -- must throw |
| 19 | `handleCallback() rejects when code is missing from URL` | URL has `?state=...` but no `code` -- must throw containing "code" |
| 20 | `logout() clears all stored tokens and user info` | `isAuthenticated() === false`, `getUserInfo() === null`, `localStorage.removeItem` called for token and refresh_token keys |
| 21 | `getToken() attempts refresh when access token is missing but refresh token exists` | Mock `fetch` for refresh, verify new token returned and stored, verify request body has `grant_type=refresh_token` |
| 22 | `getToken() returns null when refresh fails` | Mock `fetch` returning `ok: false`, verify `null` returned and refresh token cleared |
| 23 | `renderButton returns null (css-authserver uses redirect, not provider widget)` | `renderButton!({} as HTMLElement)` returns `null` |
| 24 | `uses custom storageKey when provided` | Pre-populate `my_custom_key` in localStorage, verify `isAuthenticated() === true` with `storageKey: 'my_custom_key'` |

**Mocks:** `global.fetch` (vi.fn), `sessionStorage`, `location`, `history.replaceState`

---

### 4. `createOAuthAuthProvider` with css-authserver (1 test)

**File:** `packages/css-client/tests/oauth.spec.ts`
**Added to existing `describe('createOAuthAuthProvider', ...)` block** (or new block alongside it).

| # | Test name | What it validates |
|---|-----------|------------------|
| 25 | `returns Bearer token from css-authserver session` | Mock session with `provider: 'css-authserver'`, verify `authProvider()` returns `'Bearer user1:grant1:secret1'` |

**Mocks:** Manual `OAuthSession` mock object.

---

### 5. `createCSSConfig` with css-authserver Mode (3 tests)

**File:** `packages/puck-css/src/__tests__/config.test.ts`
**Added to existing file** -- new `describe('createCSSConfig with css-authserver mode', ...)` block.
**Imports:** Add `createCSSConfig` to existing import from `../config.js`.

| # | Test name | What it validates |
|---|-----------|------------------|
| 26 | `accepts css-authserver as a valid auth mode` | `createCSSConfig({}, { overrides: { ..., authMode: 'css-authserver', cssAuthServerUrl: '...' } })` succeeds, returns `config.authMode === 'css-authserver'` and `config.cssAuthServerUrl` |
| 27 | `parses CSS_AUTH_SERVER_URL and CSS_AUTH_REDIRECT_URI from env` | Set `NEXT_PUBLIC_CSS_AUTH_MODE=css-authserver` etc. in `process.env`, call `createNextConfig()`, verify `config.cssAuthServerUrl` and `config.cssAuthRedirectUri` |
| 28 | `reads CSS_AUTH_SERVER_URL from prefixed env source` | Call `createCSSConfig({ VITE_CSS_AUTH_SERVER_URL: '...' }, { prefix: 'VITE_' })`, verify `config.cssAuthServerUrl` |

**Mocks:** `process.env` manipulation (same pattern as existing tests).

**Note:** Adding `'css-authserver'` to `VALID_AUTH_MODES` will change the error message in the existing `'throws when required env vars are missing'` test. The error message uses `VALID_AUTH_MODES.join(', ')`, so it will now include `css-authserver` in the list. The existing test checks `Missing required config: CSS_AUTH_MODE` (not the invalid-mode message), so it should remain unaffected.

---

### 6. `CSSApp` with css-authserver Mode (1 test)

**File:** `packages/puck-css/src/__tests__/CSSApp.test.tsx`
**Added to existing file** -- new test inside existing `describe('CSSApp', ...)` block.

| # | Test name | What it validates |
|---|-----------|------------------|
| 29 | `shows default login page when not authenticated in css-authserver mode` | Set `mockAuthState.authMode = 'css-authserver'`, render `<CSSApp config={{ ...testConfig, authMode: 'css-authserver' }}>`, verify `css-login-page` testid is visible |

**Mocks:** Existing `vi.mock('../auth/index', ...)` and `mockAuthState` mutation.

**Note:** The `authMode` cast will need to accommodate `'css-authserver'` after the `AuthMode` type is extended. During the test-writing (red) phase, `as 'mock'` cast may be needed temporarily.

---

### 7. `CSSLoginPage` with css-authserver Mode (5 tests)

**File:** `packages/puck-css/src/__tests__/CSSLoginPage.test.tsx` (new file)
**Environment:** jsdom (Vitest config for puck-css)
**Imports:** `CSSLoginPage` from `../auth/CSSLoginPage`, `render`, `screen`, `fireEvent` from `@testing-library/react`

**Mock setup:**
```typescript
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
```

| # | Test name | What it validates |
|---|-----------|------------------|
| 30 | `renders a Sign in button for css-authserver mode` | `screen.getByRole('button', { name: /sign in/i })` exists |
| 31 | `calls login() when the Sign in button is clicked` | `fireEvent.click(button)`, verify `mockLogin` called |
| 32 | `shows loading text when isLoading is true` | Set `mockAuthState.isLoading = true`, verify "Signing in" text |
| 33 | `shows CSS Auth Server label in subtitle` | Verify text "CSS Auth Server" appears in rendered output |
| 34 | `displays error message when error is present` | Set `mockAuthState.error = 'Something went wrong'`, verify error text rendered |

**Mocks:** `useCSSAuth` via `vi.mock`, `DEMO_USERS`.

---

## Test Execution Commands

```bash
# css-client tests (PKCE + session lifecycle)
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feat/css-auth-server-provider
pnpm --filter @pantheon/css-client test -- --run tests/oauth.spec.ts

# puck-css config tests
pnpm --filter @pantheon/puck-css test -- --run src/__tests__/config.test.ts

# puck-css CSSApp tests
pnpm --filter @pantheon/puck-css test -- --run src/__tests__/CSSApp.test.tsx

# puck-css CSSLoginPage tests
pnpm --filter @pantheon/puck-css test -- --run src/__tests__/CSSLoginPage.test.tsx

# Full suite (both packages)
pnpm --filter @pantheon/css-client test -- --run
pnpm --filter @pantheon/puck-css test -- --run
```

---

## Task-to-Test Mapping

| Implementation Task | Tests | Expect Red/Green |
|---------------------|-------|-----------------|
| Task 1: PKCE Utility Functions | Tests 1-7 | Red: functions not exported. Green: after adding to `oauth.ts` |
| Task 2: Extend OAuthSession Interface | Test 8 | Red: TS error on `'css-authserver'` + `handleCallback`. Green: after updating interface |
| Task 3: Implement `createCSSAuthServerOAuth` | Tests 9-25 | Red: factory not exported. Green: after full implementation |
| Task 4: Extend CSSConfig | Tests 26-28 | Red: `'css-authserver'` not in `VALID_AUTH_MODES`. Green: after config changes |
| Task 5: Wire CSSAuthProvider | Test 29 | Red: (may pass with mock, but validates integration). Green: after wiring |
| Task 6: CSSLoginPage UI | Tests 30-34 | Red: no css-authserver case in `getAuthModeLabel`/JSX. Green: after adding component |
| Task 7: Demo App .env | No tests (env template only) | N/A |
| Task 8: Full Suite + Lint | All tests | Green: all pass, 0 lint errors |

---

## Pre-existing Test Baseline

Before writing any new tests, verify the existing test counts:
- `packages/css-client/tests/oauth.spec.ts`: 14 existing tests (Google OAuth, Auth0 mock, createOAuthAuthProvider)
- `packages/puck-css/src/__tests__/config.test.ts`: 7 existing tests (createNextConfig, createNextContentClient)
- `packages/puck-css/src/__tests__/CSSApp.test.tsx`: 6 existing tests (CSSApp auth gating, loading, login)

All existing tests must continue to pass after changes.
