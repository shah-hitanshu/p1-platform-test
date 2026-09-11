/**
 * Site API Token Service Tests
 *
 * Tests for per-site API token generation, validation, listing, and revocation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InferSelectModel } from 'drizzle-orm';
import { siteApiTokens } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  clearTokenValidationCache,
  generateToken,
  listTokens,
  revokeToken,
  validateToken,
} from '../../src/services/site-api-token-service';

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

describe('Site API Token Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock for SHA-256 digest — returns a predictable hash
    mockDigest.mockResolvedValue(
      new Uint8Array(32).fill(0xab).buffer,
    );

    database = stubDatabase();

    // The fixed digest means every token hashes identically across tests, so
    // the per-isolate validation cache must be emptied between them.
    clearTokenValidationCache();
  });

  type TokenRow = InferSelectModel<typeof siteApiTokens>;

  function tokenRow(overrides: Partial<TokenRow> = {}): Partial<TokenRow> {
    return {
      id: 'token-uuid-123',
      siteId: 'site-uuid-456',
      tokenHash: 'abababababababababababababababababababababababababababababababababab',
      prefix: 'sat_0d86',
      name: 'Production frontend',
      scopes: ['read:published'],
      createdBy: 'user-uuid-789',
      createdAt: new Date('2026-03-06T10:00:00.000Z'),
      lastUsedAt: null,
      revokedAt: null,
      ...overrides,
    };
  }

  // ===========================================================================
  // generateToken
  // ===========================================================================

  describe('generateToken', () => {
    it('should generate a token with sat_ prefix', async () => {
      database.on(siteApiTokens).insert.returns([tokenRow()]);

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'Production frontend',
        scopes: ['read:published'],
        createdBy: 'user-uuid-789',
      });

      expect(result.token).toMatch(/^sat_/);
    });

    it('should return the raw token only at creation time', async () => {
      database.on(siteApiTokens).insert.returns([tokenRow()]);

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'My token',
        scopes: ['read:published'],
        createdBy: 'user-uuid-789',
      });

      expect(result.token).toBeDefined();
      expect(result.token.length).toBeGreaterThan(20);
    });

    it('should return metadata alongside the raw token', async () => {
      database.on(siteApiTokens).insert.returns([tokenRow()]);

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'Production frontend',
        scopes: ['read:published'],
        createdBy: 'user-uuid-789',
      });

      expect(result.metadata.id).toBeDefined();
      expect(result.metadata.siteId).toBe('site-uuid-456');
      expect(result.metadata.name).toBe('Production frontend');
      expect(result.metadata.prefix).toMatch(/^sat_/);
      expect(result.metadata.scopes).toEqual(['read:published']);
      expect(result.metadata.createdAt).toEqual(new Date('2026-03-06T10:00:00.000Z'));
    });

    it('should store token hash, not the raw token', async () => {
      database.on(siteApiTokens).insert.returns([tokenRow()]);

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'My token',
        scopes: ['read:published'],
        createdBy: 'user-uuid-789',
      });

      const [insert] = database.calls(siteApiTokens).insert;
      expect(insert?.params).toContain('site-uuid-456');
      expect(insert?.params).not.toContain(result.token);
      // token_hash param is hex, so it carries neither the sat_ prefix nor the token
      const tokenHashParam = insert?.params.find(
        (p) => typeof p === 'string' && !p.startsWith('sat_') && p.length === 64,
      );
      expect(tokenHashParam).toBeDefined();
    });

    it('should store the prefix for display purposes', async () => {
      database.on(siteApiTokens).insert.returns([tokenRow()]);

      await generateToken({
        siteId: 'site-uuid-456',
        name: 'My token',
        scopes: ['read:published'],
        createdBy: 'user-uuid-789',
      });

      const [insert] = database.calls(siteApiTokens).insert;
      const prefixParam = insert?.params.find(
        (p) => typeof p === 'string' && p.startsWith('sat_') && p.length <= 12,
      );
      expect(prefixParam).toBeDefined();
    });

    it('should validate required siteId', async () => {
      await expect(
        generateToken({
          siteId: '',
          name: 'My token',
          scopes: ['read:published'],
          createdBy: 'user-uuid-789',
        }),
      ).rejects.toThrow();
    });

    it('should validate required name', async () => {
      await expect(
        generateToken({
          siteId: 'site-uuid-456',
          name: '',
          scopes: ['read:published'],
          createdBy: 'user-uuid-789',
        }),
      ).rejects.toThrow();
    });

    it('should validate required createdBy', async () => {
      await expect(
        generateToken({
          siteId: 'site-uuid-456',
          name: 'My token',
          scopes: ['read:published'],
          createdBy: '',
        }),
      ).rejects.toThrow();
    });

    it('should default scopes to read:published when not provided', async () => {
      database.on(siteApiTokens).insert.returns([tokenRow({ scopes: ['read:published'] })]);

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'My token',
        createdBy: 'user-uuid-789',
      });

      expect(result.metadata.scopes).toEqual(['read:published']);
    });

    it('should accept write:registry as a valid scope', async () => {
      database.on(siteApiTokens).insert.returns([tokenRow({ scopes: ['write:registry'] })]);

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'Registry CI sync token',
        scopes: ['write:registry'],
        createdBy: 'user-uuid-789',
      });

      expect(result.metadata.scopes).toEqual(['write:registry']);
    });

    it('should reject unknown scope strings', async () => {
      await expect(
        generateToken({
          siteId: 'site-uuid-456',
          name: 'My token',
          scopes: ['write:everything'],
          createdBy: 'user-uuid-789',
        }),
      ).rejects.toThrow(/Invalid scopes/);
    });
  });

  // ===========================================================================
  // validateToken
  // ===========================================================================

  describe('validateToken', () => {
    it('should return token info for a valid non-revoked token', async () => {
      database.on(siteApiTokens).select.returns([tokenRow()]);

      const result = await validateToken('sat_somevalidtoken');

      expect(result).not.toBeNull();
      expect(result?.siteId).toBe('site-uuid-456');
      expect(result?.scopes).toEqual(['read:published']);
      expect(result?.tokenId).toBe('token-uuid-123');
    });

    it('should return null for non-existent token', async () => {
      const result = await validateToken('sat_nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for empty token', async () => {
      const result = await validateToken('');

      expect(result).toBeNull();
    });

    it('should return null for token without sat_ prefix', async () => {
      const result = await validateToken('not_a_site_token');

      expect(result).toBeNull();
    });

    it('should hash the token before looking it up', async () => {
      await validateToken('sat_sometoken');

      expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
      // The hash, never the raw token, is what the lookup is parameterised by
      const [lookup] = database.calls(siteApiTokens).select;
      expect(lookup?.params).not.toContain('sat_sometoken');
    });

    it('should only match non-revoked tokens', async () => {
      await validateToken('sat_sometoken');

      const [lookup] = database.calls(siteApiTokens).select;
      expect(lookup?.sql).toContain('"revoked_at" is null');
    });
  });

  // ===========================================================================
  // validateToken memoization
  // ===========================================================================

  describe('validateToken memoization', () => {
    it('should serve repeat validations from the cache without a second query', async () => {
      database.on(siteApiTokens).select.returns([tokenRow()]);

      const first = await validateToken('sat_somevalidtoken');
      const second = await validateToken('sat_somevalidtoken');

      expect(first).toEqual(second);
      expect(database.calls(siteApiTokens).select).toHaveLength(1);
    });

    it('should cache misses so junk-token storms hit Postgres once', async () => {
      expect(await validateToken('sat_junk')).toBeNull();
      expect(await validateToken('sat_junk')).toBeNull();

      expect(database.calls(siteApiTokens).select).toHaveLength(1);
    });

    it('should collapse concurrent validations of the same token into one query', async () => {
      database.on(siteApiTokens).select.returns([tokenRow()]);

      const results = await Promise.all([
        validateToken('sat_somevalidtoken'),
        validateToken('sat_somevalidtoken'),
        validateToken('sat_somevalidtoken'),
      ]);

      expect(results.every((r) => r?.tokenId === 'token-uuid-123')).toBe(true);
      expect(database.calls(siteApiTokens).select).toHaveLength(1);
    });

    it('should not cache a failed lookup', async () => {
      database.on(siteApiTokens).select.rejects(new Error('connection reset'));

      await expect(validateToken('sat_somevalidtoken')).rejects.toThrow();
      await expect(validateToken('sat_somevalidtoken')).rejects.toThrow();

      expect(database.calls(siteApiTokens).select).toHaveLength(2);
    });

    it('should expire entries after the TTL', async () => {
      vi.useFakeTimers();
      try {
        database.on(siteApiTokens).select.returns([tokenRow()]);

        await validateToken('sat_somevalidtoken');
        vi.advanceTimersByTime(61_000);
        await validateToken('sat_somevalidtoken');

        expect(database.calls(siteApiTokens).select).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should drop cached entries when a token is revoked', async () => {
      database.on(siteApiTokens).select.returns([tokenRow()]);
      database.on(siteApiTokens).update.returns([tokenRow()]);

      await validateToken('sat_somevalidtoken');
      await revokeToken('token-uuid-123', 'site-uuid-456');
      await validateToken('sat_somevalidtoken');

      expect(database.calls(siteApiTokens).select).toHaveLength(2);
    });
  });

  // ===========================================================================
  // listTokens
  // ===========================================================================

  describe('listTokens', () => {
    it('should return token metadata for a site', async () => {
      database.on(siteApiTokens).select.returns([
        tokenRow({ id: 'token-1', name: 'Token A' }),
        tokenRow({ id: 'token-2', name: 'Token B' }),
      ]);

      const result = await listTokens('site-uuid-456');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('token-1');
      expect(result[0].name).toBe('Token A');
      expect(result[1].id).toBe('token-2');
    });

    it('should never return token hashes', async () => {
      database.on(siteApiTokens).select.returns([tokenRow()]);

      const result = await listTokens('site-uuid-456');

      const resultJson = JSON.stringify(result);
      expect(resultJson).not.toContain('token_hash');
      expect(resultJson).not.toContain('tokenHash');
    });

    it('should return empty array when no tokens exist', async () => {
      const result = await listTokens('non-existent-site');

      expect(result).toEqual([]);
    });

    it('should query by site_id', async () => {
      await listTokens('site-uuid-456');

      const [list] = database.calls(siteApiTokens).select;
      expect(list?.params).toContain('site-uuid-456');
      expect(list?.sql).toContain('"site_id"');
    });

    it('should include revoked status in results', async () => {
      database.on(siteApiTokens).select.returns([
        tokenRow({ id: 'active-token', revokedAt: null }),
        tokenRow({ id: 'revoked-token', revokedAt: new Date('2026-03-06T12:00:00.000Z') }),
      ]);

      const result = await listTokens('site-uuid-456');

      expect(result[0].revokedAt).toBeNull();
      expect(result[1].revokedAt).toEqual(new Date('2026-03-06T12:00:00.000Z'));
    });
  });

  // ===========================================================================
  // revokeToken
  // ===========================================================================

  describe('revokeToken', () => {
    it('should set revoked_at timestamp', async () => {
      database.on(siteApiTokens).update.returns([tokenRow()]);

      const result = await revokeToken('token-uuid-123', 'site-uuid-456');

      expect(result).toBe(true);
      const [revoke] = database.calls(siteApiTokens).update;
      expect(revoke?.sql).toContain('"revoked_at" =');
      expect(revoke?.params).toEqual(
        expect.arrayContaining(['token-uuid-123', 'site-uuid-456']),
      );
    });

    it('should return false when token not found', async () => {
      const result = await revokeToken('non-existent', 'site-uuid-456');

      expect(result).toBe(false);
    });

    it('should scope revocation to the specified site', async () => {
      database.on(siteApiTokens).update.returns([tokenRow()]);

      await revokeToken('token-uuid-123', 'site-uuid-456');

      const [revoke] = database.calls(siteApiTokens).update;
      expect(revoke?.sql).toContain('"site_id"');
      expect(revoke?.params).toContain('site-uuid-456');
    });
  });
});
