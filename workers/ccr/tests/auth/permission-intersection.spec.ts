/**
 * Permission Intersection Tests
 *
 * Tests for minRole (pure function) and getEffectiveRole integration
 * with acting-user permission intersection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getEffectiveRole } from '../../src/auth/authorization';
import { minRole } from '../../src/auth/roles';
import { agents, userSiteRoles } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

describe('Permission Intersection', () => {
  describe('minRole', () => {
    // Test 54: Lower role returned
    it('should return the lower role when user has lower role than agent', () => {
      expect(minRole('EDITOR', 'VIEWER')).toBe('VIEWER');
    });

    // Test 55: Agent role returned when user is higher
    it('should return the agent role when user has higher role', () => {
      expect(minRole('EDITOR', 'ADMIN')).toBe('EDITOR');
    });

    // Test 56: NO_ACCESS dominates
    it('should return NO_ACCESS when either role is NO_ACCESS', () => {
      expect(minRole('EDITOR', 'NO_ACCESS')).toBe('NO_ACCESS');
      expect(minRole('NO_ACCESS', 'ADMIN')).toBe('NO_ACCESS');
    });

    // Test 57: Equal roles
    it('should return the same role when both are equal', () => {
      expect(minRole('EDITOR', 'EDITOR')).toBe('EDITOR');
    });

    // Test 58: Exhaustive pairwise test
    it('should handle all 16 role pair combinations correctly', () => {
      const roles = ['NO_ACCESS', 'VIEWER', 'EDITOR', 'ADMIN'] as const;

      for (let i = 0; i < roles.length; i++) {
        for (let j = 0; j < roles.length; j++) {
          const result = minRole(roles[i], roles[j]);
          const expected = roles[Math.min(i, j)];
          expect(result).toBe(expected);
        }
      }
    });
  });

  describe('getEffectiveRole with permission intersection', () => {
    let database: DatabaseStub;

    beforeEach(() => {
      database = stubDatabase();
    });

    // Test 59: Agent with actingUserEmail gets min(agentRole, actingUserSiteRole)
    it('should apply permission intersection for agent with actingUserEmail', async () => {
      database.on(agents).select.returnsRaw([{ role: 'admin', implicit: false }]);
      // The acting user's site role, reached through the users join.
      database.on(userSiteRoles).select.returns([{ role: 'team_member' }]);

      const result = await getEffectiveRole(
        {
          id: 'agent-1',
          type: 'agent',
          pantheonSiteRoles: {},
          tokenExpiry: '2099-01-01',
          actingUserEmail: 'user@example.com',
        },
        'site-1',
        'branch-1',
      );

      // Agent has ADMIN, acting user has EDITOR (team_member maps to EDITOR)
      // min(ADMIN, EDITOR) = EDITOR
      expect(result.roleName).toBe('EDITOR');
    });

    // Test 60: Agent without actingUserEmail gets normal role
    it('should skip intersection when actingUserEmail is absent', async () => {
      database.on(agents).select.returnsRaw([{ role: 'admin', implicit: false }]);

      const result = await getEffectiveRole(
        {
          id: 'agent-1',
          type: 'agent',
          pantheonSiteRoles: {},
          tokenExpiry: '2099-01-01',
          // No actingUserEmail
        },
        'site-1',
        'branch-1',
      );

      // No intersection -- agent gets ADMIN directly
      expect(result.roleName).toBe('ADMIN');
    });

    // Test 61: Acting user not in allowlist -> NO_ACCESS
    it('should return NO_ACCESS when acting user is not in allowlist', async () => {
      database.on(agents).select.returnsRaw([{ role: 'admin', implicit: false }]);
      // An acting user outside the allowlist matches no row.

      const result = await getEffectiveRole(
        {
          id: 'agent-1',
          type: 'agent',
          pantheonSiteRoles: {},
          tokenExpiry: '2099-01-01',
          actingUserEmail: 'unknown@example.com',
        },
        'site-1',
        'branch-1',
      );

      // Acting user not found -> NO_ACCESS, min(ADMIN, NO_ACCESS) = NO_ACCESS
      expect(result.roleName).toBe('NO_ACCESS');
    });

    // Test 62: User principals never trigger intersection
    it('should not apply intersection for user principals', async () => {
      database.on(userSiteRoles).select.returns([{ role: 'admin' }]);

      const result = await getEffectiveRole(
        {
          id: 'user-1',
          type: 'user',
          pantheonSiteRoles: { 'site-1': 'admin' },
          tokenExpiry: '2099-01-01',
          // Even if actingUserEmail is present, user principals shouldn't trigger intersection
          actingUserEmail: 'someone@example.com',
        },
        'site-1',
        'branch-1',
      );

      // User principal -> no intersection, gets ADMIN
      expect(result.roleName).toBe('ADMIN');
      // The principal's own baseline lookup is the only role query.
      expect(database.calls(userSiteRoles).select).toHaveLength(1);
    });

    // Test 63: Superadmin bypasses permission intersection
    it('should bypass permission intersection for a superadmin', async () => {
      const result = await getEffectiveRole(
        {
          id: 'agent-admin',
          type: 'agent',
          pantheonSiteRoles: {},
          tokenExpiry: '2099-01-01',
          systemRole: 'superadmin',
          actingUserEmail: 'user@example.com',
        },
        'site-1',
        'branch-1',
      );

      // Superadmin gets ADMIN via early return, no queries, no intersection
      expect(result.roleName).toBe('ADMIN');
      expect(database.statements).toHaveLength(0);
    });
  });
});
