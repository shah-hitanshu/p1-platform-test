/**
 * Agent Site Role Service Tests (TDD)
 *
 * Tests for per-site role management for agents: grant, revoke, list, and
 * getRolesForAgent (which maps agent roles to PantheonRole for the
 * AuthenticatedPrincipal).
 *
 * SQL correctness (ON CONFLICT targeting, the listRolesBySite UNION, joins)
 * is covered against real Postgres in tests/integration/agent-auth-flow and
 * tests/integration/global-agent-roles; this suite covers validation and
 * row-to-domain-object mapping against the stub.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { agentSiteRoles } from '../../src/db/schema';

describe('Agent Site Role Service', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  const createdAt = new Date('2026-03-22T10:00:00.000Z');

  function createRoleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'role-uuid-001',
      agentId: 'agent-uuid-456',
      siteId: 'site-uuid-789',
      role: 'editor',
      createdById: 'user-uuid-111',
      createdAt,
      revokedAt: null,
      ...overrides,
    };
  }

  // ===========================================================================
  // grantRole
  // ===========================================================================

  describe('grantRole', () => {
    it('should grant a role and return the role object', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');

      database.on(agentSiteRoles).insert.returns([createRoleRow()]);

      const result = await grantRole({
        agentId: 'agent-uuid-456',
        siteId: 'site-uuid-789',
        role: 'editor',
        grantedBy: 'user-uuid-111',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('role-uuid-001');
      expect(result.agentId).toBe('agent-uuid-456');
      expect(result.siteId).toBe('site-uuid-789');
      expect(result.role).toBe('editor');
      expect(result.grantedBy).toBe('user-uuid-111');
      expect(result.grantedAt).toBe('2026-03-22T10:00:00.000Z');
      expect(result.revokedAt).toBeNull();
    });

    it('should validate agentId is required', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');

      await expect(
        grantRole({
          agentId: '',
          siteId: 'site-uuid-789',
          role: 'editor',
          grantedBy: 'user-uuid-111',
        }),
      ).rejects.toThrow();
    });

    it('should validate siteId is required', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');

      await expect(
        grantRole({
          agentId: 'agent-uuid-456',
          siteId: '',
          role: 'editor',
          grantedBy: 'user-uuid-111',
        }),
      ).rejects.toThrow();
    });

    it('should validate role is required', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');

      await expect(
        grantRole({
          agentId: 'agent-uuid-456',
          siteId: 'site-uuid-789',
          role: '' as 'viewer' | 'editor' | 'admin',
          grantedBy: 'user-uuid-111',
        }),
      ).rejects.toThrow();
    });

    it('should validate grantedBy is required', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');

      await expect(
        grantRole({
          agentId: 'agent-uuid-456',
          siteId: 'site-uuid-789',
          role: 'editor',
          grantedBy: '',
        }),
      ).rejects.toThrow();
    });

    it('should reject invalid role values', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');

      await expect(
        grantRole({
          agentId: 'agent-uuid-456',
          siteId: 'site-uuid-789',
          role: 'superuser' as 'viewer' | 'editor' | 'admin',
          grantedBy: 'user-uuid-111',
        }),
      ).rejects.toThrow();
    });

    it('should insert into agent_site_roles with the granted fields', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).insert.returns([createRoleRow()]);

      await grantRole({
        agentId: 'agent-uuid-456',
        siteId: 'site-uuid-789',
        role: 'editor',
        grantedBy: 'user-uuid-111',
      });

      const [call] = database.calls(agentSiteRoles).insert;
      expect(call?.params).toEqual(
        expect.arrayContaining(['agent-uuid-456', 'site-uuid-789', 'editor', 'user-uuid-111']),
      );
      // The unique index the upsert targets is partial, so a revoked grant is a
      // separate row rather than one to update.
      expect(call?.sql).toContain('"revoked_at" is null');
    });

    it('throws when the insert reports no row', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');

      await expect(
        grantRole({
          agentId: 'agent-uuid-456',
          siteId: 'site-uuid-789',
          role: 'editor',
          grantedBy: 'user-uuid-111',
        }),
      ).rejects.toThrow('Failed to insert agent site role');
    });
  });

  // ===========================================================================
  // revokeRole
  // ===========================================================================

  describe('revokeRole', () => {
    it('should revoke a role and return true', async () => {
      const { revokeRole } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).update.returns([{ id: 'role-uuid-001' }]);

      const result = await revokeRole('role-uuid-001', 'agent-uuid-456');

      expect(result).toBe(true);
      expect(database.calls(agentSiteRoles).update[0].params).toEqual(
        expect.arrayContaining(['role-uuid-001', 'agent-uuid-456']),
      );
    });

    it('should return false when role not found', async () => {
      const { revokeRole } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).update.returns([]);

      const result = await revokeRole('non-existent-role', 'agent-uuid-456');

      expect(result).toBe(false);
    });

    it('should scope revocation to the specified agent', async () => {
      const { revokeRole } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).update.returns([{ id: 'role-uuid-001' }]);

      await revokeRole('role-uuid-001', 'agent-uuid-456');

      expect(database.calls(agentSiteRoles).update[0].sql).toMatch(/agent_id/i);
      expect(database.calls(agentSiteRoles).update[0].params).toEqual(
        expect.arrayContaining(['agent-uuid-456']),
      );
    });

    it('should only revoke non-revoked roles', async () => {
      const { revokeRole } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).update.returns([{ id: 'role-uuid-001' }]);

      await revokeRole('role-uuid-001', 'agent-uuid-456');

      expect(database.calls(agentSiteRoles).update[0].sql).toMatch(/revoked_at.*is null/i);
    });
  });

  // ===========================================================================
  // revokeRoleBySite
  // ===========================================================================

  describe('revokeRoleBySite', () => {
    it('should revoke a role scoped to the site and return true', async () => {
      const { revokeRoleBySite } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).update.returns([{ id: 'role-uuid-001' }]);

      const result = await revokeRoleBySite('role-uuid-001', 'site-uuid-789');

      expect(result).toBe(true);
      expect(database.calls(agentSiteRoles).update[0].params).toEqual(
        expect.arrayContaining(['role-uuid-001', 'site-uuid-789']),
      );
    });

    it('should return false when role not found', async () => {
      const { revokeRoleBySite } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).update.returns([]);

      const result = await revokeRoleBySite('non-existent-role', 'site-uuid-789');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // getAgentSiteRoleById
  // ===========================================================================

  describe('getAgentSiteRoleById', () => {
    it('returns the role when found', async () => {
      const { getAgentSiteRoleById } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).select.returns([createRoleRow()]);

      const result = await getAgentSiteRoleById('role-uuid-001', 'agent-uuid-456');

      expect(result?.id).toBe('role-uuid-001');
      expect(result?.siteId).toBe('site-uuid-789');
    });

    it('returns null when not found', async () => {
      const { getAgentSiteRoleById } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).select.returns([]);

      const result = await getAgentSiteRoleById('missing', 'agent-uuid-456');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // listRoles
  // ===========================================================================

  describe('listRoles', () => {
    it('should list active roles for an agent', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');

      database.on(agentSiteRoles).select.returns([
        createRoleRow({ id: 'role-1', siteId: 'site-aaa', role: 'admin' }),
        createRoleRow({ id: 'role-2', siteId: 'site-bbb', role: 'viewer' }),
      ]);

      const result = await listRoles('agent-uuid-456');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('role-1');
      expect(result[0].siteId).toBe('site-aaa');
      expect(result[0].role).toBe('admin');
      expect(result[1].id).toBe('role-2');
      expect(result[1].siteId).toBe('site-bbb');
      expect(result[1].role).toBe('viewer');
    });

    it('should return empty array when no roles', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).select.returns([]);

      const result = await listRoles('agent-with-no-roles');

      expect(result).toEqual([]);
    });

    it('should query by agent_id', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).select.returns([]);

      await listRoles('agent-uuid-456');

      expect(database.calls(agentSiteRoles).select[0].params).toEqual(
        expect.arrayContaining(['agent-uuid-456']),
      );
    });

    it('should only return non-revoked roles', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).select.returns([]);

      await listRoles('agent-uuid-456');

      expect(database.calls(agentSiteRoles).select[0].sql).toMatch(/revoked_at.*is null/i);
    });

    it('should order by granted_at descending', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).select.returns([]);

      await listRoles('agent-uuid-456');

      expect(database.calls(agentSiteRoles).select[0].sql).toMatch(/order by.*created_at.*desc/i);
    });
  });

  // ===========================================================================
  // getRolesForAgent
  // ===========================================================================

  describe('getRolesForAgent', () => {
    it('should return pantheonSiteRoles map with correct role mapping', async () => {
      const { getRolesForAgent } = await import('../../src/services/agent-site-role-service');

      database.on(agentSiteRoles).select.returns([
        createRoleRow({ siteId: 'site-aaa', role: 'viewer' }),
        createRoleRow({ siteId: 'site-bbb', role: 'editor' }),
        createRoleRow({ siteId: 'site-ccc', role: 'admin' }),
      ]);

      const result = await getRolesForAgent('agent-uuid-456');

      // viewer -> team_member, editor -> developer, admin -> admin
      expect(result).toEqual({
        'site-aaa': 'team_member',
        'site-bbb': 'developer',
        'site-ccc': 'admin',
      });
    });

    it('should return empty object when agent has no roles', async () => {
      const { getRolesForAgent } = await import('../../src/services/agent-site-role-service');
      database.on(agentSiteRoles).select.returns([]);

      const result = await getRolesForAgent('agent-with-no-roles');

      expect(result).toEqual({});
    });
  });
});
