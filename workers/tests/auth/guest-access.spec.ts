/**
 * Phase 2.2: Authorization System - Guest Access Validation Tests
 *
 * Tests for guest link validation and guest principal creation.
 * Based on collaborative-state-system-architecture-v2.2.md Section "Guest Access"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GuestLink, GuestLinkStatus } from '../../src/types';
import * as crypto from 'crypto';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 2.2: Guest Access Validation', () => {
  // Helper to create a valid token hash
  function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // Helper to create a mock guest link record
  function createGuestLinkRecord(overrides: Partial<GuestLink> = {}): GuestLink {
    return {
      id: 'guest-link-123',
      branchId: 'branch-1',
      email: 'guest@example.com',
      name: 'Guest User',
      tokenHash: hashToken('valid-token'),
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000).toISOString(), // 24 hours from now
      createdById: 'user-123',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
      accessCount: 0,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('validateGuestToken', () => {
    it('should return a guest principal for valid token', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord();

      vi.mocked(db.query).mockResolvedValue({
        rows: [guestLink],
      });

      const result = await validateGuestToken('valid-token');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('guest-link-123');
      expect(result?.type).toBe('guest');
      expect(result?.branchId).toBe('branch-1');
    });

    it('should hash the token before querying', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const token = 'my-secret-token';
      const expectedHash = hashToken(token);

      await validateGuestToken(token);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('token_hash'),
        expect.arrayContaining([expectedHash])
      );
    });

    it('should return null for non-existent token', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await validateGuestToken('invalid-token');

      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const expiredGuestLink = createGuestLinkRecord({
        expiresAt: new Date(Date.now() - 86400000).toISOString(), // 24 hours ago
      });

      // Database query checks expiry in WHERE clause
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await validateGuestToken('valid-token');

      expect(result).toBeNull();
    });

    it('should return null for revoked token', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      // Database query checks status = 'active' in WHERE clause
      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await validateGuestToken('valid-token');

      expect(result).toBeNull();
    });

    it('should check status is active in query', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await validateGuestToken('some-token');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/status\s*=\s*['"]?active/i),
        expect.any(Array)
      );
    });

    it('should check expiration time in query', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await validateGuestToken('some-token');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/expires_at\s*>/i),
        expect.any(Array)
      );
    });
  });

  describe('Guest principal structure', () => {
    it('should include email from guest link', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord({
        email: 'special-guest@company.com',
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [guestLink] });

      const result = await validateGuestToken('valid-token');

      expect(result?.email).toBe('special-guest@company.com');
    });

    it('should include name from guest link', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord({
        name: 'John Doe',
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [guestLink] });

      const result = await validateGuestToken('valid-token');

      expect(result?.name).toBe('John Doe');
    });

    it('should include branchId for scoped access', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord({
        branchId: 'specific-branch-id',
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [guestLink] });

      const result = await validateGuestToken('valid-token');

      expect(result?.branchId).toBe('specific-branch-id');
    });

    it('should have fixed VIEWER role', async () => {
      const { validateGuestToken, GUEST_ROLE } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord();

      vi.mocked(db.query).mockResolvedValue({ rows: [guestLink] });

      const result = await validateGuestToken('valid-token');

      expect(result?.roleName).toBe('VIEWER');
      expect(GUEST_ROLE.canView).toBe(true);
      expect(GUEST_ROLE.canEdit).toBe(false);
    });
  });

  describe('GuestPrincipal type', () => {
    it('should have type property set to guest', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord();

      vi.mocked(db.query).mockResolvedValue({ rows: [guestLink] });

      const result = await validateGuestToken('valid-token');

      expect(result?.type).toBe('guest');
    });

    it('should have pantheonSiteRoles as empty object', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord();

      vi.mocked(db.query).mockResolvedValue({ rows: [guestLink] });

      const result = await validateGuestToken('valid-token');

      expect(result?.pantheonSiteRoles).toEqual({});
    });

    it('should include token expiry from guest link', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const guestLink = createGuestLinkRecord({
        expiresAt: futureDate,
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [guestLink] });

      const result = await validateGuestToken('valid-token');

      expect(result?.tokenExpiry).toBe(futureDate);
    });
  });

  describe('Access tracking', () => {
    it('should increment access count after successful validation', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord();

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [guestLink] }) // SELECT query
        .mockResolvedValueOnce({ rows: [] }); // UPDATE query

      await validateGuestToken('valid-token');

      // Check that an UPDATE query was made
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query).toHaveBeenLastCalledWith(
        expect.stringMatching(/UPDATE.*guest_links.*access_count/is),
        expect.arrayContaining(['guest-link-123'])
      );
    });

    it('should update last_access_at timestamp', async () => {
      const { validateGuestToken } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const guestLink = createGuestLinkRecord();

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [guestLink] })
        .mockResolvedValueOnce({ rows: [] });

      await validateGuestToken('valid-token');

      expect(db.query).toHaveBeenLastCalledWith(
        expect.stringMatching(/last_access_at/i),
        expect.any(Array)
      );
    });
  });

  describe('createGuestLink', () => {
    it('should create a new guest link record', async () => {
      const { createGuestLink } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{
          id: 'new-guest-link-id',
          token_hash: 'some-hash',
        }],
      });

      const result = await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        name: 'Guest User',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 24,
        message: 'Welcome!',
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('token'); // Unhashed token returned once
    });

    it('should generate a secure random token', async () => {
      const { createGuestLink } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: 'new-id', token_hash: 'hash' }],
      });

      const result = await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 24,
      });

      // Token should be a hex string of sufficient length
      expect(result.token).toMatch(/^[a-f0-9]{32,}$/i);
    });

    it('should store hashed token in database', async () => {
      const { createGuestLink } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: 'new-id', token_hash: 'hash' }],
      });

      await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 24,
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT'),
        expect.arrayContaining([
          expect.stringMatching(/^[a-f0-9]{64}$/i), // SHA-256 hash is 64 hex chars
        ])
      );
    });

    it('should set status to active', async () => {
      const { createGuestLink } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: 'new-id', token_hash: 'hash' }],
      });

      await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 24,
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['active'])
      );
    });

    it('should set expiration based on expiresInHours', async () => {
      const { createGuestLink } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const now = Date.now();
      vi.useFakeTimers({ now });

      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: 'new-id', token_hash: 'hash' }],
      });

      await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 48,
      });

      const expectedExpiry = new Date(now + 48 * 60 * 60 * 1000).toISOString();

      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expectedExpiry])
      );

      vi.useRealTimers();
    });
  });

  describe('revokeGuestLink', () => {
    it('should set status to revoked', async () => {
      const { revokeGuestLink } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'link-id' }] });

      await revokeGuestLink('link-id');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE.*guest_links.*status.*revoked/is),
        expect.arrayContaining(['link-id'])
      );
    });

    it('should return true when link is successfully revoked', async () => {
      const { revokeGuestLink } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'link-id' }] });

      const result = await revokeGuestLink('link-id');

      expect(result).toBe(true);
    });

    it('should return false when link does not exist', async () => {
      const { revokeGuestLink } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await revokeGuestLink('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('getGuestLinksByBranch', () => {
    it('should return all active guest links for a branch', async () => {
      const { getGuestLinksByBranch } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      const links = [
        createGuestLinkRecord({ id: 'link-1', email: 'guest1@example.com' }),
        createGuestLinkRecord({ id: 'link-2', email: 'guest2@example.com' }),
      ];

      vi.mocked(db.query).mockResolvedValue({ rows: links });

      const result = await getGuestLinksByBranch('branch-1');

      expect(result).toHaveLength(2);
      expect(result[0].email).toBe('guest1@example.com');
      expect(result[1].email).toBe('guest2@example.com');
    });

    it('should exclude revoked links by default', async () => {
      const { getGuestLinksByBranch } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getGuestLinksByBranch('branch-1');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/status\s*=\s*['"]?active/i),
        expect.any(Array)
      );
    });

    it('should include all statuses when includeRevoked is true', async () => {
      const { getGuestLinksByBranch } = await import('../../src/auth/guest-access');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await getGuestLinksByBranch('branch-1', { includeRevoked: true });

      // Should not filter by status
      expect(db.query).toHaveBeenCalledWith(
        expect.not.stringMatching(/status\s*=\s*['"]?active/i),
        expect.any(Array)
      );
    });
  });

  describe('GUEST_ROLE constant', () => {
    it('should be a VIEWER role', async () => {
      const { GUEST_ROLE } = await import('../../src/auth/guest-access');

      expect(GUEST_ROLE.canView).toBe(true);
    });

    it('should deny all editing permissions', async () => {
      const { GUEST_ROLE } = await import('../../src/auth/guest-access');

      expect(GUEST_ROLE.canEdit).toBe(false);
      expect(GUEST_ROLE.canCreateBranch).toBe(false);
      expect(GUEST_ROLE.canEditDocuments).toBe(false);
      expect(GUEST_ROLE.canCreateCheckpoint).toBe(false);
      expect(GUEST_ROLE.canProposeMerge).toBe(false);
      expect(GUEST_ROLE.canMerge).toBe(false);
      expect(GUEST_ROLE.canMergeToMain).toBe(false);
      expect(GUEST_ROLE.canManageGrants).toBe(false);
    });
  });

  describe('isGuestBranchAccess', () => {
    it('should return true when guest has access to branch', async () => {
      const { isGuestBranchAccess } = await import('../../src/auth/guest-access');

      const guestPrincipal = {
        id: 'guest-link-123',
        type: 'guest' as const,
        branchId: 'branch-1',
        email: 'guest@example.com',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
        roleName: 'VIEWER' as const,
      };

      expect(isGuestBranchAccess(guestPrincipal, 'branch-1')).toBe(true);
    });

    it('should return false when guest tries to access different branch', async () => {
      const { isGuestBranchAccess } = await import('../../src/auth/guest-access');

      const guestPrincipal = {
        id: 'guest-link-123',
        type: 'guest' as const,
        branchId: 'branch-1',
        email: 'guest@example.com',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
        roleName: 'VIEWER' as const,
      };

      expect(isGuestBranchAccess(guestPrincipal, 'branch-2')).toBe(false);
    });
  });
});
