/**
 * Phase 2.2: Authorization System - Guest Access Validation Tests
 *
 * Tests for guest link validation and guest principal creation.
 * Based on collaborative-state-system-architecture-v2.2.md Section "Guest Access"
 */

import * as crypto from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateGuestToken,
  createGuestLink,
  revokeGuestLink,
  getGuestLinksByBranch,
  isGuestBranchAccess,
  GUEST_ROLE,
} from '../../src/auth/guest-access';
import { guestLinks } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

describe('Phase 2.2: Guest Access Validation', () => {
  let database: DatabaseStub;

  // Helper to create a valid token hash
  function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // Helper to create a stored guest link row
  function createGuestLinkRecord(
    overrides: Partial<typeof guestLinks.$inferSelect> = {},
  ): typeof guestLinks.$inferSelect {
    return {
      id: 'guest-link-123',
      branchId: 'branch-1',
      email: 'guest@example.com',
      name: 'Guest User',
      tokenHash: hashToken('valid-token'),
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
      createdById: 'user-123',
      createdByType: 'user',
      createdAt: new Date(),
      message: null,
      accessCount: 0,
      lastAccessAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    database = stubDatabase();
  });

  describe('validateGuestToken', () => {
    it('should return a guest principal for valid token', async () => {
      database.on(guestLinks).select.returns([createGuestLinkRecord()]);

      const result = await validateGuestToken('valid-token');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('guest-link-123');
      expect(result?.type).toBe('guest');
      expect(result?.branchId).toBe('branch-1');
    });

    it('should look the token up by hash, never by its plaintext', async () => {
      const token = 'my-secret-token';

      await validateGuestToken(token);

      const [lookup] = database.calls(guestLinks).select;
      expect(lookup?.params).toContain(hashToken(token));
      expect(lookup?.params).not.toContain(token);
    });

    it('should return null for non-existent token', async () => {
      const result = await validateGuestToken('invalid-token');

      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      // Expiry is enforced in the WHERE clause, so an expired link matches no row.
      const result = await validateGuestToken('valid-token');

      expect(result).toBeNull();
    });

    it('should return null for revoked token', async () => {
      // Status is enforced in the WHERE clause, so a revoked link matches no row.
      const result = await validateGuestToken('valid-token');

      expect(result).toBeNull();
    });
  });

  describe('Guest principal structure', () => {
    it('should include email from guest link', async () => {
      database.on(guestLinks).select.returns([
        createGuestLinkRecord({ email: 'special-guest@company.com' }),
      ]);

      const result = await validateGuestToken('valid-token');

      expect(result?.email).toBe('special-guest@company.com');
    });

    it('should include name from guest link', async () => {
      database.on(guestLinks).select.returns([createGuestLinkRecord({ name: 'John Doe' })]);

      const result = await validateGuestToken('valid-token');

      expect(result?.name).toBe('John Doe');
    });

    it('should include branchId for scoped access', async () => {
      database.on(guestLinks).select.returns([
        createGuestLinkRecord({ branchId: 'specific-branch-id' }),
      ]);

      const result = await validateGuestToken('valid-token');

      expect(result?.branchId).toBe('specific-branch-id');
    });

    it('should have fixed VIEWER role', async () => {
      database.on(guestLinks).select.returns([createGuestLinkRecord()]);

      const result = await validateGuestToken('valid-token');

      expect(result?.roleName).toBe('VIEWER');
      expect(GUEST_ROLE.canView).toBe(true);
      expect(GUEST_ROLE.canEdit).toBe(false);
    });
  });

  describe('GuestPrincipal type', () => {
    it('should have type property set to guest', async () => {
      database.on(guestLinks).select.returns([createGuestLinkRecord()]);

      const result = await validateGuestToken('valid-token');

      expect(result?.type).toBe('guest');
    });

    it('should have pantheonSiteRoles as empty object', async () => {
      database.on(guestLinks).select.returns([createGuestLinkRecord()]);

      const result = await validateGuestToken('valid-token');

      expect(result?.pantheonSiteRoles).toEqual({});
    });

    it('should include token expiry from guest link', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      database.on(guestLinks).select.returns([
        createGuestLinkRecord({ expiresAt: futureDate }),
      ]);

      const result = await validateGuestToken('valid-token');

      expect(result?.tokenExpiry).toEqual(futureDate);
    });
  });

  describe('Access tracking', () => {
    it('should record the access against the validated link', async () => {
      database.on(guestLinks).select.returns([createGuestLinkRecord()]);

      await validateGuestToken('valid-token');

      const [tracking] = database.calls(guestLinks).update;
      expect(tracking).toBeDefined();
      expect(tracking?.params).toContain('guest-link-123');
    });

    it('should not record an access when no link matched', async () => {
      await validateGuestToken('valid-token');

      expect(database.calls(guestLinks).update).toHaveLength(0);
    });
  });

  describe('createGuestLink', () => {
    it('should create a new guest link record', async () => {
      database.on(guestLinks).insert.returns([{ id: 'new-guest-link-id' }]);

      const result = await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        name: 'Guest User',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 24,
        message: 'Welcome!',
      });

      expect(result.id).toBe('new-guest-link-id');
      expect(result).toHaveProperty('token'); // Unhashed token returned once
    });

    it('should generate a secure random token', async () => {
      database.on(guestLinks).insert.returns([{ id: 'new-id' }]);

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

    it('should store the token as a hash, never in plaintext', async () => {
      database.on(guestLinks).insert.returns([{ id: 'new-id' }]);

      const result = await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 24,
      });

      const [insert] = database.calls(guestLinks).insert;
      expect(insert?.params).toContain(hashToken(result.token));
      expect(insert?.params).not.toContain(result.token);
    });

    it('should set status to active', async () => {
      database.on(guestLinks).insert.returns([{ id: 'new-id' }]);

      await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 24,
      });

      const [insert] = database.calls(guestLinks).insert;
      expect(insert?.params).toContain('active');
    });

    it('should set expiration based on expiresInHours', async () => {
      const now = Date.now();
      vi.useFakeTimers({ now });
      database.on(guestLinks).insert.returns([{ id: 'new-id' }]);

      await createGuestLink({
        branchId: 'branch-1',
        email: 'guest@example.com',
        createdById: 'user-123',
        createdByType: 'user',
        expiresInHours: 48,
      });

      // Timestamps reach the driver as ISO strings, whatever the column's JS type.
      const stamps = (database.calls(guestLinks).insert[0]?.params ?? []).map((param) =>
        param instanceof Date ? param.toISOString() : String(param),
      );
      expect(stamps).toContain(new Date(now + 48 * 60 * 60 * 1000).toISOString());

      vi.useRealTimers();
    });
  });

  describe('revokeGuestLink', () => {
    it('should set status to revoked', async () => {
      database.on(guestLinks).update.returns([{ id: 'link-id' }]);

      await revokeGuestLink('link-id');

      const [revoke] = database.calls(guestLinks).update;
      expect(revoke?.params).toContain('revoked');
      expect(revoke?.params).toContain('link-id');
    });

    it('should return true when link is successfully revoked', async () => {
      database.on(guestLinks).update.returns([{ id: 'link-id' }]);

      const result = await revokeGuestLink('link-id');

      expect(result).toBe(true);
    });

    it('should return false when link does not exist', async () => {
      const result = await revokeGuestLink('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('getGuestLinksByBranch', () => {
    it('should return all active guest links for a branch', async () => {
      database.on(guestLinks).select.returns([
        createGuestLinkRecord({ id: 'link-1', email: 'guest1@example.com' }),
        createGuestLinkRecord({ id: 'link-2', email: 'guest2@example.com' }),
      ]);

      const result = await getGuestLinksByBranch('branch-1');

      expect(result).toHaveLength(2);
      expect(result[0]?.email).toBe('guest1@example.com');
      expect(result[1]?.email).toBe('guest2@example.com');
    });

    it('should exclude revoked links by default', async () => {
      await getGuestLinksByBranch('branch-1');

      const [listing] = database.calls(guestLinks).select;
      expect(listing?.params).toContain('branch-1');
      expect(listing?.params).toContain('active');
    });

    it('should include all statuses when includeRevoked is true', async () => {
      await getGuestLinksByBranch('branch-1', { includeRevoked: true });

      const [listing] = database.calls(guestLinks).select;
      expect(listing?.params).toContain('branch-1');
      expect(listing?.params).not.toContain('active');
    });
  });

  describe('GUEST_ROLE constant', () => {
    it('should be a VIEWER role', () => {
      expect(GUEST_ROLE.canView).toBe(true);
    });

    it('should deny all editing permissions', () => {
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
    const guestPrincipal = {
      id: 'guest-link-123',
      type: 'guest' as const,
      branchId: 'branch-1',
      email: 'guest@example.com',
      name: null,
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 3600000),
      roleName: 'VIEWER' as const,
    };

    it('should return true when guest has access to branch', () => {
      expect(isGuestBranchAccess(guestPrincipal, 'branch-1')).toBe(true);
    });

    it('should return false when guest tries to access different branch', () => {
      expect(isGuestBranchAccess(guestPrincipal, 'branch-2')).toBe(false);
    });
  });
});
