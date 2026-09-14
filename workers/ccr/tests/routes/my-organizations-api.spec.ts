/**
 * Business Accounts Phase 1: My Organizations API Tests
 *
 * Tests for GET /api/organizations/mine endpoint — route parsing,
 * dispatch, handler behavior, and the linkOrCreateOrgForSpace helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';
import type { Organization } from '../../src/types';
import { users } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';

// Mock services
vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getOrganizationsForUser: vi.fn(),
    getUserOwnedOrg: vi.fn(),
    hasActiveOrgMembership: vi.fn(),
    linkOrgToSpace: vi.fn(),
    createOrgForUser: vi.fn(),
    listAllOrganizationsForSwitcher: vi.fn(),
  };
});

// PCC-3479: the switcher branches on the caller's system role. Default to an
// ordinary user; the superadmin tests opt in explicitly.
vi.mock('../../src/utils/admin-check', () => ({
  isSuperAdmin: vi.fn(async () => false),
  isSystemAdmin: vi.fn(async () => false),
  getSystemRole: vi.fn(async () => 'member'),
}));

const mockOrg = {
  id: 'new-org-id',
  name: 'My Space',
  settings: { agentIdleTimeoutMs: 5000 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  externalSpaceId: 'space_abc',
  role: 'admin' as const,
};

describe('linkOrCreateOrgForSpace', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.clearAllMocks();
    database = stubDatabase();
  });

  it('links the user\'s own org to the space', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserOwnedOrg, linkOrgToSpace, createOrgForUser } = await import('../../src/services');

    vi.mocked(getUserOwnedOrg).mockResolvedValue('org-uuid-123');
    vi.mocked(linkOrgToSpace).mockResolvedValue(true);

    await linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', 'My Space');

    expect(getUserOwnedOrg).toHaveBeenCalledWith('user-uuid-123');
    expect(linkOrgToSpace).toHaveBeenCalledWith('org-uuid-123', 'space_abc', 'My Space');
    expect(createOrgForUser).not.toHaveBeenCalled();
  });

  it('passes undefined (not null) to linkOrgToSpace when spaceName is absent', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserOwnedOrg, linkOrgToSpace } = await import('../../src/services');

    vi.mocked(getUserOwnedOrg).mockResolvedValue('org-uuid-123');
    vi.mocked(linkOrgToSpace).mockResolvedValue(true);

    await linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', null);

    expect(linkOrgToSpace).toHaveBeenCalledWith('org-uuid-123', 'space_abc', undefined);
  });

  // The account-hijack bug: an invitee (member, not owner, of the inviting
  // account) must be left alone, never relinked or renamed on their behalf.
  it('does nothing when the user is a member (not owner) of another org', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserOwnedOrg, hasActiveOrgMembership, linkOrgToSpace, createOrgForUser } =
      await import('../../src/services');

    vi.mocked(getUserOwnedOrg).mockResolvedValue(null);
    vi.mocked(hasActiveOrgMembership).mockResolvedValue(true);

    await linkOrCreateOrgForSpace('invitee-uuid', 'space_abc', 'The Inviting Org');

    expect(linkOrgToSpace).not.toHaveBeenCalled();
    expect(createOrgForUser).not.toHaveBeenCalled();
  });

  it('Rule 1: creates an organization when the user has a primary space but no P1 org at all', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserOwnedOrg, hasActiveOrgMembership, linkOrgToSpace, createOrgForUser } =
      await import('../../src/services');

    vi.mocked(getUserOwnedOrg).mockResolvedValue(null);
    vi.mocked(hasActiveOrgMembership).mockResolvedValue(false);
    database.on(users).select.returns([{ email: 'user@pantheon.io' }]);
    vi.mocked(createOrgForUser).mockResolvedValue(mockOrg);

    await linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', 'My Space');

    expect(database.calls(users).select[0].params).toEqual(['user-uuid-123']);
    expect(createOrgForUser).toHaveBeenCalledWith('user-uuid-123', 'user@pantheon.io', 'My Space', 'space_abc');
    expect(linkOrgToSpace).not.toHaveBeenCalled();
  });

  it('Rule 1: does not call createOrgForUser when the user has no email on record', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserOwnedOrg, hasActiveOrgMembership, createOrgForUser } = await import('../../src/services');

    vi.mocked(getUserOwnedOrg).mockResolvedValue(null);
    vi.mocked(hasActiveOrgMembership).mockResolvedValue(false);

    await linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', null);

    expect(createOrgForUser).not.toHaveBeenCalled();
  });

  it('swallows errors from linking an existing org', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserOwnedOrg, linkOrgToSpace } = await import('../../src/services');

    vi.mocked(getUserOwnedOrg).mockResolvedValue('org-uuid-123');
    vi.mocked(linkOrgToSpace).mockRejectedValue(new Error('unique constraint'));

    await expect(linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', null)).resolves.toBeUndefined();
  });

  it('swallows errors from creating an org for a spaceless user', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserOwnedOrg, hasActiveOrgMembership, createOrgForUser } = await import('../../src/services');

    vi.mocked(getUserOwnedOrg).mockResolvedValue(null);
    vi.mocked(hasActiveOrgMembership).mockResolvedValue(false);
    database.on(users).select.returns([{ email: 'user@pantheon.io' }]);
    vi.mocked(createOrgForUser).mockRejectedValue(new Error('unique constraint'));

    await expect(linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', null)).resolves.toBeUndefined();
  });
});

describe('GET /api/organizations/mine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDatabase();
  });

  describe('route parsing', () => {
    it('should parse /api/organizations/mine to my-organizations handler', () => {
      const result = parseRoute('/api/organizations/mine');
      expect(result).toBeDefined();
      expect(result?.handler).toBe('my-organizations');
    });

    it('should not interfere with agent CRUD route', () => {
      const result = parseRoute('/api/organizations/some-org-id/agents');
      expect(result).toBeDefined();
      expect(result?.handler).toBe('agents');
      expect(result?.params.organizationId).toBe('some-org-id');
    });

    it('should not interfere with agent presence route', () => {
      const result = parseRoute('/api/organizations/org-1/agents/agent-1/presence');
      expect(result).toBeDefined();
      expect(result?.handler).toBe('presence');
    });

    it('should parse the org-scoped users collection (PCC-3479)', () => {
      const result = parseRoute('/api/organizations/org-1/users');
      expect(result?.handler).toBe('org-users');
      expect(result?.params.organizationId).toBe('org-1');
      expect(result?.params.userId).toBeUndefined();
    });

    it('should parse a single org-scoped user', () => {
      const result = parseRoute('/api/organizations/org-1/users/user-9');
      expect(result?.handler).toBe('org-users');
      expect(result?.params.organizationId).toBe('org-1');
      expect(result?.params.userId).toBe('user-9');
    });
  });

  describe('handler', () => {
    it('should return organizations for authenticated user', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );
      const { getOrganizationsForUser } = await import('../../src/services');

      vi.mocked(getOrganizationsForUser).mockResolvedValue([
        {
          id: 'org-1',
          name: 'My Org',
          settings: { agentIdleTimeoutMs: 5000 },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          archivedAt: null,
          externalSpaceId: 'space_abc',
          role: 'admin',
        },
      ]);

      const request = new Request('http://localhost/api/organizations/mine');
      const response = await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
          dbUserId: 'user-uuid-123',
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json<{ organizations: Organization[] }>();
      expect(body.organizations).toHaveLength(1);
      expect(body.organizations[0].id).toBe('org-1');
      expect(body.organizations[0].externalSpaceId).toBe('space_abc');
    });

    it('should return empty array when user has no orgs', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );
      const { getOrganizationsForUser } = await import('../../src/services');

      vi.mocked(getOrganizationsForUser).mockResolvedValue([]);

      const request = new Request('http://localhost/api/organizations/mine');
      const response = await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
          dbUserId: 'user-uuid-123',
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json<{ organizations: Organization[] }>();
      expect(body.organizations).toEqual([]);
    });

    it('should return 401 when dbUserId is missing', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );

      const request = new Request('http://localhost/api/organizations/mine');
      const response = await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
        },
      });

      expect(response.status).toBe(401);
    });

    it('should only allow GET method', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );

      const request = new Request('http://localhost/api/organizations/mine', {
        method: 'POST',
      });
      const response = await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
          dbUserId: 'user-uuid-123',
        },
      });

      expect(response.status).toBe(405);
    });

    it('should call linkOrCreateOrgForSpace when linkSpaceId is provided, before listing organizations', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );
      const { getOrganizationsForUser, getUserOwnedOrg, linkOrgToSpace } = await import('../../src/services');

      vi.mocked(getUserOwnedOrg).mockResolvedValue('org-uuid-123');
      vi.mocked(linkOrgToSpace).mockResolvedValue(true);
      vi.mocked(getOrganizationsForUser).mockResolvedValue([mockOrg]);

      const request = new Request('http://localhost/api/organizations/mine?linkSpaceId=space_abc&linkSpaceName=My%20Space');
      const response = await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
          dbUserId: 'user-uuid-123',
        },
      });

      expect(response.status).toBe(200);
      expect(getUserOwnedOrg).toHaveBeenCalledWith('user-uuid-123');
      expect(linkOrgToSpace).toHaveBeenCalledWith('org-uuid-123', 'space_abc', 'My Space');
    });

    it('should not call linkOrCreateOrgForSpace when linkSpaceId is absent', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );
      const { getOrganizationsForUser, getUserOwnedOrg } = await import('../../src/services');

      vi.mocked(getOrganizationsForUser).mockResolvedValue([]);

      const request = new Request('http://localhost/api/organizations/mine');
      await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
          dbUserId: 'user-uuid-123',
        },
      });

      expect(getUserOwnedOrg).not.toHaveBeenCalled();
    });
  });

  // PCC-3479: superadmin is P1-only. Returning every P1 organization here is
  // what puts them all in the switcher; the frontend still merges in only the
  // Content Publisher spaces the user genuinely has access to.
  describe('superadmin', () => {
    it('returns every organization instead of just the caller\'s', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );
      const { getOrganizationsForUser, listAllOrganizationsForSwitcher } =
        await import('../../src/services');
      const { isSuperAdmin } = await import('../../src/utils/admin-check');

      vi.mocked(isSuperAdmin).mockResolvedValueOnce(true);
      vi.mocked(listAllOrganizationsForSwitcher).mockResolvedValue([
        mockOrg,
        { ...mockOrg, id: 'someone-elses-org', name: 'Someone Else' },
      ]);

      const request = new Request('http://localhost/api/organizations/mine');
      const response = await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
          dbUserId: 'root-uuid',
          systemRole: 'superadmin',
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json<{ organizations: Organization[]; isSystemAdmin: boolean }>();
      expect(body.organizations).toHaveLength(2);
      expect(getOrganizationsForUser).not.toHaveBeenCalled();
      // The entries themselves say role 'admin' either way, so the flag is the
      // only thing in this payload that distinguishes Pantheon staff.
      expect(body.isSystemAdmin).toBe(true);
    });

    it('leaves an ordinary admin scoped to their own organizations', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );
      const { getOrganizationsForUser, listAllOrganizationsForSwitcher } =
        await import('../../src/services');

      vi.mocked(getOrganizationsForUser).mockResolvedValue([mockOrg]);

      const request = new Request('http://localhost/api/organizations/mine');
      const response = await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
          dbUserId: 'user-uuid-123',
          systemRole: 'admin',
        },
      });

      expect(response.status).toBe(200);
      expect(listAllOrganizationsForSwitcher).not.toHaveBeenCalled();
      expect(getOrganizationsForUser).toHaveBeenCalledWith('user-uuid-123');
      // Legacy system_role 'admin' is inert — it is not Pantheon staff.
      const body = await response.json<{ isSystemAdmin: boolean }>();
      expect(body.isSystemAdmin).toBe(false);
    });
  });
});
