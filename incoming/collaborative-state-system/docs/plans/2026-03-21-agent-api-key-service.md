# Agent API Key Service (B2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Create `agent-api-key-service.ts` that generates, validates, lists, and revokes agent API keys with `aak_` prefix, modeled after the existing `site-api-token-service.ts`.

**Architecture:** The service provides four functions (`generateKey`, `validateKey`, `listKeys`, `revokeKey`) that manage rows in the `app.agent_api_keys` table (migration 027). Keys use the `aak_` prefix with base62-encoded random bytes, stored as SHA-256 hex hashes. Unlike site tokens, agent keys have no scopes -- authorization is handled by `agent_site_roles`. The `validateKey` function updates `last_used_at` on successful validation (an improvement over the site token service which does not track usage).

**Tech Stack:** TypeScript, Vitest (unit tests with mocked DB), `query()` from `src/db.ts`, Web Crypto API (`crypto.subtle.digest`, `crypto.getRandomValues`).

---

## Design Decisions

### 1. No scopes -- agent keys are authentication-only

Site tokens (`sat_`) have a `scopes` column (e.g., `['read:published']`) because each token is scoped to a specific site and grants limited permissions. Agent keys (`aak_`) are purely authentication credentials. Once an agent is authenticated, its authorization is determined by looking up per-site roles in `agent_site_roles`. This matches the user's approved Phase B plan and the migration 027 schema which has no `scopes` column.

### 2. `validateKey` updates `last_used_at` (fire-and-forget)

The existing `site-api-token-service.ts` does not update `last_used_at` on validation. The user explicitly requested this for agent keys. The update is performed as a fire-and-forget side effect (no `await` on the UPDATE query) so validation latency is not affected. The query uses the already-computed `token_hash` for the WHERE clause, which hits the partial index `idx_agent_api_keys_hash`.

### 3. `revokeKey` is scoped by `agentId` (not `siteId`)

Site token revocation is scoped by `siteId` because tokens belong to sites. Agent key revocation is scoped by `agentId` because keys belong to agents. The `revokeKey(keyId, agentId)` signature ensures a key can only be revoked through its owning agent, preventing cross-agent revocation.

### 4. `listKeys` returns only active (non-revoked) keys

Following the pattern from `site-api-token-service.ts`, `listKeys` only returns active (non-revoked) keys by default. This is the expected behavior for admin UIs showing manageable keys.

### 5. Reuse of helper functions

The `base62Encode` and `sha256Hex` helpers are identical to those in `site-api-token-service.ts`. They are duplicated rather than extracted to a shared module because: (a) they are small (< 10 lines each), (b) extracting them would create a cross-cutting refactor outside the scope of B2, and (c) the two services may diverge in the future. If a third token type emerges, a shared crypto-helpers module would be warranted.

---

### Task 1: Write the failing test file

**Files:**
- Create: `workers/tests/services/agent-api-key-service.spec.ts`

**Step 1: Write the failing test**

Create `workers/tests/services/agent-api-key-service.spec.ts` with the following content:

```typescript
/**
 * Agent API Key Service Tests (TDD)
 *
 * Tests for agent API key generation, validation, listing, and revocation.
 * Modeled after site-api-token-service.spec.ts but adapted for agent keys:
 * - Uses aak_ prefix instead of sat_
 * - No scopes (agent authorization comes from agent_site_roles)
 * - Keyed by agentId instead of siteId
 * - validateKey updates last_used_at
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock crypto.subtle for SHA-256 hashing
const mockDigest = vi.fn();
vi.stubGlobal('crypto', {
  subtle: { digest: mockDigest },
  getRandomValues: vi.fn((arr: Uint8Array) => {
    // Fill with deterministic bytes for testing
    for (let i = 0; i < arr.length; i++) {
      arr[i] = (i * 7 + 13) % 256;
    }
    return arr;
  }),
});

describe('Agent API Key Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock for SHA-256 digest — returns a predictable hash
    mockDigest.mockResolvedValue(
      new Uint8Array(32).fill(0xab).buffer,
    );
  });

  // Database row format matching app.agent_api_keys schema
  interface MockKeyRow {
    id: string;
    agent_id: string;
    token_hash: string;
    prefix: string;
    name: string;
    created_by: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }

  function createMockKeyRow(overrides: Partial<MockKeyRow> = {}): MockKeyRow {
    return {
      id: 'key-uuid-123',
      agent_id: 'agent-uuid-456',
      token_hash: 'abababababababababababababababababababababababababababababababababab',
      prefix: 'aak_0d86',
      name: 'Production agent key',
      created_by: 'user-uuid-789',
      created_at: '2026-03-21T10:00:00.000Z',
      last_used_at: null,
      revoked_at: null,
      ...overrides,
    };
  }

  // ===========================================================================
  // generateKey
  // ===========================================================================

  describe('generateKey', () => {
    it('should generate a key with aak_ prefix', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'Production agent key',
        createdBy: 'user-uuid-789',
      });

      expect(result.key).toMatch(/^aak_/);
    });

    it('should return the raw key only at creation time', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      expect(result.key).toBeDefined();
      expect(result.key.length).toBeGreaterThan(20);
    });

    it('should return metadata alongside the raw key', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'Production agent key',
        createdBy: 'user-uuid-789',
      });

      expect(result.metadata.id).toBeDefined();
      expect(result.metadata.agentId).toBe('agent-uuid-456');
      expect(result.metadata.name).toBe('Production agent key');
      expect(result.metadata.prefix).toMatch(/^aak_/);
      expect(result.metadata.createdAt).toBeDefined();
    });

    it('should not include scopes in metadata (agents use role-based auth)', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      const metadataJson = JSON.stringify(result.metadata);
      expect(metadataJson).not.toContain('scopes');
    });

    it('should store key hash, not the raw key', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      // The INSERT query should contain a hash, not the raw key
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['agent-uuid-456']),
      );

      // Verify the stored value is a hex hash, not starting with aak_
      const insertCall = vi.mocked(db.query).mock.calls[0];
      const params = insertCall[1] as string[];
      // token_hash param should be hex (no aak_ prefix)
      const tokenHashParam = params.find((p) => typeof p === 'string' && !p.startsWith('aak_') && p.length === 64);
      expect(tokenHashParam).toBeDefined();
    });

    it('should store the prefix for display purposes', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      // Verify a prefix starting with aak_ was passed to the query
      const insertCall = vi.mocked(db.query).mock.calls[0];
      const params = insertCall[1] as string[];
      const prefixParam = params.find((p) => typeof p === 'string' && p.startsWith('aak_') && p.length <= 12);
      expect(prefixParam).toBeDefined();
    });

    it('should validate required agentId', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');

      await expect(
        generateKey({
          agentId: '',
          name: 'My key',
          createdBy: 'user-uuid-789',
        }),
      ).rejects.toThrow('agentId is required');
    });

    it('should validate required name', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');

      await expect(
        generateKey({
          agentId: 'agent-uuid-456',
          name: '',
          createdBy: 'user-uuid-789',
        }),
      ).rejects.toThrow('name is required');
    });

    it('should validate required createdBy', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');

      await expect(
        generateKey({
          agentId: 'agent-uuid-456',
          name: 'My key',
          createdBy: '',
        }),
      ).rejects.toThrow('createdBy is required');
    });

    it('should insert into app.agent_api_keys table', async () => {
      const { generateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('app.agent_api_keys'),
        expect.any(Array),
      );
    });
  });

  // ===========================================================================
  // validateKey
  // ===========================================================================

  describe('validateKey', () => {
    it('should return key info for a valid non-revoked key', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await validateKey('aak_somevalidkey');

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('agent-uuid-456');
      expect(result?.keyId).toBe('key-uuid-123');
    });

    it('should not include scopes in validation result', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await validateKey('aak_somevalidkey');

      expect(result).not.toBeNull();
      const resultJson = JSON.stringify(result);
      expect(resultJson).not.toContain('scopes');
    });

    it('should return null for non-existent key', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await validateKey('aak_nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for empty key', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');

      const result = await validateKey('');

      expect(result).toBeNull();
    });

    it('should return null for key without aak_ prefix', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');

      const result = await validateKey('not_an_agent_key');

      expect(result).toBeNull();
    });

    it('should return null for key that is just the prefix', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');

      const result = await validateKey('aak_');

      expect(result).toBeNull();
    });

    it('should hash the key before looking it up', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await validateKey('aak_somekey');

      // Should have called crypto.subtle.digest
      expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
    });

    it('should only match non-revoked keys', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await validateKey('aak_somekey');

      // The first query (SELECT) should filter by revoked_at IS NULL
      const firstCall = vi.mocked(db.query).mock.calls[0];
      expect(firstCall[0]).toContain('revoked_at IS NULL');
    });

    it('should update last_used_at on successful validation', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRow = createMockKeyRow();
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [mockRow] })  // SELECT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE last_used_at

      await validateKey('aak_somevalidkey');

      // Should have made two queries: SELECT + UPDATE last_used_at
      expect(db.query).toHaveBeenCalledTimes(2);
      const updateCall = vi.mocked(db.query).mock.calls[1];
      expect(updateCall[0]).toContain('last_used_at');
      expect(updateCall[0]).toContain('UPDATE');
    });

    it('should not update last_used_at when key is not found', async () => {
      const { validateKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await validateKey('aak_nonexistent');

      // Should have only made the SELECT query, not the UPDATE
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // listKeys
  // ===========================================================================

  describe('listKeys', () => {
    it('should return key metadata for an agent', async () => {
      const { listKeys } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockKeyRow({ id: 'key-1', name: 'Key A' }),
        createMockKeyRow({ id: 'key-2', name: 'Key B' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listKeys('agent-uuid-456');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('key-1');
      expect(result[0].name).toBe('Key A');
      expect(result[1].id).toBe('key-2');
    });

    it('should never return key hashes', async () => {
      const { listKeys } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      const mockRows = [createMockKeyRow()];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listKeys('agent-uuid-456');

      // The result should not contain tokenHash
      const resultJson = JSON.stringify(result);
      expect(resultJson).not.toContain('token_hash');
      expect(resultJson).not.toContain('tokenHash');
    });

    it('should return empty array when no keys exist', async () => {
      const { listKeys } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listKeys('non-existent-agent');

      expect(result).toEqual([]);
    });

    it('should query by agent_id', async () => {
      const { listKeys } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listKeys('agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('agent_id'),
        expect.arrayContaining(['agent-uuid-456']),
      );
    });

    it('should only return non-revoked keys', async () => {
      const { listKeys } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listKeys('agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at IS NULL'),
        expect.any(Array),
      );
    });

    it('should order by created_at descending', async () => {
      const { listKeys } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listKeys('agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Array),
      );
    });
  });

  // ===========================================================================
  // revokeKey
  // ===========================================================================

  describe('revokeKey', () => {
    it('should set revoked_at timestamp', async () => {
      const { revokeKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await revokeKey('key-uuid-123', 'agent-uuid-456');

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at'),
        expect.arrayContaining(['key-uuid-123', 'agent-uuid-456']),
      );
    });

    it('should return false when key not found', async () => {
      const { revokeKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await revokeKey('non-existent', 'agent-uuid-456');

      expect(result).toBe(false);
    });

    it('should scope revocation to the specified agent', async () => {
      const { revokeKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      await revokeKey('key-uuid-123', 'agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('agent_id'),
        expect.arrayContaining(['agent-uuid-456']),
      );
    });

    it('should only revoke non-revoked keys', async () => {
      const { revokeKey } = await import('../../src/services/agent-api-key-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      await revokeKey('key-uuid-123', 'agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at IS NULL'),
        expect.any(Array),
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-key-service/workers && npx vitest run tests/services/agent-api-key-service.spec.ts`

Expected: FAIL with "Cannot find module '../../src/services/agent-api-key-service'" or similar import error.

**Step 3: Commit the test**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-key-service
git add workers/tests/services/agent-api-key-service.spec.ts
git commit -m "test: add agent API key service unit tests (B2)"
```

---

### Task 2: Implement the agent API key service

**Files:**
- Create: `workers/src/services/agent-api-key-service.ts`

**Step 1: Write the implementation**

Create `workers/src/services/agent-api-key-service.ts` with the following content:

```typescript
/**
 * Agent API Key Service
 *
 * Manages API keys for agent authentication.
 * Keys are opaque strings prefixed with "aak_", stored as SHA-256 hashes.
 * The raw key is returned only once at creation time.
 *
 * Unlike site API tokens (sat_), agent keys have no scopes.
 * Authorization is determined by per-site roles in agent_site_roles.
 */

import { query } from '../db';

// =============================================================================
// Types
// =============================================================================

export interface GenerateKeyParams {
  agentId: string;
  name: string;
  createdBy: string;
}

export interface GenerateKeyResult {
  /** Raw key — shown only once */
  key: string;
  /** Key metadata (safe to store/display) */
  metadata: KeyMetadata;
}

export interface KeyMetadata {
  id: string;
  agentId: string;
  prefix: string;
  name: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ValidateKeyResult {
  keyId: string;
  agentId: string;
}

interface KeyRow {
  id: string;
  agent_id: string;
  token_hash: string;
  prefix: string;
  name: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// =============================================================================
// Constants
// =============================================================================

const KEY_PREFIX = 'aak_';
const KEY_RANDOM_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 8; // chars after aak_ to store for display

// Base62 alphabet for encoding
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// =============================================================================
// Helpers
// =============================================================================

function base62Encode(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += BASE62_CHARS.charAt(byte % 62);
  }
  return result;
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function mapRowToMetadata(row: KeyRow): KeyMetadata {
  return {
    id: row.id,
    agentId: row.agent_id,
    prefix: row.prefix,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Generate a new agent API key.
 *
 * @returns The raw key (shown once) and its metadata
 */
export async function generateKey(
  params: GenerateKeyParams,
): Promise<GenerateKeyResult> {
  if (!params.agentId || params.agentId.trim() === '') {
    throw new Error('agentId is required');
  }
  if (!params.name || params.name.trim() === '') {
    throw new Error('name is required');
  }
  if (!params.createdBy || params.createdBy.trim() === '') {
    throw new Error('createdBy is required');
  }

  // Generate random bytes and encode as base62
  const randomBytes = new Uint8Array(KEY_RANDOM_BYTES);
  crypto.getRandomValues(randomBytes);
  const randomPart = base62Encode(randomBytes);

  const rawKey = KEY_PREFIX + randomPart;
  const prefix = rawKey.substring(0, KEY_PREFIX.length + DISPLAY_PREFIX_LENGTH);
  const tokenHash = await sha256Hex(rawKey);

  const result = await query<KeyRow>(
    `INSERT INTO app.agent_api_keys (agent_id, token_hash, prefix, name, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.agentId, tokenHash, prefix, params.name, params.createdBy],
  );

  return {
    key: rawKey,
    metadata: mapRowToMetadata(result.rows[0]),
  };
}

/**
 * Validate a raw agent API key.
 *
 * Updates last_used_at on successful validation (fire-and-forget).
 *
 * @returns Key info if valid and not revoked, null otherwise
 */
export async function validateKey(
  rawKey: string,
): Promise<ValidateKeyResult | null> {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX) || rawKey === KEY_PREFIX) {
    return null;
  }

  const tokenHash = await sha256Hex(rawKey);

  const result = await query<KeyRow>(
    `SELECT id, agent_id
     FROM app.agent_api_keys
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Fire-and-forget: update last_used_at without blocking the response
  void query(
    `UPDATE app.agent_api_keys SET last_used_at = NOW() WHERE token_hash = $1`,
    [tokenHash],
  );

  return {
    keyId: row.id,
    agentId: row.agent_id,
  };
}

/**
 * List active (non-revoked) keys for an agent (metadata only, never hashes).
 */
export async function listKeys(agentId: string): Promise<KeyMetadata[]> {
  const result = await query<KeyRow>(
    `SELECT id, agent_id, prefix, name, created_by, created_at, last_used_at, revoked_at
     FROM app.agent_api_keys
     WHERE agent_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [agentId],
  );

  return result.rows.map(mapRowToMetadata);
}

/**
 * Revoke a key by setting its revoked_at timestamp.
 *
 * @returns true if revoked, false if not found
 */
export async function revokeKey(
  keyId: string,
  agentId: string,
): Promise<boolean> {
  const result = await query(
    `UPDATE app.agent_api_keys
     SET revoked_at = NOW()
     WHERE id = $1 AND agent_id = $2 AND revoked_at IS NULL`,
    [keyId, agentId],
  );

  return (result.rowCount ?? 0) > 0;
}
```

**Step 2: Run tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-key-service/workers && npx vitest run tests/services/agent-api-key-service.spec.ts`

Expected: All tests PASS.

**Step 3: Run lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-key-service/workers && pnpm lint`

Expected: 0 errors.

**Step 4: Run the full service test suite to check for regressions**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-key-service/workers && npx vitest run tests/services/`

Expected: All tests PASS (site-api-token-service.spec.ts + agent-api-key-service.spec.ts + any others).

**Step 5: Commit the implementation**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/add-agent-api-key-service
git add workers/src/services/agent-api-key-service.ts
git commit -m "feat: add agent API key service with generate/validate/list/revoke (B2)"
```

---

## Verification Checklist

After both tasks are complete, verify:

1. **Test count**: `npx vitest run tests/services/agent-api-key-service.spec.ts` shows all 26 tests passing
2. **No regressions**: `npx vitest run tests/services/` shows all service tests passing
3. **Lint clean**: `pnpm lint` reports 0 errors
4. **Exports**: The service exports `generateKey`, `validateKey`, `listKeys`, `revokeKey`, `GenerateKeyParams`, `GenerateKeyResult`, `KeyMetadata`, `ValidateKeyResult`
5. **No scopes**: Unlike `site-api-token-service.ts`, no `scopes` field exists in types, queries, or results
6. **`aak_` prefix**: All generated keys start with `aak_`
7. **`last_used_at` update**: `validateKey` fires an UPDATE query on success
8. **Revocation scoped to agent**: `revokeKey(keyId, agentId)` includes `agent_id` in WHERE clause

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `workers/tests/services/agent-api-key-service.spec.ts` | Create | 26 unit tests covering generateKey, validateKey, listKeys, revokeKey |
| `workers/src/services/agent-api-key-service.ts` | Create | Service implementation with aak_ prefix, SHA-256 hashing, no scopes |
