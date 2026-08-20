/**
 * Phase 2.2: Authorization System - Role Definitions Tests
 *
 * Tests for the ROLES constant and role-related utilities.
 * Based on collaborative-state-system-architecture-v2.2.md Section "Role System"
 */

import { describe, it, expect } from 'vitest';
import type { RoleName, RolePermissions } from '../../src/types';

// These will be imported from the implementation once created
// import { ROLES, mapPantheonRole, maxRole, roleAtLeast } from '../../src/auth/roles';

describe('Phase 2.2: Role Definitions', () => {
  describe('ROLES constant', () => {
    it('should define exactly four roles', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const roleNames = Object.keys(ROLES);
      expect(roleNames).toHaveLength(4);
      expect(roleNames).toContain('NO_ACCESS');
      expect(roleNames).toContain('VIEWER');
      expect(roleNames).toContain('EDITOR');
      expect(roleNames).toContain('ADMIN');
    });

    it('should have all roles with the same permission keys', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const expectedKeys: (keyof RolePermissions)[] = [
        'canView',
        'canEdit',
        'canCreateBranch',
        'canEditDocuments',
        'canCreateCheckpoint',
        'canProposeMerge',
        'canMerge',
        'canMergeToMain',
        'canManageGrants',
        'canManageTemplates',
      ];

      for (const roleName of Object.keys(ROLES) as RoleName[]) {
        const role = ROLES[roleName];
        for (const key of expectedKeys) {
          expect(role).toHaveProperty(key);
          expect(typeof role[key]).toBe('boolean');
        }
      }
    });
  });

  describe('NO_ACCESS role', () => {
    it('should deny all permissions', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const noAccess = ROLES.NO_ACCESS;

      expect(noAccess.canView).toBe(false);
      expect(noAccess.canEdit).toBe(false);
      expect(noAccess.canCreateBranch).toBe(false);
      expect(noAccess.canEditDocuments).toBe(false);
      expect(noAccess.canCreateCheckpoint).toBe(false);
      expect(noAccess.canProposeMerge).toBe(false);
      expect(noAccess.canMerge).toBe(false);
      expect(noAccess.canMergeToMain).toBe(false);
      expect(noAccess.canManageGrants).toBe(false);
      expect(noAccess.canManageTemplates).toBe(false);
    });
  });

  describe('VIEWER role', () => {
    it('should only allow viewing', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const viewer = ROLES.VIEWER;

      expect(viewer.canView).toBe(true);
      expect(viewer.canEdit).toBe(false);
      expect(viewer.canCreateBranch).toBe(false);
      expect(viewer.canEditDocuments).toBe(false);
      expect(viewer.canCreateCheckpoint).toBe(false);
      expect(viewer.canProposeMerge).toBe(false);
      expect(viewer.canMerge).toBe(false);
      expect(viewer.canMergeToMain).toBe(false);
      expect(viewer.canManageGrants).toBe(false);
      expect(viewer.canManageTemplates).toBe(false);
    });
  });

  describe('EDITOR role', () => {
    it('should allow editing but not merging to main or managing grants', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const editor = ROLES.EDITOR;

      expect(editor.canView).toBe(true);
      expect(editor.canEdit).toBe(true);
      expect(editor.canCreateBranch).toBe(true);
      expect(editor.canEditDocuments).toBe(true);
      expect(editor.canCreateCheckpoint).toBe(true);
      expect(editor.canProposeMerge).toBe(true);
      expect(editor.canMerge).toBe(true);
      expect(editor.canMergeToMain).toBe(false);
      expect(editor.canManageGrants).toBe(false);
      expect(editor.canManageTemplates).toBe(false);
    });
  });

  describe('ADMIN role', () => {
    it('should allow all permissions', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const admin = ROLES.ADMIN;

      expect(admin.canView).toBe(true);
      expect(admin.canEdit).toBe(true);
      expect(admin.canCreateBranch).toBe(true);
      expect(admin.canEditDocuments).toBe(true);
      expect(admin.canCreateCheckpoint).toBe(true);
      expect(admin.canProposeMerge).toBe(true);
      expect(admin.canMerge).toBe(true);
      expect(admin.canMergeToMain).toBe(true);
      expect(admin.canManageGrants).toBe(true);
      expect(admin.canManageTemplates).toBe(true);
    });
  });

  describe('Role hierarchy', () => {
    it('should have ADMIN as a superset of EDITOR permissions', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const editor = ROLES.EDITOR;
      const admin = ROLES.ADMIN;

      // Every permission that EDITOR has, ADMIN should also have
      for (const [key, value] of Object.entries(editor)) {
        if (value === true) {
          expect(admin[key as keyof RolePermissions]).toBe(true);
        }
      }
    });

    it('should have EDITOR as a superset of VIEWER permissions', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const viewer = ROLES.VIEWER;
      const editor = ROLES.EDITOR;

      // Every permission that VIEWER has, EDITOR should also have
      for (const [key, value] of Object.entries(viewer)) {
        if (value === true) {
          expect(editor[key as keyof RolePermissions]).toBe(true);
        }
      }
    });

    it('should have VIEWER as a superset of NO_ACCESS permissions', async () => {
      const { ROLES } = await import('../../src/auth/roles');
      const noAccess = ROLES.NO_ACCESS;
      const viewer = ROLES.VIEWER;

      // Every permission that NO_ACCESS has, VIEWER should also have
      for (const [key, value] of Object.entries(noAccess)) {
        if (value === true) {
          expect(viewer[key as keyof RolePermissions]).toBe(true);
        }
      }
    });
  });

  describe('mapPantheonRole', () => {
    it('should map owner to ADMIN', async () => {
      const { mapPantheonRole } = await import('../../src/auth/roles');
      expect(mapPantheonRole('owner')).toBe('ADMIN');
    });

    it('should map admin to ADMIN', async () => {
      const { mapPantheonRole } = await import('../../src/auth/roles');
      expect(mapPantheonRole('admin')).toBe('ADMIN');
    });

    it('should map developer to EDITOR', async () => {
      const { mapPantheonRole } = await import('../../src/auth/roles');
      expect(mapPantheonRole('developer')).toBe('EDITOR');
    });

    it('should map team_member to EDITOR', async () => {
      const { mapPantheonRole } = await import('../../src/auth/roles');
      expect(mapPantheonRole('team_member')).toBe('EDITOR');
    });

    it('should map undefined to NO_ACCESS', async () => {
      const { mapPantheonRole } = await import('../../src/auth/roles');
      expect(mapPantheonRole(undefined)).toBe('NO_ACCESS');
    });
  });

  describe('maxRole', () => {
    it('should return the higher role when comparing two roles', async () => {
      const { maxRole } = await import('../../src/auth/roles');

      expect(maxRole('NO_ACCESS', 'VIEWER')).toBe('VIEWER');
      expect(maxRole('VIEWER', 'EDITOR')).toBe('EDITOR');
      expect(maxRole('EDITOR', 'ADMIN')).toBe('ADMIN');
    });

    it('should return the first role when it is higher', async () => {
      const { maxRole } = await import('../../src/auth/roles');

      expect(maxRole('ADMIN', 'VIEWER')).toBe('ADMIN');
      expect(maxRole('EDITOR', 'NO_ACCESS')).toBe('EDITOR');
    });

    it('should return the same role when both are equal', async () => {
      const { maxRole } = await import('../../src/auth/roles');

      expect(maxRole('VIEWER', 'VIEWER')).toBe('VIEWER');
      expect(maxRole('ADMIN', 'ADMIN')).toBe('ADMIN');
    });

    it('should return the first role when second is undefined', async () => {
      const { maxRole } = await import('../../src/auth/roles');

      expect(maxRole('NO_ACCESS', undefined)).toBe('NO_ACCESS');
      expect(maxRole('EDITOR', undefined)).toBe('EDITOR');
    });
  });

  describe('roleAtLeast', () => {
    it('should return true when role meets minimum', async () => {
      const { roleAtLeast } = await import('../../src/auth/roles');

      expect(roleAtLeast('EDITOR', 'EDITOR')).toBe(true);
      expect(roleAtLeast('ADMIN', 'EDITOR')).toBe(true);
      expect(roleAtLeast('ADMIN', 'ADMIN')).toBe(true);
    });

    it('should return false when role is below minimum', async () => {
      const { roleAtLeast } = await import('../../src/auth/roles');

      expect(roleAtLeast('VIEWER', 'EDITOR')).toBe(false);
      expect(roleAtLeast('NO_ACCESS', 'EDITOR')).toBe(false);
      expect(roleAtLeast('EDITOR', 'ADMIN')).toBe(false);
    });
  });

  describe('getRolePermissions', () => {
    it('should return the permissions for a given role name', async () => {
      const { ROLES, getRolePermissions } = await import('../../src/auth/roles');

      expect(getRolePermissions('NO_ACCESS')).toEqual(ROLES.NO_ACCESS);
      expect(getRolePermissions('VIEWER')).toEqual(ROLES.VIEWER);
      expect(getRolePermissions('EDITOR')).toEqual(ROLES.EDITOR);
      expect(getRolePermissions('ADMIN')).toEqual(ROLES.ADMIN);
    });
  });
});
