# Agent API Key Service (B2) -- Test Plan

**Date:** 2026-03-21
**Component:** `workers/src/services/agent-api-key-service.ts`
**Test file:** `workers/tests/services/agent-api-key-service.spec.ts`
**Framework:** Vitest with mocked `query` function (matches `site-api-token-service.spec.ts` pattern)

---

## Test Infrastructure

Following the established pattern from `site-api-token-service.spec.ts`:

- Mock `../../src/db` with `vi.mock` to provide a `query` spy
- Stub `crypto.subtle.digest` and `crypto.getRandomValues` globally
- Use deterministic byte fills (`(i * 7 + 13) % 256`) for `getRandomValues`
- Use `0xab`-filled 32-byte buffer for `digest` return
- Dynamic `import()` of the service under test inside each test (required because the module is mocked at the top level)
- `vi.resetAllMocks()` in `beforeEach`

---

## Test Cases (26 total)

### generateKey (9 tests)

| # | Test | Assertion |
|---|------|-----------|
| 1 | should generate a key with `aak_` prefix | `result.key` matches `/^aak_/` |
| 2 | should return the raw key only at creation time | `result.key` is defined and length > 20 |
| 3 | should return metadata alongside the raw key | `result.metadata` has `id`, `agentId`, `name`, `prefix` (starts with `aak_`), `createdAt` |
| 4 | should not include scopes in metadata | JSON.stringify of metadata does not contain `"scopes"` |
| 5 | should store key hash, not the raw key | INSERT query params contain a 64-char hex string (not prefixed with `aak_`) |
| 6 | should store the prefix for display purposes | INSERT query params contain a string starting with `aak_` of length <= 12 |
| 7 | should validate required agentId | Empty `agentId` rejects with `"agentId is required"` |
| 8 | should validate required name | Empty `name` rejects with `"name is required"` |
| 9 | should validate required createdBy | Empty `createdBy` rejects with `"createdBy is required"` |
| 10 | should insert into `app.agent_api_keys` table | Query SQL contains `app.agent_api_keys` |

### validateKey (8 tests)

| # | Test | Assertion |
|---|------|-----------|
| 11 | should return key info for a valid non-revoked key | Result is non-null with `agentId` and `keyId` |
| 12 | should not include scopes in validation result | JSON.stringify of result does not contain `"scopes"` |
| 13 | should return null for non-existent key | Query returns empty rows, result is null |
| 14 | should return null for empty key | No DB call, returns null |
| 15 | should return null for key without `aak_` prefix | No DB call, returns null |
| 16 | should return null for key that is just the prefix (`aak_`) | No DB call, returns null |
| 17 | should hash the key before looking it up | `crypto.subtle.digest` called with `'SHA-256'` |
| 18 | should only match non-revoked keys | SELECT query contains `revoked_at IS NULL` |
| 19 | should update `last_used_at` on successful validation | Two `query` calls: SELECT + UPDATE with `last_used_at` |
| 20 | should not update `last_used_at` when key is not found | Only one `query` call (SELECT only) |

### listKeys (5 tests)

| # | Test | Assertion |
|---|------|-----------|
| 21 | should return key metadata for an agent | Returns array of length 2 with correct `id` and `name` |
| 22 | should never return key hashes | JSON.stringify contains neither `token_hash` nor `tokenHash` |
| 23 | should return empty array when no keys exist | Returns `[]` |
| 24 | should query by `agent_id` | Query SQL contains `agent_id`, params include the agent UUID |
| 25 | should only return non-revoked keys | Query SQL contains `revoked_at IS NULL` |
| 26 | should order by `created_at` descending | Query SQL contains `ORDER BY created_at DESC` |

### revokeKey (4 tests)

| # | Test | Assertion |
|---|------|-----------|
| 27 | should set `revoked_at` timestamp | Returns `true`, query contains `revoked_at` with key ID and agent ID params |
| 28 | should return false when key not found | `rowCount: 0` causes return `false` |
| 29 | should scope revocation to the specified agent | Query SQL contains `agent_id`, params include agent UUID |
| 30 | should only revoke non-revoked keys | Query SQL contains `revoked_at IS NULL` |

---

## Key Differences from site-api-token-service Tests

| Aspect | site-api-token-service | agent-api-key-service |
|--------|------------------------|----------------------|
| Prefix | `sat_` | `aak_` |
| Owner dimension | `siteId` | `agentId` |
| Scopes | Present in types, params, queries, results | Absent -- explicitly tested to NOT appear |
| `last_used_at` tracking | Not tested (service does not update it) | Tested: fire-and-forget UPDATE on valid key |
| validateKey prefix guard | `sat_` | `aak_`, including bare-prefix edge case |
| listKeys filtering | Returns both active and revoked | Returns only non-revoked (filtered by `revoked_at IS NULL`) |
| Table name | `app.site_api_tokens` | `app.agent_api_keys` |

---

## Coverage Matrix

| Function | Happy path | Input validation | Security (hash storage) | Edge cases | Query correctness |
|----------|-----------|-----------------|------------------------|------------|------------------|
| generateKey | Tests 1-3 | Tests 7-9 | Tests 4-6 | -- | Test 10 |
| validateKey | Test 11 | Tests 14-16 | Tests 12, 17 | Tests 13, 19, 20 | Test 18 |
| listKeys | Test 21 | -- | Test 22 | Test 23 | Tests 24-26 |
| revokeKey | Test 27 | -- | -- | Test 28 | Tests 29-30 |
