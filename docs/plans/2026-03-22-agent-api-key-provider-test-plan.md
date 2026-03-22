# Agent API Key Provider (B3) -- Test Plan

**Date:** 2026-03-22
**Feature:** `AgentApiKeyProvider` identity provider for `aak_`-prefixed agent API keys
**Harness:** Vitest with `vi.mock` for the `agent-api-key-service` dependency
**Test file:** `workers/tests/auth/agent-api-key-provider.spec.ts`

---

## Strategy Reconciliation

The implementation plan specifies a single class (`AgentApiKeyProvider`) implementing the existing `IdentityProvider` interface, plus a one-line type union change in `types.ts`. The testing strategy from the conversation matches the plan exactly:

- **Interface shape:** The `IdentityProvider` interface is already defined and stable. Tests assert against its contract.
- **External dependency:** The only external dependency is `validateKey` from `agent-api-key-service`, which is mocked via `vi.mock`. No database, network, or paid API access needed.
- **Type change:** Adding `'agent_key'` to the `AuthProvider` union is verified implicitly -- if the type is wrong, TypeScript compilation fails and tests cannot import the module.
- **No strategy changes required.** The plan is a small, self-contained unit with a single mock boundary.

---

## Harness Requirements

**Harness: Vitest + vi.mock**

- **What it does:** Replaces `agent-api-key-service.validateKey` with a Vitest mock function, allowing tests to control validation outcomes without a database.
- **What it exposes:** `vi.mocked(agentKeyService.validateKey)` for setting return values (`mockResolvedValue`) and inspecting calls (`toHaveBeenCalledWith`).
- **Complexity:** Zero -- this is standard Vitest mocking, already used identically in the reference test file (`site-token-provider.spec.ts`).
- **All tests depend on this harness.**

Setup:
```typescript
vi.mock('../../src/services/agent-api-key-service', () => ({
  validateKey: vi.fn(),
}));
```

Reset between tests via `vi.resetAllMocks()` in `beforeEach`.

---

## Test Plan

### 1. Valid agent key produces correct principal (scenario)

- **Name:** Authenticating with a valid agent API key returns a fully-formed agent principal
- **Type:** scenario
- **Harness:** Vitest + vi.mock
- **Preconditions:** `validateKey` mock returns `{ keyId: 'key-uuid-123', agentId: 'agent-uuid-456' }`
- **Actions:** Call `provider.validateAgentKey('aak_validkey123abc')`
- **Expected outcome:**
  - Returns non-null principal (source: implementation plan, user specification)
  - `principal.id === 'agent-uuid-456'` -- uses agentId, not keyId (source: Decision D1)
  - `principal.type === 'agent'` (source: user specification)
  - `principal.authProvider === 'agent_key'` (source: user specification)
  - `principal.pantheonSiteRoles` deep-equals `{}` (source: Decision D4)
  - `principal.scopes` is `undefined` (source: Decision D5)
  - `principal.tokenExpiry` is an ISO string ~24 hours in the future (source: Decision D3)
  - `validateKey` was called exactly once with the full key string (source: implementation plan)
- **Interactions:** Exercises the mock boundary with `agent-api-key-service.validateKey`

### 2. Invalid key rejected by service returns null (scenario)

- **Name:** Authenticating with a key the service rejects returns null
- **Type:** scenario
- **Harness:** Vitest + vi.mock
- **Preconditions:** `validateKey` mock returns `null`
- **Actions:** Call `provider.validateAgentKey('aak_invalidkey999')`
- **Expected outcome:** Returns `null` (source: user specification -- "Returns null for invalid key")
- **Interactions:** Exercises the mock boundary -- validates that a service rejection propagates correctly

### 3. Service delegation passes full key string (integration)

- **Name:** Provider delegates the complete key string to validateKey
- **Type:** integration
- **Harness:** Vitest + vi.mock
- **Preconditions:** `validateKey` mock returns `{ keyId: 'key-uuid-123', agentId: 'agent-uuid-456' }`
- **Actions:** Call `provider.validateAgentKey('aak_testkey789xyz')`
- **Expected outcome:**
  - `validateKey` called with `'aak_testkey789xyz'` (exact string, not stripped of prefix)
  - `validateKey` called exactly once
- **Interactions:** This is the core integration point between provider and service. Verifies the provider does not transform the key before passing it.

### 4. Bearer token path returns false/null (integration)

- **Name:** Agent keys are excluded from the Bearer token authentication path
- **Type:** integration
- **Harness:** Vitest + vi.mock
- **Preconditions:** None (no mocks needed -- these methods don't call the service)
- **Actions:**
  - Call `provider.canVerifyToken('aak_somekey123')` -- returns `false`
  - Call `provider.canVerifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig')` -- returns `false`
  - Call `provider.canVerifyToken('')` -- returns `false`
  - Call `provider.canVerifyToken('anything')` -- returns `false`
  - Call `provider.validateToken('aak_somekey123')` -- returns `null`
  - Call `provider.validateToken('eyJhbGciOiJIUzI1NiJ9.test.sig')` -- returns `null`
  - Call `provider.validateToken('')` -- returns `null`
  - Call `provider.validateToken('sat_token123')` -- returns `null`
- **Expected outcome:** All `canVerifyToken` calls return `false`; all `validateToken` calls return `null` (source: Decision D2, user specification)
- **Interactions:** This ensures `MultiProviderIdentityProvider.validateToken()` will never route tokens to this provider, since it checks `canVerifyToken()` first (see `identity-provider.ts` line 124).

### 5. Interface contract compliance (invariant)

- **Name:** AgentApiKeyProvider satisfies the IdentityProvider interface contract
- **Type:** invariant
- **Harness:** Vitest + vi.mock
- **Preconditions:** Module imports successfully
- **Actions:** Instantiate `new AgentApiKeyProvider()`
- **Expected outcome:**
  - `provider.name === 'agent_key'` (source: user specification)
  - `typeof provider.canVerifyToken === 'function'`
  - `typeof provider.validateToken === 'function'`
  - `typeof provider.validateAgentKey === 'function'`
- **Interactions:** None. Pure shape check.

### 6. Non-aak_ prefixed key rejected without service call (boundary)

- **Name:** Keys without the aak_ prefix are rejected before hitting the database
- **Type:** boundary
- **Harness:** Vitest + vi.mock
- **Preconditions:** None
- **Actions:** Call `provider.validateAgentKey('sat_notanagentkey')`
- **Expected outcome:**
  - Returns `null`
  - `validateKey` was NOT called (source: user specification, implementation plan -- prefix check is a guard before service delegation)
- **Interactions:** Verifies the provider does not make unnecessary database calls for keys belonging to other providers.

### 7. Empty string rejected without service call (boundary)

- **Name:** Empty string is rejected before hitting the database
- **Type:** boundary
- **Harness:** Vitest + vi.mock
- **Preconditions:** None
- **Actions:** Call `provider.validateAgentKey('')`
- **Expected outcome:**
  - Returns `null`
  - `validateKey` was NOT called (source: user specification)
- **Interactions:** None

### 8. Bare prefix "aak_" with no value rejected without service call (boundary)

- **Name:** The bare prefix with no content after it is rejected
- **Type:** boundary
- **Harness:** Vitest + vi.mock
- **Preconditions:** None
- **Actions:** Call `provider.validateAgentKey('aak_')`
- **Expected outcome:**
  - Returns `null`
  - `validateKey` was NOT called (source: user specification -- "Returns null for bare 'aak_' with no value")
- **Interactions:** None

### 9. Principal id uses agentId not keyId (unit)

- **Name:** The principal identity is the agent, not the credential
- **Type:** unit
- **Harness:** Vitest + vi.mock
- **Preconditions:** `validateKey` mock returns `{ keyId: 'key-uuid-123', agentId: 'agent-uuid-456' }`
- **Actions:** Call `provider.validateAgentKey('aak_validkey123abc')`
- **Expected outcome:** `principal.id === 'agent-uuid-456'` (not `'key-uuid-123'`) (source: Decision D1)
- **Interactions:** None beyond mock

### 10. Token expiry is approximately 24 hours in the future (unit)

- **Name:** Token expiry is set to ~24 hours from validation time
- **Type:** unit
- **Harness:** Vitest + vi.mock
- **Preconditions:** `validateKey` mock returns a valid result
- **Actions:** Record `Date.now()` before and after calling `validateAgentKey`, parse `tokenExpiry`
- **Expected outcome:** Expiry timestamp is within `[before + 24h - 1s, after + 24h + 1s]` (source: Decision D3, matches `SiteApiTokenProvider` convention)
- **Interactions:** None beyond mock

---

## Coverage Summary

### Covered

| Area | Tests | Notes |
|------|-------|-------|
| Happy path authentication | 1, 9, 10 | Full principal shape, id mapping, expiry |
| Service rejection | 2 | Null propagation from validateKey |
| Service delegation | 3 | Correct argument passing |
| Bearer token exclusion | 4 | canVerifyToken + validateToken always reject |
| Interface contract | 5 | Shape and name compliance |
| Input validation boundaries | 6, 7, 8 | Wrong prefix, empty, bare prefix |

### Explicitly Excluded

| Area | Reason | Risk |
|------|--------|------|
| Database integration | Out of scope for B3; `validateKey` is tested in B2's own test suite | Low -- mock boundary is narrow and well-defined |
| MultiProvider wiring | Covered in B4 (next phase) | Low -- interface contract tests (5) ensure compatibility |
| Concurrent validation | No shared mutable state in the provider | None |
| Performance | Single `await` to mock; no computation beyond string prefix check | None |

### Action Space Coverage

Every method on `AgentApiKeyProvider` (`name`, `canVerifyToken`, `validateToken`, `validateAgentKey`) appears in at least one test. Every user-facing outcome (principal returned, null returned, service called/not called) is asserted. The `AuthProvider` type change is verified implicitly by successful module import and TypeScript compilation.
