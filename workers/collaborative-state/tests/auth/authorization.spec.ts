/**
 * Phase 2.2: Authorization System - Branch-Level Authorization Tests
 *
 * Tests for effective role calculation and branch-level authorization.
 * Based on collaborative-state-system-architecture-v2.2.md Section "Branch-Level Authorization"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

// Mock database module - will be replaced with actual implementation
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Phase 2.2: Branch-Level Authorization', () => {
  // Helper to create a test principal
  function createPrincipal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
    return {
      id: 'user-123',
      type: 'user',
      email: 'test@example.com',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      ...overrides,
    };
  }

  describe('getEffectiveRole', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    describe('Pantheon baseline role only (no branch grant)', () => {
      it('should return ADMIN for site owner', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'owner' },
        });

        // No branch grant exists
        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('ADMIN');
        expect(result.role.canMergeToMain).toBe(true);
        expect(result.role.canManageGrants).toBe(true);
      });

      it('should return ADMIN for site admin', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'admin' },
        });

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('ADMIN');
      });

      it('should return EDITOR for developer', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'developer' },
        });

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('EDITOR');
        expect(result.role.canMerge).toBe(true);
        expect(result.role.canMergeToMain).toBe(false);
      });

      it('should return EDITOR for team_member', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'team_member' },
        });

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('EDITOR');
      });

      it('should return NO_ACCESS for user with no site role', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: {}, // No role for any site
        });

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('NO_ACCESS');
        expect(result.role.canView).toBe(false);
      });
    });

    describe('Branch grant elevation', () => {
      it('should elevate NO_ACCESS to VIEWER via branch grant', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: {}, // No Pantheon role
        });

        // Branch grant gives VIEWER
        vi.mocked(db.query).mockResolvedValue({
          rows: [{ role: 'VIEWER' }],
        });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('VIEWER');
        expect(result.role.canView).toBe(true);
      });

      it('should elevate VIEWER to EDITOR via branch grant', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: {}, // Would be NO_ACCESS
        });

        vi.mocked(db.query).mockResolvedValue({
          rows: [{ role: 'EDITOR' }],
        });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('EDITOR');
        expect(result.role.canEditDocuments).toBe(true);
      });

      it('should elevate EDITOR to ADMIN via branch grant', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'developer' }, // EDITOR baseline
        });

        vi.mocked(db.query).mockResolvedValue({
          rows: [{ role: 'ADMIN' }],
        });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('ADMIN');
        expect(result.role.canMergeToMain).toBe(true);
      });

      it('should not downgrade role via branch grant (max logic)', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'admin' }, // ADMIN baseline
        });

        // First query: user_site_roles returns empty (fall back to JWT)
        // Second query: branch_grants returns VIEWER (lower than ADMIN)
        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // user_site_roles - no entry
          .mockResolvedValueOnce({ rows: [{ role: 'VIEWER' }] }); // branch_grants

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        // Should still be ADMIN (max of ADMIN and VIEWER)
        expect(result.roleName).toBe('ADMIN');
      });

      it('should use Pantheon role when branch grant is undefined', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'developer' },
        });

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('EDITOR');
      });
    });

    describe('Database query', () => {
      it('should query branch_grants with correct parameters', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          id: 'user-456',
          pantheonSiteRoles: {},
        });

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        await getEffectiveRole(principal, 'site-1', 'branch-xyz');

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('branch_grants'),
          expect.arrayContaining(['branch-xyz', 'user-456']),
        );
      });
    });

    describe('Branch ownership', () => {
      it('returns NO_ACCESS when the branch belongs to another site', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'owner' },
        });

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] }) // user_site_roles - falls back to JWT
          .mockResolvedValueOnce({ rows: [{ site_id: 'site-2', role: null }] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-of-site-2');

        expect(result.roleName).toBe('NO_ACCESS');
        expect(result.role.canView).toBe(false);
      });

      it('ignores a branch grant on a branch belonging to another site', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({ pantheonSiteRoles: {} });

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ site_id: 'site-2', role: 'ADMIN' }] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-of-site-2');

        expect(result.roleName).toBe('NO_ACCESS');
      });

      it('resolves the role normally when the branch belongs to the site', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: { 'site-1': 'owner' },
        });

        vi.mocked(db.query)
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ site_id: 'site-1', role: null }] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('ADMIN');
      });
    });

    describe('Agent principals', () => {
      it('should calculate effective role for agent principals', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          id: 'agent-123',
          type: 'agent',
          pantheonSiteRoles: { 'site-1': 'developer' },
        });

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('EDITOR');
      });

      it('should apply branch grant elevation for agents', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          id: 'agent-123',
          type: 'agent',
          pantheonSiteRoles: {},
        });

        vi.mocked(db.query).mockResolvedValue({
          rows: [{ role: 'EDITOR' }],
        });

        const result = await getEffectiveRole(principal, 'site-1', 'branch-1');

        expect(result.roleName).toBe('EDITOR');
      });
    });

    describe('Multiple sites', () => {
      it('should use correct site role from pantheonSiteRoles map', async () => {
        const { getEffectiveRole } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createPrincipal({
          pantheonSiteRoles: {
            'site-1': 'owner',     // ADMIN
            'site-2': 'developer', // EDITOR
            'site-3': 'team_member', // EDITOR
          },
        });

        vi.mocked(db.query).mockResolvedValue({ rows: [] });

        const result1 = await getEffectiveRole(principal, 'site-1', 'branch-1');
        expect(result1.roleName).toBe('ADMIN');

        const result2 = await getEffectiveRole(principal, 'site-2', 'branch-1');
        expect(result2.roleName).toBe('EDITOR');

        const result3 = await getEffectiveRole(principal, 'site-unknown', 'branch-1');
        expect(result3.roleName).toBe('NO_ACCESS');
      });
    });

    describe('Service principals (sat_ tokens)', () => {
      it('should throw AuthorizationError — service principals must use assertServicePermission', async () => {
        const { getEffectiveRole, AuthorizationError } = await import('../../src/auth/authorization');

        const principal: AuthenticatedPrincipal = {
          id: 'token-id-abc',
          type: 'service',
          pantheonSiteRoles: {},
          tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
          siteId: 'site-1',
          scopes: ['read:draft'],
          authProvider: 'site_token',
        };

        await expect(
          getEffectiveRole(principal, 'site-1', 'branch-1'),
        ).rejects.toThrow(AuthorizationError);
      });
    });
  });

  describe('hasPermission', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should return true when role has the permission', async () => {
      const { hasPermission } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'owner' },
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const canView = await hasPermission(principal, 'site-1', 'branch-1', 'canView');
      expect(canView).toBe(true);

      const canMergeToMain = await hasPermission(principal, 'site-1', 'branch-1', 'canMergeToMain');
      expect(canMergeToMain).toBe(true);
    });

    it('should return false when role lacks the permission', async () => {
      const { hasPermission } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'developer' }, // EDITOR
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const canMergeToMain = await hasPermission(principal, 'site-1', 'branch-1', 'canMergeToMain');
      expect(canMergeToMain).toBe(false);

      const canManageGrants = await hasPermission(principal, 'site-1', 'branch-1', 'canManageGrants');
      expect(canManageGrants).toBe(false);
    });

    it('should return false for NO_ACCESS users', async () => {
      const { hasPermission } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        pantheonSiteRoles: {},
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const canView = await hasPermission(principal, 'site-1', 'branch-1', 'canView');
      expect(canView).toBe(false);
    });
  });

  describe('assertPermission', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should not throw when permission is granted', async () => {
      const { assertPermission } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'owner' },
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await expect(
        assertPermission(principal, 'site-1', 'branch-1', 'canView'),
      ).resolves.not.toThrow();
    });

    it('should throw AuthorizationError when permission is denied', async () => {
      const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'developer' },
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await expect(
        assertPermission(principal, 'site-1', 'branch-1', 'canMergeToMain'),
      ).rejects.toThrow(AuthorizationError);
    });

    it('should include permission and role info in error', async () => {
      const { assertPermission, AuthorizationError } = await import('../../src/auth/authorization');
      const db = await import('../../src/db');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'developer' },
      });

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      try {
        await assertPermission(principal, 'site-1', 'branch-1', 'canManageGrants');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthorizationError);
        expect((error as Error).message).toContain('canManageGrants');
        expect((error as InstanceType<typeof AuthorizationError>).roleName).toBe('EDITOR');
        expect((error as InstanceType<typeof AuthorizationError>).requiredPermission).toBe('canManageGrants');
      }
    });

    describe('Service principal dispatch', () => {
      function createServicePrincipal(siteId: string): AuthenticatedPrincipal {
        return {
          id: 'token-id-abc',
          type: 'service',
          pantheonSiteRoles: {},
          tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
          siteId,
          scopes: ['read:draft'],
          authProvider: 'site_token',
        };
      }

      const BRANCH_UUID = '11111111-2222-3333-4444-555555555555';

      it('should dispatch service principals to hasServicePermission instead of getEffectiveRole', async () => {
        const { assertPermission } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createServicePrincipal('site-1');
        vi.mocked(db.query).mockResolvedValue({ rows: [{ site_id: 'site-1' }] });

        await expect(
          assertPermission(principal, 'site-1', BRANCH_UUID, 'canView'),
        ).resolves.toBeUndefined();
        // The only query is the branch ownership lookup; role resolution never ran.
        expect(vi.mocked(db.query)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(db.query)).toHaveBeenCalledWith(
          expect.stringContaining('app.branches'),
          [BRANCH_UUID],
        );
      });

      it('denies a service principal a branch belonging to another site', async () => {
        const { assertPermission, AuthorizationError } = await import(
          '../../src/auth/authorization'
        );
        const db = await import('../../src/db');

        const principal = createServicePrincipal('site-1');
        vi.mocked(db.query).mockResolvedValue({ rows: [{ site_id: 'site-2' }] });

        await expect(
          assertPermission(principal, 'site-1', BRANCH_UUID, 'canView'),
        ).rejects.toThrow(AuthorizationError);
      });

      it('reports no permission for a service principal on another site\'s branch', async () => {
        const { hasPermission } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createServicePrincipal('site-1');
        vi.mocked(db.query).mockResolvedValue({ rows: [{ site_id: 'site-2' }] });

        expect(await hasPermission(principal, 'site-1', BRANCH_UUID, 'canView')).toBe(false);
      });

      it('skips the ownership lookup when no branch is named', async () => {
        const { assertPermission } = await import('../../src/auth/authorization');
        const db = await import('../../src/db');

        const principal = createServicePrincipal('site-1');

        await expect(
          assertPermission(principal, 'site-1', '', 'canView'),
        ).resolves.toBeUndefined();
        expect(vi.mocked(db.query)).not.toHaveBeenCalled();
      });
    });
  });

  describe('hasServicePermission', () => {
    function createServicePrincipal(siteId: string): AuthenticatedPrincipal {
      return {
        id: 'token-id-abc',
        type: 'service',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
        siteId,
        scopes: ['read:draft'],
        authProvider: 'site_token',
      };
    }

    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should return true when service principal targets its bound site', async () => {
      const { hasServicePermission } = await import('../../src/auth/authorization');

      const principal = createServicePrincipal('site-1');

      expect(hasServicePermission(principal, 'site-1')).toBe(true);
    });

    it('should return false when targeting a different site', async () => {
      const { hasServicePermission } = await import('../../src/auth/authorization');

      const principal = createServicePrincipal('site-1');

      expect(hasServicePermission(principal, 'site-2')).toBe(false);
    });

    it('should return false when called with a non-service principal', async () => {
      const { hasServicePermission } = await import('../../src/auth/authorization');

      const principal = createPrincipal({
        pantheonSiteRoles: { 'site-1': 'owner' },
      });

      expect(hasServicePermission(principal, 'site-1')).toBe(false);
    });
  });

  describe('AuthorizationError', () => {
    it('should be an instance of Error', async () => {
      const { AuthorizationError } = await import('../../src/auth/authorization');

      const error = new AuthorizationError('Test message', 'canView', 'VIEWER');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AuthorizationError');
    });

    it('should contain required permission and role name', async () => {
      const { AuthorizationError } = await import('../../src/auth/authorization');

      const error = new AuthorizationError(
        'Missing permission',
        'canMergeToMain',
        'EDITOR',
      );

      expect(error.requiredPermission).toBe('canMergeToMain');
      expect(error.roleName).toBe('EDITOR');
    });
  });
});
