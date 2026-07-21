# Agent API Key Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Create an `AgentApiKeyProvider` identity provider that authenticates `aak_`-prefixed API keys by delegating to the agent-api-key-service, and add the `'agent_key'` auth provider type.

**Architecture:** The `AgentApiKeyProvider` implements the existing `IdentityProvider` interface (defined in `workers/src/auth/identity-provider.ts`). It mirrors the structure of `SiteApiTokenProvider` but differs in three key ways: (1) it validates via `validateAgentKey()` instead of `canVerifyToken()`/`validateToken()` since agent keys are opaque strings, not Bearer JWTs; (2) it returns a principal with `type: 'agent'` and no scopes; (3) the principal `id` is the `agentId` (the identity being authenticated), not the `keyId` (which is just the credential identifier). The `AuthProvider` union type in `types.ts` must be extended with `'agent_key'` so the provider's `name` property satisfies the type constraint.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers runtime

---

## Decision Log

### D1: Principal `id` uses `agentId`, not `keyId`

**Decision:** Set `principal.id = result.agentId` (not `result.keyId`).

**Justification:** The `AuthenticatedPrincipal.id` field identifies _who_ is authenticated. For agent keys, the authenticated entity is the agent (identified by `agentId`). The `keyId` is just the credential used to prove identity -- analogous to how a password hash ID would not be used as the user ID. This matches the user's specification and is consistent with how `SiteApiTokenProvider` uses `tokenId` as the principal ID for service tokens (where the token _is_ the identity since service tokens are not tied to a user).

### D2: `canVerifyToken()` returns `false`; `validateToken()` returns `null`

**Decision:** Agent keys are not Bearer tokens and cannot be routed through the JWT-based `canVerifyToken`/`validateToken` flow.

**Justification:** The `MultiProviderIdentityProvider.validateToken()` path decodes JWTs and matches by issuer claim. Agent keys are opaque `aak_` strings, not JWTs. Authentication flows through `MultiProviderIdentityProvider.validateAgentKey()` which calls each provider's `validateAgentKey()` in order. Returning `false`/`null` from the token methods ensures agent keys are never accidentally processed as JWTs.

### D3: Token expiry set to 24 hours from validation time

**Decision:** Set `tokenExpiry` to `Date.now() + 24 * 60 * 60 * 1000`, matching `SiteApiTokenProvider`.

**Justification:** Agent API keys themselves do not expire (they are revocable), but `AuthenticatedPrincipal.tokenExpiry` is a required field that controls session/cache lifetime. The 24-hour window matches the existing convention in `SiteApiTokenProvider` and provides a reasonable re-validation interval.

### D4: Empty `pantheonSiteRoles` on principal

**Decision:** Set `pantheonSiteRoles: {}` on the returned principal.

**Justification:** Agents do not have Pantheon platform roles. Their authorization is determined by per-site roles in `agent_site_roles` (B5b scope), resolved downstream by the authorization layer. The provider's job is authentication, not authorization.

### D5: No scopes on principal

**Decision:** Do not set `scopes` on the returned principal (field is optional on `AuthenticatedPrincipal`).

**Justification:** Unlike site API tokens which have explicit scope grants (`read:published`, etc.), agent keys derive their permissions from site-level role assignments. Adding scopes would create a conflicting authorization model.

### D6: TDD commit ordering -- type change bundled with implementation

**Decision:** The `AuthProvider` type change (adding `'agent_key'`) is committed together with the implementation in Task 2, not as a separate commit before tests.

**Justification:** The project's TDD workflow requires: (a) write tests, (b) verify red, (c) commit tests, (d) write implementation, (e) lint, (f) verify green. The type change is part of the implementation -- tests fail because the module doesn't exist (red state), not because of the type union. Committing the type change before tests would create a third commit that breaks the two-commit TDD cadence (tests commit, then implementation commit). This matches the workflow described in the project CLAUDE.md section 3.

---

## Task 1: Write the failing test file

**Files:**
- Create: `workers/tests/auth/agent-api-key-provider.spec.ts`

**Step 1: Write the complete test file**

Create `workers/tests/auth/agent-api-key-provider.spec.ts` with the following content. The test structure mirrors `workers/tests/auth/site-token-provider.spec.ts` for consistency, with sections adapted for agent key semantics.

```typescript
/**
 * Agent API Key Provider Tests (TDD)
 *
 * Tests for the AgentApiKeyProvider which authenticates
 * agent API keys (aak_ prefixed) against the database.
 * Tests should FAIL initially until implementation is complete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agent API key service
vi.mock('../../src/services/agent-api-key-service', () => ({
  validateKey: vi.fn(),
}));

describe('AgentApiKeyProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Interface compliance
  // ===========================================================================

  describe('interface', () => {
    it('should have name property set to "agent_key"', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(provider.name).toBe('agent_key');
    });

    it('should implement canVerifyToken method', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(typeof provider.canVerifyToken).toBe('function');
    });

    it('should implement validateToken method', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(typeof provider.validateToken).toBe('function');
    });

    it('should implement validateAgentKey method', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(typeof provider.validateAgentKey).toBe('function');
    });
  });

  // ===========================================================================
  // canVerifyToken
  // ===========================================================================

  describe('canVerifyToken', () => {
    it('should always return false (agent keys are not Bearer tokens)', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(provider.canVerifyToken('aak_somekey123')).toBe(false);
      expect(provider.canVerifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig')).toBe(false);
      expect(provider.canVerifyToken('')).toBe(false);
      expect(provider.canVerifyToken('anything')).toBe(false);
    });
  });

  // ===========================================================================
  // validateToken
  // ===========================================================================

  describe('validateToken', () => {
    it('should always return null (Bearer tokens not supported)', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      const result = await provider.validateToken('aak_somekey123');

      expect(result).toBeNull();
    });

    it('should return null for any token string', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const provider = new AgentApiKeyProvider();

      expect(await provider.validateToken('eyJhbGciOiJIUzI1NiJ9.test.sig')).toBeNull();
      expect(await provider.validateToken('')).toBeNull();
      expect(await provider.validateToken('sat_token123')).toBeNull();
    });
  });

  // ===========================================================================
  // validateAgentKey
  // ===========================================================================

  describe('validateAgentKey', () => {
    it('should return principal for valid aak_ key', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal).not.toBeNull();
    });

    it('should return principal with type "agent"', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.type).toBe('agent');
    });

    it('should set authProvider to "agent_key"', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.authProvider).toBe('agent_key');
    });

    it('should use agentId as principal id (not keyId)', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.id).toBe('agent-uuid-456');
    });

    it('should set empty pantheonSiteRoles', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.pantheonSiteRoles).toEqual({});
    });

    it('should not include scopes on principal', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const principal = await provider.validateAgentKey('aak_validkey123abc');

      expect(principal?.scopes).toBeUndefined();
    });

    it('should set tokenExpiry to a future date', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      const before = Date.now();
      const principal = await provider.validateAgentKey('aak_validkey123abc');
      const after = Date.now();

      expect(principal?.tokenExpiry).toBeDefined();
      const expiry = new Date(principal!.tokenExpiry).getTime();
      // Should be ~24 hours in the future
      expect(expiry).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
      expect(expiry).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 1000);
    });

    it('should return null for invalid key (validateKey returns null)', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue(null);

      const principal = await provider.validateAgentKey('aak_invalidkey999');

      expect(principal).toBeNull();
    });

    it('should return null for non-aak_ prefixed keys without calling service', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      const principal = await provider.validateAgentKey('sat_notanagentkey');

      expect(principal).toBeNull();
      expect(agentKeyService.validateKey).not.toHaveBeenCalled();
    });

    it('should return null for empty string without calling service', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      const principal = await provider.validateAgentKey('');

      expect(principal).toBeNull();
      expect(agentKeyService.validateKey).not.toHaveBeenCalled();
    });

    it('should return null for bare "aak_" with no value after prefix', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      const principal = await provider.validateAgentKey('aak_');

      expect(principal).toBeNull();
      expect(agentKeyService.validateKey).not.toHaveBeenCalled();
    });

    it('should delegate to validateKey from agent-api-key-service', async () => {
      const { AgentApiKeyProvider } = await import('../../src/auth/agent-api-key-provider');
      const agentKeyService = await import('../../src/services/agent-api-key-service');
      const provider = new AgentApiKeyProvider();

      vi.mocked(agentKeyService.validateKey).mockResolvedValue({
        keyId: 'key-uuid-123',
        agentId: 'agent-uuid-456',
      });

      await provider.validateAgentKey('aak_testkey789xyz');

      expect(agentKeyService.validateKey).toHaveBeenCalledWith('aak_testkey789xyz');
      expect(agentKeyService.validateKey).toHaveBeenCalledTimes(1);
    });
  });
});
```

**Step 2: Run tests to verify they fail (red state)**

Run: `cd /Users/chris.yates/src/collaborative-state-system/workers/.worktrees/add-agent-api-key-provider && pnpm test -- --run workers/tests/auth/agent-api-key-provider.spec.ts`
Expected: All tests FAIL because `workers/src/auth/agent-api-key-provider.ts` does not exist yet.

**Step 3: Commit the tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system/workers/.worktrees/add-agent-api-key-provider
git add workers/tests/auth/agent-api-key-provider.spec.ts
git commit -m "test(auth): add agent API key provider tests - red state (B3)"
```

---

## Task 2: Implement the AgentApiKeyProvider and update AuthProvider type

**Files:**
- Modify: `workers/src/types.ts:482` -- add `'agent_key'` to `AuthProvider` union
- Create: `workers/src/auth/agent-api-key-provider.ts`

**Step 1: Update the AuthProvider type union**

In `workers/src/types.ts` at line 482, change:

```typescript
export type AuthProvider = 'auth0' | 'google' | 'mock' | 'site_token' | 'unknown';
```

to:

```typescript
export type AuthProvider = 'auth0' | 'google' | 'mock' | 'site_token' | 'agent_key' | 'unknown';
```

**Justification:** The `IdentityProvider.name` property is typed as `AuthProvider`. Without this addition, `readonly name = 'agent_key' as const` would be a type error. The value is inserted alphabetically before `'unknown'` to maintain the existing ordering convention (specific providers, then the fallback).

**Step 2: Write the implementation**

Create `workers/src/auth/agent-api-key-provider.ts`:

```typescript
/**
 * Agent API Key Provider
 *
 * Authenticates agent API keys (aak_ prefixed) by delegating
 * to the agent-api-key-service for hash-based validation.
 * Returns an agent principal with no scopes -- authorization
 * is determined by per-site roles in agent_site_roles.
 *
 * Implements the IdentityProvider interface.
 */

import type { AuthenticatedPrincipal } from '../types';
import type { IdentityProvider } from './identity-provider';
import { validateKey } from '../services/agent-api-key-service';

const KEY_PREFIX = 'aak_';

/**
 * Provider for agent API keys (aak_ prefixed opaque tokens).
 * These keys authenticate AI agents, not users or services.
 *
 * Agent keys are NOT Bearer tokens. They are validated through
 * the validateAgentKey() path, not canVerifyToken()/validateToken().
 */
export class AgentApiKeyProvider implements IdentityProvider {
  readonly name = 'agent_key' as const;

  /**
   * Agent keys are not Bearer tokens and cannot be verified as JWTs.
   * Always returns false so the MultiProvider token routing skips this provider.
   */
  canVerifyToken(_token: string): boolean {
    return false;
  }

  /**
   * Bearer token validation is not supported for agent keys.
   * Always returns null.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateToken(_token: string): Promise<AuthenticatedPrincipal | null> {
    return null;
  }

  /**
   * Validate an agent API key and return an agent principal.
   *
   * Rejects keys that don't start with "aak_" or have no content after
   * the prefix without hitting the database. Valid-looking keys are
   * delegated to the agent-api-key-service for SHA-256 hash lookup.
   */
  async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
    if (!apiKey || !apiKey.startsWith(KEY_PREFIX) || apiKey.length <= KEY_PREFIX.length) {
      return null;
    }

    const result = await validateKey(apiKey);
    if (!result) {
      return null;
    }

    return {
      id: result.agentId,
      type: 'agent',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      authProvider: 'agent_key',
    };
  }
}
```

**Step 3: Run linting**

Run: `cd /Users/chris.yates/src/collaborative-state-system/workers/.worktrees/add-agent-api-key-provider && pnpm lint`
Expected: 0 errors, 0 warnings (or only pre-existing warnings unrelated to new files)

**Step 4: Run tests to verify they pass (green state)**

Run: `cd /Users/chris.yates/src/collaborative-state-system/workers/.worktrees/add-agent-api-key-provider && pnpm test -- --run workers/tests/auth/agent-api-key-provider.spec.ts`
Expected: All 15 tests PASS

**Step 5: Run the full test suite to check for regressions**

Run: `cd /Users/chris.yates/src/collaborative-state-system/workers/.worktrees/add-agent-api-key-provider && pnpm test -- --run`
Expected: All existing tests continue to pass. The `AuthProvider` type expansion is backward-compatible since it is a union type and existing values remain valid.

**Step 6: Commit the implementation**

```bash
cd /Users/chris.yates/src/collaborative-state-system/workers/.worktrees/add-agent-api-key-provider
git add workers/src/types.ts workers/src/auth/agent-api-key-provider.ts
git commit -m "feat(auth): implement AgentApiKeyProvider for aak_ key authentication (B3)"
```

---

## Verification Checklist

After all tasks are complete, verify:

1. `workers/src/types.ts` -- `AuthProvider` includes `'agent_key'`
2. `workers/src/auth/agent-api-key-provider.ts` -- exists, exports `AgentApiKeyProvider`
3. `workers/tests/auth/agent-api-key-provider.spec.ts` -- all tests pass
4. `pnpm lint` -- no errors in new files
5. `pnpm test -- --run` -- full suite passes (no regressions)
6. Two commits on branch: tests (red), then implementation + type change (green)

## Files Changed Summary

| File | Action | Purpose |
|------|--------|---------|
| `workers/tests/auth/agent-api-key-provider.spec.ts` | Create | 15 unit tests covering interface, token rejection, key validation |
| `workers/src/types.ts` | Modify line 482 | Add `'agent_key'` to `AuthProvider` union |
| `workers/src/auth/agent-api-key-provider.ts` | Create | `AgentApiKeyProvider` class implementing `IdentityProvider` |
