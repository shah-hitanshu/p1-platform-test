# CSS Auth Server — Test Plan

**Date:** 2026-04-07
**Feature:** Standalone CSS OAuth 2.0 Authorization Server (`workers/auth-server/`) with Google proxy pattern
**Tasks covered:** Tasks 1–11 of `2026-04-07-css-auth-server.md`
**Agreed fidelity:** Heavy — property-based origin tests, miniflare integration, full provider routing coverage

---

## Strategy Reconciliation

The implementation plan was reviewed against the agreed Heavy testing strategy. Key findings:

1. **Direct OAUTH_KV write for client registration** (Design Decision #1): The strategy assumed a simple client registration call. The plan reveals that `oauthHelpers.createClient()` ignores any provided `clientId`, requiring direct `OAUTH_KV.put('client:{siteId}', ...)` for new clients and `oauthHelpers.updateClient()` for existing ones. The source-inspection tests (Harness H3) are updated to assert both call sites. No scope increase.

2. **Miniflare harness is config-driven, not a separate service**: The `vitest.integration.config.ts` file embeds the `CSS_BACKEND` service binding stub inline. This simplifies Harness H4 — no separate stub server process is needed.

3. **`CSSAuthIdentityProvider.canVerifyToken()` uses dot-count routing**: The token routing rule (2 dots = JWT, 0 dots with no known prefix = opaque CSS token) is now concrete. The `canVerifyToken` unit tests capture this precisely.

4. **`CSSAuthIdentityProvider` accepts optional `fetcher?`**: The provider falls back to global `fetch()` when no service binding is provided. Tests cover both paths.

5. **Performance scope**: The strategy mentioned a <50ms timing assertion for `validateToken`. This is implemented as an invariant test (T37) using a resolved mock — no network call involved.

6. **`allowedOrigins` in site API tests**: The plan specifies that existing `site-api.spec.ts` snapshot tests may need updating to include `allowedOrigins: []`. This is a regression test (T38) — verify the field is included in API responses after migration.

No strategy changes require user approval.

---

## Harness Definitions

### H1: Vitest + Mocked Fetch (Direct API harness)

**Used by:** Google handler tests, `CSSAuthIdentityProvider.validateToken` tests, `lookupSiteAuthConfig` tests
**What it does:** Replaces global `fetch` or provides a `vi.fn()` Fetcher mock, allowing tests to control HTTP responses without network access.
**Exposes:** Control over response status, body, and headers; assertions on call arguments (URL, method, headers, body).
**Estimated complexity:** Trivial — established pattern in MCP server tests.
**Tests depending on this:** T11–T17, T19–T26, T31–T37

### H2: Vitest + Service Mock (Service binding mock harness)

**Used by:** `lookupSiteAuthConfig` tests, `internal-api` handler tests, `CSSAuthIdentityProvider` integration tests
**What it does:** Constructs a mock `Fetcher` object (`{ fetch: vi.fn() }`) typed as a Cloudflare `Fetcher` to simulate service binding calls.
**Exposes:** Response control per call, argument capture.
**Estimated complexity:** Trivial — same pattern used in existing tests.
**Tests depending on this:** T19–T26, T27–T30, T40–T43

### H3: Vitest + Source Inspection (Config validation harness)

**Used by:** OAuthProvider configuration tests
**What it does:** Reads `workers/auth-server/src/index.ts` with `readFileSync()` and asserts that required configuration strings are present.
**Exposes:** String containment assertions on source code as a proxy for runtime OAuthProvider config.
**Estimated complexity:** Trivial — established pattern from MCP server `oauth-integration.spec.ts`.
**Limitation:** Cannot detect runtime misconfiguration from values that are identical to checked strings. Guards against accidental removal.
**Tests depending on this:** T44–T51

### H4: Miniflare Integration (Cloudflare runtime harness)

**Used by:** Full authorize-flow integration tests
**What it does:** `@cloudflare/vitest-pool-workers` runs the auth server Worker in the real Cloudflare workerd runtime with in-memory KV and a stubbed `CSS_BACKEND` service binding (inline in `vitest.integration.config.ts`). Tests use `SELF.fetch()` to call the live Worker.
**Exposes:** Real HTTP response assertions against actual OAuthProvider behavior.
**Estimated complexity:** Medium — must be set up before integration tests can run. Already specified in the plan (Task 7).
**Tests depending on this:** T52–T61

### H5: fast-check Property-Based (Property harness)

**Used by:** Origin validator safety invariants
**What it does:** Uses `fc.assert()` with `fc.property()` generators to test `matchesAllowedOrigin()` across a large domain of generated URLs.
**Exposes:** Counterexample generation on invariant violation.
**Estimated complexity:** Low — `fast-check` already listed as a dev dependency in `workers/auth-server/package.json`.
**Tests depending on this:** T8–T10

---

## Test Plan

### Scenario Tests (Multi-step user flows)

---

**T1 — Happy-path browser OAuth flow: known site, valid redirect URI, S256 PKCE**

- **Type:** scenario
- **Harness:** H4 (miniflare)
- **Preconditions:** Miniflare KV empty; `CSS_BACKEND` stub returns `allowedOrigins: ['http://localhost:3000']` for `test-site-123`
- **Actions:**
  1. `GET /authorize?client_id=test-site-123&redirect_uri=http://localhost:3000/callback&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`
  2. Follow the 302 redirect to capture the Google auth URL
- **Expected outcome:** Response status 302; `Location` header contains `accounts.google.com`. Source of truth: RFC 6749 §4.1.2 (authorization response); plan Task 6 step 3.
- **Interactions:** `CSS_BACKEND` service binding (stubbed), `OAUTH_KV` (written to during upsertClient)

---

**T2 — Happy-path: second authorize request for same site accumulates redirect URIs**

- **Type:** scenario
- **Harness:** H4 (miniflare)
- **Preconditions:** `OAUTH_KV` already contains a `client:test-site-123` entry with `redirectUris: ['http://localhost:3000/callback']`; `CSS_BACKEND` stub returns `allowedOrigins: ['http://localhost:3000', 'https://live-testsite.pantheonsite.io']`
- **Actions:**
  1. `GET /authorize?client_id=test-site-123&redirect_uri=https://live-testsite.pantheonsite.io/callback&response_type=code&code_challenge=...&code_challenge_method=S256`
- **Expected outcome:** Response status 302 (not 400); new `redirect_uri` is accepted. Source of truth: Design Decision #1 — redirect URIs accumulate in OAUTH_KV; wildcard matching in `matchesAllowedOrigin`.
- **Interactions:** `CSS_BACKEND` service binding, `OAUTH_KV` read + write (upsertClient merges URI)

---

**T3 — Happy-path: `POST /internal/token/validate` returns active=true for a valid token obtained from authorize flow**

- **Type:** scenario
- **Harness:** H4 (miniflare)
- **Preconditions:** A valid token is obtained via the authorize+callback flow (or pre-written to `OAUTH_KV`). Token is in the CSS auth server opaque format.
- **Actions:**
  1. `POST /internal/token/validate` with `{ "token": "<valid-opaque-token>" }` and `X-Internal-Secret: test-internal-secret`
- **Expected outcome:** `{ active: true, sub: "<userId>", props: { email, siteId } }` with status 200. Source of truth: Design Decision #3; plan Task 6, `/internal/token/validate` handler.
- **Interactions:** `OAUTH_KV` (token lookup via `oauthHelpers.unwrapToken()`)

---

**T4 — End-to-end provider routing: opaque CSS token reaches `CSSAuthIdentityProvider` in MultiProvider**

- **Type:** scenario
- **Harness:** H2 (service binding mock)
- **Preconditions:** `MultiProviderIdentityProvider` configured with `GoogleIdentityProvider`, `CSSAuthIdentityProvider` (mock fetcher returning `active: true`)
- **Actions:**
  1. Call `multi.validateToken('userid123:grantabc:secretxyz')`
- **Expected outcome:** Returns an `AuthenticatedPrincipal` with `authProvider: 'css_auth'` and `type: 'user'`. `GoogleIdentityProvider.canVerifyToken()` returns false for the token (no 2-dot JWT structure). Source of truth: Design Decision #6; plan Task 9.
- **Interactions:** `CSSAuthIdentityProvider.validateToken()`, `GoogleIdentityProvider.canVerifyToken()`

---

**T5 — `allowedOrigins` round-trip: set via API, used by auth server**

- **Type:** scenario
- **Harness:** H2 (service binding mock for auth), H1 (fetch mock for site API)
- **Preconditions:** Site exists in DB with no `allowedOrigins`
- **Actions:**
  1. `PATCH /api/sites/{siteId}` with `{ "allowedOrigins": ["https://mysite.com"] }`
  2. `GET /api/sites/{siteId}` and assert `allowedOrigins` field is present
  3. Auth server calls `GET /internal/site-auth-config/{siteId}` and receives `{ allowedOrigins: ["https://mysite.com"] }`
- **Expected outcome:** Step 2 returns the site with `allowedOrigins: ["https://mysite.com"]`; step 3 returns `200` with correct `allowedOrigins`. Source of truth: plan Task 1 (site service), Task 2 (internal endpoint), Task 10 (wrangler config).
- **Interactions:** `site-service.ts`, `site-api.ts`, `internal-api.ts`, `site-lookup.ts`

---

### Integration Tests (Component boundary exercises)

---

**T6 — Internal `GET /internal/site-auth-config/:siteId` returns correct origins for known site**

- **Type:** integration
- **Harness:** H2 (service binding mock for `getSiteAllowedOrigins`)
- **Preconditions:** `getSiteAllowedOrigins` mocked to return `['https://mysite.com', '*-mysite.pantheonsite.io']`
- **Actions:** `handleInternalRoutes(GET /internal/site-auth-config/site-123, { internalSecret })` with correct secret
- **Expected outcome:** `200` with `{ siteId: 'site-123', allowedOrigins: ['https://mysite.com', '*-mysite.pantheonsite.io'] }`. Source of truth: plan Task 2, step 1.
- **Interactions:** `site-service.getSiteAllowedOrigins()`

---

**T7 — Internal endpoint returns 404 for unknown site**

- **Type:** integration
- **Harness:** H2 (service binding mock)
- **Preconditions:** `getSiteAllowedOrigins` returns `null`
- **Actions:** `handleInternalRoutes(GET /internal/site-auth-config/missing-site, { internalSecret })` with correct secret
- **Expected outcome:** `404`. Source of truth: plan Task 2, step 1.
- **Interactions:** `site-service.getSiteAllowedOrigins()`

---

**T7b — Internal endpoint returns 200 with empty array when site has no origins configured**

- **Type:** integration
- **Harness:** H2 (service binding mock)
- **Preconditions:** `getSiteAllowedOrigins` returns `[]`
- **Actions:** `handleInternalRoutes(GET /internal/site-auth-config/site-empty, { internalSecret })` with correct secret
- **Expected outcome:** `200` with `{ allowedOrigins: [] }`. Source of truth: plan Task 2, step 1.
- **Interactions:** `site-service.getSiteAllowedOrigins()`

---

**T7c — Internal endpoint returns 500 when site service throws**

- **Type:** integration
- **Harness:** H2 (service binding mock)
- **Preconditions:** `getSiteAllowedOrigins` rejects with `new Error('DB down')`
- **Actions:** `handleInternalRoutes(GET /internal/site-auth-config/site-1, { internalSecret })` with correct secret
- **Expected outcome:** `500`. Source of truth: plan Task 2, step 1.
- **Interactions:** `site-service.getSiteAllowedOrigins()`

---

**T7d — Internal endpoint requires correct X-Internal-Secret**

- **Type:** integration
- **Harness:** H2 (service binding mock)
- **Preconditions:** Correct secret is `'correct-secret'`
- **Actions:** Call `handleInternalRoutes` without `X-Internal-Secret` header; call again with wrong secret
- **Expected outcome:** `401` for missing header; `403` for wrong secret (follows existing `handleInternalRoutes` auth pattern). Source of truth: existing `internal-api.spec.ts` auth tests.
- **Interactions:** `handleInternalRoutes` centralized auth check

---

**T8 — `lookupSiteAuthConfig` sends X-Internal-Secret header and correct endpoint URL**

- **Type:** integration
- **Harness:** H1 (mock Fetcher)
- **Preconditions:** Mock returns `200` with valid body
- **Actions:** `lookupSiteAuthConfig(fetcher, 'test-secret', 'site-1')`
- **Expected outcome:** Fetcher called with URL containing `/internal/site-auth-config/site-1`; `X-Internal-Secret: test-secret` header present. Source of truth: plan Task 5, step 1.
- **Interactions:** Service binding to main CSS worker (mocked)

---

**T9 — `lookupSiteAuthConfig` returns null on 404, throws on 500**

- **Type:** integration
- **Harness:** H1 (mock Fetcher)
- **Preconditions:** Mock returns `404` for first call, `500` for second
- **Actions:**
  1. `lookupSiteAuthConfig(fetcher404, 'secret', 'missing')` → expect `null`
  2. `lookupSiteAuthConfig(fetcher500, 'secret', 'site-1')` → expect rejection with `'Site auth config lookup failed: 500'`
- **Expected outcome:** First call returns `null`; second rejects. Source of truth: plan Task 5, step 1.
- **Interactions:** Service binding (mocked)

---

**T10 — `CSSAuthIdentityProvider.validateToken` round-trip: sends token, maps response to AuthenticatedPrincipal**

- **Type:** integration
- **Harness:** H1 (mock Fetcher)
- **Preconditions:** Fetcher returns `{ active: true, sub: 'google-sub-123', exp: <future>, props: { userId: 'google-sub-123', email: 'user@example.com', name: 'Test User', siteId: 'site-abc' } }`
- **Actions:** `provider.validateToken('abc123:grantid:secret')`
- **Expected outcome:** Returns `AuthenticatedPrincipal` with `email: 'user@example.com'`, `authProvider: 'css_auth'`, `type: 'user'`. Source of truth: plan Task 8, step 1.
- **Interactions:** Auth server `/internal/token/validate` (mocked)

---

**T11 — `CSSAuthIdentityProvider.validateToken` sends POST to `/internal/token/validate` with correct headers and body**

- **Type:** integration
- **Harness:** H1 (mock Fetcher)
- **Preconditions:** Fetcher returns `{ active: false }`
- **Actions:** `provider.validateToken('mytoken')`; inspect captured call
- **Expected outcome:** Method is `POST`; URL contains `/internal/token/validate`; body is `{ "token": "mytoken" }`; `X-Internal-Secret: test-secret` header present; `Content-Type: application/json` header present. Source of truth: plan Task 8, step 1.
- **Interactions:** Auth server (mocked)

---

**T12 — `CSSAuthIdentityProvider` routing: dot-containing tokens not claimed**

- **Type:** integration
- **Harness:** Direct (no network)
- **Preconditions:** Provider instantiated
- **Actions:**
  1. `provider.canVerifyToken('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.fakesig')` (2 dots — standard JWT)
  2. `provider.canVerifyToken('header.payload')` (1 dot)
  3. `provider.canVerifyToken('a.b.c.d')` (3 dots)
- **Expected outcome:** All return `false`. The implementation rejects any token containing a dot (not just 2-dot JWTs). CSS auth opaque tokens use the `userId:grantId:secret` format and never contain dots. Source of truth: Design Decision #6 (updated: "any dot" rule is more conservative and correct than the earlier "exactly 2 dots" rule).
- **Interactions:** `canVerifyToken` routing logic

---

**T13 — `CSSAuthIdentityProvider` routing: `sat_` tokens not claimed**

- **Type:** integration
- **Harness:** Direct
- **Preconditions:** Provider instantiated
- **Actions:** `provider.canVerifyToken('sat_abc123def456')`
- **Expected outcome:** `false`. Source of truth: Design Decision #6.
- **Interactions:** `canVerifyToken` prefix exclusion

---

**T14 — `CSSAuthIdentityProvider` routing: `aak_` tokens not claimed**

- **Type:** integration
- **Harness:** Direct
- **Preconditions:** Provider instantiated
- **Actions:** `provider.canVerifyToken('aak_someagentkey')`
- **Expected outcome:** `false`. Source of truth: Design Decision #6.
- **Interactions:** `canVerifyToken` prefix exclusion

---

**T15 — `MultiProviderIdentityProvider` routes opaque CSS token to `CSSAuthIdentityProvider`, not Google**

- **Type:** integration
- **Harness:** H2 (mock Fetcher for CSSAuth)
- **Preconditions:** Multi provider has `[GoogleIdentityProvider, CSSAuthIdentityProvider]`; CSSAuth mock fetcher returns `active: true` for opaque token
- **Actions:** `multi.validateToken('userid123:grantabc:secretxyz')`
- **Expected outcome:** `GoogleIdentityProvider.canVerifyToken()` returns `false`; `CSSAuthIdentityProvider.canVerifyToken()` returns `true`; result has `authProvider: 'css_auth'`. Source of truth: plan Task 9.
- **Interactions:** Provider dispatch chain in `MultiProviderIdentityProvider`

---

**T16 — `CSSAuthIdentityProvider.validateToken` returns null for inactive token**

- **Type:** integration
- **Harness:** H1 (mock Fetcher)
- **Preconditions:** Fetcher returns `{ active: false }`
- **Actions:** `provider.validateToken('expired-token')`
- **Expected outcome:** `null`. Source of truth: plan Task 8, step 1.
- **Interactions:** Auth server (mocked)

---

**T17 — `CSSAuthIdentityProvider.validateToken` returns null for 401 from auth server (fail-closed)**

- **Type:** integration
- **Harness:** H1 (mock Fetcher)
- **Preconditions:** Fetcher returns `401`
- **Actions:** `provider.validateToken('bad-token')`
- **Expected outcome:** `null` (not a thrown exception). Source of truth: Design Decision — fail closed.
- **Interactions:** Auth server (mocked)

---

**T18 — `CSSAuthIdentityProvider.validateToken` returns null for 500 (fail-closed)**

- **Type:** integration
- **Harness:** H1 (mock Fetcher)
- **Preconditions:** Fetcher returns `500`
- **Actions:** `provider.validateToken('any-token')`
- **Expected outcome:** `null`. Source of truth: Design Decision — fail closed.
- **Interactions:** Auth server (mocked)

---

### Boundary and Edge-Case Tests — Origin Validator

---

**T19 — `matchesAllowedOrigin`: exact match accepted**

- **Type:** boundary
- **Harness:** Direct (pure function)
- **Preconditions:** None
- **Actions:** `matchesAllowedOrigin('https://mysite.com', ['https://mysite.com'])`
- **Expected outcome:** `true`. Source of truth: RFC 6749 §3.1.2 (redirect URI must match exactly); plan Task 4 spec.
- **Interactions:** None

---

**T20 — `matchesAllowedOrigin`: empty allowedOrigins always returns false**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://mysite.com', [])`
- **Expected outcome:** `false`. Source of truth: plan Task 4 spec.
- **Interactions:** None

---

**T21 — `matchesAllowedOrigin`: non-matching exact origin rejected**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://evil.com', ['https://mysite.com'])`
- **Expected outcome:** `false`. Source of truth: plan Task 4 spec.
- **Interactions:** None

---

**T22 — `matchesAllowedOrigin`: localhost with port accepted**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('http://localhost:3000', ['http://localhost:3000'])`
- **Expected outcome:** `true`. Source of truth: plan Task 4 spec.
- **Interactions:** None

---

**T23 — `matchesAllowedOrigin`: wrong port rejected**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('http://localhost:4000', ['http://localhost:3000'])`
- **Expected outcome:** `false`. Source of truth: plan Task 4 spec.
- **Interactions:** None

---

**T24 — `matchesAllowedOrigin`: wildcard Pantheon branch URL (live env)**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://live-mysite.pantheonsite.io', ['*-mysite.pantheonsite.io'])`
- **Expected outcome:** `true`. Source of truth: Design Decision #7.
- **Interactions:** None

---

**T25 — `matchesAllowedOrigin`: wildcard Pantheon branch URL (dev env)**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://dev-mysite.pantheonsite.io', ['*-mysite.pantheonsite.io'])`
- **Expected outcome:** `true`. Source of truth: Design Decision #7.
- **Interactions:** None

---

**T26 — SECURITY: wildcard does not match suffix-extended attacker domain**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://live-mysite.pantheonsite.io.evil.com', ['*-mysite.pantheonsite.io'])`
- **Expected outcome:** `false`. Source of truth: Design Decision #7 — suffix must be anchored to end of full hostname.
- **Interactions:** None

---

**T27 — SECURITY: wildcard does not match subdomain of allowed pattern**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://sub.live-mysite.pantheonsite.io', ['*-mysite.pantheonsite.io'])`
- **Expected outcome:** `false`. Source of truth: Design Decision #7 — prefix label must contain no dots.
- **Interactions:** None

---

**T28 — SECURITY: wildcard rejects http scheme for non-localhost**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('http://live-mysite.pantheonsite.io', ['*-mysite.pantheonsite.io'])`
- **Expected outcome:** `false`. Source of truth: Design Decision #7 — wildcards only for https origins.
- **Interactions:** None

---

**T29 — `matchesAllowedOrigin`: accepts when redirect_uri matches any pattern in list**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://mysite.com', ['*-mysite.pantheonsite.io', 'https://mysite.com'])`
- **Expected outcome:** `true`. Source of truth: plan Task 4 spec.
- **Interactions:** None

---

**T30 — `matchesAllowedOrigin`: path+query stripped — origin compared only**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://mysite.com/callback?foo=bar', ['https://mysite.com'])`
- **Expected outcome:** `true`. Source of truth: plan Task 4 spec (ignores path/query).
- **Interactions:** None

---

**T31 — `matchesAllowedOrigin`: trailing slash on redirect URI normalized**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('https://mysite.com/', ['https://mysite.com'])`
- **Expected outcome:** `true`. Source of truth: plan Task 4 spec.
- **Interactions:** None

---

**T32 — `matchesAllowedOrigin`: malformed redirect URI rejected**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('not-a-url', ['https://mysite.com'])`
- **Expected outcome:** `false`. Source of truth: plan Task 4 spec.
- **Interactions:** None

---

**T33 — `matchesAllowedOrigin`: empty redirect URI rejected**

- **Type:** boundary
- **Harness:** Direct
- **Actions:** `matchesAllowedOrigin('', ['https://mysite.com'])`
- **Expected outcome:** `false`. Source of truth: plan Task 4 spec.
- **Interactions:** None

---

### Property-Based Tests (Invariants across input space)

---

**T34 — Property: empty allowedOrigins list always returns false**

- **Type:** invariant
- **Harness:** H5 (fast-check)
- **Preconditions:** None
- **Actions:** `fc.assert(fc.property(fc.webUrl(), url => matchesAllowedOrigin(url, []) === false))`
- **Expected outcome:** No counterexample found across 100+ generated URLs. Source of truth: plan Task 4 property spec.
- **Interactions:** None

---

**T35 — Property: exact match is reflexive for https origins**

- **Type:** invariant
- **Harness:** H5 (fast-check)
- **Actions:** `fc.assert(fc.property(fc.domain().map(d => 'https://' + d), origin => matchesAllowedOrigin(origin, [origin]) === true))`
- **Expected outcome:** No counterexample found. Source of truth: plan Task 4 property spec.
- **Interactions:** None

---

**T36 — Property: wildcard NEVER matches suffix-extended (attacker-appended) hostnames**

- **Type:** invariant
- **Harness:** H5 (fast-check)
- **Actions:** For any generated attacker domain, construct `https://live-mysite.pantheonsite.io.{attackerDomain}/callback` and assert `matchesAllowedOrigin(url, ['*-mysite.pantheonsite.io']) === false`
- **Expected outcome:** No counterexample found. Source of truth: Design Decision #7; plan Task 4 property spec.
- **Interactions:** None

---

**T37 — Property: wildcard matches valid single-label Pantheon branch URLs**

- **Type:** invariant
- **Harness:** H5 (fast-check)
- **Actions:** For labels matching `^[a-z][a-z0-9-]{0,20}[a-z0-9]$`, assert `matchesAllowedOrigin('https://{label}-mysite.pantheonsite.io/callback', ['*-mysite.pantheonsite.io']) === true`
- **Expected outcome:** No counterexample found. Source of truth: Design Decision #7; plan Task 4 property spec.
- **Interactions:** None

---

### Performance Invariant

---

**T38 — `CSSAuthIdentityProvider.validateToken` completes in under 100ms with a resolved mock**

- **Type:** invariant
- **Harness:** H1 (mock Fetcher — synchronously resolved)
- **Preconditions:** Fetcher mock returns `{ active: false }` without delay
- **Actions:** Measure wall-clock time for `await provider.validateToken('some-token')` with `performance.now()`
- **Expected outcome:** Elapsed time < 100ms. Any violation indicates severe overhead in the provider class itself (not network). Source of truth: strategy performance requirement.
- **Interactions:** None (mock eliminates network latency)

---

### Source-Inspection Tests (OAuthProvider configuration)

---

**T39 — OAuthProvider enforces PKCE S256 (`allowPlainPKCE: false`)**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** `readFileSync('workers/auth-server/src/index.ts')` contains `allowPlainPKCE: false`
- **Expected outcome:** String present. Source of truth: Design Decision #5; RFC 7636 §4.2 (S256 requirement for public clients).
- **Interactions:** None

---

**T40 — OAuthProvider configures `/authorize` endpoint**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** Source contains `authorizeEndpoint: '/authorize'`
- **Expected outcome:** String present. Source of truth: plan Task 6, spec.
- **Interactions:** None

---

**T41 — OAuthProvider configures `/token` endpoint**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** Source contains `tokenEndpoint: '/token'`
- **Expected outcome:** String present. Source of truth: plan Task 6, spec.
- **Interactions:** None

---

**T42 — OAuthProvider configures 1-hour access token TTL**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** Source contains `accessTokenTTL: 3600`
- **Expected outcome:** String present. Source of truth: plan Task 6, spec.
- **Interactions:** None

---

**T43 — OAuthProvider configures 30-day refresh token TTL**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** Source contains `refreshTokenTTL: 2592000`
- **Expected outcome:** String present. Source of truth: plan Task 6, spec.
- **Interactions:** None

---

**T44 — Authorize handler uses `lookupSiteAuthConfig` and `matchesAllowedOrigin`**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** Source contains `lookupSiteAuthConfig` and `matchesAllowedOrigin`
- **Expected outcome:** Both strings present. Source of truth: plan Task 6, step 3.
- **Interactions:** None

---

**T45 — Authorize handler uses `upsertClient` which calls `OAUTH_KV.put` for new clients and `updateClient` for existing**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** Source contains `upsertClient`, `OAUTH_KV.put`, and `updateClient`
- **Expected outcome:** All three strings present. Source of truth: Design Decision #1 (direct KV write required; `createClient()` ignored).
- **Interactions:** None

---

**T46 — `/internal/token/validate` uses `unwrapToken`**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** Source contains `unwrapToken` and `/internal/token/validate`
- **Expected outcome:** Both strings present. Source of truth: Design Decision #3.
- **Interactions:** None

---

**T47 — `/internal/token/validate` validates `INTERNAL_SECRET`**

- **Type:** unit
- **Harness:** H3 (source inspection)
- **Actions:** Source contains `INTERNAL_SECRET` adjacent to the `/internal/token/validate` handler
- **Expected outcome:** String present. Source of truth: Design Decision #3 (endpoint is protected by shared secret).
- **Interactions:** None

---

### Miniflare Integration Tests (Cloudflare runtime)

---

**T48 — `GET /health` returns 200 in Cloudflare runtime**

- **Type:** integration
- **Harness:** H4 (miniflare)
- **Preconditions:** Worker started with miniflare config
- **Actions:** `SELF.fetch('http://localhost/health')`
- **Expected outcome:** `200` with `{ status: 'healthy', service: 'css-auth-server' }`. Source of truth: plan Task 6 spec.
- **Interactions:** `health.ts`

---

**T49 — `GET /authorize` with unknown site returns 400**

- **Type:** integration
- **Harness:** H4 (miniflare)
- **Preconditions:** `CSS_BACKEND` stub returns `404` for `unknown-site-id`
- **Actions:** `SELF.fetch('/authorize?client_id=unknown-site-id&redirect_uri=http://localhost:3000/callback&response_type=code&code_challenge=...&code_challenge_method=S256', { redirect: 'manual' })`
- **Expected outcome:** `400`. Source of truth: plan Task 7, step 2.
- **Interactions:** `CSS_BACKEND` stub, `lookupSiteAuthConfig`

---

**T50 — `GET /authorize` with disallowed redirect_uri returns 400**

- **Type:** integration
- **Harness:** H4 (miniflare)
- **Preconditions:** `CSS_BACKEND` stub returns `allowedOrigins: ['http://localhost:3000']` for `test-site-123`
- **Actions:** `/authorize?client_id=test-site-123&redirect_uri=https://evil.com/callback&...`
- **Expected outcome:** `400`. Source of truth: plan Task 7, step 2.
- **Interactions:** `CSS_BACKEND` stub, `matchesAllowedOrigin`

---

**T51 — `GET /authorize` valid client and URI redirects to Google**

- **Type:** integration
- **Harness:** H4 (miniflare)
- **Preconditions:** `CSS_BACKEND` stub returns `allowedOrigins: ['http://localhost:3000', '*-testsite.pantheonsite.io']` for `test-site-123`
- **Actions:** `/authorize?client_id=test-site-123&redirect_uri=http://localhost:3000/callback&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`
- **Expected outcome:** `302`; `Location` contains `accounts.google.com`. Source of truth: RFC 6749 §4.1.2; plan Task 7, step 2.
- **Interactions:** `OAuthProvider`, `upsertClient`, `OAUTH_KV`, `CSS_BACKEND` stub

---

**T52 — SECURITY: `GET /authorize` with plain PKCE rejected by OAuthProvider**

- **Type:** integration
- **Harness:** H4 (miniflare)
- **Preconditions:** `allowPlainPKCE: false` is set
- **Actions:** `/authorize?client_id=test-site-123&redirect_uri=http://localhost:3000/callback&code_challenge=some-plain&code_challenge_method=plain`
- **Expected outcome:** Status is NOT `302`. Source of truth: Design Decision #5; RFC 7636.
- **Interactions:** `OAuthProvider` PKCE enforcement

---

**T53 — SECURITY: wildcard http redirect_uri rejected in Cloudflare runtime**

- **Type:** integration
- **Harness:** H4 (miniflare)
- **Preconditions:** `CSS_BACKEND` stub returns `allowedOrigins: ['*-testsite.pantheonsite.io']` for `test-site-123`
- **Actions:** `/authorize?client_id=test-site-123&redirect_uri=http://live-testsite.pantheonsite.io/callback&...`
- **Expected outcome:** `400`. Source of truth: Design Decision #7 — wildcards require https.
- **Interactions:** `matchesAllowedOrigin`, `OAuthProvider`

---

**T54 — `POST /internal/token/validate` without X-Internal-Secret returns 401**

- **Type:** integration
- **Harness:** H4 (miniflare)
- **Preconditions:** Worker running
- **Actions:** `POST /internal/token/validate` with body `{ "token": "some-token" }` and no `X-Internal-Secret` header
- **Expected outcome:** `401`. Source of truth: plan Task 7, step 2.
- **Interactions:** Token validate handler

---

**T55 — `POST /internal/token/validate` with invalid token returns `{ active: false }`**

- **Type:** integration
- **Harness:** H4 (miniflare)
- **Preconditions:** `INTERNAL_SECRET` is `test-internal-secret`
- **Actions:** `POST /internal/token/validate` with `{ "token": "invalid-xyz" }` and `X-Internal-Secret: test-internal-secret`
- **Expected outcome:** `200` with `{ active: false }`. Source of truth: plan Task 7, step 2.
- **Interactions:** `oauthHelpers.unwrapToken()` returning null

---

### Google Handler Unit Tests (Ported from MCP server)

---

**T56 — `getGoogleAuthorizationUrl` constructs URL with correct query params**

- **Type:** unit
- **Harness:** Direct (pure function)
- **Actions:** Call with `{ clientId: 'test', redirectUri: 'http://localhost/callback', state: 'state-1', scope: 'openid email profile' }`
- **Expected outcome:** URL contains `accounts.google.com/o/oauth2/v2/auth`, `client_id=test`, `redirect_uri=`, `state=state-1`, `response_type=code`. Source of truth: MCP server `google-handler.spec.ts` (ported verbatim).
- **Interactions:** None

---

**T57 — `exchangeGoogleCode` exchanges code for tokens and decodes user info**

- **Type:** unit
- **Harness:** H1 (mocked global `fetch`)
- **Actions:** Call with valid params; fetch mock returns `{ access_token, id_token }` where `id_token` contains `{ sub, email, name }`
- **Expected outcome:** Returns `{ accessToken, user: { sub, email } }`. Source of truth: MCP server `google-handler.spec.ts`.
- **Interactions:** `fetch` (mocked)

---

**T58 — `exchangeGoogleCode` sends correct parameters to Google token endpoint**

- **Type:** unit
- **Harness:** H1 (mocked global `fetch`)
- **Actions:** Call and inspect `mockFetch.mock.calls[0]`
- **Expected outcome:** URL is `https://oauth2.googleapis.com/token`; method is `POST`; body contains `grant_type=authorization_code`. Source of truth: MCP server `google-handler.spec.ts`.
- **Interactions:** `fetch` (mocked)

---

**T59 — `exchangeGoogleCode` throws on non-200 Google response**

- **Type:** unit
- **Harness:** H1 (mocked `fetch` returning `ok: false, status: 400`)
- **Actions:** Call with any params
- **Expected outcome:** Promise rejects. Source of truth: MCP server `google-handler.spec.ts`.
- **Interactions:** `fetch` (mocked)

---

**T60 — `decodeIdTokenClaims` decodes user info from ID token payload**

- **Type:** unit
- **Harness:** Direct
- **Actions:** Construct a JWT with base64-encoded `{ sub, email, name }` payload; call `decodeIdTokenClaims(token)`
- **Expected outcome:** Returns `{ sub, email, name }`. Source of truth: MCP server `google-handler.spec.ts`.
- **Interactions:** None

---

**T61 — `decodeIdTokenClaims` handles base64url encoding**

- **Type:** unit
- **Harness:** Direct
- **Actions:** Construct a JWT payload with `+` and `/` characters encoded as `-` and `_`
- **Expected outcome:** Claims decoded correctly. Source of truth: MCP server `google-handler.spec.ts`.
- **Interactions:** None

---

**T62 — `decodeIdTokenClaims` throws on malformed token**

- **Type:** unit
- **Harness:** Direct
- **Actions:** `decodeIdTokenClaims('not-a-jwt')`
- **Expected outcome:** Throws. Source of truth: MCP server `google-handler.spec.ts`.
- **Interactions:** None

---

### Regression Tests

---

**T63 — Existing CSS worker test suite passes without regressions after Task 1 changes**

- **Type:** regression
- **Harness:** Vitest (main `workers` package)
- **Preconditions:** Task 1 changes applied (`allowedOrigins` on Site interface, `AuthProvider` updated)
- **Actions:** Run `pnpm test` in `workers/`
- **Expected outcome:** All pre-existing tests pass. Site snapshots that include the full `Site` object now include `allowedOrigins: []`. Source of truth: existing 2,654-test suite.
- **Interactions:** `site-service`, `domain.ts`, `enums.ts`

---

**T64 — Site API GET returns `allowedOrigins` field after Task 1**

- **Type:** regression
- **Harness:** H2 (service mock for `getSite`)
- **Preconditions:** `getSite` mock returns a site with `allowedOrigins: ['https://mysite.com']`
- **Actions:** `handleSiteRoutes(GET /api/sites/site-123, context)`
- **Expected outcome:** Response body includes `allowedOrigins: ['https://mysite.com']`. Source of truth: plan Task 1, step 6.
- **Interactions:** `site-api.ts`, `site-service.ts`

---

**T65 — Site create and update pass `allowedOrigins` through to service layer**

- **Type:** regression
- **Harness:** H2 (service mock)
- **Preconditions:** `createSite` and `updateSite` mocks capture arguments
- **Actions:**
  1. `POST /api/sites` with `{ "allowedOrigins": ["https://newsite.com"] }`
  2. `PATCH /api/sites/site-1` with `{ "allowedOrigins": ["https://updated.com"] }`
- **Expected outcome:** `createSite` called with `allowedOrigins: ['https://newsite.com']`; `updateSite` called with `allowedOrigins: ['https://updated.com']`. Source of truth: plan Task 1, steps 5–6.
- **Interactions:** `site-api.ts`, `site-service.ts`

---

**T66 — Site create without `allowedOrigins` defaults to empty array**

- **Type:** regression
- **Harness:** H2 (service mock)
- **Preconditions:** `createSite` mock captures arguments
- **Actions:** `POST /api/sites` with `{ "pantheonSiteId": "abc", "name": "New Site" }` (no `allowedOrigins` field)
- **Expected outcome:** `createSite` called with `allowedOrigins: []` (or `undefined` which service layer defaults to `[]`). Source of truth: plan Task 1, step 5 — `params.allowedOrigins ?? []`.
- **Interactions:** `site-api.ts`, `site-service.ts`

---

### Health Check Unit Test

---

**T67 — `handleHealthCheck` returns 200 with correct service name**

- **Type:** unit
- **Harness:** Direct (pure function)
- **Actions:** `handleHealthCheck('local')`
- **Expected outcome:** `200` response with `{ status: 'healthy', service: 'css-auth-server', environment: 'local' }`. Source of truth: plan Task 3, step 6.
- **Interactions:** None

---

### `CSSAuthIdentityProvider` Additional Unit Tests

---

**T68 — `canVerifyToken` returns true for opaque token with colons and no dots**

- **Type:** unit
- **Harness:** Direct
- **Actions:** `provider.canVerifyToken('abc123:grantid456:secretxyz')`
- **Expected outcome:** `true`. Source of truth: Design Decision #6 — opaque token format is `userId:grantId:secret`.
- **Interactions:** None

---

**T69 — `canVerifyToken` returns false for empty string**

- **Type:** unit
- **Harness:** Direct
- **Actions:** `provider.canVerifyToken('')`
- **Expected outcome:** `false`. Source of truth: plan Task 8, step 1.
- **Interactions:** None

---

**T70 — `validateToken` returns null for empty string (fail-closed)**

- **Type:** unit
- **Harness:** Direct (no fetcher call expected)
- **Actions:** `provider.validateToken('')`
- **Expected outcome:** `null` without calling the fetcher. Source of truth: plan Task 8, step 1 — early return on empty.
- **Interactions:** None (no fetch call should occur)

---

**T71 — `validateAgentKey` always returns null**

- **Type:** unit
- **Harness:** Direct
- **Actions:** `provider.validateAgentKey('aak_somekey')`
- **Expected outcome:** `null`. Source of truth: plan Task 8, step 1 — CSS auth server issues user tokens, not agent keys.
- **Interactions:** None

---

## Coverage Summary

### Action Space Covered

| Surface | Tests |
|---------|-------|
| `GET /authorize` — valid client + URI → Google redirect | T1, T2, T51 |
| `GET /authorize` — unknown site → 400 | T49 |
| `GET /authorize` — disallowed redirect_uri → 400 | T50 |
| `GET /authorize` — http wildcard → 400 | T53 |
| `GET /authorize` — plain PKCE rejected | T52 |
| `POST /internal/token/validate` — no secret → 401 | T54 |
| `POST /internal/token/validate` — invalid token → active:false | T3, T55 |
| `POST /internal/token/validate` — valid token → active:true | T3 |
| `GET /health` → 200 | T48, T67 |
| `GET /internal/site-auth-config/:siteId` — known site | T6 |
| `GET /internal/site-auth-config/:siteId` — 404 | T7 |
| `GET /internal/site-auth-config/:siteId` — empty origins | T7b |
| `GET /internal/site-auth-config/:siteId` — DB error → 500 | T7c |
| `GET /internal/site-auth-config/:siteId` — auth required | T7d |
| `allowedOrigins` API CRUD (site create/update/get) | T5, T63–T66 |
| Origin validator — all matching cases | T19–T33 |
| Origin validator — property invariants | T34–T37 |
| `lookupSiteAuthConfig` — happy path + error paths | T8, T9 |
| `CSSAuthIdentityProvider.canVerifyToken` routing | T12–T14, T68, T69 |
| `CSSAuthIdentityProvider.validateToken` — all paths | T10, T11, T16–T18, T70 |
| `CSSAuthIdentityProvider.validateAgentKey` | T71 |
| `MultiProviderIdentityProvider` routing | T4, T15 |
| OAuthProvider configuration constants | T39–T47 |
| Google handler — all 3 functions | T56–T62 |
| Performance: `validateToken` < 100ms | T38 |
| End-to-end scenario | T1–T5 |
| Regression: existing test suite | T63 |
| upsertClient: direct KV write for new + updateClient for existing | T45 (source inspection), T2 (miniflare flow) |

### Explicitly Excluded

| Area | Rationale |
|------|-----------|
| Full authorize→callback→token E2E (real Google) | Requires live Google credentials; mocked at boundary instead |
| `oauthHelpers.createClient()` behavior | Correctly excluded — plan documents this is unused (ignores clientId) |
| Auth0 identity provider integration | Out of scope per user decision: design for it, don't build it |
| Admin UI for origin management | Not built in this phase |
| HMAC state signing | Documented as known residual; tracked in PROGRESS.md |
| KV namespace provisioning commands | Operator concern; not automated |
| Production load / concurrent-request scenarios | Deferred to pre-launch load testing |

### Residual Risks from Exclusions

1. **No real Google OAuth end-to-end test**: The callback handler's `exchangeGoogleCode` call is mocked in all tests. A real integration test (requiring live credentials) is not part of this plan. Risk: misconfigured `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` secrets will only surface at deploy time.

2. **State parameter forgery**: HMAC signing of the state parameter is not implemented. A forged state could redirect a user's authorization to a registered URI that wasn't their origin. The plan documents this as a known residual and the risk is low (no privilege escalation possible), but it should be addressed before high-traffic launch.

3. **Wildcard matching edge cases beyond `fast-check` generators**: The property tests use `fc.domain()` which generates well-formed domains. Adversarial inputs like `%2e` URL-encoded dots are not tested. Risk: low, as the Cloudflare runtime URL parser normalizes these.
