# PCC-3191 MCP Server Auth Migration Implementation Plan

> **Superseded.** This is a point-in-time planning document. The delivered implementation diverged from it; the authoritative record is `PROGRESS.md` (PCC-3191 section). Known divergences:
> - **Per-caller identity, not a shared one.** The plan forwarded the user's token under a single `mcp-server` identity (`X-Actor-Id: mcp-server`, `X-Actor-Type: agent`). The backend's actor-vs-principal cross-check rejected that with 403, so the human path now sends `X-Actor-Type: user` and no actor id, and a separate agent path forwards each agent's own `aak_` key.
> - **RFC 9728 / RFC 8707 not shipped.** No `/.well-known/oauth-protected-resource` endpoint exists, and the `resource` parameter is not sent (Auth0 requires the resource pre-registered as an API). Token scoping uses the Auth0 `audience` parameter instead.
> - **Env field differs.** `COOKIE_ENCRYPTION_KEY` was not retained; `MCP_STATE_SIGNING_SECRET` was added for HMAC-signed OAuth state.
> - **Added beyond this plan:** signed OAuth state with id-token nonce binding, Auth0 refresh-token handling for session longevity, an `AUTH0_AUDIENCE` gate on `/authorize`, and per-tool rate limiting.
> - **Tests diverged:** the source-inspection tests this plan specified (in `worker-config.spec.ts` and `oauth-integration.spec.ts`) were dropped as change-detectors; behavioral suites replaced them.

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Replace the MCP server's shared API key + trusted-header model with Auth0 OAuth token forwarding, eliminating the privilege-escalation vulnerability where AGENT_API_KEY leakage lets any caller spoof arbitrary acting-user identities.

**Architecture:** The MCP server already performs OAuth with Auth0 via the broker infrastructure added in PR #104 / the `auth-broker` branch. This plan wires the resulting Auth0 access token through to the CSS backend as a `Bearer` token, lets the backend validate it via `Auth0IdentityProvider` (already in place), and retires the `AGENT_API_KEY`/`X-Acting-User-*` header path for MCP traffic. Two new RFC endpoints (`/.well-known/oauth-protected-resource` and `resource` parameter injection) are added to the MCP server to comply with modern MCP auth standards.

**Tech Stack:** TypeScript, Cloudflare Workers, `@cloudflare/workers-oauth-provider`, `@modelcontextprotocol/sdk`, Auth0, Vitest

---

## Pre-existing baseline failures (do NOT fix in this plan)

Two tests fail on the `auth-broker` branch before any of our changes:

- `workers/mcp-server/tests/shared/create-page.spec.ts` — `rejects document_path starting with /_registry/` (1 failure): a race condition in the mock causing `undefined` to appear where a Response is expected. This is a pre-existing test bug introduced in commit `2598120`.
- `workers/tests/routes/allowlist-agent-acting.spec.ts` (2 failures): `extractActingUser` no longer reads `X-Acting-User-*` plain headers at the backend under the new auth model; these tests mock the old header path. Pre-existing failures from commit `0d2b105`.

These must remain failing (do not touch) after this plan. If they start passing, investigate — that would indicate an unexpected side-effect.

---

## Decision log

### D1 — Auth0 token forwarding, not HMAC signing

The conversation considered two paths: (A) HMAC-signed acting-user claim, (B) forward the OAuth access token. We implement (B) because:
- The `auth-broker` branch has already built the full Auth0 PKCE flow in the MCP server (`auth/google-handler.ts` is replaced by the Auth0 path in `workers/src/auth/oauth/auth0-handler.ts` which is already integrated into the main worker).
- The CSS backend already validates Auth0 tokens via `Auth0IdentityProvider` — no new validation logic is needed on the backend.
- (B) provides strong cryptographic binding: the token is tied to a real Auth0 session. (A) only prevents spoofing when `AGENT_API_KEY` leaks; it does nothing if the signing key also leaks.
- The `AGENT_API_KEY` secret becomes unnecessary for MCP traffic, reducing the attack surface.

### D2 — The MCP server continues to use `@cloudflare/workers-oauth-provider` as the authorization server

The MCP server issues its own short-lived access tokens via `OAuthProvider`. When the MCP client exchanges the Auth0 code and gets an MCP access token, the MCP server uses the Auth0 access token (obtained during the Auth0 callback) and stores it in the token's `props` (alongside `userId` and `email`). This access token is then forwarded to the backend on every API call.

This is the minimal change: the `UserProps` type gains an `auth0AccessToken` field, and `api-client.ts` sends it as `Authorization: Bearer` instead of `X-API-Key`.

### D3 — Switch /authorize to Auth0

The MCP server's `/authorize` currently redirects to Google OAuth. We replace this with the Auth0 authorization URL using `getAuth0AuthorizationUrl` from a new `workers/mcp-server/src/auth/auth0-handler.ts` (local copy — see D8).

### D4 — Backend: validate Auth0 Bearer token, retire acting-user headers for MCP traffic

The backend already handles `Authorization: Bearer <Auth0-JWT>` in `authenticate()`. When the MCP server sends `Bearer <auth0-access-token>`, the `Auth0IdentityProvider` validates it and produces a `user` principal — no agent-key path needed. The `X-Acting-User-*` headers become unnecessary because the user's identity is now in the JWT itself. `extractActingUser()` remains in the codebase (it still serves the local-dev mock path) but the MCP server stops sending those headers.

**Implication for acting-user permission intersection:** `getEffectiveRole()` currently checks `if (principal.type === 'agent' && principal.actingUserEmail !== undefined)` to intersect roles. Under the new model, the MCP server's calls arrive as `user` principals — the intersection logic is no longer needed for MCP traffic (the user's own role is the role). No behavior change is required in `authorization.ts`.

### D5 — RFC 9728: /.well-known/oauth-protected-resource

RFC 9728 specifies that protected resources must publish a metadata document at `/.well-known/oauth-protected-resource`. This lets MCP clients discover which authorization server to use. We add this endpoint to the MCP server's `defaultHandler` in `index.ts`. The document must include `resource` (the MCP server's own URL) and `authorization_servers` (the Auth0 issuer). Values come from `env.PUBLIC_ORIGIN` (MCP server URL) and `env.AUTH0_ISSUER_BASE_URL`.

### D6 — RFC 8707: resource indicator in token requests

RFC 8707 requires the `resource` parameter be included in authorization and token requests. We add `resource: env.PUBLIC_ORIGIN` to the Auth0 authorization URL so the Auth0 access token is scoped to the MCP server as a resource server. The `resource` field is added to the MCP server's `getAuth0AuthorizationUrl` params (the existing `workers/src/auth/oauth/auth0-handler.ts` does not have this field, so the MCP server copy diverges intentionally here).

### D7 — Env: replace GOOGLE_CLIENT_ID/SECRET and AGENT_API_KEY with Auth0 credentials

The Google credential env vars and `AGENT_API_KEY`/`AGENT_ID` are replaced with Auth0 credential env vars in `types.ts`. `AGENT_ID` is removed entirely; the hardcoded fallback `'mcp-server'` is used for the `X-Actor-Id` logging header. `AGENT_API_KEY` is removed from `Env` entirely since the MCP server no longer needs it. `PUBLIC_ORIGIN` is added as a required var. The `wrangler.jsonc` `vars` stanzas are updated accordingly, with Auth0 secrets noted as Wrangler secrets. The `.dev.vars.example` file is also updated to replace old secrets with Auth0 credentials.

**Note on local-dev fallback:** The previous local-dev path used `agentApiKey` from `env.AGENT_API_KEY`. After this migration, local dev also uses the Auth0 token flow. The `agentApiKey` field is retained as optional in `McpApiClientConfig` and `McpHandlerConfig` for backwards compatibility only — but nothing in this plan sets it from `env` anymore.

### D8 — MCP server: Auth0 handler lives in src/auth/auth0-handler.ts (local copy, no jose dependency)

Rather than sharing the handler from `workers/src/auth/oauth/auth0-handler.ts`, we create a copy in `workers/mcp-server/src/auth/auth0-handler.ts`. The MCP server and the main worker are separate Cloudflare Worker bundles; cross-package imports would complicate the build.

**Divergence from original:** The original uses `decodeJwt` from `jose` to decode the ID token payload. The MCP server copy uses `atob`/`JSON.parse` instead, avoiding the need to add `jose` as a dependency. This is safe because: (a) the token is received directly from Auth0's token endpoint over HTTPS — it has not transited untrusted channels; (b) we are extracting user identity from the ID token (not the access token), and the ID token's claims are signed by Auth0 (the signature is not verified here but HTTPS delivery provides equivalent trust). This mirrors the approach in the existing `google-handler.ts` in the same package.

The MCP server copy also adds the `resource` field to `Auth0AuthUrlParams` (RFC 8707), which the original does not have.

### D9 — Existing tests that encode retired behavior must be updated

Several existing tests encode behavior that this plan retires:

1. `tests/shared/api-client.spec.ts` — `should throw if agentApiKey is missing`: This test verified that `agentApiKey` was required. After this plan, neither key is individually required — the constructor requires either `agentApiKey` OR `accessToken`. This test must be updated to match the new contract: pass an empty `agentApiKey` WITH no `accessToken`, assert it throws.

2. `tests/auth/oauth-integration.spec.ts` — Test 45 (`MCP handler extracts user props and passes as actingUser to API client`): This test simulates the OLD behavior — creates `McpApiClient` with `agentApiKey` and asserts `X-Acting-User-*` headers are sent. After this plan, the MCP server creates `McpApiClient` with `accessToken` and sends `Authorization: Bearer` instead. Test 45 must be updated to simulate the new behavior.

3. `tests/config/worker-config.spec.ts` — Tests 85, 87: These check that `types.ts` declares `AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and that `.dev.vars.example` documents them. After this plan those fields are removed. Tests 85 and 87 must be updated to check for the new Auth0 field names instead.

All updates are required to keep the test suite accurate. They are authorized by the fact that the behavior they test is being intentionally retired by this plan.

---

## Task 1: Add Auth0 handler to MCP server auth module

**Files:**
- Create: `workers/mcp-server/src/auth/auth0-handler.ts`
- Create: `workers/mcp-server/tests/auth/auth0-handler.spec.ts`

### Step 1: Write the failing test

Create `workers/mcp-server/tests/auth/auth0-handler.spec.ts`:

```typescript
/**
 * Auth0 Handler Tests (MCP server copy)
 *
 * Tests for Auth0 authorization URL construction and code exchange.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('getAuth0AuthorizationUrl', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('builds a valid Auth0 authorization URL with required params', async () => {
    const { getAuth0AuthorizationUrl } = await import('../../src/auth/auth0-handler.js');
    const url = getAuth0AuthorizationUrl({
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'client-id-123',
      redirectUri: 'https://mcp.example.com/callback',
      state: 'state-abc',
      scope: 'openid email profile',
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('example.auth0.com');
    expect(parsed.pathname).toBe('/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-id-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://mcp.example.com/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
  });

  it('includes audience when provided', async () => {
    const { getAuth0AuthorizationUrl } = await import('../../src/auth/auth0-handler.js');
    const url = getAuth0AuthorizationUrl({
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'cid',
      redirectUri: 'https://mcp.example.com/callback',
      state: 'st',
      scope: 'openid email',
      audience: 'https://api.example.com',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('audience')).toBe('https://api.example.com');
  });

  it('includes resource when provided (RFC 8707)', async () => {
    const { getAuth0AuthorizationUrl } = await import('../../src/auth/auth0-handler.js');
    const url = getAuth0AuthorizationUrl({
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'cid',
      redirectUri: 'https://mcp.example.com/callback',
      state: 'st',
      scope: 'openid email',
      resource: 'https://mcp.example.com',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('resource')).toBe('https://mcp.example.com');
  });

  it('strips trailing slashes from issuer', async () => {
    const { getAuth0AuthorizationUrl } = await import('../../src/auth/auth0-handler.js');
    const url = getAuth0AuthorizationUrl({
      issuerBaseUrl: 'https://example.auth0.com///',
      clientId: 'cid',
      redirectUri: 'https://mcp.example.com/callback',
      state: 'st',
      scope: 'openid email',
    });
    expect(url).not.toContain('//authorize');
  });
});

describe('exchangeAuth0Code', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns accessToken and user on success', async () => {
    const { exchangeAuth0Code } = await import('../../src/auth/auth0-handler.js');

    // Build a minimal JWT with sub and email in the payload
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ sub: 'auth0|user123', email: 'user@example.com', name: 'Test User' }));
    const idToken = `${header}.${payload}.fakesig`;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'at_abc',
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    } as Response);

    const result = await exchangeAuth0Code({
      code: 'auth-code-xyz',
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'cid',
      clientSecret: 'csecret',
      redirectUri: 'https://mcp.example.com/callback',
    });

    expect(result.accessToken).toBe('at_abc');
    expect(result.user.sub).toBe('auth0|user123');
    expect(result.user.email).toBe('user@example.com');
  });

  it('throws on non-ok response', async () => {
    const { exchangeAuth0Code } = await import('../../src/auth/auth0-handler.js');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'invalid_client', error_description: 'Bad credentials' }),
    } as Response);

    await expect(exchangeAuth0Code({
      code: 'bad-code',
      issuerBaseUrl: 'https://example.auth0.com',
      clientId: 'cid',
      clientSecret: 'wrong',
      redirectUri: 'https://mcp.example.com/callback',
    })).rejects.toThrow('Auth0 token exchange failed');
  });
});
```

### Step 2: Run the test to verify it fails

```bash
cd workers/mcp-server && pnpm test tests/auth/auth0-handler.spec.ts
```

Expected: FAIL — `../../src/auth/auth0-handler.js` does not exist yet

### Step 3: Create `workers/mcp-server/src/auth/auth0-handler.ts`

```typescript
/**
 * Auth0 OAuth Handler (MCP server)
 *
 * Handles the OAuth authorization flow with Auth0 as the upstream IdP.
 * Functionally similar to workers/src/auth/oauth/auth0-handler.ts, but kept
 * as a local copy so the MCP server bundle stays self-contained.
 *
 * Divergences from the original (see plan D8):
 * - Uses atob/JSON.parse instead of jose.decodeJwt (no jose dependency needed)
 * - Adds `resource` field to Auth0AuthUrlParams for RFC 8707 compliance
 */

export interface Auth0AuthUrlParams {
  issuerBaseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  audience?: string;
  /** RFC 8707: resource indicator, scopes the access token to this server */
  resource?: string;
  nonce?: string;
}

export interface Auth0CodeExchangeParams {
  code: string;
  issuerBaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Auth0User {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
}

export interface Auth0CodeExchangeResult {
  accessToken: string;
  user: Auth0User;
}

function normalizeIssuer(issuerBaseUrl: string): string {
  let s = issuerBaseUrl;
  while (s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return s;
}

export function getAuth0AuthorizationUrl(params: Auth0AuthUrlParams): string {
  const issuer = normalizeIssuer(params.issuerBaseUrl);
  const url = new URL(`${issuer}/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  if (params.audience !== undefined && params.audience !== '') {
    url.searchParams.set('audience', params.audience);
  }
  if (params.resource !== undefined && params.resource !== '') {
    url.searchParams.set('resource', params.resource);
  }
  if (params.nonce !== undefined && params.nonce !== '') {
    url.searchParams.set('nonce', params.nonce);
  }
  return url.toString();
}

function decodeAuth0IdTokenClaims(idToken: string): Auth0User {
  const parts = idToken.split('.');
  if (parts.length < 3) {
    throw new Error('Invalid ID token: expected at least 3 parts');
  }
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const decoded = atob(padded);
  const claims = JSON.parse(decoded) as Auth0User;
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new Error('Invalid ID token: missing sub claim');
  }
  if (typeof claims.email !== 'string' || claims.email === '') {
    throw new Error('Invalid ID token: missing email claim');
  }
  return claims;
}

export async function exchangeAuth0Code(
  params: Auth0CodeExchangeParams,
): Promise<Auth0CodeExchangeResult> {
  const issuer = normalizeIssuer(params.issuerBaseUrl);
  const tokenUrl = `${issuer}/oauth/token`;

  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    let errorMessage = `Auth0 token exchange failed (HTTP ${String(response.status)})`;
    try {
      const errorData: { error?: string; error_description?: string } = await response.json();
      errorMessage = `Auth0 token exchange failed: ${errorData.error ?? 'unknown'} - ${errorData.error_description ?? ''}`;
    } catch {
      // non-JSON body — use generic message
    }
    throw new Error(errorMessage);
  }

  const tokenData: {
    access_token: string;
    id_token: string;
    token_type: string;
    expires_in: number;
  } = await response.json();

  const user = decodeAuth0IdTokenClaims(tokenData.id_token);
  return { accessToken: tokenData.access_token, user };
}
```

### Step 4: Run test to verify it passes

```bash
cd workers/mcp-server && pnpm test tests/auth/auth0-handler.spec.ts
```

Expected: PASS (all tests in this file)

### Step 5: Commit

```bash
git add workers/mcp-server/src/auth/auth0-handler.ts workers/mcp-server/tests/auth/auth0-handler.spec.ts
git commit -m "feat(mcp-server): add Auth0 OAuth handler for authorization code flow"
```

---

## Task 2: Update MCP server types, env, and config tests to use Auth0 credentials

**Files:**
- Modify: `workers/mcp-server/src/types.ts`
- Modify: `workers/mcp-server/wrangler.jsonc`
- Modify: `workers/mcp-server/.dev.vars.example`
- Modify: `workers/mcp-server/tests/config/worker-config.spec.ts`

There is no meaningful unit test for type changes alone. TypeScript will enforce correctness at the typecheck step. However, `tests/config/worker-config.spec.ts` (Tests 85 and 87) contains source-inspection assertions that check for the old credential field names — these will fail after we update `types.ts` and `.dev.vars.example`. We must update those tests to reflect the new Auth0 field names before making the source changes, then verify the new test expectations match the new source.

### Step 1: Update tests/config/worker-config.spec.ts (Tests 85 and 87)

Open `workers/mcp-server/tests/config/worker-config.spec.ts`. Replace the full file contents:

```typescript
/**
 * Worker Config Validation Tests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Worker Config', () => {
  // Test 85: Env type includes all required Auth0 + cookie bindings
  // Updated from AGENT_API_KEY/AGENT_ID/GOOGLE_CLIENT_* (retired by PCC-3191)
  it('should declare all required secrets in Env type', () => {
    const typesPath = resolve(__dirname, '../../src/types.ts');
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).toContain('AUTH0_CLIENT_ID');
    expect(content).toContain('AUTH0_CLIENT_SECRET');
    expect(content).toContain('AUTH0_ISSUER_BASE_URL');
    expect(content).toContain('PUBLIC_ORIGIN');
    expect(content).toContain('COOKIE_ENCRYPTION_KEY');
    // Retired fields must not appear in Env
    expect(content).not.toContain('AGENT_API_KEY');
    expect(content).not.toContain('AGENT_ID');
    expect(content).not.toContain('GOOGLE_CLIENT_ID');
    expect(content).not.toContain('GOOGLE_CLIENT_SECRET');
  });

  // Test 86: Env type includes OAUTH_KV binding (unchanged)
  it('should declare OAUTH_KV KV namespace binding', () => {
    const typesPath = resolve(__dirname, '../../src/types.ts');
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).toContain('OAUTH_KV: KVNamespace');
  });

  // Test 87: .dev.vars.example documents all Auth0 secrets
  // Updated from AGENT_API_KEY/AGENT_ID/GOOGLE_CLIENT_* (retired by PCC-3191)
  it('should document all required secrets in .dev.vars.example', () => {
    const devVarsPath = resolve(__dirname, '../../.dev.vars.example');
    const content = readFileSync(devVarsPath, 'utf-8');
    expect(content).toContain('AUTH0_CLIENT_ID');
    expect(content).toContain('AUTH0_CLIENT_SECRET');
    expect(content).toContain('AUTH0_ISSUER_BASE_URL');
    expect(content).toContain('COOKIE_ENCRYPTION_KEY');
    // Retired fields must not appear in the example file
    expect(content).not.toContain('AGENT_API_KEY');
    expect(content).not.toContain('GOOGLE_CLIENT_ID');
    expect(content).not.toContain('GOOGLE_CLIENT_SECRET');
  });
});
```

### Step 2: Run config tests to verify the updated tests fail (source not changed yet)

```bash
cd workers/mcp-server && pnpm test tests/config/worker-config.spec.ts
```

Expected: Tests 85 and 87 FAIL — `types.ts` still has old field names; `.dev.vars.example` still has old secrets. Test 86 passes unchanged.

### Step 3: Update `workers/mcp-server/src/types.ts`

Read the current file first to confirm its full contents, then replace the entire file. The replacement below is the complete authoritative version — it preserves the RL binding fields from the current file and adds Auth0 fields while removing AGENT_API_KEY, AGENT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.

```typescript
export interface Env {
  // Non-secret env vars
  ENVIRONMENT: string;
  CSS_BACKEND_URL: string;
  MCP_SERVER_NAME: string;
  MCP_SERVER_VERSION: string;

  /**
   * The public-facing origin of this MCP server (e.g. https://mcp.example.com).
   * Used for RFC 9728 oauth-protected-resource metadata and RFC 8707 resource indicators.
   */
  PUBLIC_ORIGIN: string;

  // Auth0 secrets (replaced Google OAuth and AGENT_API_KEY credentials — PCC-3191)
  // Set via `wrangler secret put` per environment — not in vars.
  AUTH0_CLIENT_ID: string;
  AUTH0_CLIENT_SECRET: string;
  AUTH0_ISSUER_BASE_URL: string;

  /** Optional: Auth0 audience for the access token (defaults to AUTH0_ISSUER_BASE_URL) */
  AUTH0_AUDIENCE?: string;

  // Cookie encryption key (used by OAuthProvider)
  COOKIE_ENCRYPTION_KEY: string;

  // KV binding (used by @cloudflare/workers-oauth-provider)
  OAUTH_KV: KVNamespace;

  // Service binding to the API worker (avoids worker-to-worker fetch 1042 errors)
  CSS_BACKEND?: Fetcher;

  // PCC-3192 — Rate Limiting bindings (red-team Finding 4). All four are
  // optional so the rate-limit wrapper can fail OPEN with a one-shot warn
  // when a binding is missing.
  RL_TOOLS_READ?: RateLimit;
  RL_TOOLS_MUTATION?: RateLimit;
  RL_TOOLS_ANON?: RateLimit;
  RL_OAUTH?: RateLimit;
}
```

Removed from `Env`: `AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### Step 4: Update `workers/mcp-server/.dev.vars.example`

Replace the entire file:

```
# MCP Server Development Secrets
# Copy to .dev.vars and fill in values

# Auth0 credentials (for user authentication — replaces Google OAuth, PCC-3191)
AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com
# Optional: Auth0 API audience for access token scoping
# AUTH0_AUDIENCE=https://your-api-audience

# Cookie encryption key (for OAuth flow)
COOKIE_ENCRYPTION_KEY=generate-a-random-32-byte-hex-string
```

### Step 5: Update `workers/mcp-server/wrangler.jsonc`

Make these changes to the vars stanzas:

**Top-level `vars` block:** Add `PUBLIC_ORIGIN: "http://localhost:8788"`. Remove any references to `AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from vars (these should be absent already in the file — verify they are not present before and after).

**`env.sbx1` vars:** Add `PUBLIC_ORIGIN: "https://css-mcp-server-sbx1.chris-801.workers.dev"`.

**`env.production` vars:** Add `PUBLIC_ORIGIN: "https://css-mcp-server-prod.pantheon.workers.dev"`.

Add this comment block just before the top-level `vars` stanza:

```jsonc
// ============================================================================
// Auth secrets — set via `wrangler secret put` per environment:
//   AUTH0_CLIENT_ID          — Auth0 application client ID
//   AUTH0_CLIENT_SECRET      — Auth0 application client secret
//   AUTH0_ISSUER_BASE_URL    — Auth0 tenant URL (e.g. https://example.auth0.com)
//   AUTH0_AUDIENCE           — (optional) Auth0 API audience for access token scoping
//   COOKIE_ENCRYPTION_KEY    — random 32-byte hex for OAuthProvider cookie signing
// ============================================================================
```

### Step 6: Run config tests to verify they now pass

```bash
cd workers/mcp-server && pnpm test tests/config/worker-config.spec.ts
```

Expected: All 3 tests PASS.

### Step 7: Run typecheck to see errors cascade from type removals

```bash
cd workers/mcp-server && pnpm typecheck
```

Expected: TypeScript errors in `index.ts` and `mcp-handler.ts` referencing removed fields (`AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). These are the targets for Tasks 3 and 4.

### Step 8: Commit

```bash
git add workers/mcp-server/src/types.ts workers/mcp-server/wrangler.jsonc workers/mcp-server/.dev.vars.example workers/mcp-server/tests/config/worker-config.spec.ts
git commit -m "feat(mcp-server): replace Google OAuth env fields with Auth0 credentials in types, wrangler config, and dev docs"
```

---

## Task 3: Update McpApiClient to forward Auth0 access token

**Files:**
- Modify: `workers/mcp-server/src/shared/types.ts`
- Modify: `workers/mcp-server/src/shared/api-client.ts`
- Modify: `workers/mcp-server/tests/shared/api-client.spec.ts`

### Step 1: Write the failing tests and update existing stale test

Open `workers/mcp-server/tests/shared/api-client.spec.ts` and make these changes:

**a) Update the stale test** (`should throw if agentApiKey is missing`) to match the new constructor contract. The new rule is: throw if BOTH are absent. Locate the test (around line 54) and replace it:

```typescript
// BEFORE (old behavior — agentApiKey was required):
it('should throw if agentApiKey is missing', async () => {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  expect(() => new McpApiClient({ ...defaultConfig, agentApiKey: '' })).toThrow();
});

// AFTER (new behavior — either agentApiKey OR accessToken is required):
it('should throw if neither agentApiKey nor accessToken is provided', async () => {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  // Neither key present — must throw
  expect(() => new McpApiClient({
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-uuid-1',
  })).toThrow('either agentApiKey or accessToken');
});

it('should NOT throw if only accessToken is provided', async () => {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  // accessToken alone is sufficient
  expect(() => new McpApiClient({
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-uuid-1',
    accessToken: 'auth0-token-xyz',
  })).not.toThrow();
});
```

**b) Add new tests** at the end of the `describe('headers')` block:

```typescript
it('should send Authorization: Bearer when accessToken is provided', async () => {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const client = new McpApiClient({
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-uuid-1',
    accessToken: 'auth0-access-token-xyz',
  });

  mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
  await client.listSites();

  const [, options] = mockFetch.mock.calls[0];
  expect(options.headers['Authorization']).toBe('Bearer auth0-access-token-xyz');
  expect(options.headers['X-API-Key']).toBeUndefined();
});

it('should not send X-Acting-User-* headers when using accessToken auth', async () => {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const client = new McpApiClient({
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-uuid-1',
    accessToken: 'auth0-access-token-xyz',
    actingUser: { id: 'user-123', email: 'user@example.com' },
  });

  mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
  await client.listSites();

  const [, options] = mockFetch.mock.calls[0];
  expect(options.headers['X-Acting-User-Id']).toBeUndefined();
  expect(options.headers['X-Acting-User-Email']).toBeUndefined();
});

it('agentApiKey path still sends X-API-Key and X-Acting-User-* (legacy local dev)', async () => {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const client = new McpApiClient({
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-uuid-1',
    agentApiKey: 'aak_test-key',
    actingUser: { id: 'user-123', email: 'user@example.com' },
  });

  mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
  await client.listSites();

  const [, options] = mockFetch.mock.calls[0];
  expect(options.headers['X-API-Key']).toBe('aak_test-key');
  expect(options.headers['X-Acting-User-Id']).toBe('user-123');
  expect(options.headers['X-Acting-User-Email']).toBe('user@example.com');
  expect(options.headers['Authorization']).toBeUndefined();
});
```

**Note on other tests in `api-client.spec.ts` that use `agentApiKey` inline:**

Lines 353, 365, 380, 404 construct `McpApiClient` with `agentApiKey: 'aak_test'` (non-empty). After the type change, `agentApiKey` becomes optional but still accepted. These tests remain valid and do NOT need to be changed — they exercise the legacy agentApiKey path which is intentionally retained for local dev. Do not touch them.

### Step 2: Run tests to verify new tests fail and stale test now matches intent

```bash
cd workers/mcp-server && pnpm test tests/shared/api-client.spec.ts
```

Expected: FAIL — `accessToken` field does not exist on `McpApiClientConfig`; the updated `should throw if neither` test also fails since current behavior still throws on missing `agentApiKey` alone.

### Step 3: Update `workers/mcp-server/src/shared/types.ts`

```typescript
export interface ActingUser {
  id: string;
  email: string;
}

export interface McpApiClientConfig {
  baseUrl: string;
  agentId: string;
  /** Legacy agent API key — used for local dev without Auth0 */
  agentApiKey?: string;
  /**
   * Auth0 access token — when present, sent as `Authorization: Bearer`.
   * Supersedes agentApiKey. X-Acting-User-* headers are NOT sent (identity
   * is already in the token).
   */
  accessToken?: string;
  actingUser?: ActingUser;
  /** Service binding fetcher — bypasses worker-to-worker fetch restrictions */
  fetcher?: Fetcher;
}
```

### Step 4: Update `workers/mcp-server/src/shared/api-client.ts`

In the `McpApiClient` class:

1. Update private fields:

```typescript
private readonly baseUrl: string;
private readonly agentId: string;
private readonly agentApiKey?: string;
private readonly accessToken?: string;
private readonly actingUser?: ActingUser;
private readonly fetcher?: Fetcher;
```

2. Update constructor:

```typescript
constructor(config: McpApiClientConfig) {
  if (!config.baseUrl) throw new Error('baseUrl is required');
  if (!config.agentId) throw new Error('agentId is required');
  if (!config.agentApiKey && !config.accessToken) {
    throw new Error('McpApiClient requires either agentApiKey or accessToken');
  }
  this.baseUrl = config.baseUrl.replace(/\/$/, '');
  this.agentId = config.agentId;
  this.agentApiKey = config.agentApiKey;
  this.accessToken = config.accessToken;
  this.actingUser = config.actingUser;
  this.fetcher = config.fetcher;
}
```

3. Update `getHeaders()`:

```typescript
private getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Actor-Type': 'agent',
    'X-Actor-Id': this.agentId,
  };

  if (this.accessToken !== undefined && this.accessToken !== '') {
    // Auth0 token path: identity is in the token; no acting-user headers needed.
    headers['Authorization'] = `Bearer ${this.accessToken}`;
  } else if (this.agentApiKey !== undefined && this.agentApiKey !== '') {
    // Legacy agent API key path (local dev / backwards compat).
    headers['X-API-Key'] = this.agentApiKey;
    if (this.actingUser) {
      headers['X-Acting-User-Id'] = this.actingUser.id;
      headers['X-Acting-User-Email'] = this.actingUser.email;
    }
  }

  return headers;
}
```

Note: `X-Actor-Type: agent` is kept in both paths for backend logging/tracing purposes. The backend ignores it for authentication when a Bearer token is present (Auth0IdentityProvider takes precedence). Removing it is out of scope for this plan.

### Step 5: Run tests to verify all api-client tests pass

```bash
cd workers/mcp-server && pnpm test tests/shared/api-client.spec.ts
```

Expected: PASS for all api-client tests

### Step 6: Commit

```bash
git add workers/mcp-server/src/shared/types.ts workers/mcp-server/src/shared/api-client.ts workers/mcp-server/tests/shared/api-client.spec.ts
git commit -m "feat(mcp-server): forward Auth0 access token as Bearer in api-client, retire X-Acting-User headers"
```

---

## Task 4: Update MCP server index.ts — switch /authorize to Auth0, add RFC 9728 endpoint, store accessToken in props

**Files:**
- Modify: `workers/mcp-server/src/index.ts`
- Modify: `workers/mcp-server/src/mcp-handler.ts`
- Modify: `workers/mcp-server/tests/auth/oauth-integration.spec.ts`
- Delete: `workers/mcp-server/src/auth/google-handler.ts` (no remaining importers after Step 3a)

### Step 1: Update Test 45 in oauth-integration.spec.ts and add new tests 48-51

**a) Update Test 45** (around line 68–88 in the file). The current Test 45 tests the OLD behavior (creating `McpApiClient` with `agentApiKey` and asserting `X-Acting-User-*` headers). Replace it to test the new behavior:

```typescript
// Test 45: Authenticated MCP request creates API client with Auth0 access token from token props
it('MCP handler extracts auth0AccessToken from props and passes as accessToken to API client', async () => {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  // Simulate what the MCP handler does under the new auth model:
  // create API client with accessToken from token props (no agentApiKey)
  const client = new McpApiClient({
    baseUrl: 'http://localhost:8787',
    agentId: 'mcp-server',
    accessToken: 'auth0-access-token-abc',
    actingUser: { id: 'auth0|user123', email: 'user@example.com' },
  });

  mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
  await client.listSites();

  const [, options] = mockFetch.mock.calls[0];
  // Bearer token — not API key
  expect(options.headers['Authorization']).toBe('Bearer auth0-access-token-abc');
  expect(options.headers['X-API-Key']).toBeUndefined();
  // Acting-user headers NOT sent in Bearer mode (identity is in the token)
  expect(options.headers['X-Acting-User-Id']).toBeUndefined();
  expect(options.headers['X-Acting-User-Email']).toBeUndefined();
});
```

**b) Add new tests 48-51** at the end of the `describe('OAuth Integration')` block:

```typescript
// Test 48: /authorize redirects to Auth0, not Google
it('/authorize redirects to Auth0 (not Google)', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const indexSource = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf-8');
  expect(indexSource).toContain('getAuth0AuthorizationUrl');
  expect(indexSource).not.toContain('getGoogleAuthorizationUrl');
});

// Test 49: RFC 9728 /.well-known/oauth-protected-resource endpoint is handled
it('index.ts handles /.well-known/oauth-protected-resource', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const indexSource = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf-8');
  expect(indexSource).toContain('/.well-known/oauth-protected-resource');
  expect(indexSource).toContain('"resource"');
  expect(indexSource).toContain('"authorization_servers"');
  expect(indexSource).toContain('"bearer_methods_supported"');
});

// Test 50: UserProps includes auth0AccessToken field
it('UserProps stores auth0AccessToken from the code exchange', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const indexSource = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf-8');
  expect(indexSource).toContain('auth0AccessToken');
});

// Test 51: MCP API handler creates McpApiClient with accessToken, not agentApiKey
it('MCP API handler passes accessToken (not agentApiKey) to McpApiClient', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const mcpHandlerSource = readFileSync(resolve(__dirname, '../../src/mcp-handler.ts'), 'utf-8');
  expect(mcpHandlerSource).toContain('accessToken');
  // agentApiKey must not be populated from env in the handler
  expect(mcpHandlerSource).not.toContain('agentApiKey: config.agentApiKey');
});

// Test 52: mcpApiHandler returns 401 when ctx.props is undefined (PCC-3191 security guard)
it('index.ts returns 401 when props is undefined (no fallback to agent key)', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const indexSource = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf-8');
  // Must return 401 when props is undefined — NOT a silent warn + proceed
  expect(indexSource).toContain('status: 401');
  // Must not fall back to env.AGENT_API_KEY or env.AGENT_ID
  expect(indexSource).not.toContain('env.AGENT_API_KEY');
  expect(indexSource).not.toContain('env.AGENT_ID');
});
```

### Step 2: Run tests to verify updated Test 45 and new tests 48-52 fail

```bash
cd workers/mcp-server && pnpm test tests/auth/oauth-integration.spec.ts
```

Expected: Test 45 now fails because it passes `accessToken` but the old `McpApiClientConfig` does not have that field — however Task 3 has already fixed the type, so Test 45 may pass if Tests 48-52 are what actually fails. All new tests 48-52 fail since `index.ts` still uses Google, lacks the RFC 9728 endpoint, returns a warn-and-continue instead of 401 for undefined props, and still references `env.AGENT_API_KEY`.

### Step 3: Update `workers/mcp-server/src/index.ts`

**a) Update imports:**

```typescript
// Remove:
import {
  getGoogleAuthorizationUrl,
  exchangeGoogleCode,
} from './auth/google-handler.js';

// Add:
import {
  getAuth0AuthorizationUrl,
  exchangeAuth0Code,
} from './auth/auth0-handler.js';
```

**b) Update `UserProps` interface:**

```typescript
interface UserProps {
  userId: string;
  email: string;
  name?: string;
  /** Auth0 access token — forwarded to the CSS backend as Bearer on every API call */
  auth0AccessToken: string;
}
```

**c) Add the RFC 9728 endpoint in `defaultHandler` (before the rate-limit block for `/authorize`):**

```typescript
// RFC 9728 — OAuth Protected Resource Metadata
// Tells MCP clients which authorization server to use for this resource.
if (url.pathname === '/.well-known/oauth-protected-resource') {
  const publicOrigin = env.PUBLIC_ORIGIN;
  const issuer = env.AUTH0_ISSUER_BASE_URL;
  return new Response(
    JSON.stringify({
      resource: publicOrigin,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
```

**d) Replace the `/authorize` handler body** (the `if (url.pathname === '/authorize')` block):

```typescript
if (url.pathname === '/authorize') {
  const oauthHelpers = getOAuthHelpers(env);
  if (!oauthHelpers) {
    return new Response('OAuth not configured', { status: 500 });
  }

  const authRequest: AuthRequest = await oauthHelpers.parseAuthRequest(request);
  const client = await oauthHelpers.lookupClient(authRequest.clientId);
  if (!client) {
    return new Response('Unknown client', { status: 400 });
  }

  const stateData = JSON.stringify({
    authRequest: {
      responseType: authRequest.responseType,
      clientId: authRequest.clientId,
      redirectUri: authRequest.redirectUri,
      scope: authRequest.scope,
      state: authRequest.state,
      codeChallenge: authRequest.codeChallenge,
      codeChallengeMethod: authRequest.codeChallengeMethod,
    },
  });
  const encodedState = btoa(stateData);

  const callbackUrl = `${url.origin}/callback`;

  // RFC 8707 — resource indicator: scope the access token to this MCP server
  const auth0Url = getAuth0AuthorizationUrl({
    issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
    clientId: env.AUTH0_CLIENT_ID,
    redirectUri: callbackUrl,
    state: encodedState,
    scope: 'openid email profile',
    audience: env.AUTH0_AUDIENCE,
    resource: env.PUBLIC_ORIGIN,
  });

  return Response.redirect(auth0Url, 302);
}
```

**e) Replace the `/callback` handler body**:

```typescript
if (url.pathname === '/callback') {
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  if (code === null || code === '' || stateParam === null || stateParam === '') {
    return new Response('Missing code or state parameter', { status: 400 });
  }

  const stateData = JSON.parse(atob(stateParam)) as {
    authRequest: {
      responseType: string;
      clientId: string;
      redirectUri: string;
      scope: string[];
      state: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
    };
  };

  const callbackUrl = `${url.origin}/callback`;
  const auth0Result = await exchangeAuth0Code({
    code,
    issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL,
    clientId: env.AUTH0_CLIENT_ID,
    clientSecret: env.AUTH0_CLIENT_SECRET,
    redirectUri: callbackUrl,
  });

  const oauthHelpers = getOAuthHelpers(env);
  if (!oauthHelpers) {
    return new Response('OAuth not configured', { status: 500 });
  }

  const { redirectTo } = await oauthHelpers.completeAuthorization({
    request: stateData.authRequest as AuthRequest,
    userId: auth0Result.user.sub,
    metadata: {
      label: auth0Result.user.name ?? auth0Result.user.email,
    },
    scope: stateData.authRequest.scope,
    props: {
      userId: auth0Result.user.sub,
      email: auth0Result.user.email,
      name: auth0Result.user.name,
      auth0AccessToken: auth0Result.accessToken,
    } satisfies UserProps,
  });

  return Response.redirect(redirectTo, 302);
}
```

**f) Update `mcpApiHandler` — guard for `props === undefined`, pass `accessToken` to `createMcpServer`, remove `agentApiKey`/`AGENT_ID` references:**

Replace the `props` extraction block and the `createMcpServer` call together:

```typescript
// Extract user props from the authenticated context.
// OAuthProvider sets ctx.props with the user identity from the OAuth token.
// If props is undefined, OAuthProvider failed to inject claims — this should
// not happen in normal operation but can occur if the library API changes.
// Return 401 rather than proceeding without an authenticated identity:
// the old fallback to AGENT_API_KEY is intentionally eliminated by PCC-3191.
const props = (ctx as ExecutionContext & { props?: UserProps }).props;
if (props === undefined) {
  console.error('MCP API handler: ctx.props is undefined -- rejecting request (PCC-3191)');
  return new Response(
    JSON.stringify({ error: 'Unauthorized', reason: 'no authenticated identity in token context' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

const server = createMcpServer({
  baseUrl: env.CSS_BACKEND_URL,
  agentId: 'mcp-server',           // hardcoded; used for X-Actor-Id header only
  serverName: env.MCP_SERVER_NAME,
  serverVersion: env.MCP_SERVER_VERSION,
  actingUser: { id: props.userId, email: props.email },
  accessToken: props.auth0AccessToken,
  fetcher: env.CSS_BACKEND,
  rateLimiters: {
    toolsRead: env.RL_TOOLS_READ,
    toolsMutation: env.RL_TOOLS_MUTATION,
    toolsAnon: env.RL_TOOLS_ANON,
  },
  rateLimitContext: {
    actingUserId: props.userId,
    clientIp: getClientIp(request),
  },
});
```

**Why the 401 guard:** Under the new auth model, `createMcpServer` receives neither `agentApiKey` nor `accessToken` when `props` is undefined. `McpApiClient` would throw, producing an unhandled 500. Returning 401 is the correct security response — we have no authenticated identity, so we must not proceed. The old `console.warn` + silent continue was acceptable when `AGENT_API_KEY` from `env` provided a fallback; that fallback is intentionally eliminated by this plan.

### Step 4: Update `workers/mcp-server/src/mcp-handler.ts`

Update `McpHandlerConfig` to remove required `agentApiKey` and add optional `accessToken`:

```typescript
export interface McpHandlerConfig {
  baseUrl: string;
  agentId: string;
  /** Auth0 access token — forwarded to CSS backend as Bearer */
  accessToken?: string;
  /** Legacy API key — no longer used in production; retained for type compatibility */
  agentApiKey?: string;
  serverName: string;
  serverVersion: string;
  actingUser?: ActingUser;
  fetcher?: Fetcher;
  rateLimiters?: RateLimiters;
  rateLimitContext?: RateLimitContext;
}
```

Update `createMcpServer` to pass `accessToken`:

```typescript
const apiClient = new McpApiClient({
  baseUrl: config.baseUrl,
  agentId: config.agentId,
  accessToken: config.accessToken,
  agentApiKey: config.agentApiKey,   // retained for type compat; unused in production
  actingUser: config.actingUser,
  fetcher: config.fetcher,
});
```

### Step 5: Delete `workers/mcp-server/src/auth/google-handler.ts` and its test file (now dead code)

After Task 4 Step 3a removes the imports for `getGoogleAuthorizationUrl` and `exchangeGoogleCode`, `google-handler.ts` has no remaining importers in `src/`. The matching test file `tests/auth/google-handler.spec.ts` (Tests 34-41) imports directly from `google-handler.js` — leaving it after the source file is deleted will cause runtime import errors on every test run. Delete both files.

The equivalent functionality (URL construction, code exchange, ID token decoding) is now covered by `tests/auth/auth0-handler.spec.ts` added in Task 1.

```bash
rm workers/mcp-server/src/auth/google-handler.ts
rm workers/mcp-server/tests/auth/google-handler.spec.ts
```

Verify nothing still imports the Google handler:

```bash
grep -rn "google-handler" workers/mcp-server/src/ workers/mcp-server/tests/ && echo "STILL REFERENCED — DO NOT COMMIT" || echo "clean"
```

Expected: `clean`

### Step 6: Run all MCP server tests, typecheck, and lint

```bash
cd workers/mcp-server && pnpm test
```

Expected: All previously-passing tests still pass (except pre-existing `create-page.spec.ts` failure). Tests 34-41 (GoogleOAuthHandler) are gone — the file is deleted. Updated Test 45 and new tests 48-52 now pass. Tests 85 and 87 (updated in Task 2) pass. The new auth0-handler tests from Task 1 pass.

```bash
cd workers/mcp-server && pnpm typecheck
```

Expected: 0 errors

```bash
cd workers/mcp-server && pnpm lint
```

Expected: 0 errors

### Step 7: Commit

```bash
git add workers/mcp-server/src/index.ts workers/mcp-server/src/mcp-handler.ts workers/mcp-server/tests/auth/oauth-integration.spec.ts
git rm workers/mcp-server/src/auth/google-handler.ts workers/mcp-server/tests/auth/google-handler.spec.ts
git commit -m "feat(mcp-server): switch /authorize to Auth0, add RFC 9728 endpoint, forward access token to backend, remove google-handler"
```

---

## Task 5: Verify backend test failures are pre-existing and document

**Files:**
- Read: `workers/tests/routes/allowlist-agent-acting.spec.ts`

### Step 1: Confirm the 2 failing backend tests predate this branch

```bash
cd workers && pnpm test tests/routes/allowlist-agent-acting.spec.ts
```

These 2 tests (`rejects with 403 when agent acts on behalf of a user that is NOT in the allowlist`, `rejects with 403 when agent acts on behalf of an inactive allowlisted user`) fail because the new auth model means the MCP server no longer sends `X-Acting-User-*` headers — so these tests, which mock the old header path, cannot pass without updating the tests.

**Important:** These tests encode a real behavioral contract. Under the new auth model, the acting-user identity is in the Auth0 JWT `sub`/`email` claims, not in headers. The backend receives a `user` principal directly — the `agent + X-Acting-User-*` path is retired for MCP traffic.

**Do NOT modify the backend tests in this plan.** The correct fix is a separate PR that:
1. Updates these tests to use Auth0 JWT tokens instead of `X-Acting-User-*` headers
2. Adds new tests that verify the `user` principal path works correctly

Document this as a follow-up in `PROGRESS.md`.

### Step 2: Add PROGRESS.md entry

Update `PROGRESS.md` with:
- PCC-3191 implementation complete on branch `pcc-3191-mcp-auth-migration`
- Pre-existing test failures noted: `allowlist-agent-acting.spec.ts` (2 — pre-existing from `auth-broker` branch), `create-page.spec.ts` (1 — pre-existing mock bug)
- Follow-up needed: update `allowlist-agent-acting.spec.ts` to use Auth0 JWT tokens

---

## Task 6: Final verification

### Step 1: Run all MCP server tests

```bash
cd workers/mcp-server && pnpm test
```

Expected: All previously-passing tests pass. New tests added in Tasks 1, 3, and 4 (including Tests 48-52) pass. Tests 85 and 87 updated in Task 2 pass. Pre-existing `create-page.spec.ts` failure unchanged.

### Step 2: Run typecheck

```bash
cd workers/mcp-server && pnpm typecheck
```

Expected: 0 errors

### Step 3: Run lint

```bash
cd workers/mcp-server && pnpm lint
```

Expected: 0 errors

### Step 4: Run backend tests to confirm no regressions

```bash
cd workers && pnpm test
```

Expected: Same results as baseline (2 pre-existing failures in `allowlist-agent-acting.spec.ts`).

### Step 5: Final commit

```bash
git add PROGRESS.md
git commit -m "docs: update PROGRESS.md with PCC-3191 MCP auth migration completion"
```

---

## Testing strategy summary

| Behavior | Test type | File |
|---|---|---|
| Auth0 authorization URL construction | Unit | `tests/auth/auth0-handler.spec.ts` |
| Auth0 URL includes `resource` param (RFC 8707) | Unit | `tests/auth/auth0-handler.spec.ts` |
| Auth0 code exchange returns accessToken + user | Unit | `tests/auth/auth0-handler.spec.ts` |
| McpApiClient sends `Authorization: Bearer` when `accessToken` provided | Unit | `tests/shared/api-client.spec.ts` |
| McpApiClient does NOT send `X-Acting-User-*` in Bearer mode | Unit | `tests/shared/api-client.spec.ts` |
| McpApiClient legacy `agentApiKey` path still works (local dev) | Unit | `tests/shared/api-client.spec.ts` |
| McpApiClient throws if neither agentApiKey nor accessToken | Unit | `tests/shared/api-client.spec.ts` |
| `types.ts` declares Auth0 fields, not old AGENT/GOOGLE fields | Source inspection | `tests/config/worker-config.spec.ts` |
| `.dev.vars.example` documents Auth0 secrets, not old fields | Source inspection | `tests/config/worker-config.spec.ts` |
| MCP handler uses Auth0 token from props (new Test 45) | Unit | `tests/auth/oauth-integration.spec.ts` |
| `/authorize` redirects to Auth0, not Google | Source inspection | `tests/auth/oauth-integration.spec.ts` |
| `/.well-known/oauth-protected-resource` endpoint exists with correct JSON keys | Source inspection | `tests/auth/oauth-integration.spec.ts` |
| `UserProps` includes `auth0AccessToken` field | Source inspection | `tests/auth/oauth-integration.spec.ts` |
| `createMcpServer` receives `accessToken` not `agentApiKey` | Source inspection | `tests/auth/oauth-integration.spec.ts` |
| `mcpApiHandler` returns 401 when `ctx.props` is undefined (no AGENT_API_KEY fallback) | Source inspection | `tests/auth/oauth-integration.spec.ts` |

**Tests 34-41 (GoogleOAuthHandler) are intentionally deleted.** `tests/auth/google-handler.spec.ts` imports directly from `src/auth/google-handler.js`. That source file is deleted in Task 4 Step 5, so the test file must be deleted with it — otherwise all 8 tests fail with a runtime import error. The equivalent coverage (URL construction, code exchange, ID token decode) is provided by `tests/auth/auth0-handler.spec.ts` added in Task 1.

**Why source-inspection tests instead of live HTTP tests?**
The `OAuthProvider` from `@cloudflare/workers-oauth-provider` uses `cloudflare:` protocol imports that are not available in Vitest's Node.js runtime. Integration tests that instantiate the full worker would require Miniflare, which is not currently in the MCP server's dev dependencies. The existing test suite already uses source-inspection for similar reasons (Tests 42–47 in `oauth-integration.spec.ts`). We follow the established pattern rather than introducing a new test harness.

---

## Known gaps (document, do not block)

1. **Real Auth0 end-to-end test:** Cannot run without `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_ISSUER_BASE_URL` — these are ops secrets. The local-dev path has no fallback in production mode; local dev requires Auth0 configuration or a local Auth0 emulator.

2. **`allowlist-agent-acting.spec.ts`:** 2 tests that mock the old `X-Acting-User-*` header path are now conceptually stale — the MCP server no longer sends those headers. Follow-up PR needed.

3. **`create-page.spec.ts`:** 1 pre-existing test failure. Not introduced by this change.

4. **`X-Actor-Type: agent` header:** Kept in both Bearer and legacy paths for backend logging/tracing. The backend ignores it for authentication when a Bearer token is present. Cleanup is out of scope for this plan.
