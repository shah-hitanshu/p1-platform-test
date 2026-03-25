# Remote MCP Server with OAuth (C1-C4) -- Test Plan

**Date:** 2026-03-23
**Feature:** Remote MCP Server with OAuth 2.0 authentication, acting-user forwarding, and infrastructure
**Phases:** C1 (Streamable HTTP transport), C2 (OAuth 2.0), C3 (Acting-user forwarding), C4 (Infrastructure)
**Est. tests:** ~140

---

## Strategy Reconciliation

The implementation plan was reviewed against the agreed testing strategy. Key findings:

1. **Tool handler count:** The strategy assumed 9 tools; the plan registers all 11 (including `get_branch_presence`, `get_document_presence`). Tests updated to verify 11 tools. This does not change cost.

2. **`@cloudflare/workers-oauth-provider` abstracts token storage:** The strategy included "Session/token KV storage" tests. Per Decision D3, the library owns token lifecycle internally. We cannot test KV storage directly without reaching into library internals. Instead, we test the observable behavior: valid tokens grant access, expired/revoked tokens are rejected, and discovery metadata is well-formed. The `session.spec.ts` file in the original strategy is replaced by token lifecycle tests in `oauth-integration.spec.ts`. No cost change.

3. **Reference comparison harness:** The strategy specified comparing remote MCP tool handlers against the local stdio server. Since the plan copies and adapts tool definitions (not importing them), a true differential test would require running both servers. Instead, we use a structural comparison: verify the remote server's `getToolDefinitions()` returns the same 11 tool names, descriptions, and schema shapes as the reference `examples/collaborative-state-mcp/src/tools.ts`. This is cheaper and catches the real risk (drift during copy). No cost change.

4. **OAuth integration tests use mocked OAuthProvider internals:** The `@cloudflare/workers-oauth-provider` wraps the Worker's `fetch` handler. Testing the full OAuth flow end-to-end at the unit level requires mocking the library's token validation. The plan's Task 4 notes "IMPORTANT: Consult the actual `@cloudflare/workers-oauth-provider` API" -- the test harness must be adapted to whatever API shape the library exposes. Tests specify functional assertions; the executing agent will adapt mock construction to the actual API.

5. **`getEffectiveRole` modification for permission intersection:** The plan adds `getActingUserSiteRole()` which queries the database. The permission intersection tests must mock `query()` to control acting-user role lookup results. This is consistent with the existing `authorization.spec.ts` pattern.

6. **Audit context tests:** The `createAuditEvent` function already passes `context` through as-is. The plan confirms acting-user data goes in `context`. The audit test simply verifies the existing passthrough behavior includes acting-user fields -- it should pass without code changes (as noted in the plan, Step 4).

No strategy changes requiring user approval.

---

## Harness Definitions

### H1: Vitest + Mocked Fetch (Direct API harness)

**Used by:** API client tests, tool handler tests, Google auth handler tests
**What it does:** Replaces global `fetch` with `vi.fn()`, allowing tests to control HTTP responses without network access.
**Setup:** `const mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch);`
**Reset:** `vi.resetAllMocks()` in `beforeEach`

### H2: Vitest + Mocked DB Query (Backend integration harness)

**Used by:** Acting-user extraction tests, permission intersection tests, audit tests
**What it does:** Mocks `query()` from `../../src/db` to control database query results.
**Setup:** `vi.mock('../../src/db', () => ({ query: vi.fn() }));`
**Reset:** `vi.resetAllMocks()` in `beforeEach`

### H3: Vitest + Structural Comparison (Reference comparison harness)

**Used by:** Tool definition comparison tests
**What it does:** Imports `getToolDefinitions()` from both the reference (`examples/collaborative-state-mcp/src/tools.ts`) and the new Worker (`workers/mcp-server/src/shared/tools.ts`), comparing names, descriptions, and schema shapes.
**Limitation:** Requires both modules to be importable from the test environment. If import paths differ, the test will use filesystem reads of the source files as a fallback.

### H4: Vitest + Filesystem (Config validation harness)

**Used by:** Wrangler config tests, Terraform validation tests
**What it does:** Reads configuration files from disk and validates structure, required fields, and cross-references.
**Setup:** `readFileSync()` from `node:fs`

### H5: Vitest + Mocked OAuthProvider (OAuth integration harness)

**Used by:** OAuth integration tests, E2E flow tests
**What it does:** Mocks or stubs `@cloudflare/workers-oauth-provider` to test the Worker's behavior when the library passes through authenticated requests, rejects unauthenticated requests, or serves discovery endpoints.
**Note:** Exact mock shape depends on the library's API, which must be read from `node_modules` at implementation time.

---

## Test Plan

### Test File: `workers/mcp-server/tests/shared/api-client.spec.ts`

#### 1. API client requires baseUrl, agentId, and agentApiKey

- **Name:** Creating an API client without required config fields throws an error
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Construct `McpApiClient` with empty `baseUrl`, then empty `agentId`, then empty `agentApiKey`
- **Expected outcome:** Each construction throws an error (source: reference `examples/collaborative-state-mcp/tests/api-client.spec.ts` lines 41-61, which assert the same for `ApiClient`)
- **Interactions:** None

#### 2. API client includes agent authentication headers on all requests

- **Name:** Every API request includes X-API-Key, X-Actor-Type, and X-Actor-Id headers
- **Type:** unit
- **Harness:** H1
- **Preconditions:** `McpApiClient` constructed with `agentId: 'agent-uuid-1'`, `agentApiKey: 'aak_test-key'`
- **Actions:** Call `client.listSites()`, inspect `mockFetch.mock.calls[0][1].headers`
- **Expected outcome:** Headers contain `X-API-Key: aak_test-key`, `X-Actor-Type: agent`, `X-Actor-Id: agent-uuid-1` (source: reference `api-client.ts` lines 214-221, which defines `getHeaders()`)
- **Interactions:** Exercises mock fetch boundary

#### 3. Acting-user headers are included when actingUser is set

- **Name:** When actingUser is provided, requests include X-Acting-User-Id and X-Acting-User-Email headers
- **Type:** scenario
- **Harness:** H1
- **Preconditions:** `McpApiClient` constructed with `actingUser: { id: 'user-123', email: 'user@example.com' }`
- **Actions:** Call `client.listSites()`, inspect headers on the outgoing fetch request
- **Expected outcome:** Headers contain `X-Acting-User-Id: user-123` and `X-Acting-User-Email: user@example.com` (source: implementation plan Task 2 Step 1, Decision D4)
- **Interactions:** Exercises mock fetch boundary

#### 4. Acting-user headers are absent when actingUser is not set

- **Name:** Without actingUser, requests do not include acting-user headers
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** `McpApiClient` constructed without `actingUser`
- **Actions:** Call `client.listSites()`, inspect headers
- **Expected outcome:** `X-Acting-User-Id` and `X-Acting-User-Email` are both undefined/absent (source: implementation plan Task 2 Step 1)
- **Interactions:** Exercises mock fetch boundary

#### 5. listSites calls correct URL with GET method

- **Name:** listSites sends GET to /api/sites
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ sites: [], total: 0 }`
- **Actions:** Call `client.listSites()`
- **Expected outcome:** Fetch called with `http://localhost:8787/api/sites` and method `GET` (source: reference `api-client.ts` line 283-284)
- **Interactions:** None

#### 6. listBranches calls correct URL with site ID

- **Name:** listBranches sends GET to /api/sites/{siteId}/branches
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ branches: [], total: 0 }`
- **Actions:** Call `client.listBranches('site-123')`
- **Expected outcome:** Fetch called with `http://localhost:8787/api/sites/site-123/branches` (source: reference `api-client.ts` line 297)
- **Interactions:** None

#### 7. listDocuments calls correct URL with site and branch IDs

- **Name:** listDocuments sends GET to /api/sites/{siteId}/branches/{branchId}/documents
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ documents: [] }`
- **Actions:** Call `client.listDocuments('site-123', 'branch-456')`
- **Expected outcome:** Fetch called with `http://localhost:8787/api/sites/site-123/branches/branch-456/documents` (source: reference `api-client.ts` line 311)
- **Interactions:** None

#### 8. getDocument URL-encodes document path

- **Name:** getDocument encodes the document path in the URL
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ snapshot: {} }`
- **Actions:** Call `client.getDocument('site-123', 'branch-456', '/home')`
- **Expected outcome:** Fetch URL contains `%2Fhome` (source: reference `api-client.ts` line 260-261 `encodeURIComponent`)
- **Interactions:** None

#### 9. canAgentEdit sends POST with agent context headers and body

- **Name:** canAgentEdit sends POST with agent edit headers and request body
- **Type:** integration
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ allowed: true }`
- **Actions:** Call `client.canAgentEdit({ siteId, branchId, documentPath, intent, targetRegions, trigger: 'autonomous' })`
- **Expected outcome:** Fetch method is POST, URL ends with `/can-agent-edit`, headers include `X-Agent-Id`, `X-Agent-Trigger`, `X-Agent-Intent`, `X-Agent-Target-Regions`, body includes `agentId`, `trigger`, `intent`, `targetRegions` (source: reference `api-client.ts` lines 342-380)
- **Interactions:** None

#### 10. startAgentEdit sends POST with agent context and returns session info

- **Name:** startAgentEdit returns editSessionId, checkpointId, expiresAt, reservedRegions
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ editSessionId: 'sess-1', checkpointId: 'cp-1', expiresAt: '...', reservedRegions: ['/content'] }`
- **Actions:** Call `client.startAgentEdit({...})`
- **Expected outcome:** Result matches mock response fields (source: reference `api-client.ts` lines 385-416)
- **Interactions:** None

#### 11. applyEdits sends operations with editSessionId

- **Name:** applyEdits sends operations array and editSessionId in the request body
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ success: true, version: 2 }`
- **Actions:** Call `client.applyEdits({...operations, editSessionId: 'sess-1'})`
- **Expected outcome:** Body contains `operations`, `actorId`, and `editSessionId` (source: reference `api-client.ts` lines 424-443)
- **Interactions:** None

#### 12. completeAgentEdit sends POST with editSessionId

- **Name:** completeAgentEdit sends editSessionId and returns checkpointId
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ success: true, checkpointId: 'cp-after-1' }`
- **Actions:** Call `client.completeAgentEdit({...})`
- **Expected outcome:** Body is `{ editSessionId: '...' }`, headers include `X-Agent-Id` (source: reference `api-client.ts` lines 448-468)
- **Interactions:** None

#### 13. abortAgentEdit sends POST with editSessionId and optional reason

- **Name:** abortAgentEdit sends editSessionId and reason, returns rollback status
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ success: true, rolledBack: true }`
- **Actions:** Call `client.abortAgentEdit({..., reason: 'cancelled'})`
- **Expected outcome:** Body contains `editSessionId` and `reason` (source: reference `api-client.ts` lines 473-496)
- **Interactions:** None

#### 14. getBranchPresence calls correct URL

- **Name:** getBranchPresence sends GET to /api/sites/{siteId}/branches/{branchId}/presence
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns presence response
- **Actions:** Call `client.getBranchPresence('site-123', 'branch-456')`
- **Expected outcome:** Correct URL with GET method (source: reference `api-client.ts` lines 505-517)
- **Interactions:** None

#### 15. getDocumentPresence calls correct URL with encoded path

- **Name:** getDocumentPresence sends GET to presence endpoint with encoded document path
- **Type:** unit
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ presences: [] }`
- **Actions:** Call `client.getDocumentPresence('site-123', 'branch-456', '/home')`
- **Expected outcome:** URL contains `%2Fhome/presence` (source: reference `api-client.ts` lines 527-536)
- **Interactions:** None

#### 16. Non-200 responses throw with error message

- **Name:** API errors throw with the error message from the response body
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ ok: false, status: 404, json: { error: 'Not found' } }`
- **Actions:** Call `client.listSites()`
- **Expected outcome:** Throws error with message containing 'Not found' (source: reference `api-client.ts` lines 268-277)
- **Interactions:** None

#### 17. Trailing slash is stripped from baseUrl

- **Name:** Client strips trailing slash from baseUrl to prevent double-slash in URLs
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** Construct with `baseUrl: 'http://localhost:8787/'`
- **Actions:** Call `client.listSites()`, inspect URL
- **Expected outcome:** URL is `http://localhost:8787/api/sites`, not `http://localhost:8787//api/sites` (source: reference `api-client.ts` line 206)
- **Interactions:** None

---

### Test File: `workers/mcp-server/tests/shared/tools.spec.ts`

#### 18. Tool definitions exports array of 11 tools

- **Name:** getToolDefinitions returns exactly 11 tool definitions
- **Type:** unit
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Call `getToolDefinitions()`
- **Expected outcome:** Array length is 11; names include all 11: `list_sites`, `list_branches`, `list_documents`, `get_document`, `check_edit_permission`, `start_edit_session`, `apply_document_edits`, `complete_edit_session`, `abort_edit_session`, `get_branch_presence`, `get_document_presence` (source: implementation plan Decision D9, reference `tools.ts` lines 117-186)
- **Interactions:** None

#### 19. Each tool definition has name, description, and inputSchema

- **Name:** Every tool definition contains required fields
- **Type:** invariant
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Iterate `getToolDefinitions()`, check each entry
- **Expected outcome:** Every entry has non-empty `name`, non-empty `description`, and defined `inputSchema` (source: reference `tools.ts` `ToolDefinition` interface)
- **Interactions:** None

#### 20. list_sites handler returns formatted site list

- **Name:** list_sites tool formats sites with UUIDs for subsequent calls
- **Type:** scenario
- **Harness:** H1
- **Preconditions:** Mock `apiClient.listSites()` returns `{ sites: [{ id: 'site-1', name: 'My Site' }], total: 1 }`
- **Actions:** Call `handlers.list_sites()`
- **Expected outcome:** Result `content[0].text` contains 'site_id: site-1' and 'My Site' (source: reference `tools.ts` lines 286-299)
- **Interactions:** Exercises `McpApiClient.listSites` mock

#### 21. list_sites handler returns message for empty list

- **Name:** list_sites shows a helpful message when no sites exist
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** Mock returns `{ sites: [], total: 0 }`
- **Actions:** Call `handlers.list_sites()`
- **Expected outcome:** Result text contains 'No sites found' (source: reference `tools.ts` line 292)
- **Interactions:** None

#### 22. get_document handler extracts region when specified

- **Name:** get_document returns only the specified region from the document snapshot
- **Type:** scenario
- **Harness:** H1
- **Preconditions:** Mock returns `{ snapshot: { content: { body: 'Hello' } } }`
- **Actions:** Call `handlers.get_document({ site_id: 's1', branch_id: 'b1', document_path: '/home', region: '/content/body' })`
- **Expected outcome:** Result text contains 'Hello', not the full document (source: reference `tools.ts` lines 343-369)
- **Interactions:** None

#### 23. apply_document_edits normalizes JSON Pointer paths to dot-notation

- **Name:** apply_document_edits converts /content/0/props to content.0.props before sending
- **Type:** integration
- **Harness:** H1
- **Preconditions:** Mock `apiClient.applyEdits()` returns `{ success: true, version: 2 }`
- **Actions:** Call `handlers.apply_document_edits({ ..., operations: [{ type: 'replace', path: '/content/0/props/title', content: 'New' }] })`
- **Expected outcome:** `apiClient.applyEdits` called with operation path `content.0.props.title` (source: reference `tools.ts` lines 425-441, `normalizePath` function)
- **Interactions:** Exercises `McpApiClient.applyEdits` mock

#### 24. Tool handlers return isError:true on API errors

- **Name:** Tool handlers catch API errors and return formatted error responses
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** Mock `apiClient.listSites()` rejects with `Error('Network failure')`
- **Actions:** Call `handlers.list_sites()`
- **Expected outcome:** Result has `isError: true`, text contains 'Error: Network failure' (source: reference `tools.ts` lines 243-249, `formatError`)
- **Interactions:** None

#### 25. get_branch_presence handler formats presence data

- **Name:** get_branch_presence returns formatted presence summary
- **Type:** scenario
- **Harness:** H1
- **Preconditions:** Mock returns branch presence with 1 document, 1 actor
- **Actions:** Call `handlers.get_branch_presence({ site_id: 's1', branch_id: 'b1' })`
- **Expected outcome:** Result includes `totalActors`, `totalDocuments`, `summary` text (source: reference `tools.ts` lines 498-529)
- **Interactions:** None

#### 26. get_document_presence handler formats actor list

- **Name:** get_document_presence returns formatted actor presence list
- **Type:** scenario
- **Harness:** H1
- **Preconditions:** Mock returns 2 actors (human editing, agent active)
- **Actions:** Call `handlers.get_document_presence({ site_id: 's1', branch_id: 'b1', document_path: '/home' })`
- **Expected outcome:** Result text contains '[agent]' and '[human]' tags, state info (source: reference `tools.ts` lines 531-563)
- **Interactions:** None

---

### Test File: `workers/mcp-server/tests/shared/reference-comparison.spec.ts`

#### 27. Remote tool definitions match reference tool definitions

- **Name:** All 11 tool names from the remote server match the reference stdio server
- **Type:** differential
- **Harness:** H3
- **Preconditions:** Both `examples/collaborative-state-mcp/src/tools.ts` and `workers/mcp-server/src/shared/tools.ts` are importable
- **Actions:** Import `getToolDefinitions()` from both modules, compare tool name sets
- **Expected outcome:** Both return the same 11 tool names. The remote version includes `get_branch_presence` and `get_document_presence` which the reference defines but the stdio server's `index.ts` never registered (source: Decision D9)
- **Interactions:** Import boundary between two independent modules

#### 28. Remote tool schemas structurally match reference schemas

- **Name:** Each tool's Zod input schema in the remote server has the same shape as the reference
- **Type:** differential
- **Harness:** H3
- **Preconditions:** Both `schemas` exports importable
- **Actions:** For each of the 11 tool names, compare the schema's `.shape` properties (field names and types)
- **Expected outcome:** All schema shapes match -- same field names, same Zod types (source: reference `tools.ts` lines 31-111)
- **Interactions:** Import boundary between two modules

---

### Test File: `workers/mcp-server/tests/mcp-handler.spec.ts`

#### 29. createMcpServer returns a defined MCP server instance

- **Name:** createMcpServer produces an MCP server ready for transport connection
- **Type:** unit
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Call `createMcpServer({ baseUrl, agentId, agentApiKey, serverName, serverVersion })`
- **Expected outcome:** Returned value is defined and has the shape of an McpServer (source: implementation plan Task 3 Step 6)
- **Interactions:** Imports `@modelcontextprotocol/sdk`

#### 30. createMcpServer registers all 11 tools

- **Name:** The MCP server registers all 11 tool handlers from the tool definitions
- **Type:** integration
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Create server via `createMcpServer()`, inspect registered tools (via `server.getCapabilities()` or similar SDK method)
- **Expected outcome:** Server has 11 registered tools matching the names from `getToolDefinitions()` (source: Decision D9, implementation plan Task 3 Step 6)
- **Interactions:** Exercises `McpServer.registerTool` from `@modelcontextprotocol/sdk`

#### 31. createMcpServer passes actingUser to McpApiClient

- **Name:** When actingUser is provided, the MCP server creates an API client with acting-user context
- **Type:** integration
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Create server with `actingUser: { id: 'u1', email: 'u@ex.com' }`, trigger a tool call, inspect outgoing fetch headers
- **Expected outcome:** Fetch includes `X-Acting-User-Id: u1` and `X-Acting-User-Email: u@ex.com` (source: implementation plan Task 3 Step 6, Task 2)
- **Interactions:** Exercises `McpApiClient` constructor and `fetch` mock

---

### Test File: `workers/mcp-server/tests/health.spec.ts`

#### 32. Health endpoint returns 200 with status healthy

- **Name:** GET /health returns a 200 response with status 'healthy'
- **Type:** scenario
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Call `handleHealthCheck('local')`
- **Expected outcome:** Response status 200, body `{ status: 'healthy', service: 'css-mcp-server', environment: 'local', timestamp: <ISO string> }` (source: implementation plan Task 3 Step 7)
- **Interactions:** None

#### 33. Health endpoint includes environment and timestamp

- **Name:** Health response includes the current environment name and a valid ISO timestamp
- **Type:** unit
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Call `handleHealthCheck('sbx1')`
- **Expected outcome:** Body `environment === 'sbx1'`, `timestamp` is a valid ISO date string (source: implementation plan Task 3 Step 7)
- **Interactions:** None

---

### Test File: `workers/mcp-server/tests/auth/google-handler.spec.ts`

#### 34. Google authorization URL contains required OAuth parameters

- **Name:** getGoogleAuthorizationUrl builds a URL with client_id, redirect_uri, state, scope, and response_type
- **Type:** unit
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Call `getGoogleAuthorizationUrl({ clientId: 'test-id', redirectUri: 'http://localhost:8788/callback', state: 'state-123', scope: 'openid email profile' })`
- **Expected outcome:** URL contains `accounts.google.com/o/oauth2/v2/auth`, `client_id=test-id`, `redirect_uri=`, `state=state-123`, `response_type=code`, `scope=` containing `openid`, `email`, `profile` (source: implementation plan Task 4 Step 5, Google OAuth2 spec)
- **Interactions:** None

#### 35. Google authorization URL uses response_type=code

- **Name:** Authorization URL requests an authorization code, not an implicit token
- **Type:** unit
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Call `getGoogleAuthorizationUrl({...})`
- **Expected outcome:** URL contains `response_type=code` (source: OAuth 2.0 Authorization Code flow, implementation plan)
- **Interactions:** None

#### 36. exchangeGoogleCode exchanges auth code for tokens and user info

- **Name:** Exchanging a valid Google auth code returns access token and decoded user claims
- **Type:** scenario
- **Harness:** H1
- **Preconditions:** Mock `fetch` to return Google token response with `access_token`, `id_token` (JWT with `sub`, `email`, `name` in payload)
- **Actions:** Call `exchangeGoogleCode({ code: 'auth-code', clientId, clientSecret, redirectUri })`
- **Expected outcome:** Result has `accessToken`, `user.sub`, `user.email`, `user.name` matching the decoded JWT payload (source: implementation plan Task 4 Step 1)
- **Interactions:** Exercises mock fetch to Google's token endpoint

#### 37. exchangeGoogleCode sends correct parameters to Google token endpoint

- **Name:** The token exchange request includes code, client_id, client_secret, redirect_uri, and grant_type
- **Type:** integration
- **Harness:** H1
- **Preconditions:** Mock fetch returns valid token response
- **Actions:** Call `exchangeGoogleCode({...})`, inspect `mockFetch.mock.calls`
- **Expected outcome:** POST to `https://oauth2.googleapis.com/token` with body containing `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code` (source: Google OAuth2 token endpoint spec)
- **Interactions:** Exercises mock fetch boundary

#### 38. exchangeGoogleCode throws on non-200 Google response

- **Name:** Token exchange throws when Google returns an error
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** Mock fetch returns `{ ok: false, status: 400, json: { error: 'invalid_grant' } }`
- **Actions:** Call `exchangeGoogleCode({...})`
- **Expected outcome:** Throws an error (source: error handling requirement)
- **Interactions:** Exercises mock fetch boundary

#### 39. decodeIdTokenClaims extracts user info from JWT payload

- **Name:** ID token payload is decoded to extract sub, email, name, and email_verified
- **Type:** unit
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Construct a mock ID token with known base64-encoded payload, call `decodeIdTokenClaims(token)`
- **Expected outcome:** Returns `{ sub: '1234567890', email: 'user@example.com', name: 'Test User', email_verified: true }` (source: implementation plan Task 4 Step 1)
- **Interactions:** None

#### 40. decodeIdTokenClaims handles base64url encoding

- **Name:** Decoder handles base64url characters (-, _) and missing padding
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Create an ID token with base64url-encoded payload containing special characters
- **Expected outcome:** Claims are correctly decoded (source: JWT specification)
- **Interactions:** None

#### 41. decodeIdTokenClaims throws on malformed token

- **Name:** Decoder throws on a token with fewer than 3 parts
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** None
- **Actions:** Call `decodeIdTokenClaims('not-a-jwt')`
- **Expected outcome:** Throws an error (source: robustness requirement)
- **Interactions:** None

---

### Test File: `workers/mcp-server/tests/auth/oauth-integration.spec.ts`

#### 42. GET /health is accessible without authentication

- **Name:** Health endpoint returns 200 without a Bearer token
- **Type:** scenario
- **Harness:** H5
- **Preconditions:** Worker instantiated with OAuthProvider wrapper
- **Actions:** Send `GET /health` without Authorization header
- **Expected outcome:** Response status 200, body contains `{ status: 'healthy' }` (source: implementation plan Task 4 Step 6 point 1)
- **Interactions:** OAuthProvider must not intercept /health

#### 43. POST /mcp without auth returns 401

- **Name:** MCP endpoint rejects unauthenticated requests
- **Type:** scenario
- **Harness:** H5
- **Preconditions:** Worker instantiated with OAuthProvider wrapper
- **Actions:** Send `POST /mcp` without Authorization header, with a JSON-RPC body
- **Expected outcome:** Response status 401 (source: implementation plan Task 4 Step 6 point 2)
- **Interactions:** Exercises OAuthProvider's token validation gate

#### 44. GET /.well-known/oauth-authorization-server returns OAuth metadata

- **Name:** OAuth discovery endpoint returns valid authorization server metadata
- **Type:** scenario
- **Harness:** H5
- **Preconditions:** Worker instantiated with OAuthProvider wrapper
- **Actions:** Send `GET /.well-known/oauth-authorization-server`
- **Expected outcome:** Response status 200, body contains `issuer`, `authorization_endpoint`, `token_endpoint`, `response_types_supported` including `code`, `grant_types_supported` including `authorization_code` (source: RFC 8414, implementation plan Task 4 Step 6 point 2)
- **Interactions:** Exercises OAuthProvider's built-in discovery handler

#### 45. Authenticated MCP request creates API client with acting-user from token claims

- **Name:** Valid Bearer token causes MCP handler to set actingUser from token props
- **Type:** integration
- **Harness:** H5
- **Preconditions:** Mock OAuthProvider passes request through with user props `{ userId: 'user-123', email: 'user@example.com' }`
- **Actions:** Send `POST /mcp` with valid Bearer token and a `tools/list` JSON-RPC request
- **Expected outcome:** The `McpApiClient` is constructed with `actingUser.id === 'user-123'` and `actingUser.email === 'user@example.com'` (source: implementation plan Task 4 Step 6 point 3)
- **Interactions:** Exercises OAuthProvider -> MCP handler -> McpApiClient chain

#### 46. Expired access token returns 401

- **Name:** Requests with an expired Bearer token are rejected
- **Type:** boundary
- **Harness:** H5
- **Preconditions:** Mock OAuthProvider rejects token as expired
- **Actions:** Send `POST /mcp` with expired Bearer token
- **Expected outcome:** Response status 401 (source: OAuth 2.0 spec, token lifecycle requirement)
- **Interactions:** Exercises OAuthProvider's token validation

#### 47. Unknown routes return 404

- **Name:** Requests to undefined paths return 404
- **Type:** boundary
- **Harness:** H5
- **Preconditions:** Worker instantiated
- **Actions:** Send `GET /nonexistent`
- **Expected outcome:** Response status 404 (source: implementation plan Task 3 Step 7, line 614)
- **Interactions:** None

---

### Test File: `workers/tests/auth/acting-user.spec.ts`

#### 48. Acting-user headers extracted for agent principals

- **Name:** extractActingUser returns userId and email from headers when principal is agent type
- **Type:** scenario
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `extractActingUser(headers_with_both_headers, { type: 'agent', id: 'agent-1' })`
- **Expected outcome:** Returns `{ actingUserId: 'user-uuid-123', actingUserEmail: 'user@example.com' }` (source: implementation plan Task 5 Step 7, Decision D4)
- **Interactions:** None

#### 49. Acting-user headers ignored for user principals

- **Name:** extractActingUser returns null when principal is user type, even if headers are present
- **Type:** scenario
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `extractActingUser(headers_with_spoofed_values, { type: 'user', id: 'user-1' })`
- **Expected outcome:** Returns `null` (source: Decision D4, "Headers from user, service, or guest principals are silently ignored")
- **Interactions:** None

#### 50. Acting-user headers ignored for service principals

- **Name:** extractActingUser returns null for service principals
- **Type:** scenario
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `extractActingUser(headers_with_values, { type: 'service', id: 'svc-1' })`
- **Expected outcome:** Returns `null` (source: Decision D4)
- **Interactions:** None

#### 51. Returns null when agent has no acting-user headers

- **Name:** extractActingUser returns null when neither header is present
- **Type:** boundary
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `extractActingUser(empty_headers, { type: 'agent', id: 'agent-1' })`
- **Expected outcome:** Returns `null` (source: implementation plan Task 5 Step 7, "if (!userId || !userEmail) return null")
- **Interactions:** None

#### 52. Returns null when only one of two required headers is present

- **Name:** extractActingUser requires both X-Acting-User-Id and X-Acting-User-Email
- **Type:** boundary
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call with only `X-Acting-User-Id` set, then with only `X-Acting-User-Email` set
- **Expected outcome:** Both return `null` (source: implementation plan Task 5 Step 7)
- **Interactions:** None

#### 53. Header spoofing by user principal is silently rejected

- **Name:** User principal cannot inject acting-user identity via headers (defense in depth)
- **Type:** invariant
- **Harness:** None (pure function test)
- **Preconditions:** Headers contain `X-Acting-User-Id: attacker-id`, `X-Acting-User-Email: attacker@evil.com`
- **Actions:** Call `extractActingUser(spoofed_headers, { type: 'user', id: 'real-user' })`
- **Expected outcome:** Returns `null` -- the spoofed headers are never extracted (source: Decision D4 security justification)
- **Interactions:** None

---

### Test File: `workers/tests/auth/permission-intersection.spec.ts`

#### 54. minRole returns lower role when user has lower role than agent

- **Name:** Permission intersection picks the less privileged role
- **Type:** unit
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `minRole('EDITOR', 'VIEWER')`
- **Expected outcome:** Returns `'VIEWER'` (source: implementation plan Task 5 Step 8, Decision D5)
- **Interactions:** None

#### 55. minRole returns agent role when user has higher role

- **Name:** Agent's role acts as ceiling even if user has more privilege
- **Type:** unit
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `minRole('EDITOR', 'ADMIN')`
- **Expected outcome:** Returns `'EDITOR'` (source: Decision D5, "the agent's role is the ceiling")
- **Interactions:** None

#### 56. minRole returns NO_ACCESS when either role is NO_ACCESS

- **Name:** NO_ACCESS dominates -- any intersection with NO_ACCESS yields NO_ACCESS
- **Type:** invariant
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `minRole('EDITOR', 'NO_ACCESS')` and `minRole('NO_ACCESS', 'ADMIN')`
- **Expected outcome:** Both return `'NO_ACCESS'` (source: Decision D5, role hierarchy)
- **Interactions:** None

#### 57. minRole returns same role when both are equal

- **Name:** Intersection of equal roles returns that role
- **Type:** unit
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `minRole('EDITOR', 'EDITOR')`
- **Expected outcome:** Returns `'EDITOR'` (source: mathematical minimum)
- **Interactions:** None

#### 58. minRole handles all four role pairs correctly

- **Name:** Exhaustive pairwise test of minRole across all role levels
- **Type:** invariant
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Test all 16 combinations of `[NO_ACCESS, VIEWER, EDITOR, ADMIN]` x `[NO_ACCESS, VIEWER, EDITOR, ADMIN]`
- **Expected outcome:** `minRole(a, b)` always returns the role with the lower index in `ROLE_ORDER` (source: `ROLE_ORDER = ['NO_ACCESS', 'VIEWER', 'EDITOR', 'ADMIN']`)
- **Interactions:** None

#### 59. getEffectiveRole applies permission intersection for agent with actingUserEmail

- **Name:** Agent's effective role is min(agentRole, actingUserSiteRole) when actingUserEmail is set
- **Type:** integration
- **Harness:** H2
- **Preconditions:** Mock `query` returns agent site role `ADMIN` and acting user site role `VIEWER` (via email lookup)
- **Actions:** Call `getEffectiveRole(agentPrincipal_with_actingUserEmail, siteId, branchId)`
- **Expected outcome:** Returns `{ roleName: 'VIEWER' }` -- not ADMIN (source: Decision D5, implementation plan Task 5 Step 9)
- **Interactions:** Exercises database query mock for both agent role and acting-user role lookups

#### 60. getEffectiveRole skips intersection when actingUserEmail is absent

- **Name:** Agent without acting-user context gets normal role computation
- **Type:** boundary
- **Harness:** H2
- **Preconditions:** Mock `query` returns agent site role `ADMIN`, no branch grant
- **Actions:** Call `getEffectiveRole(agentPrincipal_without_actingUser, siteId, branchId)`
- **Expected outcome:** Returns `{ roleName: 'ADMIN' }` (source: existing behavior, regression guard)
- **Interactions:** Exercises database query mock

#### 61. getEffectiveRole returns NO_ACCESS when acting user is not in allowlist

- **Name:** Unknown acting user defaults to NO_ACCESS, collapsing agent's effective role
- **Type:** boundary
- **Harness:** H2
- **Preconditions:** Mock `query` returns agent site role `ADMIN`, acting user email lookup returns empty rows
- **Actions:** Call `getEffectiveRole(agentPrincipal_with_actingUserEmail, siteId, branchId)`
- **Expected outcome:** Returns `{ roleName: 'NO_ACCESS' }` (source: Decision D5 "no record = no access")
- **Interactions:** Exercises database query mock

#### 62. getEffectiveRole does not apply intersection for user principals

- **Name:** User principals never trigger permission intersection even if actingUserEmail happens to be set
- **Type:** boundary
- **Harness:** H2
- **Preconditions:** Mock `query` returns user site role `ADMIN`
- **Actions:** Call `getEffectiveRole(userPrincipal_with_actingUserEmail_but_type_user, siteId, branchId)`
- **Expected outcome:** Returns `{ roleName: 'ADMIN' }` -- intersection is only for `principal.type === 'agent'` (source: implementation plan Task 5 Step 9 condition)
- **Interactions:** Exercises database query mock

#### 63. System admin bypasses permission intersection

- **Name:** System admins always get ADMIN role regardless of acting-user
- **Type:** boundary
- **Harness:** H2
- **Preconditions:** Principal with `systemRole: 'admin'`, `type: 'agent'`, and `actingUserEmail`
- **Actions:** Call `getEffectiveRole(systemAdminAgent, siteId, branchId)`
- **Expected outcome:** Returns `{ roleName: 'ADMIN' }` (source: existing `getEffectiveRole` line 223-228, system admin early return)
- **Interactions:** None -- early return before any query

---

### Test File: `workers/tests/audit/acting-user-audit.spec.ts`

#### 64. Audit event context includes acting-user fields when provided

- **Name:** actingUserId and actingUserEmail appear in the audit event context
- **Type:** unit
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `createAuditEvent({ ..., context: { actingUserId: 'user-uuid-123', actingUserEmail: 'user@example.com', editSessionId: 'session-abc' }, ... })`
- **Expected outcome:** `event.context.actingUserId === 'user-uuid-123'`, `event.context.actingUserEmail === 'user@example.com'` (source: Decision D6, implementation plan Task 5 Step 3)
- **Interactions:** None

#### 65. Audit event context works without acting-user fields (backwards compatible)

- **Name:** Audit events without acting-user fields continue to work normally
- **Type:** regression
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `createAuditEvent({ ..., context: { editSessionId: 'session-abc' }, ... })`
- **Expected outcome:** `event.context.actingUserId` is undefined, `event.context.actingUserEmail` is undefined (source: backwards compatibility requirement)
- **Interactions:** None

#### 66. Audit event preserves all existing context fields alongside acting-user

- **Name:** Adding acting-user to context does not clobber other context fields
- **Type:** regression
- **Harness:** None (pure function test)
- **Preconditions:** None
- **Actions:** Call `createAuditEvent({ ..., context: { actingUserId: 'u1', actingUserEmail: 'u@ex.com', editSessionId: 'sess-1', branchName: 'feature' }, ... })`
- **Expected outcome:** All four context fields are present in the event (source: `createAuditEvent` passthrough behavior)
- **Interactions:** None

---

### Test File: `workers/mcp-server/tests/config/wrangler-validation.spec.ts`

#### 67. Wrangler config has valid JSONC syntax

- **Name:** wrangler.jsonc parses without errors after stripping comments
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `wrangler.jsonc` exists
- **Actions:** Read file, strip JSONC comments, parse as JSON
- **Expected outcome:** No parse errors (source: implementation plan Task 1 Step 3)
- **Interactions:** None

#### 68. Wrangler config defines MCP_OAUTH_KV binding

- **Name:** KV namespace binding for OAuth token storage is configured
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `wrangler.jsonc` exists
- **Actions:** Read file content
- **Expected outcome:** Contains `MCP_OAUTH_KV` (source: implementation plan Task 1 Step 3, Decision D3)
- **Interactions:** None

#### 69. Wrangler config defines sbx1 environment

- **Name:** Sandbox environment is configured
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `wrangler.jsonc` exists
- **Actions:** Read file content
- **Expected outcome:** Contains `"sbx1"` (source: implementation plan Task 1 Step 3)
- **Interactions:** None

#### 70. Wrangler config defines production environment

- **Name:** Production environment is configured
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `wrangler.jsonc` exists
- **Actions:** Read file content
- **Expected outcome:** Contains `"production"` (source: implementation plan Task 1 Step 3)
- **Interactions:** None

#### 71. Wrangler config uses port 8788 (different from main worker)

- **Name:** MCP server dev port does not conflict with the main CSS backend on 8787
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `wrangler.jsonc` exists
- **Actions:** Read file content
- **Expected outcome:** Contains `8788` (source: implementation plan Task 1 Step 3)
- **Interactions:** None

#### 72. Wrangler config specifies required vars for each environment

- **Name:** Each environment has ENVIRONMENT, CSS_BACKEND_URL, MCP_SERVER_NAME, MCP_SERVER_VERSION
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `wrangler.jsonc` exists
- **Actions:** Parse config, check `vars` in root and each env override
- **Expected outcome:** Required vars present in root config and overridden in each environment (source: implementation plan Task 1 Step 3)
- **Interactions:** None

#### 73. Wrangler config main entry point is src/index.ts

- **Name:** Worker main entry point is correctly specified
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `wrangler.jsonc` exists
- **Actions:** Parse config
- **Expected outcome:** `main` field is `src/index.ts` (source: implementation plan Task 1 Step 3)
- **Interactions:** None

---

### Test File: `workers/mcp-server/tests/e2e/oauth-mcp-flow.spec.ts`

#### 74. Unauthenticated health check returns 200

- **Name:** GET /health is publicly accessible and returns healthy status
- **Type:** scenario
- **Harness:** H5
- **Preconditions:** Worker with OAuthProvider wrapper
- **Actions:** Send `GET /health` without auth
- **Expected outcome:** Response 200 with `{ status: 'healthy' }` (source: implementation plan Task 3 Step 7)
- **Interactions:** OAuthProvider must pass through health endpoint

#### 75. Unauthenticated MCP request returns 401

- **Name:** POST /mcp without Bearer token is rejected
- **Type:** scenario
- **Harness:** H5
- **Preconditions:** Worker with OAuthProvider wrapper
- **Actions:** Send `POST /mcp` with JSON-RPC body but no auth
- **Expected outcome:** Response 401 (source: implementation plan Task 4 Step 6)
- **Interactions:** OAuthProvider blocks the request

#### 76. OAuth discovery returns valid metadata document

- **Name:** Discovery endpoint serves RFC 8414 compliant metadata
- **Type:** scenario
- **Harness:** H5
- **Preconditions:** Worker with OAuthProvider wrapper
- **Actions:** Send `GET /.well-known/oauth-authorization-server`
- **Expected outcome:** JSON with `issuer`, `authorization_endpoint`, `token_endpoint`, `response_types_supported` (source: RFC 8414)
- **Interactions:** OAuthProvider's built-in handler

#### 77. Authenticated tool call forwards acting-user headers to backend

- **Name:** Authenticated list_sites request includes agent auth AND acting-user headers to CSS backend
- **Type:** scenario
- **Harness:** H5 + H1 (mock backend fetch)
- **Preconditions:** Mock OAuthProvider passes request with user claims `{ userId: 'user-1', email: 'user@test.com' }`, mock backend fetch to capture outgoing request
- **Actions:** Send authenticated `POST /mcp` with `tools/call` for `list_sites`
- **Expected outcome:** Backend fetch includes `X-API-Key: aak_...`, `X-Acting-User-Id: user-1`, `X-Acting-User-Email: user@test.com` (source: implementation plan Task 3, Task 2)
- **Interactions:** OAuthProvider -> MCP handler -> McpApiClient -> mock fetch

#### 78. Tool call response is returned correctly through the MCP transport

- **Name:** MCP tool call result reaches the HTTP response body
- **Type:** scenario
- **Harness:** H5 + H1
- **Preconditions:** Mock backend returns `{ sites: [{ id: 's1', name: 'Test' }], total: 1 }`, mock OAuthProvider authenticates
- **Actions:** Send authenticated `POST /mcp` with `tools/call` for `list_sites`
- **Expected outcome:** HTTP response contains JSON-RPC result with tool output containing 'Test' and 'site_id: s1' (source: reference `tools.ts` `list_sites` handler format)
- **Interactions:** Full MCP request/response chain

#### 79. Expired token returns 401

- **Name:** Expired Bearer token is rejected by OAuthProvider
- **Type:** boundary
- **Harness:** H5
- **Preconditions:** Mock OAuthProvider configured to reject expired tokens
- **Actions:** Send `POST /mcp` with expired Bearer token
- **Expected outcome:** Response 401 (source: OAuth 2.0 spec)
- **Interactions:** OAuthProvider's token validation

#### 80. Revoked token returns 401

- **Name:** After token revocation, subsequent requests with that token fail
- **Type:** scenario
- **Harness:** H5
- **Preconditions:** Mock OAuthProvider with a token that has been revoked
- **Actions:** Send `POST /mcp` with revoked Bearer token
- **Expected outcome:** Response 401 (source: OAuth 2.0 token revocation spec)
- **Interactions:** OAuthProvider's revocation + validation

---

### Test File: `workers/mcp-server/tests/transport/streamable-http.spec.ts`

#### 81. MCP server handles POST /mcp with JSON-RPC initialize request

- **Name:** Streamable HTTP transport processes an MCP initialize handshake
- **Type:** integration
- **Harness:** H1
- **Preconditions:** MCP server created via `createMcpServer()`, transport connected
- **Actions:** Send a well-formed JSON-RPC `initialize` request to the transport
- **Expected outcome:** Response contains `serverInfo` with `name` and `version` matching config (source: MCP protocol spec, `@modelcontextprotocol/sdk` behavior)
- **Interactions:** Exercises `StreamableHTTPServerTransport` from SDK

#### 82. MCP server handles tools/list request

- **Name:** tools/list returns all 11 registered tools
- **Type:** integration
- **Harness:** H1
- **Preconditions:** MCP server initialized
- **Actions:** Send JSON-RPC `tools/list` request
- **Expected outcome:** Response lists 11 tools with correct names, descriptions, and inputSchemas (source: Decision D9)
- **Interactions:** Exercises MCP SDK tool listing

#### 83. Transport returns 405 for GET on /mcp

- **Name:** GET method is not allowed on the MCP endpoint
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** MCP transport created
- **Actions:** Send `GET /mcp`
- **Expected outcome:** Response status 405 (Method Not Allowed) or the transport's equivalent rejection (source: Streamable HTTP spec, POST-only)
- **Interactions:** Exercises transport method validation

#### 84. Transport handles invalid JSON-RPC body gracefully

- **Name:** Malformed JSON-RPC request returns a proper error response
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** MCP transport created
- **Actions:** Send `POST /mcp` with body `{ "invalid": true }` (missing `jsonrpc`, `method`)
- **Expected outcome:** Response contains JSON-RPC error (e.g., -32600 Invalid Request) (source: JSON-RPC 2.0 spec)
- **Interactions:** Exercises transport error handling

---

### Test File: `workers/mcp-server/tests/config/worker-config.spec.ts`

#### 85. Env type includes all required secret bindings

- **Name:** The Env interface declares all secrets needed for deployment
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `src/types.ts` exists
- **Actions:** Read `src/types.ts`, check for `AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`
- **Expected outcome:** All 5 secret field names are present in the file (source: implementation plan Task 3 Step 5, `.dev.vars.example`)
- **Interactions:** None

#### 86. Env type includes MCP_OAUTH_KV binding

- **Name:** The Env interface declares the KV namespace binding
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `src/types.ts` exists
- **Actions:** Read `src/types.ts`
- **Expected outcome:** Contains `MCP_OAUTH_KV: KVNamespace` (source: implementation plan Task 3 Step 5)
- **Interactions:** None

#### 87. .dev.vars.example documents all required secrets

- **Name:** The example dev vars file lists all secrets developers need to configure
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `.dev.vars.example` exists
- **Actions:** Read file
- **Expected outcome:** Contains `AGENT_API_KEY`, `AGENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY` (source: implementation plan Task 1 Step 6)
- **Interactions:** None

---

### Test File: `workers/mcp-server/tests/config/terraform-validation.spec.ts`

#### 88. Terraform MCP module creates KV namespace resource

- **Name:** The cloudflare-mcp Terraform module declares a KV namespace for OAuth
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `terraform/modules/cloudflare-mcp/main.tf` exists
- **Actions:** Read file content
- **Expected outcome:** Contains `cloudflare_workers_kv_namespace` resource named `mcp_oauth_kv` (source: implementation plan Task 6 Step 4)
- **Interactions:** None

#### 89. Terraform MCP module outputs KV namespace ID

- **Name:** Module outputs the KV ID for wrangler.jsonc configuration
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `terraform/modules/cloudflare-mcp/main.tf` exists
- **Actions:** Read file content
- **Expected outcome:** Contains `output "mcp_oauth_kv_id"` (source: implementation plan Task 6 Step 4)
- **Interactions:** None

#### 90. Terraform sbx1 environment includes MCP module

- **Name:** The sandbox environment's main.tf includes the cloudflare-mcp module
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `terraform/environments/sbx1/main.tf` exists
- **Actions:** Read file content
- **Expected outcome:** Contains `module "cloudflare_mcp"` with `source = "../../modules/cloudflare-mcp"` (source: implementation plan Task 6 Step 5)
- **Interactions:** None

#### 91. Terraform sbx1 environment outputs MCP KV ID

- **Name:** sbx1 main.tf exposes mcp_oauth_kv_id output
- **Type:** unit
- **Harness:** H4
- **Preconditions:** `terraform/environments/sbx1/main.tf` exists
- **Actions:** Read file content
- **Expected outcome:** Contains `output "mcp_oauth_kv_id"` referencing `module.cloudflare_mcp.mcp_oauth_kv_id` (source: implementation plan Task 6 Step 5)
- **Interactions:** None

---

### Test File: `workers/mcp-server/tests/auth/token-lifecycle.spec.ts`

#### 92. Token with user claims makes actingUser available to MCP handler

- **Name:** OAuth token user claims flow through to API client acting-user context
- **Type:** scenario
- **Harness:** H5 + H1
- **Preconditions:** Mock OAuthProvider provides authenticated request with props `{ userId: 'u1', email: 'u@test.com', name: 'Test User' }`
- **Actions:** Trigger a tool call on the authenticated MCP endpoint
- **Expected outcome:** `McpApiClient` constructed with `actingUser: { id: 'u1', email: 'u@test.com' }` (source: implementation plan Task 4 Step 6 point 3)
- **Interactions:** OAuthProvider -> Worker handler -> McpApiClient

#### 93. Token without user claims still processes requests (agent-only mode)

- **Name:** MCP handler works without acting-user when token props lack user info
- **Type:** boundary
- **Harness:** H5 + H1
- **Preconditions:** Mock OAuthProvider provides authenticated request with empty/minimal props
- **Actions:** Trigger a tool call
- **Expected outcome:** `McpApiClient` constructed without `actingUser`, requests sent without acting-user headers (source: implementation plan Task 2 test for absent actingUser)
- **Interactions:** OAuthProvider -> Worker handler -> McpApiClient

---

### Test File: `workers/tests/auth/acting-user-integration.spec.ts`

#### 94. Acting-user fields are attached to principal after extraction in main worker

- **Name:** Worker index.ts attaches actingUserId and actingUserEmail to principal
- **Type:** integration
- **Harness:** H2
- **Preconditions:** Authenticated agent principal, request headers contain both acting-user headers
- **Actions:** Simulate the auth + acting-user extraction flow from `index.ts`
- **Expected outcome:** `principal.actingUserId === 'user-uuid-123'`, `principal.actingUserEmail === 'user@example.com'` (source: implementation plan Task 5 Step 10)
- **Interactions:** Exercises `extractActingUser` + principal mutation

#### 95. Non-agent principals are not mutated by acting-user extraction

- **Name:** User and service principals pass through extraction without modification
- **Type:** regression
- **Harness:** H2
- **Preconditions:** Authenticated user principal with spoofed acting-user headers
- **Actions:** Run extraction logic
- **Expected outcome:** `principal.actingUserId` and `principal.actingUserEmail` remain undefined (source: Decision D4)
- **Interactions:** None

---

### Test File: `workers/tests/auth/types-extension.spec.ts`

#### 96. AuthenticatedPrincipal interface accepts actingUserId

- **Name:** TypeScript allows setting actingUserId on an AuthenticatedPrincipal
- **Type:** unit
- **Harness:** None (compile-time verification via test import)
- **Preconditions:** None
- **Actions:** Construct an `AuthenticatedPrincipal` object with `actingUserId: 'test'`
- **Expected outcome:** Compiles and runs without error (source: implementation plan Task 5 Step 6)
- **Interactions:** None

#### 97. AuthenticatedPrincipal interface accepts actingUserEmail

- **Name:** TypeScript allows setting actingUserEmail on an AuthenticatedPrincipal
- **Type:** unit
- **Harness:** None (compile-time verification via test import)
- **Preconditions:** None
- **Actions:** Construct an `AuthenticatedPrincipal` object with `actingUserEmail: 'test@example.com'`
- **Expected outcome:** Compiles and runs without error (source: implementation plan Task 5 Step 6)
- **Interactions:** None

#### 98. Both acting-user fields are optional

- **Name:** AuthenticatedPrincipal without acting-user fields remains valid
- **Type:** regression
- **Harness:** None (compile-time verification)
- **Preconditions:** None
- **Actions:** Construct an `AuthenticatedPrincipal` without actingUserId or actingUserEmail
- **Expected outcome:** Compiles and runs without error (source: implementation plan Task 5 Step 6, "optional")
- **Interactions:** None

---

## Test Count Summary

| Test File | Count | Types |
|-----------|-------|-------|
| `workers/mcp-server/tests/shared/api-client.spec.ts` | 17 | boundary, unit, scenario, integration |
| `workers/mcp-server/tests/shared/tools.spec.ts` | 9 | unit, invariant, scenario, integration, boundary |
| `workers/mcp-server/tests/shared/reference-comparison.spec.ts` | 2 | differential |
| `workers/mcp-server/tests/mcp-handler.spec.ts` | 3 | unit, integration |
| `workers/mcp-server/tests/health.spec.ts` | 2 | scenario, unit |
| `workers/mcp-server/tests/auth/google-handler.spec.ts` | 8 | unit, scenario, integration, boundary |
| `workers/mcp-server/tests/auth/oauth-integration.spec.ts` | 6 | scenario, integration, boundary |
| `workers/mcp-server/tests/auth/token-lifecycle.spec.ts` | 2 | scenario, boundary |
| `workers/mcp-server/tests/transport/streamable-http.spec.ts` | 4 | integration, boundary |
| `workers/mcp-server/tests/config/wrangler-validation.spec.ts` | 7 | unit |
| `workers/mcp-server/tests/config/worker-config.spec.ts` | 3 | unit |
| `workers/mcp-server/tests/config/terraform-validation.spec.ts` | 4 | unit |
| `workers/mcp-server/tests/e2e/oauth-mcp-flow.spec.ts` | 7 | scenario, boundary |
| `workers/tests/auth/acting-user.spec.ts` | 6 | scenario, boundary, invariant |
| `workers/tests/auth/permission-intersection.spec.ts` | 10 | unit, invariant, integration, boundary |
| `workers/tests/audit/acting-user-audit.spec.ts` | 3 | unit, regression |
| `workers/tests/auth/acting-user-integration.spec.ts` | 2 | integration, regression |
| `workers/tests/auth/types-extension.spec.ts` | 3 | unit, regression |
| **Total** | **98** | |

**Note:** The agreed strategy estimated ~140 tests. This plan specifies 98 concrete tests. The difference reflects that several strategy categories (e.g., "Full OAuth endpoint suite" and "Session/token KV storage") collapsed into fewer, more focused tests once the `@cloudflare/workers-oauth-provider` library's abstraction was accounted for (it handles much of the OAuth machinery internally). Additional tests for individual tool handler response formatting (the remaining ~40) follow the exact same pattern as tests 20-26 and can be generated mechanically -- one per tool handler for success and error cases across 11 tools = 22 more tests, plus boundary cases for edge inputs. The executing agent should expand tests 20-26 pattern to all 11 tools when writing the test files, reaching approximately 120-130 tests.
