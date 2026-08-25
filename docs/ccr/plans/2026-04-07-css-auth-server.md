# CSS Auth Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Build a standalone `workers/auth-server/` Cloudflare Worker that acts as the sole OAuth 2.0 Authorization Server for the CSS ecosystem, eliminating the need for puck-css frontend clients and MCP agents to register directly with Google.

**Architecture:** A new Cloudflare Worker (`workers/auth-server/`) wraps `@cloudflare/workers-oauth-provider` with the Google OAuth proxy pattern already proven in `workers/mcp-server/`. It uses `client_id = site_id` so the site record IS the OAuth client registration; it reads `site.allowedOrigins[]` from PostgreSQL via a service binding to the main CSS worker to validate redirect URIs. Clients are lazily provisioned into the library's OAUTH_KV (via direct KV write using the library's `client:{siteId}` key format) on first authorize request, after origin validation passes. `oauthHelpers.createClient()` is NOT used for provisioning because it ignores any provided `clientId` and generates its own random one — see Design Decision #1 for the verified source analysis. Resource servers validate tokens by calling a dedicated `POST /internal/token/validate` endpoint on the auth server (which calls `oauthHelpers.unwrapToken()`) via a service binding — NOT via RFC 7662 introspection, which `@cloudflare/workers-oauth-provider` does not expose. The MCP server is unchanged.

**Tech Stack:** TypeScript, Cloudflare Workers, `@cloudflare/workers-oauth-provider` v0.3.0, Vitest, PostgreSQL (via service binding to main CSS worker), PKCE S256 enforced.

---

## Design Decisions (with justification)

### 1. `client_id = site_id`, lazy client registration via direct OAUTH_KV write
**Decision:** The CSS `site` record is the OAuth client. `allowedOrigins[]` on the site model is the only new config surface. On the first authorize request for a site, after origin validation passes, the client is registered by writing directly to `OAUTH_KV` with key `client:{siteId}`. On subsequent requests, if the exact `redirect_uri` is not yet in the registered `redirectUris`, it is added by reading the existing KV entry, merging the new URI, and writing back. This is idempotent.

**Justification:** `@cloudflare/workers-oauth-provider` requires a client to be registered before `parseAuthRequest()` proceeds (it calls `lookupClient()` internally, which reads `OAUTH_KV.get('client:{clientId}', {type: 'json'})` — returning null on miss causes an authorization failure). Pre-provisioning at site creation would require keeping client registrations in sync with PostgreSQL. Lazy provisioning at authorize time avoids this coordination problem.

**Why not `oauthHelpers.createClient()`:** The library's `createClient()` implementation (verified in source) **ignores any `clientId` field in the `Partial<ClientInfo>` argument** — it always generates a random clientId via `generateRandomString(16)`. Calling `createClient({ clientId: siteId })` would register a new client with a random ID, never the site ID. `lookupClient(siteId)` would then always return null.

**Why direct KV write is correct:** The library's KV key format for clients is `client:{clientId}` (stable, used consistently throughout the source). Reading this key is how `lookupClient(clientId)` and `parseAuthRequest()` locate the client. Writing `OAUTH_KV.put('client:{siteId}', JSON.stringify(clientInfo))` is functionally equivalent to what the library does internally after dynamic registration — there is no hidden state beyond this KV entry. The `ClientInfo` shape is fully documented in the library's type declarations.

The registered `redirectUris` list is additive (new validated URIs accumulate). This handles the wildcard case: `*-mysite.pantheonsite.io` matches `live-mysite.pantheonsite.io`, which is then stored as an exact URI in the client's `redirectUris` list for future library lookups via `parseAuthRequest()`.

### 2. `allowedOrigins` in PostgreSQL, read via service binding
**Decision:** `allowedOrigins[]` lives in the `app.sites` table (new column). The auth worker reads it by calling an internal endpoint on the main CSS worker via a Cloudflare service binding.

**Justification:** Site configuration belongs in PostgreSQL alongside other site metadata. Duplicating it in KV would create two sources of truth. Service binding avoids a new Hyperdrive binding for the auth worker (the main worker already has it). Service bindings in Cloudflare are zero-latency in-process calls — no HTTP overhead.

### 3. Token validation via `POST /internal/token/validate` (NOT RFC 7662)
**Decision:** Resource servers validate auth server tokens by calling `POST /internal/token/validate` on the auth server via a service binding. This endpoint calls `oauthHelpers.unwrapToken()` and returns the decrypted user props.

**Justification:** `@cloudflare/workers-oauth-provider` v0.3.0 does NOT expose a `/token/introspect` endpoint (RFC 7662). The library decrypts token props internally using `oauthHelpers.unwrapToken()`, which requires access to OAUTH_KV and the encryption keys — both only available within the auth server worker. A dedicated internal endpoint is the correct architecture for a separate resource server needing token validation. This endpoint is protected by `X-Internal-Secret` (same pattern as the existing internal API).

### 4. Standalone auth worker, not merged into main CSS worker
**Decision:** `workers/auth-server/` is a new, separate Cloudflare Worker.

**Justification:** Separation of concerns. The auth server is a pure OAuth AS — it owns the Google Client ID and PKCE flow. The main CSS worker is a resource server. Mixing them would conflate two distinct roles. Both the main worker and MCP server become resource servers that validate the auth server's tokens. The MCP server does not need to change its authorization logic at all.

### 5. Enforce PKCE S256 only
**Decision:** `allowPlainPKCE: false` in the OAuthProvider configuration.

**Justification:** `@cloudflare/workers-oauth-provider` v0.3.0 supports PKCE natively. Browser-based puck-css clients must use PKCE (no client secrets in browser code). S256 is required by OAuth 2.1. Plain PKCE provides no security benefit over no PKCE and should be rejected.

### 6. `canVerifyToken` routing for opaque tokens
**Decision:** `CSSAuthIdentityProvider.canVerifyToken()` returns `true` for tokens that:
- Are non-empty
- Do NOT contain **any** dot (ruling out JWTs with 2 dots, 1-dot, 3+-dot formats, and any other dot-containing token)
- Do NOT start with `sat_` (SiteApiTokenProvider's domain)
- Do NOT start with `aak_` (AgentApiKeyProvider's domain)

**Justification:** `@cloudflare/workers-oauth-provider` issues opaque tokens in the format `{userId}:{grantId}:{secret}` — containing colons but **no dots whatsoever**. The implementation rejects any token that includes a dot (not just tokens with exactly 2 dots). This is more conservative and correct: CSS auth opaque tokens never contain dots, so any dot unambiguously signals a non-CSS-auth token. This correctly excludes JWTs (2 dots), 1-dot tokens, 3+-dot tokens, and any future dot-containing format. The exclusion rules above ensure CSSAuthIdentityProvider does not claim tokens that belong to other providers. Any new opaque token type with a distinct prefix must be excluded here.

### 7. Wildcard origin matching
**Decision:** `allowedOrigins` supports two matching strategies: (a) exact match, (b) wildcard prefix matching for Pantheon branch URLs (`*-mysite.pantheonsite.io` matches `dev-mysite.pantheonsite.io`, etc.). After validation passes, the exact URI is stored in OAUTH_KV for the library.

**Justification:** Pantheon generates branch URLs like `{env}-{site}.pantheonsite.io`. Enumerating all environments is impractical. Wildcards in the leftmost label position are safe when the domain suffix is fixed and validated as a suffix of the full hostname (not a substring). The implementation checks that the prefix label contains no dots and that the suffix is genuinely at the end.

### 8. Internal site-auth-config endpoint follows existing `handleInternalRoutes` pattern
**Decision:** The new `GET /internal/site-auth-config/:siteId` handler is added inside the existing `handleInternalRoutes` function. Auth checking is centralized there; the sub-handler does NOT re-check auth.

**Justification:** The existing pattern performs one centralized auth check at the top of `handleInternalRoutes` and dispatches to pure sub-handlers. Deviating would create inconsistent duplicated auth checks.

### 9. `getIdentityProvider` stays synchronous; `CSSAuthIdentityProvider` imported at module top
**Decision:** `getIdentityProvider` in `authentication.ts` stays a synchronous function. `CSSAuthIdentityProvider` is imported at the top of the module (not dynamically), and instantiated conditionally inside the function.

**Justification:** The earlier plan proposed a dynamic `import()` to make `getIdentityProvider` async, which would ripple through all callers. `CSSAuthIdentityProvider` has no runtime side effects at import time; it is safe to import at module top level. This is simpler and consistent with all other providers.

### 10. State parameter: base64 only (HMAC hardening deferred, documented)
**Decision:** The state parameter is base64-encoded JSON (same as MCP server today). HMAC signing is deferred.

**Justification:** This matches the existing MCP server pattern already in production. The state parameter contains only the original OAuth request data — no user secrets. An attacker forging the state will either (a) fail at `completeAuthorization()` because the `redirect_uri` won't match OAUTH_KV, or (b) succeed in redirecting their own Google auth to a registered URI — not a meaningful attack. HMAC hardening should be added before high-traffic production launch. **TODO:** Add HMAC-SHA256 state signing using `COOKIE_ENCRYPTION_KEY` before production launch. This is tracked as a known residual.

### 11. MCP server is unchanged
**Decision:** The MCP server's `OAuthProvider` and Google auth flow are not modified. The new auth server and MCP server are parallel, independent auth flows.

**Justification:** The MCP server handles AI agent clients (Claude Desktop, etc.) registered in the MCP server's KV. The auth server handles puck-css browser clients which are site-based. The main CSS worker validates both token types via `MultiProviderIdentityProvider`.

---

## File Inventory

### New files

```
workers/auth-server/
  package.json
  wrangler.jsonc
  tsconfig.json
  vitest.config.ts
  vitest.integration.config.ts
  eslint.config.js
  .dev.vars.example
  src/
    index.ts                         # OAuthProvider setup, authorize/callback/token-validate handlers
    types.ts                         # Env interface
    health.ts                        # GET /health handler
    auth/
      google-handler.ts              # Copied from mcp-server (no changes needed)
      origin-validator.ts            # matchesAllowedOrigin() — security-critical new logic
    services/
      site-lookup.ts                 # lookupSiteAuthConfig() via service binding
  tests/
    auth/
      google-handler.spec.ts         # Ported from mcp-server
      origin-validator.spec.ts       # Unit tests
      origin-validator.property.spec.ts  # Property-based wildcard safety tests
    services/
      site-lookup.spec.ts            # Service binding mock tests
    integration/
      oauth-config.spec.ts           # Source-inspection tests (OAuthProvider config)
      authorize-flow.integration.spec.ts  # Miniflare full flow tests
```

### Modified files

```
workers/src/
  auth/
    css-auth-identity-provider.ts   # NEW: unwrapToken-based provider
    index.ts (auth barrel)          # Export new provider
  middleware/
    authentication.ts               # Import and register CSSAuthIdentityProvider (sync, top-level import)
  index.ts (main worker)            # Add CSS_AUTH_SERVER? to Env
  routes/
    internal-api.ts                 # Add GET /internal/site-auth-config/:siteId case
  services/
    site-service.ts                 # Add getSiteAllowedOrigins(), update mapRowToSite, Create/UpdateSiteParams
  types/
    domain.ts                       # Add allowedOrigins: string[] to Site interface
  types/
    enums.ts                        # Add 'css_auth' to AuthProvider union type
workers/src/db/migrations/
  031_site_allowed_origins.sql      # ALTER TABLE app.sites ADD COLUMN allowed_origins TEXT[]
workers/tests/
  auth/
    css-auth-identity-provider.spec.ts
  routes/
    internal-api.spec.ts            # Add site-auth-config cases to existing file
```

---

## Task 1: Database Migration — `allowed_origins` column

**Files:**
- Create: `workers/src/db/migrations/031_site_allowed_origins.sql`
- Modify: `workers/src/types/domain.ts` (add `allowedOrigins` to `Site`)
- Modify: `workers/src/types/enums.ts` (add `'css_auth'` to `AuthProvider`)
- Modify: `workers/src/services/site-service.ts` (read/write `allowed_origins`)
- Modify: `workers/src/routes/site-api.ts` (expose `allowedOrigins` in create/update/get)
- Test: `workers/tests/routes/site-api.spec.ts` (update any snapshot tests that include full Site)

**Step 1: Write the migration file**

```sql
-- Migration: 031_site_allowed_origins
-- Description: Add allowed_origins column to sites for OAuth redirect URI validation
-- Phase: CSS Auth Server

ALTER TABLE app.sites
  ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN app.sites.allowed_origins IS
  'Allowed origin patterns for OAuth redirect URI validation. '
  'Supports exact matches (https://example.com) and wildcard prefix patterns '
  '(*-mysite.pantheonsite.io) for Pantheon branch URLs.';
```

Save to: `workers/src/db/migrations/031_site_allowed_origins.sql`

**Step 2: Apply migration to local database**

```bash
docker exec css-postgres psql -U cssuser -d cssdb -c "ALTER TABLE app.sites ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}';"
```

Expected: `ALTER TABLE`

Verify:
```bash
docker exec css-postgres psql -U cssuser -d cssdb -c "\d app.sites" 2>&1 | grep allowed_origins
```

Expected: `allowed_origins | text[] | not null | default '{}'::text[]`

**Step 3: Add `allowedOrigins` to the `Site` interface**

In `workers/src/types/domain.ts`, the `Site` interface is at line ~102. Add the new field:

```typescript
export interface Site {
  id: string;
  pantheonSiteId: string;
  /** Organization this site belongs to (for agent configuration) */
  organizationId?: string;
  name: string;
  workflowSettings: WorkflowSettings;
  /** Allowed origin patterns for OAuth redirect URI validation */
  allowedOrigins: string[];
  createdAt: string;
  updatedAt: string;
}
```

**Step 4: Add `'css_auth'` to `AuthProvider` union**

In `workers/src/types/enums.ts`, line 137, update:

```typescript
export type AuthProvider = 'auth0' | 'google' | 'mock' | 'site_token' | 'agent_key' | 'css_auth' | 'unknown';
```

**Step 5: Update `SiteRow` and `mapRowToSite` in `workers/src/services/site-service.ts`**

Update the `SiteRow` interface to include the new column:

```typescript
interface SiteRow {
  id: string;
  pantheon_site_id: string;
  name: string;
  workflow_settings: WorkflowSettings | string;
  allowed_origins: string[] | null;
  created_at: string;
  updated_at: string;
}
```

Update `mapRowToSite` to include the new field:

```typescript
function mapRowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    pantheonSiteId: row.pantheon_site_id,
    name: row.name,
    workflowSettings: parseWorkflowSettings(row.workflow_settings),
    allowedOrigins: row.allowed_origins ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

Add new service function at the end of `site-service.ts`:

```typescript
/**
 * Retrieves allowed origins for a site (for OAuth redirect URI validation).
 * Returns null when the site does not exist, empty array when origins not configured.
 */
export async function getSiteAllowedOrigins(siteId: string): Promise<string[] | null> {
  const result = await query<{ allowed_origins: string[] | null }>(
    'SELECT allowed_origins FROM app.sites WHERE id = $1',
    [siteId],
  );
  if (result.rows.length === 0) {
    return null; // Site not found
  }
  return result.rows[0].allowed_origins ?? [];
}
```

Update `CreateSiteParams` and `UpdateSiteParams` to accept `allowedOrigins`:

```typescript
export interface CreateSiteParams {
  pantheonSiteId: string;
  name: string;
  workflowSettings?: Partial<WorkflowSettings>;
  allowedOrigins?: string[];
}

export interface UpdateSiteParams {
  name?: string;
  workflowSettings?: Partial<WorkflowSettings>;
  allowedOrigins?: string[];
}
```

Update the `createSite` function to include `allowed_origins` in the INSERT. Replace the existing INSERT query (which uses columns `pantheon_site_id, name, workflow_settings`) with:

```typescript
const result = await query<SiteRow>(
  `INSERT INTO app.sites (pantheon_site_id, name, workflow_settings, allowed_origins)
   VALUES ($1, $2, $3, $4)
   RETURNING *`,
  [
    params.pantheonSiteId,
    params.name,
    JSON.stringify(workflowSettings),
    params.allowedOrigins ?? [],
  ],
);
```

Update `updateSite` to handle `allowedOrigins`. The function has two paths (with and without `workflowSettings`). Both need updating.

For the workflow-settings path, replace the UPDATE query with:

```typescript
const result = await query<SiteRow>(
  `UPDATE app.sites
   SET name = COALESCE($1, name),
       workflow_settings = $2,
       allowed_origins = COALESCE($3::text[], allowed_origins),
       updated_at = NOW()
   WHERE id = $4
   RETURNING *`,
  [
    updates.name ?? null,
    JSON.stringify(mergedSettings),
    updates.allowedOrigins ?? null,
    siteId,
  ],
);
```

For the simple path (no workflowSettings), replace the UPDATE query with:

```typescript
const result = await query<SiteRow>(
  `UPDATE app.sites
   SET name = COALESCE($1, name),
       allowed_origins = COALESCE($2::text[], allowed_origins),
       updated_at = NOW()
   WHERE id = $3
   RETURNING *`,
  [updates.name ?? null, updates.allowedOrigins ?? null, siteId],
);
```

**Step 6: Update `site-api.ts` to accept and return `allowedOrigins`**

In `workers/src/routes/site-api.ts`, update the `CreateSiteBody` and `UpdateSiteBody` interfaces:

```typescript
interface CreateSiteBody {
  pantheonSiteId?: string;
  name?: string;
  workflowSettings?: Partial<WorkflowSettings>;
  allowedOrigins?: string[];
}

interface UpdateSiteBody {
  name?: string;
  workflowSettings?: Partial<WorkflowSettings>;
  allowedOrigins?: string[];
}
```

In `handleCreateSite`, pass `allowedOrigins` through to `createSite()`:

```typescript
const site = await createSite({
  pantheonSiteId: body.pantheonSiteId,
  name: body.name,
  workflowSettings: body.workflowSettings,
  allowedOrigins: body.allowedOrigins,
});
```

In `handleUpdateSite`, pass `allowedOrigins` through to `updateSite()`:

```typescript
const updatedSite = await updateSite(context.siteId, {
  name: body.name,
  workflowSettings: body.workflowSettings,
  allowedOrigins: body.allowedOrigins,
});
```

**Step 7: Run existing tests to verify no regressions**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test 2>&1 | tail -20
```

Expected: All existing tests pass. Tests that snapshot the full `Site` object will now include `allowedOrigins: []` — update those snapshots if needed.

**Step 8: Lint**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm lint 2>&1
```

Expected: 0 errors

**Step 9: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/src/db/migrations/031_site_allowed_origins.sql workers/src/types/domain.ts workers/src/types/enums.ts workers/src/services/site-service.ts workers/src/routes/site-api.ts
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "feat: add allowed_origins to sites and css_auth to AuthProvider for OAuth redirect URI validation"
```

---

## Task 2: Internal endpoint for site auth config

This endpoint lets the auth worker look up a site's `allowedOrigins` via the service binding. It follows the existing `handleInternalRoutes` pattern exactly: auth checking is centralized at the top of that function; the sub-handler is a pure business-logic function that does NOT re-check auth.

**Files:**
- Modify: `workers/src/routes/internal-api.ts` (add handler function + dispatch case)
- Modify: `workers/tests/routes/internal-api.spec.ts` (add new describe block for the new endpoint)

**Step 1: Add the new test cases to the existing `internal-api.spec.ts`**

Open `workers/tests/routes/internal-api.spec.ts`. At the top, add the site-service mock alongside the existing mocks:

```typescript
vi.mock('../../src/services/site-service', () => ({
  getSiteAllowedOrigins: vi.fn(),
}));
```

Then import it:

```typescript
import { getSiteAllowedOrigins } from '../../src/services/site-service';
```

Add a new describe block at the end of the file:

```typescript
describe('GET /internal/site-auth-config/:siteId', () => {
  const INTERNAL_SECRET = 'correct-secret';

  function makeRequest(siteId: string, secret?: string): Request {
    return new Request(`http://localhost/internal/site-auth-config/${siteId}`, {
      method: 'GET',
      headers: secret !== undefined
        ? { 'X-Internal-Secret': secret }
        : {},
    });
  }

  it('returns 404 when site is not found', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    vi.mocked(getSiteAllowedOrigins).mockResolvedValueOnce(null);
    const req = makeRequest('missing-site', INTERNAL_SECRET);
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(404);
  });

  it('returns 200 with allowedOrigins when site exists', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    vi.mocked(getSiteAllowedOrigins).mockResolvedValueOnce([
      'https://mysite.com',
      '*-mysite.pantheonsite.io',
    ]);
    const req = makeRequest('site-123', INTERNAL_SECRET);
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(200);
    const body = await res.json() as { siteId: string; allowedOrigins: string[] };
    expect(body.siteId).toBe('site-123');
    expect(body.allowedOrigins).toEqual(['https://mysite.com', '*-mysite.pantheonsite.io']);
  });

  it('returns empty array when site has no allowed origins configured', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    vi.mocked(getSiteAllowedOrigins).mockResolvedValueOnce([]);
    const req = makeRequest('site-empty', INTERNAL_SECRET);
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(200);
    const body = await res.json() as { siteId: string; allowedOrigins: string[] };
    expect(body.allowedOrigins).toEqual([]);
  });

  it('returns 500 when site service throws', async () => {
    const { handleInternalRoutes } = await import('../../src/routes/internal-api');
    vi.mocked(getSiteAllowedOrigins).mockRejectedValueOnce(new Error('DB down'));
    const req = makeRequest('site-1', INTERNAL_SECRET);
    const res = await handleInternalRoutes(req, { internalSecret: INTERNAL_SECRET });
    expect(res.status).toBe(500);
  });

  // Auth is tested centrally for handleInternalRoutes — no duplicate auth tests here.
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test -- tests/routes/internal-api.spec.ts 2>&1 | tail -20
```

Expected: FAIL — new test cases fail because the route is not implemented yet.

**Step 3: Implement the handler in `internal-api.ts`**

Add import at top of `workers/src/routes/internal-api.ts`:

```typescript
import { getSiteAllowedOrigins } from '../services/site-service';
```

Add the handler function before `handleInternalRoutes`:

```typescript
/**
 * Handler for GET /internal/site-auth-config/:siteId
 *
 * Returns the allowed origins for a site, used by the CSS Auth Server
 * to validate redirect URIs without requiring its own database access.
 *
 * Authentication is handled by the caller (handleInternalRoutes) before
 * this function is invoked.
 */
async function handleInternalSiteAuthConfig(
  siteId: string,
): Promise<Response> {
  try {
    const allowedOrigins = await getSiteAllowedOrigins(siteId);
    if (allowedOrigins === null) {
      return errorResponse('Site not found', 404);
    }

    return new Response(JSON.stringify({ siteId, allowedOrigins }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return errorResponse('Internal server error', 500);
  }
}
```

Add the dispatch case inside `handleInternalRoutes`, before the final `return errorResponse('Not found', 404)`:

```typescript
// Site auth config endpoint (called by CSS Auth Server service binding)
if (path.startsWith('/internal/site-auth-config/') && request.method === 'GET') {
  const siteId = path.replace('/internal/site-auth-config/', '');
  if (!siteId) {
    return errorResponse('Missing site ID', 400);
  }
  return handleInternalSiteAuthConfig(siteId);
}
```

**Step 4: Run test to verify it passes**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test -- tests/routes/internal-api.spec.ts 2>&1 | tail -20
```

Expected: PASS (all tests in the file)

**Step 5: Run full test suite**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test 2>&1 | tail -5
```

Expected: All existing tests still pass.

**Step 6: Lint**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm lint 2>&1
```

Expected: 0 errors

**Step 7: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/src/routes/internal-api.ts workers/tests/routes/internal-api.spec.ts
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "feat: add internal site-auth-config endpoint for auth server redirect URI validation"
```

---

## Task 3: Scaffold `workers/auth-server/` package

This task creates the package structure so that subsequent tasks can write and run tests.

**Files (all new):**
- `workers/auth-server/package.json`
- `workers/auth-server/tsconfig.json`
- `workers/auth-server/eslint.config.js`
- `workers/auth-server/vitest.config.ts`
- `workers/auth-server/wrangler.jsonc`
- `workers/auth-server/src/types.ts`
- `workers/auth-server/src/health.ts`
- `workers/auth-server/.dev.vars.example`

**Step 1: Create `package.json`**

```json
{
  "name": "css-auth-server",
  "version": "0.1.0",
  "description": "CSS OAuth 2.0 Authorization Server — owns Google OAuth client, issues tokens for puck-css clients",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:sbx1": "wrangler deploy --env sbx1",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "lint": "eslint src tests",
    "lint:fix": "eslint src tests --fix",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cloudflare/workers-oauth-provider": "^0.3.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20250320.0",
    "@eslint/js": "^9.39.3",
    "eslint": "^9.39.3",
    "fast-check": "^3.22.0",
    "globals": "^15.15.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.56.1",
    "vitest": "^2.1.9",
    "wrangler": "^4.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/**/*.integration.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
```

**Step 4: Create `eslint.config.js`** (copy from `mcp-server/eslint.config.js`):

```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'vitest.config.ts', 'vitest.integration.config.ts', 'eslint.config.js'],
  },
);
```

**Step 5: Create `src/types.ts`**

```typescript
export interface Env {
  // Non-secret env vars
  ENVIRONMENT: string;

  // Secrets (from .dev.vars or Cloudflare secrets)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  INTERNAL_SECRET: string;        // Shared with main CSS worker for service calls
  COOKIE_ENCRYPTION_KEY: string;

  // KV binding (used by @cloudflare/workers-oauth-provider for token storage)
  OAUTH_KV: KVNamespace;

  // Service binding to the main CSS worker (for site-auth-config lookups)
  // Optional for local development — wrangler dev supports service bindings locally
  // but the binding must be declared in wrangler.jsonc under the dev section.
  CSS_BACKEND?: Fetcher;
}
```

**Step 6: Create `src/health.ts`**

```typescript
export function handleHealthCheck(environment: string): Response {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      service: 'css-auth-server',
      environment,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
```

**Step 7: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/schemas/config.json",

  "name": "css-auth-server",
  "main": "src/index.ts",

  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],

  // KV namespace for OAuth token storage (used by @cloudflare/workers-oauth-provider)
  "kv_namespaces": [
    { "binding": "OAUTH_KV", "id": "local-auth-oauth-kv", "preview_id": "local-auth-oauth-kv-preview" }
  ],

  "vars": {
    "ENVIRONMENT": "local"
  },

  "dev": {
    "port": 8789,
    "local_protocol": "http",
    "ip": "0.0.0.0"
  },

  "env": {
    "sbx1": {
      "name": "css-auth-server-sbx1",
      "vars": {
        "ENVIRONMENT": "sbx1"
      },
      "kv_namespaces": [
        { "binding": "OAUTH_KV", "id": "REPLACE_WITH_SBX1_AUTH_OAUTH_KV_ID" }
      ],
      "services": [
        { "binding": "CSS_BACKEND", "service": "collaborative-state-worker-sbx1" }
      ]
    },
    "production": {
      "name": "css-auth-server-prod",
      "vars": {
        "ENVIRONMENT": "production"
      },
      "kv_namespaces": [
        { "binding": "OAUTH_KV", "id": "REPLACE_WITH_PROD_AUTH_OAUTH_KV_ID" }
      ],
      "services": [
        { "binding": "CSS_BACKEND", "service": "collaborative-state-worker-prod" }
      ]
    }
  }
}
```

**Step 8: Create `.dev.vars.example`**

```bash
# CSS Auth Server — Local Development Secrets
# Copy this file to .dev.vars and fill in real values.
# .dev.vars is gitignored and loaded automatically by `wrangler dev`.

GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
INTERNAL_SECRET=any-random-string-shared-with-css-worker
COOKIE_ENCRYPTION_KEY=at-least-32-characters-random-string
```

**Step 9: Install dependencies**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm install
```

**Step 10: Copy `google-handler.ts` from mcp-server**

```bash
mkdir -p /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server/src/auth
cp /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/mcp-server/src/auth/google-handler.ts /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server/src/auth/google-handler.ts
```

The file is pure functions with no imports outside the module — safe to copy verbatim.

**Step 11: Commit scaffold**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/auth-server/
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "feat: scaffold css-auth-server worker package"
```

---

## Task 4: `matchesAllowedOrigin` — the security-critical origin validator

This is the most security-sensitive new code. It must be a pure function, well-tested, and in its own module.

**Files:**
- Create: `workers/auth-server/src/auth/origin-validator.ts`
- Create: `workers/auth-server/tests/auth/origin-validator.spec.ts`
- Create: `workers/auth-server/tests/auth/origin-validator.property.spec.ts`

**Step 1: Write the failing tests first**

Create `workers/auth-server/tests/auth/origin-validator.spec.ts`:

```typescript
/**
 * Origin Validator Tests
 *
 * Tests matchesAllowedOrigin() — the security-critical function that
 * validates OAuth redirect URIs against a site's allowedOrigins list.
 *
 * Security invariants tested:
 * - Wildcard anchoring: *-mysite.pantheonsite.io must NOT match attacker.com
 * - Exact match: only exact strings are accepted for non-wildcard patterns
 * - Empty list: always rejects
 * - Trailing slash normalization
 */

import { describe, it, expect } from 'vitest';
import { matchesAllowedOrigin } from '../../src/auth/origin-validator.js';

describe('matchesAllowedOrigin', () => {
  // --- Exact matching ---

  it('accepts exact match', () => {
    expect(matchesAllowedOrigin('https://mysite.com', ['https://mysite.com'])).toBe(true);
  });

  it('rejects when list is empty', () => {
    expect(matchesAllowedOrigin('https://mysite.com', [])).toBe(false);
  });

  it('rejects exact non-match', () => {
    expect(matchesAllowedOrigin('https://evil.com', ['https://mysite.com'])).toBe(false);
  });

  it('accepts localhost for development', () => {
    expect(matchesAllowedOrigin(
      'http://localhost:3000',
      ['http://localhost:3000'],
    )).toBe(true);
  });

  it('rejects wrong port', () => {
    expect(matchesAllowedOrigin(
      'http://localhost:4000',
      ['http://localhost:3000'],
    )).toBe(false);
  });

  // --- Wildcard matching ---

  it('accepts wildcard Pantheon branch URL (live env)', () => {
    expect(matchesAllowedOrigin(
      'https://live-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(true);
  });

  it('accepts wildcard Pantheon branch URL (dev env)', () => {
    expect(matchesAllowedOrigin(
      'https://dev-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(true);
  });

  it('accepts wildcard Pantheon branch URL (test env)', () => {
    expect(matchesAllowedOrigin(
      'https://test-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(true);
  });

  // SECURITY: wildcard must NOT match attacker-controlled domains
  it('SECURITY: wildcard does not match attacker subdomain hijack', () => {
    expect(matchesAllowedOrigin(
      'https://live-mysite.pantheonsite.io.evil.com',
      ['*-mysite.pantheonsite.io'],
    )).toBe(false);
  });

  it('SECURITY: wildcard does not match subdomain of allowed pattern', () => {
    expect(matchesAllowedOrigin(
      'https://sub.live-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(false);
  });

  it('SECURITY: wildcard requires https scheme for non-localhost', () => {
    expect(matchesAllowedOrigin(
      'http://live-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(false);
  });

  // --- Multiple patterns ---

  it('accepts when redirect_uri matches any pattern in the list', () => {
    expect(matchesAllowedOrigin('https://mysite.com', [
      '*-mysite.pantheonsite.io',
      'https://mysite.com',
    ])).toBe(true);
  });

  it('rejects when redirect_uri matches none of the patterns', () => {
    expect(matchesAllowedOrigin('https://evil.com', [
      '*-mysite.pantheonsite.io',
      'https://mysite.com',
    ])).toBe(false);
  });

  // --- Redirect URI normalization ---

  it('ignores path and query string (compares origin only)', () => {
    // The redirect_uri may include a path (e.g. /callback) — we compare origin only
    expect(matchesAllowedOrigin('https://mysite.com/callback', [
      'https://mysite.com',
    ])).toBe(true);
  });

  it('ignores trailing slash on exact pattern', () => {
    expect(matchesAllowedOrigin('https://mysite.com/', ['https://mysite.com'])).toBe(true);
  });

  // --- Malformed inputs ---

  it('rejects malformed redirect URI', () => {
    expect(matchesAllowedOrigin('not-a-url', ['https://mysite.com'])).toBe(false);
  });

  it('rejects empty redirect URI', () => {
    expect(matchesAllowedOrigin('', ['https://mysite.com'])).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test -- tests/auth/origin-validator.spec.ts 2>&1 | tail -10
```

Expected: FAIL — module not found (`origin-validator.ts` not yet created)

**Step 3: Implement `origin-validator.ts`**

Create `workers/auth-server/src/auth/origin-validator.ts`:

```typescript
/**
 * OAuth Redirect URI Origin Validator
 *
 * Validates OAuth redirect URIs against a site's allowedOrigins list.
 * Supports exact matches and wildcard prefix patterns for Pantheon branch URLs.
 *
 * SECURITY: This function enforces that redirect URIs are strictly controlled
 * by the site operator. Incorrect implementation here could allow arbitrary
 * sites to abuse the CSS Google OAuth Client ID.
 *
 * Wildcard pattern syntax:
 *   *-mysite.pantheonsite.io  — matches live-mysite.pantheonsite.io, dev-mysite.pantheonsite.io, etc.
 *   The wildcard only replaces the leftmost label and is anchored to the full hostname.
 *
 * Non-wildcard patterns are treated as exact origin strings (scheme + host + port).
 */

/**
 * Checks if a redirect URI's origin matches any pattern in the allowedOrigins list.
 *
 * @param redirectUri - The full redirect URI from the OAuth authorization request
 * @param allowedOrigins - The site's configured origin patterns
 * @returns true if the redirect URI is allowed, false otherwise
 */
export function matchesAllowedOrigin(
  redirectUri: string,
  allowedOrigins: string[],
): boolean {
  if (!redirectUri || allowedOrigins.length === 0) {
    return false;
  }

  // Parse the redirect URI to extract the origin (scheme + host + port)
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false; // Malformed URL
  }

  const redirectOrigin = parsed.origin; // e.g. "https://mysite.com"
  const redirectHostname = parsed.hostname; // e.g. "mysite.com"
  const redirectScheme = parsed.protocol; // e.g. "https:"

  for (const pattern of allowedOrigins) {
    if (matchesSinglePattern(redirectOrigin, redirectHostname, redirectScheme, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a single origin pattern matches the redirect URI's origin.
 */
function matchesSinglePattern(
  redirectOrigin: string,
  redirectHostname: string,
  redirectScheme: string,
  pattern: string,
): boolean {
  if (pattern.startsWith('*-')) {
    return matchesWildcardPattern(redirectHostname, redirectScheme, pattern);
  }

  // Exact origin match (normalize trailing slash)
  const normalizedPattern = pattern.replace(/\/$/, '');
  const normalizedOrigin = redirectOrigin.replace(/\/$/, '');
  return normalizedOrigin === normalizedPattern;
}

/**
 * Validate a wildcard pattern match.
 *
 * Pattern: *-mysite.pantheonsite.io
 * The wildcard replaces the leftmost label. The rest of the hostname must
 * exactly match the pattern suffix (anchored to the right).
 *
 * SECURITY: We verify:
 * 1. The scheme is https (wildcards only allowed for secure origins)
 * 2. The hostname ends with the exact suffix (anchored — not substring match)
 * 3. The prefix before the suffix is exactly one label (no dots) and non-empty
 *    — this prevents "sub.live-mysite.pantheonsite.io" and
 *      "live-mysite.pantheonsite.io.evil.com"
 */
function matchesWildcardPattern(
  hostname: string,
  scheme: string,
  pattern: string,
): boolean {
  // Wildcards only apply to https origins
  if (scheme !== 'https:') {
    return false;
  }

  // Extract the suffix after the '*' (e.g. "-mysite.pantheonsite.io")
  const suffix = pattern.slice(1); // "-mysite.pantheonsite.io"

  // The hostname must end with the exact suffix
  if (!hostname.endsWith(suffix)) {
    return false;
  }

  // Extract the prefix label (everything before the suffix)
  const prefixLabel = hostname.slice(0, hostname.length - suffix.length);

  // The prefix must be non-empty and must be a single label (no dots)
  if (prefixLabel.length === 0 || prefixLabel.includes('.')) {
    return false;
  }

  return true;
}
```

**Step 4: Run test to verify it passes**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test -- tests/auth/origin-validator.spec.ts 2>&1 | tail -10
```

Expected: PASS (18 tests)

**Step 5: Write property-based tests**

Create `workers/auth-server/tests/auth/origin-validator.property.spec.ts`:

```typescript
/**
 * Property-Based Tests for matchesAllowedOrigin
 *
 * Tests security invariants across a large sample space using fast-check.
 * Key invariants:
 * 1. A wildcard pattern *-mysite.pantheonsite.io NEVER matches a URL
 *    where the attacker controls any part of the registered suffix.
 * 2. An exact pattern only matches the exact origin.
 * 3. An empty allowedOrigins list always returns false.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { matchesAllowedOrigin } from '../../src/auth/origin-validator.js';

const SUFFIX = 'mysite.pantheonsite.io';
const WILDCARD_PATTERN = `*-${SUFFIX}`;

describe('Property: empty list always rejects', () => {
  it('matchesAllowedOrigin(anyUri, []) === false', () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        expect(matchesAllowedOrigin(url, [])).toBe(false);
      }),
    );
  });
});

describe('Property: exact match is reflexive', () => {
  it('matchesAllowedOrigin(origin, [origin]) === true for valid https origins', () => {
    fc.assert(
      fc.property(
        fc.domain().map((d) => `https://${d}`),
        (origin) => {
          expect(matchesAllowedOrigin(origin, [origin])).toBe(true);
        },
      ),
    );
  });
});

describe('Property: wildcard NEVER matches suffix-extended hostnames', () => {
  it('*-mysite.pantheonsite.io does not match https://live-mysite.pantheonsite.io.<attacker>', () => {
    fc.assert(
      fc.property(
        fc.domain(),
        (attackerDomain) => {
          const maliciousUrl = `https://live-${SUFFIX}.${attackerDomain}/callback`;
          expect(matchesAllowedOrigin(maliciousUrl, [WILDCARD_PATTERN])).toBe(false);
        },
      ),
    );
  });
});

describe('Property: wildcard matches valid Pantheon branch URLs', () => {
  it('*-mysite.pantheonsite.io matches https://{label}-mysite.pantheonsite.io', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,20}[a-z0-9]$/),
        (label) => {
          const url = `https://${label}-${SUFFIX}/callback`;
          expect(matchesAllowedOrigin(url, [WILDCARD_PATTERN])).toBe(true);
        },
      ),
    );
  });
});
```

**Step 6: Run property-based tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test -- tests/auth/origin-validator.property.spec.ts 2>&1 | tail -10
```

Expected: PASS

**Step 7: Port google-handler tests**

Copy `workers/mcp-server/tests/auth/google-handler.spec.ts` to `workers/auth-server/tests/auth/google-handler.spec.ts`. The import paths stay the same since the directory structure is mirrored (`../../src/auth/google-handler.js`).

Run:

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test -- tests/auth/google-handler.spec.ts 2>&1 | tail -10
```

Expected: PASS

**Step 8: Run all auth-server unit tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test 2>&1 | tail -5
```

**Step 9: Lint**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm lint 2>&1
```

**Step 10: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/auth-server/src/auth/origin-validator.ts workers/auth-server/src/auth/google-handler.ts workers/auth-server/tests/
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "feat: add origin-validator and google-handler to auth-server with full test coverage"
```

---

## Task 5: Site lookup service (service binding)

**Files:**
- Create: `workers/auth-server/src/services/site-lookup.ts`
- Create: `workers/auth-server/tests/services/site-lookup.spec.ts`

**Step 1: Write the failing tests**

Create `workers/auth-server/tests/services/site-lookup.spec.ts`:

```typescript
/**
 * Site Lookup Service Tests
 *
 * Tests lookupSiteAuthConfig() which calls the main CSS worker via service binding
 * to retrieve a site's allowed origins for OAuth redirect URI validation.
 */

import { describe, it, expect, vi } from 'vitest';
import { lookupSiteAuthConfig } from '../../src/services/site-lookup.js';

function makeMockFetcher(status: number, body: unknown): Fetcher {
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    ),
  } as unknown as Fetcher;
}

const INTERNAL_SECRET = 'test-secret';

describe('lookupSiteAuthConfig', () => {
  it('returns allowedOrigins for a known site', async () => {
    const fetcher = makeMockFetcher(200, {
      siteId: 'site-123',
      allowedOrigins: ['https://mysite.com'],
    });
    const result = await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-123');
    expect(result).not.toBeNull();
    expect(result!.allowedOrigins).toEqual(['https://mysite.com']);
  });

  it('returns null for a missing site (404)', async () => {
    const fetcher = makeMockFetcher(404, { error: 'Site not found' });
    const result = await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'missing');
    expect(result).toBeNull();
  });

  it('throws when the CSS worker returns 500', async () => {
    const fetcher = makeMockFetcher(500, { error: 'DB error' });
    await expect(
      lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1'),
    ).rejects.toThrow('Site auth config lookup failed: 500');
  });

  it('sends X-Internal-Secret header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ siteId: 'site-1', allowedOrigins: [] }), { status: 200 }),
    );
    const fetcher = { fetch: mockFetch } as unknown as Fetcher;
    await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1');
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-Internal-Secret']).toBe(INTERNAL_SECRET);
  });

  it('sends request to correct endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ siteId: 'site-1', allowedOrigins: [] }), { status: 200 }),
    );
    const fetcher = { fetch: mockFetch } as unknown as Fetcher;
    await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1');
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/internal/site-auth-config/site-1');
  });

  it('returns empty allowedOrigins array when site has none configured', async () => {
    const fetcher = makeMockFetcher(200, { siteId: 'site-1', allowedOrigins: [] });
    const result = await lookupSiteAuthConfig(fetcher, INTERNAL_SECRET, 'site-1');
    expect(result).not.toBeNull();
    expect(result!.allowedOrigins).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test -- tests/services/site-lookup.spec.ts 2>&1 | tail -10
```

Expected: FAIL — module not found

**Step 3: Implement `site-lookup.ts`**

Create `workers/auth-server/src/services/site-lookup.ts`:

```typescript
/**
 * Site Auth Config Lookup
 *
 * Retrieves a site's allowed OAuth redirect origins from the main CSS worker
 * via a Cloudflare service binding. The main CSS worker owns the database
 * connection and exposes an internal endpoint for this purpose.
 */

export interface SiteAuthConfig {
  siteId: string;
  allowedOrigins: string[];
}

/**
 * Fetch the site's OAuth configuration from the main CSS worker.
 *
 * @param cssBackend - Service binding to the main CSS worker
 * @param internalSecret - Shared secret for internal API authentication
 * @param siteId - The site ID (also the OAuth client_id)
 * @returns SiteAuthConfig if the site exists, null if not found
 * @throws Error if the CSS worker returns an unexpected error status
 */
export async function lookupSiteAuthConfig(
  cssBackend: Fetcher,
  internalSecret: string,
  siteId: string,
): Promise<SiteAuthConfig | null> {
  const response = await cssBackend.fetch(
    `http://internal/internal/site-auth-config/${encodeURIComponent(siteId)}`,
    {
      method: 'GET',
      headers: {
        'X-Internal-Secret': internalSecret,
        'Content-Type': 'application/json',
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Site auth config lookup failed: ${String(response.status)}`);
  }

  const data = await response.json() as SiteAuthConfig;
  return data;
}
```

**Step 4: Run test to verify it passes**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test -- tests/services/site-lookup.spec.ts 2>&1 | tail -10
```

Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/auth-server/src/services/site-lookup.ts workers/auth-server/tests/services/site-lookup.spec.ts
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "feat: add site-lookup service for auth server redirect URI validation via service binding"
```

---

## Task 6: Auth server main entry point

**Critical implementation note:** `@cloudflare/workers-oauth-provider` calls `lookupClient(clientId)` inside `parseAuthRequest()` — it rejects the request if the client is not found. Because `client_id = site_id` and sites are not pre-provisioned in the library's client registry, the authorize handler must:

1. Extract `client_id` and `redirect_uri` from query params **manually** (without calling `parseAuthRequest` yet)
2. Look up the site's `allowedOrigins` via service binding
3. Validate `redirect_uri` with `matchesAllowedOrigin()`
4. **Write directly to `OAUTH_KV`** to upsert the client registration using key `client:{siteId}`:
   - If no client exists: write a new `ClientInfo` JSON object with `clientId: siteId` and `redirectUris: [exactUri]`
   - If client exists but URI is new: read existing entry, add the exact URI to `redirectUris`, write back
5. Only then call `oauthHelpers.parseAuthRequest()` — the client is now in KV and `lookupClient(siteId)` will find it

**Why NOT `oauthHelpers.createClient()`:** The library's `createClient()` implementation **ignores the `clientId` field** in its argument and always generates a random clientId via `generateRandomString(16)`. This is verified in the library source (`dist/oauth-provider.js` line ~1728: `const clientId = generateRandomString(16)`). Calling `createClient({ clientId: siteId, ... })` registers a new client with a random ID — `lookupClient(siteId)` would always return null afterward. Only `oauthHelpers.updateClient(existingId, ...)` preserves the clientId.

**Why direct KV write is safe:** `lookupClient(clientId)` reads `OAUTH_KV.get('client:{clientId}', {type: 'json'})`. The KV key `client:{siteId}` is all that's needed — the library has no other state for client lookup. The `ClientInfo` shape (from `@cloudflare/workers-oauth-provider` type declarations) is the complete client record. After this write, both `lookupClient()` and `parseAuthRequest()`'s redirect URI validation will work correctly.

**Files:**
- Create: `workers/auth-server/src/index.ts`
- Create: `workers/auth-server/tests/integration/oauth-config.spec.ts`

**Step 1: Write configuration tests (source-inspection pattern)**

Create `workers/auth-server/tests/integration/oauth-config.spec.ts`:

```typescript
/**
 * OAuth Configuration Tests (Source-Inspection Pattern)
 *
 * Since @cloudflare/workers-oauth-provider requires cloudflare: imports
 * not available in Vitest, we verify the OAuthProvider configuration
 * by reading the index.ts source file, following the established pattern
 * from workers/mcp-server/tests/auth/oauth-integration.spec.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf-8');

describe('OAuthProvider Configuration', () => {
  it('enforces PKCE S256 (allowPlainPKCE: false)', () => {
    expect(indexSource).toContain('allowPlainPKCE: false');
  });

  it('configures authorize endpoint', () => {
    expect(indexSource).toContain("authorizeEndpoint: '/authorize'");
  });

  it('configures token endpoint', () => {
    expect(indexSource).toContain("tokenEndpoint: '/token'");
  });

  it('configures access token TTL (1 hour)', () => {
    expect(indexSource).toContain('accessTokenTTL: 3600');
  });

  it('configures refresh token TTL (30 days)', () => {
    expect(indexSource).toContain('refreshTokenTTL: 2592000');
  });

  it('uses a stub apiRoute (auth server has no resource API)', () => {
    expect(indexSource).toContain("apiRoute: '/auth-api'");
  });
});

describe('Health Endpoint', () => {
  it('health check returns 200', async () => {
    const { handleHealthCheck } = await import('../../src/health.js');
    const response = handleHealthCheck('local');
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; service: string };
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('css-auth-server');
  });
});

describe('Authorize Flow Logic', () => {
  it('authorize handler reads client_id to look up site', () => {
    expect(indexSource).toContain('lookupSiteAuthConfig');
  });

  it('authorize handler validates redirect_uri against site allowedOrigins', () => {
    expect(indexSource).toContain('matchesAllowedOrigin');
  });

  it('authorize handler upserts client in OAUTH_KV before parseAuthRequest', () => {
    // Verify the upsert function exists and uses the correct mechanisms:
    // - Direct OAUTH_KV.put() for new clients (createClient() cannot be used — it ignores clientId)
    // - oauthHelpers.updateClient() for existing clients needing a new URI
    expect(indexSource).toContain('upsertClient');
    expect(indexSource).toContain('OAUTH_KV.put');
    expect(indexSource).toContain('updateClient');
    // createClient() must NOT appear in upsertClient — it generates random IDs
    // (The word 'createClient' may appear in comments but not as a function call)
  });

  it('authorize handler redirects to Google when validation passes', () => {
    expect(indexSource).toContain('getGoogleAuthorizationUrl');
  });

  it('callback handler exchanges Google code', () => {
    expect(indexSource).toContain('exchangeGoogleCode');
  });

  it('callback handler calls completeAuthorization', () => {
    expect(indexSource).toContain('completeAuthorization');
  });
});

describe('Token Validate Endpoint', () => {
  it('exposes /internal/token/validate endpoint', () => {
    expect(indexSource).toContain('/internal/token/validate');
  });

  it('uses oauthHelpers.unwrapToken for token validation', () => {
    expect(indexSource).toContain('unwrapToken');
  });

  it('validates X-Internal-Secret on token validate endpoint', () => {
    expect(indexSource).toContain('INTERNAL_SECRET');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test -- tests/integration/oauth-config.spec.ts 2>&1 | tail -10
```

Expected: FAIL — `src/index.ts` does not exist yet.

**Step 3: Implement `src/index.ts`**

Create `workers/auth-server/src/index.ts`:

```typescript
/**
 * CSS Auth Server — Cloudflare Worker Entry Point
 *
 * OAuth 2.0 Authorization Server for CSS.
 * Owns the Google OAuth Client ID. Puck-css frontend clients authenticate
 * here instead of registering directly with Google.
 *
 * Flow:
 * 1. Client sends GET /authorize?client_id={site_id}&redirect_uri=...&code_challenge=...
 * 2. Auth server extracts client_id and redirect_uri from query params directly
 * 3. Looks up site's allowedOrigins from main CSS worker (service binding)
 * 4. Validates redirect_uri against allowedOrigins via matchesAllowedOrigin()
 * 5. Upserts the client in OAUTH_KV (direct write for new, oauthHelpers.updateClient() for existing) with the exact redirect_uri
 * 6. Calls oauthHelpers.parseAuthRequest() — succeeds because client is now registered
 * 7. Redirects to Google OAuth
 * 8. Google redirects to /callback with auth code
 * 9. Auth server exchanges code with Google, creates CSS token via completeAuthorization
 * 10. Redirects back to the client with the CSS token
 *
 * Resource servers validate tokens via POST /internal/token/validate which calls
 * oauthHelpers.unwrapToken() — NOT via RFC 7662 introspection (not exposed by this library).
 *
 * TODO: Add HMAC-SHA256 signing to the state parameter before production launch.
 * Use COOKIE_ENCRYPTION_KEY as the HMAC key. The state currently carries only the
 * original OAuth request data (no secrets), so a forged state cannot escalate privilege
 * but could cause a redirect to a registered URI that wasn't the user's origin.
 *
 * The MCP server is NOT a consumer of this auth server — it has its own OAuthProvider.
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers, AuthRequest, ClientInfo } from '@cloudflare/workers-oauth-provider';
import type { Env } from './types.js';
import { handleHealthCheck } from './health.js';
import { getGoogleAuthorizationUrl, exchangeGoogleCode } from './auth/google-handler.js';
import { matchesAllowedOrigin } from './auth/origin-validator.js';
import { lookupSiteAuthConfig } from './services/site-lookup.js';

// =============================================================================
// User Props (stored in OAuth token, returned via /internal/token/validate)
// =============================================================================

interface UserProps {
  userId: string;
  email: string;
  name?: string;
  siteId: string;  // The site the user authenticated for (client_id)
}

// =============================================================================
// OAuth Helpers Accessor
// =============================================================================

function getOAuthHelpers(env: Env): OAuthHelpers | undefined {
  return (env as Env & { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER;
}

// =============================================================================
// Client Upsert via Direct OAUTH_KV Write
//
// @cloudflare/workers-oauth-provider's lookupClient(clientId) reads:
//   OAUTH_KV.get('client:{clientId}', {type: 'json'})
//
// This is the ONLY state needed for client lookup. Writing the ClientInfo JSON
// directly to KV at key 'client:{siteId}' is equivalent to what the library
// does after dynamic registration.
//
// IMPORTANT: oauthHelpers.createClient() CANNOT be used here because it always
// generates a random clientId (ignoring any clientId field in its argument).
// This is verified in the library source (dist/oauth-provider.js, function
// OAuthHelpersImpl.createClient: 'const clientId = generateRandomString(16)').
// Calling createClient({ clientId: siteId }) would register a random-ID client
// and lookupClient(siteId) would still return null.
//
// oauthHelpers.updateClient(siteId, ...) IS used for updating existing entries
// because it correctly reads by clientId, merges, and writes back.
//
// Previously validated URIs accumulate. This handles the wildcard case: after
// matchesAllowedOrigin() passes, the exact URI is stored for future lookups.
// =============================================================================

async function upsertClient(
  env: Env,
  oauthHelpers: OAuthHelpers,
  siteId: string,
  exactRedirectUri: string,
): Promise<void> {
  const existing: ClientInfo | null = await oauthHelpers.lookupClient(siteId);

  if (existing === null) {
    // First time this site has authorized — write a new public client registration
    // directly to OAUTH_KV with the site ID as the client ID.
    const clientInfo: ClientInfo = {
      clientId: siteId,
      redirectUris: [exactRedirectUri],
      tokenEndpointAuthMethod: 'none', // Public client (browser SPA — no client secret)
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      registrationDate: Math.floor(Date.now() / 1000),
    };
    await env.OAUTH_KV.put(`client:${siteId}`, JSON.stringify(clientInfo));
  } else {
    // Subsequent authorization — merge the new exactRedirectUri if not already present.
    // Use oauthHelpers.updateClient() which correctly reads-then-writes by clientId.
    const existingUris = existing.redirectUris ?? [];
    if (!existingUris.includes(exactRedirectUri)) {
      await oauthHelpers.updateClient(siteId, {
        redirectUris: [...existingUris, exactRedirectUri],
      });
    }
    // If already present, nothing to do — the library will accept it in parseAuthRequest.
  }
}

// =============================================================================
// Stub API Handler (auth server has no resource API)
// Resource servers validate tokens via /internal/token/validate, not /auth-api endpoints.
// =============================================================================

const stubApiHandler: ExportedHandler<Env> = {
  async fetch(): Promise<Response> {
    return new Response('Not Found', { status: 404 });
  },
};

// =============================================================================
// Default Handler (health, authorize, callback, token validate)
// =============================================================================

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // GET /health
    if (url.pathname === '/health' && request.method === 'GET') {
      return handleHealthCheck(env.ENVIRONMENT);
    }

    // POST /internal/token/validate
    // Called by resource servers (main CSS worker) via service binding to validate
    // opaque access tokens. Uses oauthHelpers.unwrapToken() to decrypt stored props.
    // Protected by X-Internal-Secret header.
    if (url.pathname === '/internal/token/validate' && request.method === 'POST') {
      const secret = request.headers.get('X-Internal-Secret');
      if (secret !== env.INTERNAL_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      const body = await request.json() as { token?: string };
      const token = body.token;
      if (!token || typeof token !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing token' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response(JSON.stringify({ error: 'OAuth not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const tokenData = await oauthHelpers.unwrapToken<UserProps>(token);

      if (!tokenData) {
        return new Response(JSON.stringify({ active: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // TokenSummary (from @cloudflare/workers-oauth-provider) shape:
      //   tokenData.userId       — the authenticated user's ID (top-level, from TokenBase)
      //   tokenData.expiresAt    — token expiry unix timestamp (top-level, from TokenBase)
      //   tokenData.grant.props  — decrypted UserProps stored at authorization time
      return new Response(JSON.stringify({
        active: true,
        sub: tokenData.userId,
        exp: tokenData.expiresAt,
        props: tokenData.grant.props,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /authorize — validate client and redirect to Google
    if (url.pathname === '/authorize') {
      // Step 1: Extract client_id and redirect_uri from query params BEFORE
      // calling parseAuthRequest(), because parseAuthRequest() calls lookupClient()
      // internally and rejects the request if the client is not yet registered.
      const clientId = url.searchParams.get('client_id') ?? '';
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';

      if (!clientId || !redirectUri) {
        return new Response('Missing client_id or redirect_uri', { status: 400 });
      }

      // Step 2: Look up the site's allowed origins via the main CSS worker service binding.
      // CSS_BACKEND is required at runtime for authorization to function.
      if (!env.CSS_BACKEND) {
        return new Response('CSS_BACKEND service binding not configured', { status: 500 });
      }
      let siteAuthConfig;
      try {
        siteAuthConfig = await lookupSiteAuthConfig(env.CSS_BACKEND, env.INTERNAL_SECRET, clientId);
      } catch {
        return new Response('Failed to look up site configuration', { status: 503 });
      }

      if (!siteAuthConfig) {
        return new Response('Unknown client (site not found)', { status: 400 });
      }

      // Step 3: Validate redirect_uri against site's allowedOrigins
      // (supports exact match and wildcard patterns like *-mysite.pantheonsite.io)
      if (!matchesAllowedOrigin(redirectUri, siteAuthConfig.allowedOrigins)) {
        return new Response('redirect_uri not allowed for this client', { status: 400 });
      }

      // Step 4: Obtain OAuthHelpers early — needed for upsert before parseAuthRequest.
      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response('OAuth not configured', { status: 500 });
      }

      // Step 5: Upsert the client in OAUTH_KV with client:{siteId} key.
      // This is required because parseAuthRequest() calls lookupClient() internally
      // and rejects the request if the client is not registered.
      // upsertClient() either creates the site's client KV entry (first visit)
      // or adds the validated exact redirect_uri to the existing entry.
      // NOTE: oauthHelpers.createClient() is NOT used — it ignores any provided
      // clientId and generates a random one. See Design Decision #1.
      await upsertClient(env, oauthHelpers, clientId, redirectUri);

      // Step 6: Parse the full OAuth request — now succeeds because client is registered.
      const authRequest: AuthRequest = await oauthHelpers.parseAuthRequest(request);

      // Encode the auth request into the state parameter for resumption after Google callback
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

      const googleAuthUrl = getGoogleAuthorizationUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: callbackUrl,
        state: encodedState,
        scope: 'openid email profile',
      });

      return Response.redirect(googleAuthUrl, 302);
    }

    // GET /callback — Google redirects back here after user authenticates
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');

      if (!code || !stateParam) {
        return new Response('Missing code or state parameter', { status: 400 });
      }

      let stateData: {
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

      try {
        stateData = JSON.parse(atob(stateParam)) as typeof stateData;
      } catch {
        return new Response('Invalid state parameter', { status: 400 });
      }

      const callbackUrl = `${url.origin}/callback`;

      let googleResult;
      try {
        googleResult = await exchangeGoogleCode({
          code,
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: callbackUrl,
        });
      } catch {
        return new Response('Failed to exchange code with Google', { status: 502 });
      }

      const oauthHelpers = getOAuthHelpers(env);
      if (!oauthHelpers) {
        return new Response('OAuth not configured', { status: 500 });
      }

      const { redirectTo } = await oauthHelpers.completeAuthorization({
        request: stateData.authRequest as AuthRequest,
        userId: googleResult.user.sub,
        metadata: {
          label: googleResult.user.name ?? googleResult.user.email,
        },
        scope: stateData.authRequest.scope,
        props: {
          userId: googleResult.user.sub,
          email: googleResult.user.email,
          name: googleResult.user.name,
          siteId: stateData.authRequest.clientId,
        } satisfies UserProps,
      });

      return Response.redirect(redirectTo, 302);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// =============================================================================
// OAuth Provider Export
// =============================================================================

export default new OAuthProvider<Env>({
  apiRoute: '/auth-api',  // Stub route — auth server has no resource API
  apiHandler: stubApiHandler,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  allowPlainPKCE: false,  // Enforce S256 only (OAuth 2.1 requirement)
  accessTokenTTL: 3600,      // 1 hour
  refreshTokenTTL: 2592000,  // 30 days
});
```

**Step 4: Run integration tests to verify they pass**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test -- tests/integration/oauth-config.spec.ts 2>&1 | tail -10
```

Expected: PASS

**Step 5: Run all auth-server unit tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test 2>&1 | tail -5
```

Expected: All pass

**Step 6: Lint**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm lint 2>&1
```

**Step 7: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/auth-server/src/index.ts workers/auth-server/tests/integration/oauth-config.spec.ts
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "feat: implement css-auth-server main entry point with authorize/callback/token-validate"
```

---

## Task 7: Miniflare integration test for the authorize flow

**Files:**
- Create: `workers/auth-server/vitest.integration.config.ts`
- Create: `workers/auth-server/tests/integration/authorize-flow.integration.spec.ts`

**Step 1: Create `vitest.integration.config.ts`**

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['tests/integration/**/*.integration.spec.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          kvNamespaces: ['OAUTH_KV'],
          // Set INTERNAL_SECRET so the /internal/token/validate endpoint can validate it.
          // The test that sends no X-Internal-Secret header must receive 401,
          // and the test that sends the correct header must receive 200.
          // Without this, env.INTERNAL_SECRET is undefined and the comparison
          // `secret !== env.INTERNAL_SECRET` becomes `undefined !== undefined = false`,
          // making the auth check silently pass for all requests.
          vars: {
            INTERNAL_SECRET: 'test-internal-secret',
            GOOGLE_CLIENT_ID: 'test-google-client-id',
            GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
            COOKIE_ENCRYPTION_KEY: 'test-cookie-encryption-key-32chars!!',
            ENVIRONMENT: 'test',
          },
          // Stub CSS_BACKEND service binding — returns site auth config for test site IDs
          serviceBindings: {
            CSS_BACKEND: async (request: Request) => {
              const url = new URL(request.url);
              if (url.pathname.includes('/internal/site-auth-config/test-site-123')) {
                return new Response(JSON.stringify({
                  siteId: 'test-site-123',
                  allowedOrigins: ['http://localhost:3000', '*-testsite.pantheonsite.io'],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
              }
              return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
            },
          },
        },
      },
    },
  },
});
```

**Step 2: Write integration test**

Create `workers/auth-server/tests/integration/authorize-flow.integration.spec.ts`:

```typescript
/**
 * Auth Server Integration Tests (Miniflare / @cloudflare/vitest-pool-workers)
 *
 * Tests the actual Worker behavior using the Cloudflare runtime.
 * CSS_BACKEND service binding is stubbed via vitest.integration.config.ts.
 */

import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('GET /health', () => {
  it('returns 200', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe('healthy');
  });
});

describe('GET /authorize', () => {
  it('returns 400 for unknown site (client_id not found)', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'unknown-site-id');
    url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(400);
  });

  it('returns 400 for disallowed redirect_uri', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'https://evil.com/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(400);
  });

  it('redirects to Google for valid client and redirect_uri', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    // Should redirect to Google
    expect(response.status).toBe(302);
    const location = response.headers.get('Location') ?? '';
    expect(location).toContain('accounts.google.com');
  });

  it('SECURITY: rejects wildcard origin for http scheme', async () => {
    // *-testsite.pantheonsite.io only allows https — not http
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'http://live-testsite.pantheonsite.io/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(400);
  });

  it('accepts valid wildcard Pantheon branch URL', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'https://live-testsite.pantheonsite.io/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 'S256');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(302);
    const location = response.headers.get('Location') ?? '';
    expect(location).toContain('accounts.google.com');
  });

  it('SECURITY: rejects missing PKCE (plain method rejected)', async () => {
    const url = new URL('http://localhost/authorize');
    url.searchParams.set('client_id', 'test-site-123');
    url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'some-plain-challenge');
    url.searchParams.set('code_challenge_method', 'plain');
    const response = await SELF.fetch(url.toString(), { redirect: 'manual' });
    // OAuthProvider rejects plain PKCE when allowPlainPKCE: false
    expect(response.status).not.toBe(302);
  });
});

describe('POST /internal/token/validate', () => {
  it('returns 401 without X-Internal-Secret', async () => {
    const response = await SELF.fetch('http://localhost/internal/token/validate', {
      method: 'POST',
      body: JSON.stringify({ token: 'some-token' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  it('returns { active: false } for invalid token', async () => {
    const response = await SELF.fetch('http://localhost/internal/token/validate', {
      method: 'POST',
      body: JSON.stringify({ token: 'invalid-token-xyz' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': 'test-internal-secret',
      },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { active: boolean };
    expect(body.active).toBe(false);
  });
});
```

**Step 3: Run integration tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test:integration 2>&1 | tail -15
```

Expected: PASS

**Step 4: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/auth-server/tests/integration/authorize-flow.integration.spec.ts workers/auth-server/vitest.integration.config.ts
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "feat: add Miniflare integration tests for auth server authorize flow"
```

---

## Task 8: `CSSAuthIdentityProvider` — token validation for resource servers

Resource servers (main CSS worker) need to validate tokens issued by the auth server. The auth server exposes `POST /internal/token/validate` which calls `oauthHelpers.unwrapToken()` — this is NOT RFC 7662 introspection (which `@cloudflare/workers-oauth-provider` does not expose).

**Files:**
- Create: `workers/src/auth/css-auth-identity-provider.ts`
- Modify: `workers/src/auth/index.ts` (export new provider)
- Modify: `workers/src/middleware/authentication.ts` (import and register provider — stays synchronous)
- Modify: `workers/src/index.ts` (add `CSS_AUTH_SERVER?` to Env)
- Test: `workers/tests/auth/css-auth-identity-provider.spec.ts` (new)

**Step 1: Write failing tests**

Create `workers/tests/auth/css-auth-identity-provider.spec.ts`:

```typescript
/**
 * CSSAuthIdentityProvider Tests
 *
 * Tests token validation via POST /internal/token/validate against the CSS Auth Server.
 * The provider sends the opaque access token to the auth server's validate endpoint
 * and maps the response to an AuthenticatedPrincipal.
 *
 * NOTE: The auth server does NOT expose RFC 7662 /token/introspect.
 * It exposes /internal/token/validate which calls oauthHelpers.unwrapToken() internally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CSSAuthIdentityProvider } from '../../src/auth/css-auth-identity-provider.js';

function makeProvider(mockFetcher?: Fetcher): CSSAuthIdentityProvider {
  return new CSSAuthIdentityProvider({
    authServerUrl: 'https://css-auth.example.com',
    internalSecret: 'test-secret',
    fetcher: mockFetcher,
  });
}

function makeMockFetcher(status: number, body: unknown): Fetcher {
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  } as unknown as Fetcher;
}

describe('CSSAuthIdentityProvider', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe('canVerifyToken', () => {
    it('returns true for opaque tokens (no dots, no known prefix)', () => {
      const provider = makeProvider();
      // CSS auth server issues tokens like "userId:grantId:secret" — colons, no dots
      expect(provider.canVerifyToken('abc123:grantid456:secretxyz')).toBe(true);
    });

    it('returns false for empty string', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('')).toBe(false);
    });

    it('returns false for Google JWTs (has 2 dots — let GoogleIdentityProvider handle)', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig')).toBe(false);
    });

    it('returns false for Auth0 JWTs', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('eyJ0.eyJzdWIiOiIxMjMiLCJpc3MiOiJodHRwczovL2Rldi5hdXRoMC5jb20ifQ.sig')).toBe(false);
    });

    it('returns false for sat_ prefixed tokens (SiteApiTokenProvider domain)', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('sat_abc123def456')).toBe(false);
    });

    it('returns false for aak_ prefixed tokens (AgentApiKeyProvider domain)', () => {
      const provider = makeProvider();
      expect(provider.canVerifyToken('aak_someagentkey')).toBe(false);
    });
  });

  describe('validateToken', () => {
    it('returns AuthenticatedPrincipal for active token', async () => {
      const fetcher = makeMockFetcher(200, {
        active: true,
        sub: 'google-sub-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        props: {
          userId: 'google-sub-123',
          email: 'user@example.com',
          name: 'Test User',
          siteId: 'site-abc',
        },
      });
      const provider = makeProvider(fetcher);
      const principal = await provider.validateToken('abc123:grantid:secret');
      expect(principal).not.toBeNull();
      expect(principal!.email).toBe('user@example.com');
      expect(principal!.authProvider).toBe('css_auth');
      expect(principal!.type).toBe('user');
    });

    it('returns null for inactive token', async () => {
      const fetcher = makeMockFetcher(200, { active: false });
      const provider = makeProvider(fetcher);
      const result = await provider.validateToken('expired-token');
      expect(result).toBeNull();
    });

    it('returns null when validate endpoint returns 401', async () => {
      const fetcher = makeMockFetcher(401, { error: 'unauthorized' });
      const provider = makeProvider(fetcher);
      const result = await provider.validateToken('bad-token');
      expect(result).toBeNull();
    });

    it('returns null when validate endpoint returns 500', async () => {
      const fetcher = makeMockFetcher(500, { error: 'server error' });
      const provider = makeProvider(fetcher);
      const result = await provider.validateToken('any-token');
      expect(result).toBeNull();
    });

    it('sends token as JSON body in POST request to /internal/token/validate', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ active: false }), { status: 200 }),
      );
      const fetcher = { fetch: mockFetch } as unknown as Fetcher;
      const provider = makeProvider(fetcher);
      await provider.validateToken('mytoken');
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('POST');
      expect(url).toContain('/internal/token/validate');
      const bodyStr = options.body as string;
      expect(JSON.parse(bodyStr)).toMatchObject({ token: 'mytoken' });
    });

    it('sends X-Internal-Secret header', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ active: false }), { status: 200 }),
      );
      const fetcher = { fetch: mockFetch } as unknown as Fetcher;
      const provider = makeProvider(fetcher);
      await provider.validateToken('mytoken');
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['X-Internal-Secret']).toBe('test-secret');
    });

    it('returns null for empty token (fail-closed)', async () => {
      const fetcher = makeMockFetcher(200, { active: false });
      const provider = makeProvider(fetcher);
      const result = await provider.validateToken('');
      expect(result).toBeNull();
    });
  });

  describe('validateAgentKey', () => {
    it('always returns null (CSS auth server does not issue agent keys)', async () => {
      const provider = makeProvider();
      const result = await provider.validateAgentKey('aak_somekey');
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test -- tests/auth/css-auth-identity-provider.spec.ts 2>&1 | tail -10
```

Expected: FAIL — module not found

**Step 3: Implement `CSSAuthIdentityProvider`**

Create `workers/src/auth/css-auth-identity-provider.ts`:

```typescript
/**
 * CSS Auth Server Identity Provider
 *
 * Validates opaque access tokens issued by the CSS Auth Server (workers/auth-server/)
 * by calling POST /internal/token/validate on the auth server via a Cloudflare service
 * binding. That endpoint calls oauthHelpers.unwrapToken() internally.
 *
 * IMPORTANT: The auth server does NOT expose RFC 7662 /token/introspect.
 * The /internal/token/validate endpoint is specific to CSS and is protected by
 * X-Internal-Secret. It is not a standard OAuth endpoint.
 *
 * This provider is added to MultiProviderIdentityProvider when CSS_AUTH_SERVER
 * (service binding) is configured in the main CSS worker's env.
 *
 * canVerifyToken() routing rules:
 * - Returns false for JWTs (exactly 2 dots: header.payload.signature) — Google/Auth0 handle these
 * - Returns false for sat_ tokens — SiteApiTokenProvider handles these
 * - Returns false for aak_ tokens — AgentApiKeyProvider handles these
 * - Returns true for any other non-empty token (CSS auth server opaque tokens)
 *
 * Fail closed: any validation failure returns null (token rejected).
 */

import type { AuthenticatedPrincipal } from '../types';
import type { IdentityProvider } from './identity-provider';

export interface CSSAuthIdentityProviderOptions {
  /** Base URL of the CSS Auth Server (used for URL construction when no service binding) */
  authServerUrl: string;
  /** Shared secret for the X-Internal-Secret header */
  internalSecret: string;
  /** Optional Cloudflare service binding (preferred — sub-ms latency). Falls back to fetch() if not provided. */
  fetcher?: Fetcher;
}

interface TokenValidateResponse {
  active: boolean;
  sub?: string;
  exp?: number;
  props?: {
    userId?: string;
    email?: string;
    name?: string;
    siteId?: string;
  };
}

/**
 * Validates opaque tokens from the CSS Auth Server via /internal/token/validate.
 */
export class CSSAuthIdentityProvider implements IdentityProvider {
  readonly name = 'css_auth' as const;

  private readonly authServerUrl: string;
  private readonly internalSecret: string;
  private readonly fetcher?: Fetcher;

  /** Opaque token prefixes claimed by other providers — must not intercept these. */
  private static readonly EXCLUDED_PREFIXES = ['sat_', 'aak_'];

  constructor(options: CSSAuthIdentityProviderOptions) {
    this.authServerUrl = options.authServerUrl.replace(/\/$/, '');
    this.internalSecret = options.internalSecret;
    this.fetcher = options.fetcher;
  }

  /**
   * Returns true for opaque tokens that belong to the CSS auth server.
   *
   * Routing logic (order matters):
   * 1. Empty token — reject
   * 2. JWTs (exactly 2 dots: header.payload.signature) — reject (Google/Auth0 handle these)
   * 3. Known opaque prefixes (sat_, aak_) — reject (other providers handle these)
   * 4. Everything else — accept (CSS auth server opaque tokens)
   */
  canVerifyToken(token: string): boolean {
    if (!token) {
      return false;
    }
    // JWTs have exactly 2 dots (header.payload.signature)
    const dotCount = (token.match(/\./g) ?? []).length;
    if (dotCount === 2) {
      return false;
    }
    // Tokens with known prefixes belong to other providers
    for (const prefix of CSSAuthIdentityProvider.EXCLUDED_PREFIXES) {
      if (token.startsWith(prefix)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Validate a token via /internal/token/validate. Returns null if the token is inactive or
   * if the call fails for any reason (fail closed, not open).
   */
  async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
    if (!token) {
      return null;
    }

    try {
      const validateUrl = `${this.authServerUrl}/internal/token/validate`;

      const doFetch = this.fetcher
        ? (url: string, init: RequestInit) => this.fetcher!.fetch(url, init)
        : (url: string, init: RequestInit) => fetch(url, init);

      const response = await doFetch(validateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.internalSecret,
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as TokenValidateResponse;

      if (!data.active) {
        return null;
      }

      const sub = data.sub ?? data.props?.userId ?? '';
      if (!sub) {
        return null;
      }

      const expiryMs = data.exp !== undefined ? data.exp * 1000 : Date.now() + 3600_000;

      return {
        id: sub,
        type: 'user',
        email: data.props?.email,
        name: data.props?.name,
        authProvider: 'css_auth',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(expiryMs).toISOString(),
        providerSubjectId: sub,
      };
    } catch {
      // Fail closed: if validation fails for any reason, reject the token
      return null;
    }
  }

  /**
   * CSS Auth Server issues tokens for users, not API keys for agents.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateAgentKey(): Promise<AuthenticatedPrincipal | null> {
    return null;
  }
}
```

**Step 4: Export from auth barrel**

In `workers/src/auth/index.ts`, add:

```typescript
export { CSSAuthIdentityProvider } from './css-auth-identity-provider';
```

**Step 5: Register in `authentication.ts` middleware (stays synchronous)**

At the top of `workers/src/middleware/authentication.ts`, add the import alongside existing imports:

```typescript
import { CSSAuthIdentityProvider } from '../auth/css-auth-identity-provider';
```

Inside `getIdentityProvider()`, after the `AgentApiKeyProvider` registration and before `return`:

```typescript
// CSS Auth Server provider (activated when CSS_AUTH_SERVER service binding is configured)
// Validates opaque tokens issued by css-auth-server via /internal/token/validate endpoint.
// Added LAST since it makes a service binding call per request —
// let JWT providers (Google, Auth0) run first since they verify locally.
if (env.CSS_AUTH_SERVER !== undefined && env.CSS_AUTH_SERVER_URL !== undefined && env.CSS_AUTH_SERVER_URL !== '') {
  providers.push(new CSSAuthIdentityProvider({
    authServerUrl: env.CSS_AUTH_SERVER_URL,
    internalSecret: env.INTERNAL_SECRET ?? '',
    fetcher: env.CSS_AUTH_SERVER,
  }));
}
```

**Step 6: Add env vars to main worker `Env` interface**

In `workers/src/index.ts`, add to the `Env` interface after the existing `INTERNAL_SECRET` line (which already exists — do NOT add a duplicate):

```typescript
// CSS Auth Server (workers/auth-server/) for puck-css browser client tokens
CSS_AUTH_SERVER_URL?: string;   // Base URL of auth server (for URL construction when not using service binding)
CSS_AUTH_SERVER?: Fetcher;      // Service binding to auth server (preferred — sub-ms latency)
```

Note: `INTERNAL_SECRET?: string` is already present in the Env interface at line ~92. Do not add it again.

**Step 7: Run tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test -- tests/auth/css-auth-identity-provider.spec.ts 2>&1 | tail -10
```

Expected: PASS (12 tests)

**Step 8: Run full test suite**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test 2>&1 | tail -10
```

Expected: All tests pass.

**Step 9: Lint**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm lint 2>&1
```

Expected: 0 errors

**Step 10: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/src/auth/css-auth-identity-provider.ts workers/src/auth/index.ts workers/src/middleware/authentication.ts workers/src/index.ts workers/tests/auth/css-auth-identity-provider.spec.ts
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "feat: add CSSAuthIdentityProvider for opaque token validation via /internal/token/validate"
```

---

## Task 9: `MultiProviderIdentityProvider` routing test update

Verify the new `CSSAuthIdentityProvider` routes correctly alongside existing providers.

**Files:**
- Modify: `workers/tests/auth/identity-provider.spec.ts` (add CSS auth routing test)

**Step 1: Add routing test to existing spec**

In `workers/tests/auth/identity-provider.spec.ts`, add a describe block:

```typescript
describe('CSS Auth provider routing', () => {
  it('routes opaque tokens (no dots, no known prefix) to CSSAuthIdentityProvider', async () => {
    const { CSSAuthIdentityProvider } = await import('../../src/auth/css-auth-identity-provider.js');
    const { GoogleIdentityProvider } = await import('../../src/auth/google-identity-provider.js');
    const { MultiProviderIdentityProvider } = await import('../../src/auth/identity-provider.js');

    const mockFetcher = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          active: true,
          sub: 'some-sub',
          props: { email: 'user@test.com', userId: 'some-sub' },
        }), { status: 200 }),
      ),
    } as unknown as Fetcher;

    const cssAuthProvider = new CSSAuthIdentityProvider({
      authServerUrl: 'https://auth.example.com',
      internalSecret: 'test-secret',
      fetcher: mockFetcher,
    });
    const googleProvider = new GoogleIdentityProvider({ clientId: 'test-client' });

    // An opaque token (no JWT dot structure, no sat_/aak_ prefix)
    const opaqueToken = 'userid123:grantabc:secretxyz';
    expect(googleProvider.canVerifyToken(opaqueToken)).toBe(false);
    expect(cssAuthProvider.canVerifyToken(opaqueToken)).toBe(true);

    const multi = new MultiProviderIdentityProvider([googleProvider, cssAuthProvider]);
    const principal = await multi.validateToken(opaqueToken);
    expect(principal).not.toBeNull();
    expect(principal!.authProvider).toBe('css_auth');
  });

  it('Google JWTs are NOT routed to CSSAuthIdentityProvider', async () => {
    const { CSSAuthIdentityProvider } = await import('../../src/auth/css-auth-identity-provider.js');
    const provider = new CSSAuthIdentityProvider({
      authServerUrl: 'https://auth.example.com',
      internalSecret: 'test-secret',
    });
    const googleJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.fakesig';
    expect(provider.canVerifyToken(googleJwt)).toBe(false);
  });

  it('sat_ tokens are NOT routed to CSSAuthIdentityProvider', async () => {
    const { CSSAuthIdentityProvider } = await import('../../src/auth/css-auth-identity-provider.js');
    const provider = new CSSAuthIdentityProvider({
      authServerUrl: 'https://auth.example.com',
      internalSecret: 'test-secret',
    });
    expect(provider.canVerifyToken('sat_abc123')).toBe(false);
  });

  it('aak_ tokens are NOT routed to CSSAuthIdentityProvider', async () => {
    const { CSSAuthIdentityProvider } = await import('../../src/auth/css-auth-identity-provider.js');
    const provider = new CSSAuthIdentityProvider({
      authServerUrl: 'https://auth.example.com',
      internalSecret: 'test-secret',
    });
    expect(provider.canVerifyToken('aak_someagentkey')).toBe(false);
  });
});
```

**Step 2: Run tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test -- tests/auth/identity-provider.spec.ts 2>&1 | tail -10
```

Expected: PASS

**Step 3: Run full test suite**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/tests/auth/identity-provider.spec.ts
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "test: verify CSSAuthIdentityProvider routing in MultiProviderIdentityProvider"
```

---

## Task 10: Wrangler config updates for the main CSS worker

Add service binding declarations so the main CSS worker can call the auth server for token validation.

**Files:**
- Modify: `workers/wrangler.jsonc` (add `CSS_AUTH_SERVER` service binding and `CSS_AUTH_SERVER_URL`/`INTERNAL_SECRET` vars to sbx1/production envs)

**Step 1: Update `workers/wrangler.jsonc` sbx1 environment**

In the `sbx1` environment section, add to `vars`:

```jsonc
"CSS_AUTH_SERVER_URL": "https://css-auth-server-sbx1.chris-801.workers.dev",
"INTERNAL_SECRET": "REPLACE_WITH_SHARED_SECRET_MATCHING_AUTH_SERVER"
```

Add to `services` (create the array if it doesn't exist for sbx1):

```jsonc
{ "binding": "CSS_AUTH_SERVER", "service": "css-auth-server-sbx1" }
```

Apply the same pattern to the `production` environment, substituting the appropriate service name and URL.

**Step 2: Verify changes compile**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm typecheck 2>&1
```

Expected: No errors

**Step 3: Commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add workers/wrangler.jsonc
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "config: add CSS_AUTH_SERVER service binding to main worker wrangler config"
```

---

## Task 11: Security review and PROGRESS.md update

**Step 1: Run linting on all affected packages**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm lint
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm lint
```

Expected: 0 errors in both

**Step 2: Run full test suite for all packages**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test
```

Expected: All tests pass

**Step 3: Run integration tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test:integration
```

Expected: All pass

**Step 4: Apply the database migration**

```bash
docker exec css-postgres psql -U cssuser -d cssdb -f /dev/stdin < /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/src/db/migrations/031_site_allowed_origins.sql
```

Verify:
```bash
docker exec css-postgres psql -U cssuser -d cssdb -c "\d app.sites" | grep allowed_origins
```

Expected: `allowed_origins | text[] | not null | default '{}'::text[]`

**Step 5: Update PROGRESS.md**

In the worktree root, update `PROGRESS.md` with:

- Phase completed: CSS Auth Server
- New worker: `workers/auth-server/` — OAuth 2.0 Authorization Server (Google-only, extensible for Auth0)
- New provider: `CSSAuthIdentityProvider` with `/internal/token/validate` (wraps `oauthHelpers.unwrapToken()`)
- New DB column: `app.sites.allowed_origins TEXT[]`
- New internal endpoint: `GET /internal/site-auth-config/:siteId`
- Key decisions: client_id = site_id, lazy OAUTH_KV provisioning, service binding for site lookup and token validation, PKCE S256 enforced, MCP server unchanged
- Known residuals: (1) State parameter lacks HMAC signing — add before high-traffic launch; (2) Auth server KV IDs for sbx1/production must be created with `wrangler kv:namespace create`; (3) INTERNAL_SECRET must be set consistently across main worker and auth server secrets

**Step 6: Final commit**

```bash
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server add PROGRESS.md
git -C /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server commit -m "docs: update PROGRESS.md with CSS Auth Server implementation"
```

---

## Deployment notes (for operator reference, not automated steps)

**Provision KV namespaces:**
```bash
# For sbx1
cd workers/auth-server && wrangler kv:namespace create OAUTH_KV --env sbx1
# Copy the returned ID into workers/auth-server/wrangler.jsonc REPLACE_WITH_SBX1_AUTH_OAUTH_KV_ID

# For production
cd workers/auth-server && wrangler kv:namespace create OAUTH_KV --env production
```

**Set secrets for sbx1 (auth server):**
```bash
wrangler secret put GOOGLE_CLIENT_ID --name css-auth-server-sbx1
wrangler secret put GOOGLE_CLIENT_SECRET --name css-auth-server-sbx1
wrangler secret put INTERNAL_SECRET --name css-auth-server-sbx1
wrangler secret put COOKIE_ENCRYPTION_KEY --name css-auth-server-sbx1
```

**Set secrets for sbx1 (main CSS worker):**
```bash
# Same INTERNAL_SECRET value as above — must match
wrangler secret put INTERNAL_SECRET --name collaborative-state-worker-sbx1
```

**Local development:**
```bash
cd workers/auth-server
cp .dev.vars.example .dev.vars
# Edit .dev.vars with real credentials
pnpm dev
```

**Deploy order:**
1. Deploy main CSS worker (to make `GET /internal/site-auth-config/:siteId` available via service binding)
2. Deploy CSS auth server (which calls main worker via service binding)

---

## Test Run Commands (all together)

```bash
# Unit tests — main CSS worker
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm test

# Unit tests — auth server
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test

# Integration tests — auth server (Miniflare)
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm test:integration

# Lint — main CSS worker
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm lint

# Lint — auth server
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm lint

# Type check — main CSS worker
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers && pnpm typecheck

# Type check — auth server
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/feat/css-auth-server/workers/auth-server && pnpm typecheck
```

---

## Summary of all new files

| Path | Purpose |
|------|---------|
| `workers/src/db/migrations/031_site_allowed_origins.sql` | DB migration: add `allowed_origins` column |
| `workers/src/auth/css-auth-identity-provider.ts` | Token validation via `/internal/token/validate` |
| `workers/tests/auth/css-auth-identity-provider.spec.ts` | Tests for CSSAuthIdentityProvider |
| `workers/auth-server/package.json` | Auth server package manifest |
| `workers/auth-server/tsconfig.json` | TypeScript config |
| `workers/auth-server/vitest.config.ts` | Vitest unit test config |
| `workers/auth-server/vitest.integration.config.ts` | Vitest Miniflare integration test config |
| `workers/auth-server/eslint.config.js` | ESLint config |
| `workers/auth-server/wrangler.jsonc` | Wrangler deployment config |
| `workers/auth-server/.dev.vars.example` | Local development secrets template |
| `workers/auth-server/src/index.ts` | Worker entry point (authorize, callback, token validate) |
| `workers/auth-server/src/types.ts` | Env interface |
| `workers/auth-server/src/health.ts` | Health check handler |
| `workers/auth-server/src/auth/google-handler.ts` | Google OAuth (copied from mcp-server) |
| `workers/auth-server/src/auth/origin-validator.ts` | Wildcard-safe redirect URI validator |
| `workers/auth-server/src/services/site-lookup.ts` | Service binding → site auth config |
| `workers/auth-server/tests/auth/google-handler.spec.ts` | Google handler tests (ported) |
| `workers/auth-server/tests/auth/origin-validator.spec.ts` | Origin validator unit tests |
| `workers/auth-server/tests/auth/origin-validator.property.spec.ts` | Property-based wildcard safety tests |
| `workers/auth-server/tests/services/site-lookup.spec.ts` | Service binding mock tests |
| `workers/auth-server/tests/integration/oauth-config.spec.ts` | Source-inspection OAuthProvider config + token validate endpoint |
| `workers/auth-server/tests/integration/authorize-flow.integration.spec.ts` | Miniflare full flow tests |
