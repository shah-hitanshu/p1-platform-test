/**
 * Business Accounts Phase 1: My Organizations API Tests
 *
 * Tests for GET /api/organizations/mine endpoint — route parsing,
 * dispatch, handler behavior, and the linkOrCreateOrgForSpace helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRoute } from '../../src/routes/route-parser';
import type { Organization } from '../../src/types';

// Mock services
vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getOrganizationsForUser: vi.fn(),
    getUserPrimaryOrg: vi.fn(),
    linkOrgToSpace: vi.fn(),
    createOrgForUser: vi.fn(),
  };
});

// Mock db (used for the email lookup when creating an org for a user with
// a primary space but no existing org — see Rule 1 below)
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

const mockOrg = {
  id: 'new-org-id',
  name: 'My Space',
  settings: { agentIdleTimeoutMs: 5000 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  externalSpaceId: 'space_abc',
};

describe('linkOrCreateOrgForSpace', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('links the user\'s existing primary org to the space', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserPrimaryOrg, linkOrgToSpace, createOrgForUser } = await import('../../src/services');

    vi.mocked(getUserPrimaryOrg).mockResolvedValue('org-uuid-123');
    vi.mocked(linkOrgToSpace).mockResolvedValue(true);

    await linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', 'My Space');

    expect(getUserPrimaryOrg).toHaveBeenCalledWith('user-uuid-123');
    expect(linkOrgToSpace).toHaveBeenCalledWith('org-uuid-123', 'space_abc', 'My Space');
    expect(createOrgForUser).not.toHaveBeenCalled();
  });

  it('passes undefined (not null) to linkOrgToSpace when spaceName is absent', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserPrimaryOrg, linkOrgToSpace } = await import('../../src/services');

    vi.mocked(getUserPrimaryOrg).mockResolvedValue('org-uuid-123');
    vi.mocked(linkOrgToSpace).mockResolvedValue(true);

    await linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', null);

    expect(linkOrgToSpace).toHaveBeenCalledWith('org-uuid-123', 'space_abc', undefined);
  });

  it('Rule 1: creates an organization when the user has a primary space but no P1 org', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserPrimaryOrg, linkOrgToSpace, createOrgForUser } = await import('../../src/services');
    const db = await import('../../src/db');

    vi.mocked(getUserPrimaryOrg).mockResolvedValue(null);
    vi.mocked(db.query).mockResolvedValue({ rows: [{ email: 'user@pantheon.io' }] });
    vi.mocked(createOrgForUser).mockResolvedValue(mockOrg);

    await linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', 'My Space');

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SELECT email'), ['user-uuid-123']);
    expect(createOrgForUser).toHaveBeenCalledWith('user-uuid-123', 'user@pantheon.io', 'My Space', 'space_abc');
    expect(linkOrgToSpace).not.toHaveBeenCalled();
  });

  it('Rule 1: does not call createOrgForUser when the user has no email on record', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserPrimaryOrg, createOrgForUser } = await import('../../src/services');
    const db = await import('../../src/db');

    vi.mocked(getUserPrimaryOrg).mockResolvedValue(null);
    vi.mocked(db.query).mockResolvedValue({ rows: [] });

    await linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', null);

    expect(createOrgForUser).not.toHaveBeenCalled();
  });

  it('swallows errors from linking an existing org', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserPrimaryOrg, linkOrgToSpace } = await import('../../src/services');

    vi.mocked(getUserPrimaryOrg).mockResolvedValue('org-uuid-123');
    vi.mocked(linkOrgToSpace).mockRejectedValue(new Error('unique constraint'));

    await expect(linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', null)).resolves.toBeUndefined();
  });

  it('swallows errors from creating an org for a spaceless user', async () => {
    const { linkOrCreateOrgForSpace } = await import('../../src/routes/my-organizations-api');
    const { getUserPrimaryOrg, createOrgForUser } = await import('../../src/services');
    const db = await import('../../src/db');

    vi.mocked(getUserPrimaryOrg).mockResolvedValue(null);
    vi.mocked(db.query).mockResolvedValue({ rows: [{ email: 'user@pantheon.io' }] });
    vi.mocked(createOrgForUser).mockRejectedValue(new Error('unique constraint'));

    await expect(linkOrCreateOrgForSpace('user-uuid-123', 'space_abc', null)).resolves.toBeUndefined();
  });
});

describe('GET /api/organizations/mine', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
      const { getOrganizationsForUser, getUserPrimaryOrg, linkOrgToSpace } = await import('../../src/services');

      vi.mocked(getUserPrimaryOrg).mockResolvedValue('org-uuid-123');
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
      expect(getUserPrimaryOrg).toHaveBeenCalledWith('user-uuid-123');
      expect(linkOrgToSpace).toHaveBeenCalledWith('org-uuid-123', 'space_abc', 'My Space');
    });

    it('should not call linkOrCreateOrgForSpace when linkSpaceId is absent', async () => {
      const { handleMyOrganizationsRoute } = await import(
        '../../src/routes/my-organizations-api'
      );
      const { getOrganizationsForUser, getUserPrimaryOrg } = await import('../../src/services');

      vi.mocked(getOrganizationsForUser).mockResolvedValue([]);

      const request = new Request('http://localhost/api/organizations/mine');
      await handleMyOrganizationsRoute(request, {
        principal: {
          id: 'principal-1',
          type: 'user' as const,
          dbUserId: 'user-uuid-123',
        },
      });

      expect(getUserPrimaryOrg).not.toHaveBeenCalled();
    });
  });
});
