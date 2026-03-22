/**
 * Agent Site Role Service Tests (TDD)
 *
 * Tests for per-site role management for agents: grant, revoke, list, and
 * getRolesForAgent (which maps agent roles to PantheonRole for the
 * AuthenticatedPrincipal).
 *
 * The service uses the `query` function from `../../src/db`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('Agent Site Role Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Database row format matching app.agent_site_roles schema
  interface MockRoleRow {
    id: string;
    agent_id: string;
    site_id: string;
    role: 'viewer' | 'editor' | 'admin';
    granted_by: string;
    granted_at: string;
    revoked_at: string | null;
  }

  function createMockRoleRow(overrides: Partial<MockRoleRow> = {}): MockRoleRow {
    return {
      id: 'role-uuid-001',
      agent_id: 'agent-uuid-456',
      site_id: 'site-uuid-789',
      role: 'editor',
      granted_by: 'user-uuid-111',
      granted_at: '2026-03-22T10:00:00.000Z',
      revoked_at: null,
      ...overrides,
    };
  }

  // ===========================================================================
  // grantRole
  // ===========================================================================

  describe('grantRole', () => {
    it('should grant a role and return the role object', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      const mockRow = createMockRoleRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

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

    it('should insert into app.agent_site_roles table', async () => {
      const { grantRole } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      const mockRow = createMockRoleRow();
      vi.mocked(db.query).mockResolvedValue({ rows: [mockRow] });

      await grantRole({
        agentId: 'agent-uuid-456',
        siteId: 'site-uuid-789',
        role: 'editor',
        grantedBy: 'user-uuid-111',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('app.agent_site_roles'),
        expect.arrayContaining(['agent-uuid-456', 'site-uuid-789', 'editor', 'user-uuid-111']),
      );
    });
  });

  // ===========================================================================
  // revokeRole
  // ===========================================================================

  describe('revokeRole', () => {
    it('should revoke a role and return true', async () => {
      const { revokeRole } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await revokeRole('role-uuid-001', 'agent-uuid-456');

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at'),
        expect.arrayContaining(['role-uuid-001', 'agent-uuid-456']),
      );
    });

    it('should return false when role not found', async () => {
      const { revokeRole } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await revokeRole('non-existent-role', 'agent-uuid-456');

      expect(result).toBe(false);
    });

    it('should scope revocation to the specified agent', async () => {
      const { revokeRole } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      await revokeRole('role-uuid-001', 'agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('agent_id'),
        expect.arrayContaining(['agent-uuid-456']),
      );
    });

    it('should only revoke non-revoked roles', async () => {
      const { revokeRole } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 });

      await revokeRole('role-uuid-001', 'agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at IS NULL'),
        expect.any(Array),
      );
    });
  });

  // ===========================================================================
  // listRoles
  // ===========================================================================

  describe('listRoles', () => {
    it('should list active roles for an agent', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockRoleRow({ id: 'role-1', site_id: 'site-aaa', role: 'admin' }),
        createMockRoleRow({ id: 'role-2', site_id: 'site-bbb', role: 'viewer' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

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
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await listRoles('agent-with-no-roles');

      expect(result).toEqual([]);
    });

    it('should query by agent_id', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listRoles('agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('agent_id'),
        expect.arrayContaining(['agent-uuid-456']),
      );
    });

    it('should only return non-revoked roles', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listRoles('agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at IS NULL'),
        expect.any(Array),
      );
    });

    it('should order by granted_at descending', async () => {
      const { listRoles } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      await listRoles('agent-uuid-456');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY granted_at DESC'),
        expect.any(Array),
      );
    });
  });

  // ===========================================================================
  // getRolesForAgent
  // ===========================================================================

  describe('getRolesForAgent', () => {
    it('should return pantheonSiteRoles map with correct role mapping', async () => {
      const { getRolesForAgent } = await import('../../src/services/agent-site-role-service');
      const db = await import('../../src/db');

      const mockRows = [
        createMockRoleRow({ site_id: 'site-aaa', role: 'viewer' }),
        createMockRoleRow({ site_id: 'site-bbb', role: 'editor' }),
        createMockRoleRow({ site_id: 'site-ccc', role: 'admin' }),
      ];
      vi.mocked(db.query).mockResolvedValue({ rows: mockRows });

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
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      const result = await getRolesForAgent('agent-with-no-roles');

      expect(result).toEqual({});
    });
  });
});
