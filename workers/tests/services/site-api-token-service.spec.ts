/**
 * Site API Token Service Tests (TDD)
 *
 * Tests for per-site API token generation, validation, listing, and revocation.
 * Tests should FAIL initially until implementation is complete.
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

describe('Site API Token Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock for SHA-256 digest — returns a predictable hash
    mockDigest.mockResolvedValue(
      new Uint8Array(32).fill(0xab).buffer,
    );
  });

  // Database row format
  interface MockTokenRow {
    id: string;
    site_id: string;
    token_hash: string;
    prefix: string;
    name: string;
    scopes: string[];
    created_by: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }

  function createMockTokenRow(overrides: Partial<MockTokenRow> = {}): MockTokenRow {
    return {
      id: 'token-uuid-123',
      site_id: 'site-uuid-456',
      token_hash: 'abababababababababababababababababababababababababababababababababab',
      prefix: 'sat_0d86',
      name: 'Production frontend',
      scopes: ['read:published'],
      created_by: 'user-uuid-789',
      created_at: '2026-03-06T10:00:00.000Z',
      last_used_at: null,
      revoked_at: null,
      ...overrides,
    };
  }

  // ===========================================================================
  // generateToken
  // ===========================================================================

  describe('generateToken', () => {
    it('should generate a token with sat_ prefix', async () => {
      const { generateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRow = createMockTokenRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'Production frontend',
        scopes: ['read:published'],
        createdBy: 'user-uuid-789',
      });

      expect(result.token).toMatch(/^sat_/);
    });

    it('should return the raw token only at creation time', async () => {
      const { generateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRow = createMockTokenRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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
      const { generateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRow = createMockTokenRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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
      expect(result.metadata.createdAt).toBeDefined();
    });

    it('should store token hash, not the raw token', async () => {
      const { generateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRow = createMockTokenRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await generateToken({
        siteId: 'site-uuid-456',
        name: 'My token',
        scopes: ['read:published'],
        createdBy: 'user-uuid-789',
      });

      // The INSERT query should contain a hash, not the raw token
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['site-uuid-456']),
      );

      // Verify the stored value is a hex hash, not starting with sat_
      const insertCall = vi.mocked(db.query).mock.calls[0];
      const params = insertCall[1] as string[];
      // token_hash param should be hex (no sat_ prefix)
      const tokenHashParam = params.find((p) => typeof p === 'string' && !p.startsWith('sat_') && p.length === 64);
      expect(tokenHashParam).toBeDefined();
    });

    it('should store the prefix for display purposes', async () => {
      const { generateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRow = createMockTokenRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await generateToken({
        siteId: 'site-uuid-456',
        name: 'My token',
        scopes: ['read:published'],
        createdBy: 'user-uuid-789',
      });

      // Verify a prefix starting with sat_ was passed to the query
      const insertCall = vi.mocked(db.query).mock.calls[0];
      const params = insertCall[1] as string[];
      const prefixParam = params.find((p) => typeof p === 'string' && p.startsWith('sat_') && p.length <= 12);
      expect(prefixParam).toBeDefined();
    });

    it('should validate required siteId', async () => {
      const { generateToken } = await import('../../src/services/site-api-token-service');

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
      const { generateToken } = await import('../../src/services/site-api-token-service');

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
      const { generateToken } = await import('../../src/services/site-api-token-service');

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
      const { generateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRow = createMockTokenRow({ scopes: ['read:published'] });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'My token',
        createdBy: 'user-uuid-789',
      });

      expect(result.metadata.scopes).toEqual(['read:published']);
    });

    it('should accept write:registry as a valid scope', async () => {
      const { generateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRow = createMockTokenRow({ scopes: ['write:registry'] });
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await generateToken({
        siteId: 'site-uuid-456',
        name: 'Registry CI sync token',
        scopes: ['write:registry'],
        createdBy: 'user-uuid-789',
      });

      expect(result.metadata.scopes).toEqual(['write:registry']);
    });

    it('should reject unknown scope strings', async () => {
      const { generateToken } = await import('../../src/services/site-api-token-service');

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
      const { validateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRow = createMockTokenRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      const result = await validateToken('sat_somevalidtoken');

      expect(result).not.toBeNull();
      expect(result?.siteId).toBe('site-uuid-456');
      expect(result?.scopes).toEqual(['read:published']);
      expect(result?.tokenId).toBe('token-uuid-123');
    });

    it('should return null for non-existent token', async () => {
      const { validateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await validateToken('sat_nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for empty token', async () => {
      const { validateToken } = await import('../../src/services/site-api-token-service');

      const result = await validateToken('');

      expect(result).toBeNull();
    });

    it('should return null for token without sat_ prefix', async () => {
      const { validateToken } = await import('../../src/services/site-api-token-service');

      const result = await validateToken('not_a_site_token');

      expect(result).toBeNull();
    });

    it('should hash the token before looking it up', async () => {
      const { validateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await validateToken('sat_sometoken');

      // Should have called crypto.subtle.digest
      expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
    });

    it('should only match non-revoked tokens', async () => {
      const { validateToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await validateToken('sat_sometoken');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at IS NULL'),
        expect.any(Array),
      );
    });
  });

  // ===========================================================================
  // listTokens
  // ===========================================================================

  describe('listTokens', () => {
    it('should return token metadata for a site', async () => {
      const { listTokens } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockTokenRow({ id: 'token-1', name: 'Token A' }),
        createMockTokenRow({ id: 'token-2', name: 'Token B' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listTokens('site-uuid-456');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('token-1');
      expect(result[0].name).toBe('Token A');
      expect(result[1].id).toBe('token-2');
    });

    it('should never return token hashes', async () => {
      const { listTokens } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRows = [createMockTokenRow()];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listTokens('site-uuid-456');

      // The result should not contain tokenHash
      const resultJson = JSON.stringify(result);
      expect(resultJson).not.toContain('token_hash');
      expect(resultJson).not.toContain('tokenHash');
    });

    it('should return empty array when no tokens exist', async () => {
      const { listTokens } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listTokens('non-existent-site');

      expect(result).toEqual([]);
    });

    it('should query by site_id', async () => {
      const { listTokens } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listTokens('site-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('site_id'),
        expect.arrayContaining(['site-uuid-456']),
      );
    });

    it('should include revoked status in results', async () => {
      const { listTokens } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockTokenRow({ id: 'active-token', revoked_at: null }),
        createMockTokenRow({ id: 'revoked-token', revoked_at: '2026-03-06T12:00:00.000Z' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

      const result = await listTokens('site-uuid-456');

      expect(result[0].revokedAt).toBeNull();
      expect(result[1].revokedAt).toBe('2026-03-06T12:00:00.000Z');
    });
  });

  // ===========================================================================
  // revokeToken
  // ===========================================================================

  describe('revokeToken', () => {
    it('should set revoked_at timestamp', async () => {
      const { revokeToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await revokeToken('token-uuid-123', 'site-uuid-456');

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at'),
        expect.arrayContaining(['token-uuid-123', 'site-uuid-456']),
      );
    });

    it('should return false when token not found', async () => {
      const { revokeToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await revokeToken('non-existent', 'site-uuid-456');

      expect(result).toBe(false);
    });

    it('should scope revocation to the specified site', async () => {
      const { revokeToken } = await import('../../src/services/site-api-token-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      await revokeToken('token-uuid-123', 'site-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('site_id'),
        expect.arrayContaining(['site-uuid-456']),
      );
    });
  });
});
