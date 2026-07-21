# PCC-3191 MCP Auth Migration — Test Plan

> **Superseded.** This is a point-in-time planning document. The delivered test suite diverged from it; see the divergence banner in the implementation plan and `PROGRESS.md` (PCC-3191). Most notably, the source-inspection tests planned here (`worker-config.spec.ts` Tests 85/87, `oauth-integration.spec.ts` Tests 48-52) were dropped as change-detectors. The `auth0-handler` and `api-client` unit tests landed as planned; new behavioral suites (`state-signing`, `oauth-state-binding`, `token-refresh`, `token-lifecycle`, `agent-passthrough`) cover the work this plan did not anticipate.

**Date:** 2026-05-16
**Branch:** pcc-3191-mcp-auth-migration
**Implementation plan:** `docs/plans/2026-05-16-pcc-3191-mcp-auth-migration.md`

---

## Strategy reconciliation

The agreed testing strategy called for unit tests against harnesses and integration tests via Miniflare or mock patterns. After reading the implementation plan and the existing test suite, one adjustment is warranted and is within scope:

**Adjustment: No new Miniflare harness.** The plan explicitly states that `@cloudflare/workers-oauth-provider` uses `cloudflare:` protocol imports that do not work in Vitest's Node.js runtime, and that the existing test suite already uses source-inspection tests (Tests 42–47) for this reason. A Miniflare harness would require adding `@cloudflare/vitest-pool-workers` and `workerd` to the dev dependencies — a non-trivial change outside this plan's scope. All harness-dependent integration tests are expressed as source-inspection assertions (confirmed by the existing pattern) or as unit tests against the isolated modules, which is the approach already used and approved.

**No strategy changes require user approval.** The adjustment reduces scope relative to the agreed strategy (no new harness to build), rather than adding cost or external dependencies.

---

## Harness requirements

No new harnesses are required. The existing test patterns are sufficient:

1. **Vitest unit tests with `vi.fn()` fetch mocking** — already used in `api-client.spec.ts`, `auth/google-handler.spec.ts`. All isolation tests for `McpApiClient` and `auth0-handler` use this pattern.

2. **Source-inspection tests** — already used in `oauth-integration.spec.ts` (Tests 42–47) and `worker-config.spec.ts`. These read the source file and assert that specific strings are present or absent. Used where Cloudflare runtime imports prevent direct instantiation.

3. **`node:fs` source-inspection** — already present in `oauth-integration.spec.ts`. Tests 48–52 in the plan follow the exact same pattern.

---

## Test plan

Tests are ordered by quality impact: scenario/integration tests first, then unit tests, then boundary tests, then regression guards.

---

### 1. API client sends `Authorization: Bearer` when Auth0 token is provided
- **Type:** Integration
- **Harness:** Vitest unit test with `vi.fn()` fetch mock
- **Source of truth:** Plan D1, D2, Task 3 spec — `accessToken` present → `Authorization: Bearer <token>` header
- **Preconditions:** `McpApiClient` constructed with `accessToken: 'auth0-access-token-xyz'`, no `agentApiKey`
- **Actions:** Call `client.listSites()`
- **Expected outcome:**
  - `fetch` called once
  - `options.headers['Authorization']` === `'Bearer auth0-access-token-xyz'`
  - `options.headers['X-API-Key']` is `undefined`
- **Interactions:** `McpApiClientConfig` type (must have `accessToken` field); `getHeaders()` branching logic
- **File:** `tests/shared/api-client.spec.ts`

---

### 2. API client does NOT send `X-Acting-User-*` headers in Bearer mode
- **Type:** Integration
- **Harness:** Vitest unit test with `vi.fn()` fetch mock
- **Source of truth:** Plan Task 3, `getHeaders()` spec — identity is in the token when `accessToken` is present; acting-user headers omitted
- **Preconditions:** `McpApiClient` constructed with `accessToken: 'auth0-access-token-xyz'` AND `actingUser: { id: 'user-123', email: 'user@example.com' }`
- **Actions:** Call `client.listSites()`
- **Expected outcome:**
  - `options.headers['X-Acting-User-Id']` is `undefined`
  - `options.headers['X-Acting-User-Email']` is `undefined`
- **Interactions:** `actingUser` field still accepted by constructor but suppressed in headers when `accessToken` is present
- **File:** `tests/shared/api-client.spec.ts`

---

### 3. Legacy `agentApiKey` path still sends `X-API-Key` and `X-Acting-User-*` (local dev regression guard)
- **Type:** Regression
- **Harness:** Vitest unit test with `vi.fn()` fetch mock
- **Source of truth:** Plan Task 3 — `agentApiKey` field retained for local dev; its header behavior is preserved
- **Preconditions:** `McpApiClient` constructed with `agentApiKey: 'aak_test-key'` and `actingUser: { id: 'user-123', email: 'user@example.com' }`, no `accessToken`
- **Actions:** Call `client.listSites()`
- **Expected outcome:**
  - `options.headers['X-API-Key']` === `'aak_test-key'`
  - `options.headers['X-Acting-User-Id']` === `'user-123'`
  - `options.headers['X-Acting-User-Email']` === `'user@example.com'`
  - `options.headers['Authorization']` is `undefined`
- **Interactions:** `McpHandlerConfig.agentApiKey` still wired through when set
- **File:** `tests/shared/api-client.spec.ts`

---

### 4. MCP handler creates `McpApiClient` with `accessToken` from `props.auth0AccessToken`
- **Type:** Integration (source inspection)
- **Harness:** Source-inspection via `node:fs`
- **Source of truth:** Plan Task 4 Step 3f — `mcpApiHandler` passes `accessToken: props.auth0AccessToken` to `createMcpServer`
- **Preconditions:** `src/index.ts` and `src/mcp-handler.ts` have been updated
- **Actions:** Read `src/mcp-handler.ts` source; assert `accessToken` appears as a field passed to `McpApiClient`
- **Expected outcome:**
  - `mcpHandlerSource` contains `'accessToken'`
  - `mcpHandlerSource` does NOT contain `'agentApiKey: config.agentApiKey'` (no longer wired from `env.AGENT_API_KEY`)
- **Interactions:** `McpHandlerConfig` type; `createMcpServer` call site in `index.ts`
- **File:** `tests/auth/oauth-integration.spec.ts` (Test 51)

---

### 5. `/authorize` redirects to Auth0, not Google
- **Type:** Integration (source inspection)
- **Harness:** Source-inspection via `node:fs`
- **Source of truth:** Plan D3, Task 4 Step 3d — `/authorize` uses `getAuth0AuthorizationUrl`, not `getGoogleAuthorizationUrl`
- **Preconditions:** `src/index.ts` updated
- **Actions:** Read `src/index.ts`; assert import and call site
- **Expected outcome:**
  - Source contains `'getAuth0AuthorizationUrl'`
  - Source does NOT contain `'getGoogleAuthorizationUrl'`
- **Interactions:** Auth0 handler module; import graph
- **File:** `tests/auth/oauth-integration.spec.ts` (Test 48)

---

### 6. `UserProps` stores `auth0AccessToken` from the code exchange
- **Type:** Integration (source inspection)
- **Harness:** Source-inspection via `node:fs`
- **Source of truth:** Plan Task 4 Step 3b — `UserProps` interface gains `auth0AccessToken: string`; callback stores `auth0Result.accessToken` in props
- **Preconditions:** `src/index.ts` updated
- **Actions:** Read `src/index.ts`; assert `auth0AccessToken` appears in source
- **Expected outcome:**
  - Source contains `'auth0AccessToken'`
- **Interactions:** `UserProps` interface; `completeAuthorization` call in `/callback`; `mcpApiHandler` reading `props.auth0AccessToken`
- **File:** `tests/auth/oauth-integration.spec.ts` (Test 50)

---

### 7. MCP handler returns 401 when `ctx.props` is undefined — no AGENT_API_KEY fallback
- **Type:** Integration (source inspection) + Security invariant
- **Harness:** Source-inspection via `node:fs`
- **Source of truth:** Plan Task 4 Step 3f — `mcpApiHandler` must return `{ status: 401 }` when `props === undefined`; must not reference `env.AGENT_API_KEY` or `env.AGENT_ID`
- **Preconditions:** `src/index.ts` updated
- **Actions:** Read `src/index.ts`; assert guard and absence of fallback
- **Expected outcome:**
  - Source contains `'status: 401'`
  - Source does NOT contain `'env.AGENT_API_KEY'`
  - Source does NOT contain `'env.AGENT_ID'`
- **Interactions:** Security boundary — this is the guard that closes the PCC-3191 vulnerability
- **File:** `tests/auth/oauth-integration.spec.ts` (Test 52)

---

### 8. RFC 9728 `/.well-known/oauth-protected-resource` endpoint returns correct JSON structure
- **Type:** Integration (source inspection)
- **Harness:** Source-inspection via `node:fs`
- **Source of truth:** RFC 9728 §3.1, Plan D5, Task 4 Step 3c — endpoint must return JSON with `resource`, `authorization_servers`, and `bearer_methods_supported` keys
- **Preconditions:** `src/index.ts` updated
- **Actions:** Read `src/index.ts`; assert pathname match and JSON key presence
- **Expected outcome:**
  - Source contains `'/.well-known/oauth-protected-resource'`
  - Source contains `'"resource"'`
  - Source contains `'"authorization_servers"'`
  - Source contains `'"bearer_methods_supported"'`
- **Interactions:** `env.PUBLIC_ORIGIN`; `env.AUTH0_ISSUER_BASE_URL`; MCP client discovery flow
- **File:** `tests/auth/oauth-integration.spec.ts` (Test 49)

---

### 9. Auth0 authorization URL includes all required OAuth parameters
- **Type:** Unit
- **Harness:** Vitest unit test (no fetch mock needed — pure URL construction)
- **Source of truth:** RFC 6749 §4.1.1, Plan Task 1 Step 1
- **Preconditions:** `src/auth/auth0-handler.ts` exists
- **Actions:** Call `getAuth0AuthorizationUrl({ issuerBaseUrl, clientId, redirectUri, state, scope })`
- **Expected outcome:**
  - Returned URL hostname is the auth0 issuer hostname
  - Pathname is `/authorize`
  - `client_id` === provided value
  - `redirect_uri` === provided value
  - `response_type` === `'code'`
  - `scope` === provided value
  - `state` === provided value
- **Interactions:** None — pure function
- **File:** `tests/auth/auth0-handler.spec.ts`

---

### 10. Auth0 authorization URL includes `resource` parameter when provided (RFC 8707)
- **Type:** Unit
- **Harness:** Vitest unit test
- **Source of truth:** RFC 8707 §2, Plan D6, Task 1 Step 1
- **Preconditions:** `src/auth/auth0-handler.ts` exists
- **Actions:** Call `getAuth0AuthorizationUrl` with `resource: 'https://mcp.example.com'`
- **Expected outcome:**
  - URL contains `resource=https%3A%2F%2Fmcp.example.com` (or equivalent encoded form)
  - Parsed `searchParams.get('resource')` === `'https://mcp.example.com'`
- **Interactions:** None — pure function
- **File:** `tests/auth/auth0-handler.spec.ts`

---

### 11. Auth0 authorization URL includes `audience` when provided
- **Type:** Unit
- **Harness:** Vitest unit test
- **Source of truth:** Auth0 API audience parameter docs; Plan Task 1 Step 1
- **Preconditions:** `src/auth/auth0-handler.ts` exists
- **Actions:** Call `getAuth0AuthorizationUrl` with `audience: 'https://api.example.com'`
- **Expected outcome:**
  - Parsed `searchParams.get('audience')` === `'https://api.example.com'`
- **Interactions:** None — pure function
- **File:** `tests/auth/auth0-handler.spec.ts`

---

### 12. Auth0 handler strips trailing slashes from issuer URL
- **Type:** Boundary
- **Harness:** Vitest unit test
- **Source of truth:** Plan Task 1 Step 1 — `normalizeIssuer()` strips trailing slashes to prevent `//authorize` in URL
- **Preconditions:** `src/auth/auth0-handler.ts` exists
- **Actions:** Call `getAuth0AuthorizationUrl` with `issuerBaseUrl: 'https://example.auth0.com///'`
- **Expected outcome:**
  - Returned URL does NOT contain `'//authorize'`
  - Pathname is exactly `/authorize` (one slash)
- **Interactions:** None — pure normalization
- **File:** `tests/auth/auth0-handler.spec.ts`

---

### 13. Auth0 code exchange returns `accessToken` and user object on success
- **Type:** Unit
- **Harness:** Vitest unit test with `vi.fn()` fetch mock
- **Source of truth:** Auth0 token endpoint spec; Plan Task 1 Step 1 — `exchangeAuth0Code` returns `{ accessToken, user: { sub, email } }`
- **Preconditions:** `src/auth/auth0-handler.ts` exists; fetch mocked to return valid token response with ID token JWT
- **Actions:** Call `exchangeAuth0Code({ code, issuerBaseUrl, clientId, clientSecret, redirectUri })`
- **Expected outcome:**
  - Returns `{ accessToken: 'at_abc', user: { sub: 'auth0|user123', email: 'user@example.com' } }`
- **Interactions:** `fetch` → Auth0 token endpoint; ID token payload decoding
- **File:** `tests/auth/auth0-handler.spec.ts`

---

### 14. Auth0 code exchange throws descriptively on non-ok HTTP response
- **Type:** Boundary
- **Harness:** Vitest unit test with `vi.fn()` fetch mock
- **Source of truth:** Plan Task 1 Step 1 — error path must throw with `'Auth0 token exchange failed'` prefix
- **Preconditions:** `src/auth/auth0-handler.ts` exists; fetch mocked to return `{ ok: false, status: 401 }`
- **Actions:** Call `exchangeAuth0Code` with any valid params
- **Expected outcome:**
  - Throws an error containing `'Auth0 token exchange failed'`
- **Interactions:** Error propagation from `exchangeAuth0Code` to `mcpApiHandler` callback
- **File:** `tests/auth/auth0-handler.spec.ts`

---

### 15. `McpApiClient` constructor throws when neither `agentApiKey` nor `accessToken` is provided
- **Type:** Boundary
- **Harness:** Vitest unit test
- **Source of truth:** Plan Task 3 — constructor must throw if both absent; error message contains `'either agentApiKey or accessToken'`
- **Preconditions:** `src/shared/api-client.ts` and `src/shared/types.ts` updated
- **Actions:** Call `new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'agent-uuid-1' })` with neither key
- **Expected outcome:**
  - Throws `Error` with message matching `'either agentApiKey or accessToken'`
- **Interactions:** Constructor guard logic
- **File:** `tests/shared/api-client.spec.ts`

---

### 16. `McpApiClient` constructor does NOT throw when only `accessToken` is provided
- **Type:** Boundary
- **Harness:** Vitest unit test
- **Source of truth:** Plan Task 3 — `accessToken` alone is sufficient; constructor accepts it without `agentApiKey`
- **Preconditions:** `src/shared/api-client.ts` and `src/shared/types.ts` updated
- **Actions:** Call `new McpApiClient({ baseUrl: '...', agentId: '...', accessToken: 'auth0-token-xyz' })`
- **Expected outcome:**
  - No exception thrown
  - `client` is defined
- **Interactions:** None — constructor validation only
- **File:** `tests/shared/api-client.spec.ts`

---

### 17. `types.ts` declares Auth0 env fields and not retired Google/AGENT fields
- **Type:** Regression (source inspection)
- **Harness:** Source-inspection via `node:fs`
- **Source of truth:** Plan D7, Task 2 Step 3 — `Env` interface must include `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_ISSUER_BASE_URL`, `PUBLIC_ORIGIN`, `COOKIE_ENCRYPTION_KEY`; must exclude `AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Preconditions:** `src/types.ts` updated
- **Actions:** Read `src/types.ts`; assert presence and absence
- **Expected outcome:**
  - Source contains each of: `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_ISSUER_BASE_URL`, `PUBLIC_ORIGIN`, `COOKIE_ENCRYPTION_KEY`
  - Source does NOT contain any of: `AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Interactions:** TypeScript compiler — any remaining reference to retired fields in `index.ts` or `mcp-handler.ts` will produce a type error caught by `pnpm typecheck`
- **File:** `tests/config/worker-config.spec.ts` (Test 85)

---

### 18. `.dev.vars.example` documents Auth0 secrets and not retired secrets
- **Type:** Regression (source inspection)
- **Harness:** Source-inspection via `node:fs`
- **Source of truth:** Plan Task 2 Step 4 — `.dev.vars.example` must document Auth0 credentials; must not document retired credentials
- **Preconditions:** `.dev.vars.example` updated
- **Actions:** Read `.dev.vars.example`; assert presence and absence
- **Expected outcome:**
  - File contains each of: `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_ISSUER_BASE_URL`, `COOKIE_ENCRYPTION_KEY`
  - File does NOT contain any of: `AGENT_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Interactions:** Developer onboarding — this file is the first thing a new developer reads when setting up local secrets
- **File:** `tests/config/worker-config.spec.ts` (Test 87)

---

### 19. Google handler source file and test file are deleted — no dangling imports
- **Type:** Regression
- **Harness:** Bash (grep / filesystem check), plus Vitest test run (import failure would appear as an error)
- **Source of truth:** Plan Task 4 Step 5 — `src/auth/google-handler.ts` and `tests/auth/google-handler.spec.ts` deleted after `index.ts` no longer imports from them
- **Preconditions:** Task 4 Step 3a removes imports; deletion complete
- **Actions:**
  1. `grep -rn 'google-handler' workers/mcp-server/src/ workers/mcp-server/tests/` — expect no output (`clean`)
  2. `ls workers/mcp-server/src/auth/google-handler.ts` — expect file not found
  3. `ls workers/mcp-server/tests/auth/google-handler.spec.ts` — expect file not found
- **Expected outcome:**
  - No remaining references to `google-handler` in source or test directories
  - Both files absent from the filesystem
- **Interactions:** Vitest would report an import error if `google-handler.spec.ts` survived with its `import('../../src/auth/google-handler.js')` calls pointing at a deleted file
- **File:** Bash verification step + confirmed by `pnpm test` not failing on a missing import

---

### 20. Pre-existing baseline failures remain at exactly the known count
- **Type:** Invariant
- **Harness:** `pnpm test` in both `workers/mcp-server/` and `workers/`
- **Source of truth:** Plan "Pre-existing baseline failures" section — exactly 3 failures (1 in `create-page.spec.ts`, 2 in `allowlist-agent-acting.spec.ts`) are pre-existing and must not change
- **Preconditions:** All tasks 1–4 complete; PROGRESS.md updated
- **Actions:**
  1. `cd workers/mcp-server && pnpm test` — count failures; assert exactly 1 (`create-page.spec.ts` race condition)
  2. `cd workers && pnpm test tests/routes/allowlist-agent-acting.spec.ts` — count failures; assert exactly 2
- **Expected outcome:**
  - MCP server suite: exactly 1 failure in `create-page.spec.ts`; all other tests pass
  - Backend suite (allowlist test): exactly 2 failures in `allowlist-agent-acting.spec.ts`; these must not have become 0 (that would indicate an unintended side-effect) or increased (that would indicate a regression)
- **Interactions:** This test guards against both regressions (new failures introduced) and unexpected side-effects (pre-existing failures silently fixed in ways that mask related problems)

---

### 21. TypeScript compilation produces zero errors after all changes
- **Type:** Invariant
- **Harness:** `pnpm typecheck` in `workers/mcp-server/`
- **Source of truth:** Plan Task 6 Step 2 — after all source changes, TypeScript must produce 0 errors
- **Preconditions:** All tasks 1–4 complete
- **Actions:** `cd workers/mcp-server && pnpm typecheck`
- **Expected outcome:**
  - Exit code 0
  - Zero type errors reported
- **Interactions:** All type changes (removed `AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; added `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_ISSUER_BASE_URL`, `PUBLIC_ORIGIN`, `accessToken` on `McpApiClientConfig`, etc.) must be consistent across all files

---

### 22. Linting produces zero errors after all changes
- **Type:** Invariant
- **Harness:** `pnpm lint` in `workers/mcp-server/`
- **Source of truth:** CLAUDE.md development guidelines — lint must be 0 errors before commit
- **Preconditions:** All tasks 1–4 complete
- **Actions:** `cd workers/mcp-server && pnpm lint`
- **Expected outcome:**
  - Exit code 0
  - Zero lint errors
- **Interactions:** ESLint may flag unused imports if any old Google handler references remain after the deletion

---

## Coverage summary

### Covered

| Area | Tests covering it |
|---|---|
| Auth0 authorization URL construction and parameters | Tests 9, 10, 11, 12 |
| Auth0 code exchange — success and error paths | Tests 13, 14 |
| `McpApiClient` Bearer token path (sends correct headers) | Tests 1, 2 |
| `McpApiClient` legacy `agentApiKey` path (no regression) | Test 3 |
| `McpApiClient` constructor validation | Tests 15, 16 |
| `mcpApiHandler` token forwarding path | Tests 4, 6 |
| `/authorize` → Auth0 redirect | Test 5 |
| RFC 9728 `/.well-known/oauth-protected-resource` | Test 8 |
| RFC 8707 `resource` parameter in Auth0 URL | Test 10 |
| 401 guard when `ctx.props` is undefined | Test 7 |
| `types.ts` declares Auth0 fields, not retired fields | Test 17 |
| `.dev.vars.example` updated | Test 18 |
| Google handler removed cleanly | Test 19 |
| Pre-existing failures unchanged | Test 20 |
| TypeScript type safety | Test 21 |
| Linting | Test 22 |

### Explicitly excluded per agreed strategy

| Area | Reason |
|---|---|
| Live Auth0 token validation (real JWKS) | Requires `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_ISSUER_BASE_URL` — ops secrets not available in CI. Documented as a known gap in the implementation plan. |
| End-to-end browser OAuth flow | Would require Miniflare + live Auth0 tenant; not in scope. Risk: low — the individual steps (URL construction, code exchange, token storage, header forwarding) are tested in isolation |
| Full HTTP worker integration test via Miniflare | `@cloudflare/workers-oauth-provider` uses `cloudflare:` imports incompatible with Vitest Node.js runtime. Risk: covered by the plan's source-inspection tests on `index.ts` |
| `allowlist-agent-acting.spec.ts` backend tests | Pre-existing failures on `auth-broker` branch; fix is a separate follow-up PR |
| `create-page.spec.ts` race condition | Pre-existing test bug from commit `2598120`; fix is out of scope |

### Risk from exclusions

The biggest residual risk is the live Auth0 token validation path. In production, `Auth0IdentityProvider` in the CSS backend must successfully validate the token forwarded by the MCP server. This path is not exercised by any test in this plan — it relies on the backend's existing `Auth0IdentityProvider` tests (which use mocked JWKS) and the correctness of the Auth0 access token shape. The risk is acceptable given the pre-existing coverage on the backend and the fact that token forwarding itself is tested (the correct header is sent).
