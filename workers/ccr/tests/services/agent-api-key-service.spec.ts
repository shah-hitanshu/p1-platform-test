/**
 * Agent API Key Service Tests
 *
 * Tests for agent API key generation, validation, listing, and revocation.
 * Modeled after site-api-token-service.spec.ts but adapted for agent keys:
 * - Uses aak_ prefix instead of sat_
 * - No scopes (agent authorization comes from agent_site_roles)
 * - Keyed by agentId instead of siteId
 * - validateKey updates last_used_at
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InferSelectModel } from 'drizzle-orm';
import { agentApiKeys } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  generateKey,
  listKeys,
  revokeKey,
  validateKey,
} from '../../src/services/agent-api-key-service';

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
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock for SHA-256 digest — returns a predictable hash
    mockDigest.mockResolvedValue(
      new Uint8Array(32).fill(0xab).buffer,
    );

    database = stubDatabase();
  });

  type KeyRow = InferSelectModel<typeof agentApiKeys>;

  function keyRow(overrides: Partial<KeyRow> = {}): Partial<KeyRow> {
    return {
      id: 'key-uuid-123',
      agentId: 'agent-uuid-456',
      tokenHash: 'abababababababababababababababababababababababababababababababababab',
      prefix: 'aak_0d86',
      name: 'Production agent key',
      createdBy: 'user-uuid-789',
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      lastUsedAt: null,
      revokedAt: null,
      ...overrides,
    };
  }

  // ===========================================================================
  // generateKey
  // ===========================================================================

  describe('generateKey', () => {
    it('should generate a key with aak_ prefix', async () => {
      database.on(agentApiKeys).insert.returns([keyRow()]);

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'Production agent key',
        createdBy: 'user-uuid-789',
      });

      expect(result.key).toMatch(/^aak_/);
    });

    it('should return the raw key only at creation time', async () => {
      database.on(agentApiKeys).insert.returns([keyRow()]);

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      expect(result.key).toBeDefined();
      expect(result.key.length).toBeGreaterThan(20);
    });

    it('should return metadata alongside the raw key', async () => {
      database.on(agentApiKeys).insert.returns([keyRow()]);

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'Production agent key',
        createdBy: 'user-uuid-789',
      });

      expect(result.metadata.id).toBeDefined();
      expect(result.metadata.agentId).toBe('agent-uuid-456');
      expect(result.metadata.name).toBe('Production agent key');
      expect(result.metadata.prefix).toMatch(/^aak_/);
      expect(result.metadata.createdAt).toEqual(new Date('2026-03-21T10:00:00.000Z'));
    });

    it('should not include scopes in metadata (agents use role-based auth)', async () => {
      database.on(agentApiKeys).insert.returns([keyRow()]);

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      const metadataJson = JSON.stringify(result.metadata);
      expect(metadataJson).not.toContain('scopes');
    });

    it('should store key hash, not the raw key', async () => {
      database.on(agentApiKeys).insert.returns([keyRow()]);

      const result = await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      const [insert] = database.calls(agentApiKeys).insert;
      expect(insert?.params).toContain('agent-uuid-456');
      expect(insert?.params).not.toContain(result.key);
      // token_hash param is hex, so it carries neither the aak_ prefix nor the key
      const tokenHashParam = insert?.params.find(
        (p) => typeof p === 'string' && !p.startsWith('aak_') && p.length === 64,
      );
      expect(tokenHashParam).toBeDefined();
    });

    it('should store the prefix for display purposes', async () => {
      database.on(agentApiKeys).insert.returns([keyRow()]);

      await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      const [insert] = database.calls(agentApiKeys).insert;
      const prefixParam = insert?.params.find(
        (p) => typeof p === 'string' && p.startsWith('aak_') && p.length <= 12,
      );
      expect(prefixParam).toBeDefined();
    });

    it('should validate required agentId', async () => {
      await expect(
        generateKey({
          agentId: '',
          name: 'My key',
          createdBy: 'user-uuid-789',
        }),
      ).rejects.toThrow('agentId is required');
    });

    it('should validate required name', async () => {
      await expect(
        generateKey({
          agentId: 'agent-uuid-456',
          name: '',
          createdBy: 'user-uuid-789',
        }),
      ).rejects.toThrow('name is required');
    });

    it('should validate required createdBy', async () => {
      await expect(
        generateKey({
          agentId: 'agent-uuid-456',
          name: 'My key',
          createdBy: '',
        }),
      ).rejects.toThrow('createdBy is required');
    });

    it('should insert into the agent_api_keys table', async () => {
      database.on(agentApiKeys).insert.returns([keyRow()]);

      await generateKey({
        agentId: 'agent-uuid-456',
        name: 'My key',
        createdBy: 'user-uuid-789',
      });

      expect(database.calls(agentApiKeys).insert).toHaveLength(1);
    });
  });

  // ===========================================================================
  // validateKey
  // ===========================================================================

  describe('validateKey', () => {
    it('should return key info for a valid non-revoked key', async () => {
      database.on(agentApiKeys).select.returns([keyRow()]);

      const result = await validateKey('aak_somevalidkey');

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('agent-uuid-456');
      expect(result?.keyId).toBe('key-uuid-123');
    });

    it('should not include scopes in validation result', async () => {
      database.on(agentApiKeys).select.returns([keyRow()]);

      const result = await validateKey('aak_somevalidkey');

      expect(result).not.toBeNull();
      const resultJson = JSON.stringify(result);
      expect(resultJson).not.toContain('scopes');
    });

    it('should return null for non-existent key', async () => {
      const result = await validateKey('aak_nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for empty key', async () => {
      const result = await validateKey('');

      expect(result).toBeNull();
    });

    it('should return null for key without aak_ prefix', async () => {
      const result = await validateKey('not_an_agent_key');

      expect(result).toBeNull();
    });

    it('should return null for key that is just the prefix', async () => {
      const result = await validateKey('aak_');

      expect(result).toBeNull();
    });

    it('should hash the key before looking it up', async () => {
      await validateKey('aak_somekey');

      expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
      // The hash, never the raw key, is what the lookup is parameterised by
      const [lookup] = database.calls(agentApiKeys).select;
      expect(lookup?.params).not.toContain('aak_somekey');
    });

    it('should only match non-revoked keys', async () => {
      await validateKey('aak_somekey');

      const [lookup] = database.calls(agentApiKeys).select;
      expect(lookup?.sql).toContain('"revoked_at" is null');
    });

    it('should update last_used_at on successful validation', async () => {
      database.on(agentApiKeys).select.returns([keyRow()]);

      await validateKey('aak_somevalidkey');

      const [touch] = database.calls(agentApiKeys).update;
      expect(touch?.sql).toContain('"last_used_at"');
    });

    it('should not update last_used_at when key is not found', async () => {
      await validateKey('aak_nonexistent');

      expect(database.calls(agentApiKeys).update).toEqual([]);
    });
  });

  // ===========================================================================
  // listKeys
  // ===========================================================================

  describe('listKeys', () => {
    it('should return key metadata for an agent', async () => {
      database.on(agentApiKeys).select.returns([
        keyRow({ id: 'key-1', name: 'Key A' }),
        keyRow({ id: 'key-2', name: 'Key B' }),
      ]);

      const result = await listKeys('agent-uuid-456');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('key-1');
      expect(result[0].name).toBe('Key A');
      expect(result[1].id).toBe('key-2');
    });

    it('should never return key hashes', async () => {
      database.on(agentApiKeys).select.returns([keyRow()]);

      const result = await listKeys('agent-uuid-456');

      const resultJson = JSON.stringify(result);
      expect(resultJson).not.toContain('token_hash');
      expect(resultJson).not.toContain('tokenHash');
    });

    it('should return empty array when no keys exist', async () => {
      const result = await listKeys('non-existent-agent');

      expect(result).toEqual([]);
    });

    it('should query by agent_id', async () => {
      await listKeys('agent-uuid-456');

      const [list] = database.calls(agentApiKeys).select;
      expect(list?.params).toContain('agent-uuid-456');
      expect(list?.sql).toContain('"agent_id"');
    });

    it('should only return non-revoked keys', async () => {
      await listKeys('agent-uuid-456');

      const [list] = database.calls(agentApiKeys).select;
      expect(list?.sql).toContain('"revoked_at" is null');
    });

    it('should order by created_at descending', async () => {
      await listKeys('agent-uuid-456');

      const [list] = database.calls(agentApiKeys).select;
      expect(list?.sql).toContain('order by');
      expect(list?.sql).toContain('"created_at" desc');
    });
  });

  // ===========================================================================
  // revokeKey
  // ===========================================================================

  describe('revokeKey', () => {
    it('should set revoked_at timestamp', async () => {
      database.on(agentApiKeys).update.returns([keyRow()]);

      const result = await revokeKey('key-uuid-123', 'agent-uuid-456');

      expect(result).toBe(true);
      const [revoke] = database.calls(agentApiKeys).update;
      expect(revoke?.sql).toContain('"revoked_at" =');
      expect(revoke?.params).toEqual(
        expect.arrayContaining(['key-uuid-123', 'agent-uuid-456']),
      );
    });

    it('should return false when key not found', async () => {
      const result = await revokeKey('non-existent', 'agent-uuid-456');

      expect(result).toBe(false);
    });

    it('should scope revocation to the specified agent', async () => {
      database.on(agentApiKeys).update.returns([keyRow()]);

      await revokeKey('key-uuid-123', 'agent-uuid-456');

      const [revoke] = database.calls(agentApiKeys).update;
      expect(revoke?.sql).toContain('"agent_id"');
      expect(revoke?.params).toContain('agent-uuid-456');
    });

    it('should only revoke non-revoked keys', async () => {
      database.on(agentApiKeys).update.returns([keyRow()]);

      await revokeKey('key-uuid-123', 'agent-uuid-456');

      const [revoke] = database.calls(agentApiKeys).update;
      expect(revoke?.sql).toContain('"revoked_at" is null');
    });
  });
});
