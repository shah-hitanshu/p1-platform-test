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
