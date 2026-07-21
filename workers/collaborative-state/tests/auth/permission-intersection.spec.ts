/**
 * Permission Intersection Tests
 *
 * Tests for minRole (pure function) and getEffectiveRole integration
 * with acting-user permission intersection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module for getEffectiveRole tests
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Permission Intersection', () => {
  describe('minRole', () => {
    // Test 54: Lower role returned
    it('should return the lower role when user has lower role than agent', async () => {
      const { minRole } = await import('../../src/auth/roles');
      expect(minRole('EDITOR', 'VIEWER')).toBe('VIEWER');
    });

    // Test 55: Agent role returned when user is higher
    it('should return the agent role when user has higher role', async () => {
      const { minRole } = await import('../../src/auth/roles');
      expect(minRole('EDITOR', 'ADMIN')).toBe('EDITOR');
    });

    // Test 56: NO_ACCESS dominates
    it('should return NO_ACCESS when either role is NO_ACCESS', async () => {
      const { minRole } = await import('../../src/auth/roles');
      expect(minRole('EDITOR', 'NO_ACCESS')).toBe('NO_ACCESS');
      expect(minRole('NO_ACCESS', 'ADMIN')).toBe('NO_ACCESS');
    });

    // Test 57: Equal roles
    it('should return the same role when both are equal', async () => {
      const { minRole } = await import('../../src/auth/roles');
      expect(minRole('EDITOR', 'EDITOR')).toBe('EDITOR');
    });

    // Test 58: Exhaustive pairwise test
    it('should handle all 16 role pair combinations correctly', async () => {
      const { minRole } = await import('../../src/auth/roles');
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
    beforeEach(() => {
      vi.resetAllMocks();
    });

    // Test 59: Agent with actingUserEmail gets min(agentRole, actingUserSiteRole)
    it('should apply permission intersection for agent with actingUserEmail', async () => {
      const { query } = await import('../../src/db');
      const mockedQuery = vi.mocked(query);

      // First call: agent_site_roles -> ADMIN
      mockedQuery.mockResolvedValueOnce({
        rows: [{ role: 'admin' }],
      } as never);
      // Second call: branch_grants -> no grant
      mockedQuery.mockResolvedValueOnce({
        rows: [],
      } as never);
      // Third call: acting user site role lookup -> EDITOR (team_member maps to EDITOR)
      mockedQuery.mockResolvedValueOnce({
        rows: [{ role: 'team_member' }],
      } as never);

      const { getEffectiveRole } = await import('../../src/auth/authorization');
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
      const { query } = await import('../../src/db');
      const mockedQuery = vi.mocked(query);

      // First call: agent_site_roles -> ADMIN
      mockedQuery.mockResolvedValueOnce({
        rows: [{ role: 'admin' }],
      } as never);
      // Second call: branch_grants -> no grant
      mockedQuery.mockResolvedValueOnce({
        rows: [],
      } as never);

      const { getEffectiveRole } = await import('../../src/auth/authorization');
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
      const { query } = await import('../../src/db');
      const mockedQuery = vi.mocked(query);

      // First call: agent_site_roles -> ADMIN
      mockedQuery.mockResolvedValueOnce({
        rows: [{ role: 'admin' }],
      } as never);
      // Second call: branch_grants -> no grant
      mockedQuery.mockResolvedValueOnce({
        rows: [],
      } as never);
      // Third call: acting user lookup -> no rows (user not in allowlist)
      mockedQuery.mockResolvedValueOnce({
        rows: [],
      } as never);

      const { getEffectiveRole } = await import('../../src/auth/authorization');
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
      const { query } = await import('../../src/db');
      const mockedQuery = vi.mocked(query);

      // First call: user_site_roles -> ADMIN
      mockedQuery.mockResolvedValueOnce({
        rows: [{ role: 'admin' }],
      } as never);
      // Second call: branch_grants -> no grant
      mockedQuery.mockResolvedValueOnce({
        rows: [],
      } as never);

      const { getEffectiveRole } = await import('../../src/auth/authorization');
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
    });

    // Test 63: System admin bypasses permission intersection
    it('should bypass permission intersection for system admin', async () => {
      const { getEffectiveRole } = await import('../../src/auth/authorization');
      const result = await getEffectiveRole(
        {
          id: 'agent-admin',
          type: 'agent',
          pantheonSiteRoles: {},
          tokenExpiry: '2099-01-01',
          systemRole: 'admin',
          actingUserEmail: 'user@example.com',
        },
        'site-1',
        'branch-1',
      );

      // System admin gets ADMIN via early return, no queries, no intersection
      expect(result.roleName).toBe('ADMIN');
    });
  });
});
