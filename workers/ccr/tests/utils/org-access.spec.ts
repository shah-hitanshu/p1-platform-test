/**
 * Organization access checks (PCC-3479)
 *
 * canAccessOrganization answers "may this principal act inside the account";
 * isOrgAdmin answers "may they manage it". Keeping the second from collapsing
 * into app.users.system_role is the point of these tests: self-service
 * onboarding gives everyone an account of their own, so a platform-wide admin
 * role would make each of them an admin of every account they join.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { RegisteredAgent } from '../../src/types';

vi.mock('../../src/services/organization-service', () => ({
  // Not a stub: isOrgAdmin reads this to decide which roles administer an
  // account, so mocking it away would make the owner case untestable here.
  ORG_ADMIN_ROLES: ['owner', 'admin'],
}));

vi.mock('../../src/utils/admin-check', () => ({
  isSuperAdmin: vi.fn(async () => false),
}));

vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn(async () => null),
}));

vi.mock('../../src/auth/principal-id-normalization', () => ({
  normalizePrincipalIdForDb: vi.fn(async (id: string) => `normalized:${id}`),
}));

vi.mock('../../src/db', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const ORG_ID = 'org-uuid-123';

/**
 * Both checks read the membership table directly, so the tests answer by SQL
 * rather than by call order — is_active moved into these statements and a
 * positional mock would not have noticed.
 */
async function stubDb(answers: {
  /** app.organization_members row behind isOrgAdmin, keyed by organization id. */
  role?: (organizationId: string) => string | undefined;
  /** Result of canAccessOrganization's membership-or-site-role probe. */
  access?: boolean;
  /** app.users id for the acting-user or principal_id lookup. */
  userId?: string;
}) {
  const { query } = await import('../../src/db');
  vi.mocked(query).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('SELECT role FROM app.organization_members')) {
      const role = answers.role?.(String(params?.[0]));
      return { rows: role === undefined ? [] : [{ role }], rowCount: role === undefined ? 0 : 1 };
    }
    if (sql.includes('SELECT EXISTS')) {
      return { rows: [{ found: answers.access ?? false }], rowCount: 1 };
    }
    if (sql.includes('FROM app.users')) {
      return answers.userId === undefined
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: answers.userId }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return query;
}

const user = {
  id: 'user-principal-1',
  type: 'user' as const,
  systemRole: 'member',
  dbUserId: 'user-uuid-1',
};

/** What AgentApiKeyProvider builds: no dbUserId, no email, no acting user. */
const bareAgent = {
  id: 'agent-uuid-1',
  type: 'agent' as const,
  systemRole: 'member',
};

const agentRecord = (
  overrides: Partial<RegisteredAgent> & { organizationId: string },
): RegisteredAgent => ({
  id: 'agent-uuid-1',
  name: 'Test agent',
  capabilities: [],
  status: 'active',
  settings: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('canAccessOrganization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes a direct member', async () => {
    const { canAccessOrganization } = await import('../../src/utils/org-access');
    const query = await stubDb({ access: true });

    expect(await canAccessOrganization(user, ORG_ID)).toBe(true);
    // A deactivated membership is not access, so the statement has to say so.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('om.is_active = true'),
      ['user-uuid-1', ORG_ID],
    );
  });

  it('refuses a non-member', async () => {
    const { canAccessOrganization } = await import('../../src/utils/org-access');
    await stubDb({ access: false });

    expect(await canAccessOrganization(user, ORG_ID)).toBe(false);
  });

  it('refuses an empty organization id without querying', async () => {
    const { canAccessOrganization } = await import('../../src/utils/org-access');
    const query = await stubDb({ access: true });

    expect(await canAccessOrganization(user, '')).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('resolves an agent through the user it is acting for', async () => {
    const { canAccessOrganization } = await import('../../src/utils/org-access');
    const query = await stubDb({ access: true, userId: 'acting-user-uuid' });

    const agent = {
      id: 'agent-principal-1',
      type: 'agent' as const,
      systemRole: 'member',
      actingUserEmail: 'Acting@Example.com',
    };

    expect(await canAccessOrganization(agent, ORG_ID)).toBe(true);
    // Looked up by the lowercased acting-user email, then checked as that user.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE LOWER(email) = $1'),
      ['acting@example.com'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT EXISTS'),
      ['acting-user-uuid', ORG_ID],
    );
  });

  // The principal css-client actually presents: an agent API key resolves to
  // {id, type: 'agent'} with no dbUserId and no acting-user headers. Before
  // PCC-3479 nothing gated these routes; the gate has to let an agent into the
  // account it belongs to or it 403s agents on their own records.
  it('passes a bare agent inside its own organization', async () => {
    const { canAccessOrganization } = await import('../../src/utils/org-access');
    const { getAgentById } = await import('../../src/services/agent-service');

    vi.mocked(getAgentById).mockResolvedValueOnce(
      agentRecord({ organizationId: ORG_ID }),
    );

    expect(await canAccessOrganization(bareAgent, ORG_ID)).toBe(true);
  });

  it('refuses a bare agent belonging to another organization', async () => {
    const { canAccessOrganization } = await import('../../src/utils/org-access');
    const { getAgentById } = await import('../../src/services/agent-service');

    vi.mocked(getAgentById).mockResolvedValueOnce(
      agentRecord({ organizationId: 'someone-elses-org' }),
    );

    expect(await canAccessOrganization(bareAgent, ORG_ID)).toBe(false);
  });

  // validateKey matches on the key hash and revoked_at only, so a suspended
  // agent still authenticates. Status has to be enforced here or it means
  // nothing on this path.
  it('refuses a suspended agent in its own organization', async () => {
    const { canAccessOrganization } = await import('../../src/utils/org-access');
    const { getAgentById } = await import('../../src/services/agent-service');

    vi.mocked(getAgentById).mockResolvedValueOnce(
      agentRecord({ organizationId: ORG_ID, status: 'suspended' }),
    );

    expect(await canAccessOrganization(bareAgent, ORG_ID)).toBe(false);
  });

  it('refuses an agent whose record has been deleted', async () => {
    const { canAccessOrganization } = await import('../../src/utils/org-access');

    expect(await canAccessOrganization(bareAgent, ORG_ID)).toBe(false);
  });
});

describe('isOrgAdmin', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes an admin of that organization', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');
    const query = await stubDb({ role: () => 'admin' });

    expect(await isOrgAdmin(user, ORG_ID)).toBe(true);
    // A deactivated admin is suspended from the account, so the statement has
    // to exclude them or the last-admin guard counts authority nobody holds.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('is_active = true'),
      [ORG_ID, 'user-uuid-1'],
    );
  });

  // createOrgForUser makes the creator the owner and no separate admin, so an
  // owner failing this check would lock every self-service account out of its
  // own roster.
  it('passes the owner of that organization', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');

    await stubDb({ role: () => 'owner' });

    expect(await isOrgAdmin(user, ORG_ID)).toBe(true);
  });

  it('refuses a plain member', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');

    await stubDb({ role: () => 'member' });

    expect(await isOrgAdmin(user, ORG_ID)).toBe(false);
  });

  // Being an admin of one business account says nothing about another.
  it('asks about the organization it was given, not any other', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');

    await stubDb({
      role: (organizationId) => (organizationId === 'org-mine' ? 'admin' : 'member'),
    });

    expect(await isOrgAdmin(user, 'org-mine')).toBe(true);
    expect(await isOrgAdmin(user, 'org-invited')).toBe(false);
  });

  // A site grant makes you a member of the org, never its administrator.
  it('refuses someone who reaches the org only through a site role', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');

    await stubDb({ role: () => undefined });

    expect(await isOrgAdmin(user, ORG_ID)).toBe(false);
  });

  it('passes a superadmin without a membership row', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');
    const { isSuperAdmin } = await import('../../src/utils/admin-check');
    const query = await stubDb({ role: () => undefined });

    vi.mocked(isSuperAdmin).mockResolvedValueOnce(true);

    expect(await isOrgAdmin({ ...user, systemRole: 'superadmin' }, ORG_ID)).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  // The platform admin role reaches the staff tools, not other people's
  // business accounts — that separation is the whole point of the split.
  it('does not pass a platform admin who is only a member of the account', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');
    await stubDb({ role: () => 'member' });

    expect(await isOrgAdmin({ ...user, systemRole: 'admin' }, ORG_ID)).toBe(false);
  });

  // Unlike canAccessOrganization there is no acting-user fallback: an agent
  // never administers an account on a person's behalf.
  it('refuses an agent acting for a user', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');
    const query = await stubDb({ role: () => 'admin' });

    const agent = {
      id: 'agent-principal-1',
      type: 'agent' as const,
      systemRole: 'member',
      actingUserEmail: 'acting@example.com',
    };

    expect(await isOrgAdmin(agent, ORG_ID)).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses an empty organization id without querying', async () => {
    const { isOrgAdmin } = await import('../../src/utils/org-access');
    const query = await stubDb({ role: () => 'admin' });

    expect(await isOrgAdmin(user, '')).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
