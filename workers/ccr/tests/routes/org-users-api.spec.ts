/**
 * Organization Users API Tests (PCC-3479)
 *
 * The dashboard's Users tab is scoped to the selected business account. These
 * tests pin the scoping, the per-account admin gate, and the guardrails on role
 * changes and removals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';
import { users } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import type { Env } from '../../src/env';

// Every route here needs the admin role *in this organization*, so the default
// caller is one. The permission block opts out explicitly.
vi.mock('../../src/utils/org-access', () => ({
  isOrgAdmin: vi.fn(async () => true),
  // Mirrors the real one: prefer what the gate attached, look it up otherwise.
  resolveUserId: vi.fn(async (principal: { dbUserId?: string }) => principal.dbUserId),
}));

vi.mock('../../src/services/invite-quota/invite-quota.service', () => ({ checkInviteQuota: vi.fn() }));
vi.mock('../../src/services/invite-email/invite-email.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/invite-email/invite-email.service')>()),
  sendInviteEmail: vi.fn(),
}));


vi.mock('../../src/services', () => ({
  getUsersForOrganization: vi.fn(),
  addUserToOrganization: vi.fn(),
  removeUserFromOrganization: vi.fn(),
  countOrganizationAdmins: vi.fn(async () => 2),
  countOrganizationMembers: vi.fn(),
  getOrganizationRole: vi.fn(async () => 'member'),
  // Role and isActive are written together in one statement, so there is one
  // mock for both and a null return means "no membership row".
  updateOrganizationMember: vi.fn(async () => ({ role: 'member', isActive: true })),
  isOrganizationMemberActive: vi.fn(async () => true),
  isUserInOrganization: vi.fn(),
  getOrganizationById: vi.fn(),
  recordAuditEntry: vi.fn(),
  OrganizationNotFoundError: class OrganizationNotFoundError extends Error {
    override name = 'OrganizationNotFoundError';
  },
}));

const ORG_ID = 'org-uuid-123';

const principal = {
  id: 'user-principal-1',
  type: 'user' as const,
  email: 'caller@example.com',
  dbUserId: 'caller-uuid',
  systemRole: 'member',
  pantheonSiteRoles: {},
  tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
};

function makeRequest(method: string, body?: unknown): Request {
  return new Request('https://example.com/api/organizations/org-uuid-123/users', {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}

function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-uuid-1',
    email: 'member@example.com',
    name: 'Member',
    principalId: null,
    authProvider: null,
    systemRole: 'member',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Organization users API', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    vi.clearAllMocks();
    database = stubDatabase();
  });

  describe('access control', () => {
    it('returns 403 without listing when the caller is not in the organization', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);

      const response = await handleOrgUsersRoutes(makeRequest('GET'), {
        organizationId: ORG_ID,
        principal,
      });

      expect(response.status).toBe(403);
      expect(services.getUsersForOrganization).not.toHaveBeenCalled();
    });

    it('returns 400 when no organization id is supplied', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');

      const response = await handleOrgUsersRoutes(makeRequest('GET'), {
        organizationId: '',
        principal,
      });

      expect(response.status).toBe(400);
    });

    // A member of the business account belongs to it but does not administer
    // it: the whole surface is closed to them, reading included.
    it('returns 403 without listing for a member of the organization', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);

      const response = await handleOrgUsersRoutes(makeRequest('GET'), {
        organizationId: ORG_ID,
        principal,
      });

      expect(response.status).toBe(403);
      expect(services.getUsersForOrganization).not.toHaveBeenCalled();
    });

    // The role is asked for against this organization, not the platform: an
    // admin of one business account is not thereby an admin of another.
    it('checks the admin role against the organization in the path', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');

      await handleOrgUsersRoutes(makeRequest('GET'), {
        organizationId: ORG_ID,
        principal,
      });

      expect(isOrgAdmin).toHaveBeenCalledWith(principal, ORG_ID);
    });

    it('returns 403 when a member tries to add a user', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);

      const response = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'invitee@example.com' }),
        { organizationId: ORG_ID, principal },
      );

      expect(response.status).toBe(403);
      expect(services.addUserToOrganization).not.toHaveBeenCalled();
      expect(services.getOrganizationById).not.toHaveBeenCalled();
    });

    it('returns 403 when a member tries to update a user', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { isActive: false }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(403);
      expect(services.isUserInOrganization).not.toHaveBeenCalled();
    });

    it('returns 403 when a member tries to remove a user', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false);

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'user-uuid-1',
        principal,
      });

      expect(response.status).toBe(403);
      expect(services.removeUserFromOrganization).not.toHaveBeenCalled();
    });

    // isOrgAdmin already requires an active membership row, so one check
    // answers both questions — and an outsider and a plain member get the same
    // reply, so neither learns which of the two they were.
    it('gives an outsider and a member the same answer', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const { isOrgAdmin } = await import('../../src/utils/org-access');

      // Once each: a persistent implementation would leak into later tests.
      vi.mocked(isOrgAdmin).mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      const outsider = await handleOrgUsersRoutes(makeRequest('GET'), {
        organizationId: ORG_ID,
        principal,
      });
      const member = await handleOrgUsersRoutes(makeRequest('GET'), {
        organizationId: ORG_ID,
        principal,
      });

      expect(outsider.status).toBe(403);
      expect(member.status).toBe(403);
      expect(await readJson<{ error: string }>(outsider)).toEqual(
        await readJson<{ error: string }>(member),
      );
      expect(vi.mocked(isOrgAdmin)).toHaveBeenCalledTimes(2);
    });
  });

  describe('GET', () => {
    it('lists only the selected organization\'s users', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getUsersForOrganization).mockResolvedValueOnce([
        {
          id: 'user-uuid-1',
          email: 'member@example.com',
          name: 'Member',
          principalId: null,
          authProvider: null,
          systemRole: 'member',
          role: 'member',
          isActive: true,
          isDirectMember: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const response = await handleOrgUsersRoutes(makeRequest('GET'), {
        organizationId: ORG_ID,
        principal,
      });

      expect(response.status).toBe(200);
      expect(services.getUsersForOrganization).toHaveBeenCalledWith(ORG_ID);

      const body = await readJson<{ users: { email: string }[] }>(response);
      expect(body.users).toHaveLength(1);
      expect(body.users[0]?.email).toBe('member@example.com');
    });
  });

  describe('POST', () => {
    it('creates the user and joins them to the organization', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce({
        id: ORG_ID,
      } as never);
      database.on(users).insert.returns([userRow()]);
      vi.mocked(services.addUserToOrganization).mockResolvedValueOnce(true);

      const response = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'Member@Example.com', name: 'Member' }),
        { organizationId: ORG_ID, principal },
      );

      expect(response.status).toBe(201);
      // Email is normalized before it reaches the unique index, and the new
      // app.users row is left at the default platform role.
      expect(database.calls(users).insert[0].params).toEqual([
        'member@example.com',
        'Member',
      ]);
      expect(services.addUserToOrganization).toHaveBeenCalledWith(
        ORG_ID,
        'user-uuid-1',
        'member',
      );
    });

    it('joins an email already known to P1 rather than failing on the unique index', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce({
        id: ORG_ID,
      } as never);
      // INSERT ... ON CONFLICT DO NOTHING returns nothing, then the SELECT finds it.
      database.on(users).select.returns([userRow()]);
      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(false);
      vi.mocked(services.addUserToOrganization).mockResolvedValueOnce(true);

      const response = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'member@example.com' }),
        { organizationId: ORG_ID, principal },
      );

      expect(response.status).toBe(201);
      expect(services.addUserToOrganization).toHaveBeenCalledWith(
        ORG_ID,
        'user-uuid-1',
        'member',
      );
    });

    it('joins the user as an admin when asked', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce({
        id: ORG_ID,
      } as never);
      database.on(users).insert.returns([userRow()]);
      vi.mocked(services.addUserToOrganization).mockResolvedValueOnce(true);

      const response = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'member@example.com', role: 'admin' }),
        { organizationId: ORG_ID, principal },
      );

      expect(response.status).toBe(201);
      expect(services.addUserToOrganization).toHaveBeenCalledWith(
        ORG_ID,
        'user-uuid-1',
        'admin',
      );

      const body = await readJson<{ role: string; systemRole: string }>(response);
      expect(body.role).toBe('admin');
      // Administering a business account says nothing about the platform role.
      expect(body.systemRole).toBe('member');
    });

    it('returns 409 when the user is already in this organization', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce({
        id: ORG_ID,
      } as never);
      database.on(users).select.returns([userRow()]);
      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);

      const response = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'member@example.com' }),
        { organizationId: ORG_ID, principal },
      );

      expect(response.status).toBe(409);
      expect(services.addUserToOrganization).not.toHaveBeenCalled();
    });

    // superadmin is a platform role and has no meaning inside an account, so
    // it is rejected on the whitelist before anything else happens.
    it('refuses to grant superadmin through the org-scoped API', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      const response = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'root@example.com', role: 'superadmin' }),
        { organizationId: ORG_ID, principal },
      );

      expect(response.status).toBe(400);
      expect(services.getOrganizationById).not.toHaveBeenCalled();
    });

    it('returns 404 when the organization does not exist', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce(null);

      const response = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'member@example.com' }),
        { organizationId: ORG_ID, principal },
      );

      expect(response.status).toBe(404);
    });

    // A typo mints an app.users row that nothing in this API can delete again.
    it('rejects an address that is not an email', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      const response = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'not-an-email-at-all' }),
        { organizationId: ORG_ID, principal },
      );

      expect(response.status).toBe(400);
      expect(services.getOrganizationById).not.toHaveBeenCalled();
    });
  });

  describe('POST — invite email', () => {
    const ENV = {
      ENVIRONMENT: 'staging',
      SENDGRID_API_KEY: 'k',
      DASHBOARD_URL: 'https://d.test',
    } as unknown as Env;

    async function post(body: unknown, env: Env | undefined) {
      const services = await import('../../src/services');
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Acme',
      } as never);
      database.on(users).insert.returns([userRow({ email: (body as { email: string }).email })]);
      vi.mocked(services.addUserToOrganization).mockResolvedValueOnce(true);

      return handleOrgUsersRoutes(makeRequest('POST', body), { organizationId: ORG_ID, principal }, env);
    }

    async function postAs(principalOverrides: Record<string, unknown>, body: unknown) {
      const services = await import('../../src/services');
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Acme',
      } as never);
      database.on(users).insert.returns([userRow({ email: (body as { email: string }).email })]);
      vi.mocked(services.addUserToOrganization).mockResolvedValueOnce(true);

      return handleOrgUsersRoutes(
        makeRequest('POST', body),
        { organizationId: ORG_ID, principal: { ...principal, ...principalOverrides } },
        ENV,
      );
    }

    beforeEach(async () => {
      const { checkInviteQuota } = await import('../../src/services/invite-quota/invite-quota.service');
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');
      vi.mocked(checkInviteQuota).mockResolvedValue('ok');
      vi.mocked(sendInviteEmail).mockResolvedValue(true);
    });

    it('sends an invite email and reports emailSent true', async () => {
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');
      vi.mocked(sendInviteEmail).mockResolvedValueOnce(true);

      const res = await post({ email: 'new@x.com', role: 'member' }, ENV);
      expect(res.status).toBe(201);
      expect(await readJson(res)).toMatchObject({ email: 'new@x.com', emailSent: true });
      expect(sendInviteEmail).toHaveBeenCalledWith(
        ENV,
        expect.objectContaining({ email: 'new@x.com', role: 'member', inviterEmail: 'caller@example.com' }),
      );
    });

    it('omits emailSent entirely when the send is not applicable', async () => {
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');
      vi.mocked(sendInviteEmail).mockResolvedValueOnce(undefined);

      const body = await readJson(await post({ email: 'new@x.com', role: 'member' }, ENV));
      expect('emailSent' in body).toBe(false);
    });

    it('does not attempt a send when no env is passed', async () => {
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');

      const body = await readJson(
        await post({ email: 'new@x.com', role: 'member' }, undefined),
      );
      expect('emailSent' in body).toBe(false);
      expect(sendInviteEmail).not.toHaveBeenCalled();
    });

    it('counts the quota before writing the audit entry', async () => {
      const services = await import('../../src/services');
      const { checkInviteQuota } = await import('../../src/services/invite-quota/invite-quota.service');

      await post({ email: 'new@x.com', role: 'member' }, ENV);

      expect(vi.mocked(checkInviteQuota).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(services.recordAuditEntry).mock.invocationCallOrder[0]);
    });

    it('skips the send and reports false when the quota is exceeded', async () => {
      const { checkInviteQuota } = await import('../../src/services/invite-quota/invite-quota.service');
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');
      vi.mocked(checkInviteQuota).mockResolvedValueOnce('exceeded');

      const body = await readJson<{ emailSent: boolean }>(await post({ email: 'new@x.com', role: 'member' }, ENV));
      expect(body.emailSent).toBe(false);
      expect(sendInviteEmail).not.toHaveBeenCalled();
    });

    it('audits the attempt, with its own action, when the quota is exceeded', async () => {
      const services = await import('../../src/services');
      const { checkInviteQuota } = await import('../../src/services/invite-quota/invite-quota.service');
      vi.mocked(checkInviteQuota).mockResolvedValueOnce('exceeded');

      await post({ email: 'new@x.com', role: 'member' }, ENV);

      expect(services.recordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org_user.invite_quota_exceeded',
          organizationId: ORG_ID,
          targetType: 'user',
          targetLabel: 'new@x.com',
          details: { role: 'member' },
        }),
      );
      // The membership itself is still recorded as usual.
      expect(services.recordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'org_user.add', targetLabel: 'new@x.com' }),
      );
    });

    it('writes no quota audit row when the quota permits the send', async () => {
      const services = await import('../../src/services');

      await post({ email: 'new@x.com', role: 'member' }, ENV);

      const actions = vi.mocked(services.recordAuditEntry).mock.calls.map(([e]) => e.action);
      expect(actions).toEqual(['org_user.add']);
    });

    it('writes no quota audit row when the quota check fails', async () => {
      const services = await import('../../src/services');
      const { checkInviteQuota } = await import('../../src/services/invite-quota/invite-quota.service');
      vi.mocked(checkInviteQuota).mockResolvedValueOnce('unknown');

      await post({ email: 'new@x.com', role: 'member' }, ENV);

      const actions = vi.mocked(services.recordAuditEntry).mock.calls.map(([e]) => e.action);
      expect(actions).toEqual(['org_user.add']);
    });

    // No SENDGRID_API_KEY means no send was ever possible, so a quota hit must
    // not be reported as an attempted-but-unconfirmed send.
    it('omits emailSent when the quota is exceeded but email is not configured', async () => {
      const { checkInviteQuota } = await import('../../src/services/invite-quota/invite-quota.service');
      vi.mocked(checkInviteQuota).mockResolvedValueOnce('exceeded');

      const res = await post({ email: 'new@x.com', role: 'member' }, { ENVIRONMENT: 'staging' } as unknown as Env);
      expect(res.status).toBe(201);
      expect('emailSent' in await readJson(res)).toBe(false);
    });

    it('omits emailSent when the inviter is unresolvable and email is not configured', async () => {
      const { resolveUserId } = await import('../../src/utils/org-access');
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');
      vi.mocked(resolveUserId).mockResolvedValueOnce(undefined);
      vi.mocked(services.getOrganizationById).mockResolvedValueOnce({ id: ORG_ID, name: 'Acme' } as never);
      database.on(users).insert.returns([userRow({ email: 'new@x.com' })]);
      vi.mocked(services.addUserToOrganization).mockResolvedValueOnce(true);

      const res = await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'new@x.com', role: 'member' }),
        { organizationId: ORG_ID, principal: { ...principal, email: undefined, dbUserId: undefined } },
        { ENVIRONMENT: 'staging' } as unknown as Env,
      );
      expect(res.status).toBe(201);
      expect('emailSent' in await readJson(res)).toBe(false);
    });

    it('still returns 201 with the membership intact when the quota check fails', async () => {
      const { checkInviteQuota } = await import('../../src/services/invite-quota/invite-quota.service');
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');
      vi.mocked(checkInviteQuota).mockResolvedValueOnce('unknown');

      const res = await post({ email: 'new@x.com', role: 'member' }, ENV);
      expect(res.status).toBe(201);
      expect('emailSent' in await readJson(res)).toBe(false);
      expect(sendInviteEmail).not.toHaveBeenCalled();
    });

    // principal.email and principal.dbUserId both undefined: the mock-auth and
    // broker-auth shape documented in utils/org-access.ts.
    it('resolves the inviter email from the database when the principal has none', async () => {
      const services = await import('../../src/services');
      const { resolveUserId } = await import('../../src/utils/org-access');
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');

      vi.mocked(services.getOrganizationById).mockResolvedValueOnce({ id: ORG_ID, name: 'Acme' } as never);
      database.on(users).insert.returns([userRow({ email: 'new@x.com' })]);
      database.on(users).select.whenBound(['resolved-user-id']).returns([userRow({ id: 'resolved-user-id', email: 'resolved@x.com', name: 'Resolved Name' })]);
      vi.mocked(services.addUserToOrganization).mockResolvedValueOnce(true);
      vi.mocked(resolveUserId).mockResolvedValueOnce('resolved-user-id');

      await handleOrgUsersRoutes(
        makeRequest('POST', { email: 'new@x.com', role: 'member' }),
        { organizationId: ORG_ID, principal: { ...principal, email: undefined, dbUserId: undefined } },
        ENV,
      );

      expect(sendInviteEmail).toHaveBeenCalledWith(
        ENV,
        expect.objectContaining({ inviterEmail: 'resolved@x.com', inviterName: 'Resolved Name' }),
      );
    });

    it('passes the principal display name as the inviter name', async () => {
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');

      await postAs({ name: 'Ada Lovelace' }, { email: 'new@x.com', role: 'member' });

      expect(sendInviteEmail).toHaveBeenCalledWith(
        ENV,
        expect.objectContaining({ inviterEmail: 'caller@example.com', inviterName: 'Ada Lovelace' }),
      );
    });

    it('returns emailSent:false when the inviter email cannot be resolved', async () => {
      const { resolveUserId } = await import('../../src/utils/org-access');
      const { sendInviteEmail } = await import('../../src/services/invite-email/invite-email.service');
      vi.mocked(resolveUserId).mockResolvedValueOnce(undefined);

      const body = await readJson(
        await postAs({ email: undefined, dbUserId: undefined }, { email: 'new@x.com', role: 'member' }),
      );
      // Quota permitted a send but inviter address couldn't be resolved — false,
      // not undefined (which means the feature is unconfigured).
      expect(body.emailSent).toBe(false);
      expect(sendInviteEmail).not.toHaveBeenCalled();
    });
  });

  describe('PATCH', () => {
    it('returns 404 for a user outside the organization', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(false);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { isActive: false }),
        { organizationId: ORG_ID, userId: 'other-org-user', principal },
      );

      expect(response.status).toBe(404);
    });

    it('deactivates a user in the organization', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.updateOrganizationMember).mockResolvedValueOnce({
        role: 'member',
        isActive: false,
      });
      database.on(users).select.returns([userRow()]);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { isActive: false }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(200);
      expect(services.updateOrganizationMember).toHaveBeenCalledWith(
        ORG_ID,
        'user-uuid-1',
        { role: undefined, isActive: false },
      );
      const body = await readJson<{ isActive: boolean }>(response);
      expect(body.isActive).toBe(false);
    });

    // Same "no roster edit" rule as demoting an owner: an owner's active
    // state can't be touched here either, at any head count.
    it('refuses to deactivate an owner', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole).mockResolvedValueOnce('owner');

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { isActive: false }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(409);
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    // Someone who reaches the org only through a site role has no
    // organization_members row, so there is no isActive flag on them to flip.
    it('returns 404 when deactivating a user with no membership row', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.updateOrganizationMember).mockResolvedValueOnce(null);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { isActive: false }),
        { organizationId: ORG_ID, userId: 'site-only-user', principal },
      );

      expect(response.status).toBe(404);
    });

    // Role and isActive go out in one statement, so a request that sets both
    // either applies both or neither — the caller can't be told "no" about a
    // change that half happened.
    it('writes role and isActive in a single statement', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole).mockResolvedValue('admin');
      vi.mocked(services.updateOrganizationMember).mockResolvedValueOnce({
        role: 'admin',
        isActive: false,
      });
      database.on(users).select.returns([userRow()]);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'admin', isActive: false }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(200);
      expect(services.updateOrganizationMember).toHaveBeenCalledTimes(1);
      expect(services.updateOrganizationMember).toHaveBeenCalledWith(
        ORG_ID,
        'user-uuid-1',
        { role: 'admin', isActive: false },
      );
    });

    it('returns 404 when the single write finds no membership row', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.updateOrganizationMember).mockResolvedValueOnce(null);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'admin', isActive: false }),
        { organizationId: ORG_ID, userId: 'site-only-user', principal },
      );

      expect(response.status).toBe(404);
    });

    it('promotes a member to admin of this organization', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole).mockResolvedValue('admin');
      database.on(users).select.returns([userRow()]);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'admin' }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(200);
      expect(services.updateOrganizationMember).toHaveBeenCalledWith(
        ORG_ID,
        'user-uuid-1',
        { role: 'admin', isActive: undefined },
      );

      const body = await readJson<{ role: string }>(response);
      expect(body.role).toBe('admin');
    });

    // Nothing on this route touches app.users.system_role: an account admin
    // handing out the platform role would make every account a way in.
    it('does not write the platform role', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole).mockResolvedValue('admin');
      database.on(users).select.returns([userRow()]);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'admin' }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(200);
      // Role lives on organization_members (updateOrganizationMember, mocked
      // above); nothing here writes app.users at all.
      expect(database.calls(users).update).toHaveLength(0);
    });

    // Ownership moves by transfer, not by an admin editing the roster — no
    // head-count exception, unlike the last-admin guard below: this fires
    // even when the organization has several owners.
    it('refuses to demote an owner', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole).mockResolvedValueOnce('owner');

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'member' }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(409);
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    // `owner` is not assignable here at all: handing out "this account belongs
    // to you" is a transfer, not a roster edit.
    it('rejects owner as an assignable role', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'owner' }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(400);
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    it('rejects a role outside the org whitelist', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'superadmin' }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(400);
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    // Demoting the last admin would leave nobody able to manage the account —
    // including nobody able to undo the demotion.
    it('refuses to demote the last admin', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole).mockResolvedValue('admin');
      vi.mocked(services.countOrganizationAdmins).mockResolvedValueOnce(1);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'member' }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(409);
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    // Deactivating the last admin locks the account out exactly as demoting
    // them would: isOrgAdmin refuses a suspended member, so the guard has to
    // cover both fields or the isActive path walks straight past it.
    it('refuses to deactivate the last admin', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole).mockResolvedValue('admin');
      vi.mocked(services.countOrganizationAdmins).mockResolvedValueOnce(1);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { isActive: false }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(409);
      const body = await readJson<{ error: string }>(response);
      expect(body.error).toBe('Cannot deactivate the last admin of an organization');
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    it('deactivates an admin while another remains', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole).mockResolvedValue('admin');
      vi.mocked(services.countOrganizationAdmins).mockResolvedValueOnce(2);
      vi.mocked(services.updateOrganizationMember).mockResolvedValueOnce({
        role: 'admin',
        isActive: false,
      });
      database.on(users).select.returns([userRow()]);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { isActive: false }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(200);
    });

    it('demotes an admin while another remains', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.getOrganizationRole)
        .mockResolvedValueOnce('admin')
        .mockResolvedValueOnce('member');
      vi.mocked(services.countOrganizationAdmins).mockResolvedValueOnce(2);
      database.on(users).select.returns([userRow()]);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'member' }),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(200);
      expect(services.updateOrganizationMember).toHaveBeenCalledWith(
        ORG_ID,
        'user-uuid-1',
        { role: 'member', isActive: undefined },
      );
    });

    // Someone who reaches the org only through a site role has no membership
    // row, so there is no org role to set on them.
    it('returns 404 when the target has no membership row', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);
      vi.mocked(services.updateOrganizationMember).mockResolvedValueOnce(null);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'admin' }),
        { organizationId: ORG_ID, userId: 'site-only-user', principal },
      );

      expect(response.status).toBe(404);
    });

    it('returns 400 when there is nothing to update', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', {}),
        { organizationId: ORG_ID, userId: 'user-uuid-1', principal },
      );

      expect(response.status).toBe(400);
    });

    // The last-admin guard only catches the final admin stepping down. With a
    // co-admin present, each could still demote themselves, so self-edits are
    // refused outright rather than counted.
    it('refuses to change your own membership', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'member' }),
        { organizationId: ORG_ID, userId: principal.dbUserId, principal },
      );

      expect(response.status).toBe(409);
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    // dbUserId comes back lowercase from Postgres, but the userId is a raw path
    // segment and every query downstream casts it ::uuid, where equality
    // ignores case. Comparing the two as plain strings let an admin re-type
    // their own id in capitals and demote themselves through the guard.
    it('refuses a self-edit addressed with a case-variant uuid', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'member' }),
        {
          organizationId: ORG_ID,
          userId: principal.dbUserId.toUpperCase(),
          principal,
        },
      );

      expect(response.status).toBe(409);
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    // The request gate attaches no dbUserId where there is no real auth
    // provider, which used to make this guard silently stop applying.
    it('refuses a self-edit when the gate attached no dbUserId', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const { resolveUserId } = await import('../../src/utils/org-access');
      const services = await import('../../src/services');

      vi.mocked(resolveUserId).mockResolvedValueOnce('caller-uuid');

      const response = await handleOrgUsersRoutes(
        makeRequest('PATCH', { role: 'member' }),
        {
          organizationId: ORG_ID,
          userId: 'caller-uuid',
          principal: { ...principal, dbUserId: undefined },
        },
      );

      expect(response.status).toBe(409);
      expect(services.updateOrganizationMember).not.toHaveBeenCalled();
    });

    it('rejects an unparseable body with 400, not 500', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.isUserInOrganization).mockResolvedValueOnce(true);

      const response = await handleOrgUsersRoutes(
        new Request('https://api.example.com/api/organizations/org-1/users/u-2', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: '{not json',
        }),
        { organizationId: ORG_ID, userId: 'u-2', principal },
      );

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('removes the membership', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.countOrganizationMembers).mockResolvedValueOnce(3);
      vi.mocked(services.removeUserFromOrganization).mockResolvedValueOnce(true);
      database.on(users).select.returns([{ email: 'member@example.com' }]);

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'user-uuid-1',
        principal,
      });

      expect(response.status).toBe(204);
      expect(services.removeUserFromOrganization).toHaveBeenCalledWith(
        ORG_ID,
        'user-uuid-1',
      );
    });

    it('refuses to empty the organization', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.countOrganizationMembers).mockResolvedValueOnce(1);

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'user-uuid-1',
        principal,
      });

      expect(response.status).toBe(409);
      expect(services.removeUserFromOrganization).not.toHaveBeenCalled();
    });

    // The owner is who the account belongs to; removal only ever happens
    // through a transfer. No head-count exception, unlike the last-admin/
    // last-member guards below: this fires even with several owners.
    it('refuses to remove an owner', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationRole).mockResolvedValueOnce('owner');

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'user-uuid-1',
        principal,
      });

      expect(response.status).toBe(409);
      expect(services.removeUserFromOrganization).not.toHaveBeenCalled();
      // The owner guard runs before the count guards, so the caller is told the
      // real reason rather than "cannot remove the last member".
      expect(services.countOrganizationMembers).not.toHaveBeenCalled();
    });

    // Same reasoning as the demotion guard: an account left with members but
    // no admin cannot be managed at all.
    it('refuses to remove the last admin', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.countOrganizationMembers).mockResolvedValueOnce(3);
      vi.mocked(services.getOrganizationRole).mockResolvedValueOnce('admin');
      vi.mocked(services.countOrganizationAdmins).mockResolvedValueOnce(1);

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'user-uuid-1',
        principal,
      });

      expect(response.status).toBe(409);
      expect(services.removeUserFromOrganization).not.toHaveBeenCalled();
    });

    it('removes an admin while another remains', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.countOrganizationMembers).mockResolvedValueOnce(3);
      vi.mocked(services.getOrganizationRole).mockResolvedValueOnce('admin');
      vi.mocked(services.countOrganizationAdmins).mockResolvedValueOnce(2);
      vi.mocked(services.removeUserFromOrganization).mockResolvedValueOnce(true);
      database.on(users).select.returns([{ email: 'member@example.com' }]);

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'user-uuid-1',
        principal,
      });

      expect(response.status).toBe(204);
    });

    // A superadmin can remove someone from an account they were never a member
    // of, so the removal has to leave a trace naming who did it.
    it('records an audit entry naming the actor and their platform role', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.countOrganizationMembers).mockResolvedValueOnce(3);
      // Set explicitly rather than left to the module default: clearAllMocks
      // does not drain mockResolvedValueOnce queues, so a sibling test's value
      // can otherwise arrive here and change the role this asserts on.
      vi.mocked(services.getOrganizationRole).mockResolvedValueOnce('member');
      vi.mocked(services.removeUserFromOrganization).mockResolvedValueOnce(true);
      database.on(users).select.returns([{ email: 'removed@example.com' }]);

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'user-uuid-1',
        principal: { ...principal, systemRole: 'superadmin' },
      });

      expect(response.status).toBe(204);
      expect(services.recordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org_user.remove',
          actor: expect.objectContaining({
            email: 'caller@example.com',
            dbUserId: 'caller-uuid',
            systemRole: 'superadmin',
          }),
          organizationId: ORG_ID,
          targetType: 'user',
          targetId: 'user-uuid-1',
          targetLabel: 'removed@example.com',
          details: { role: 'member' },
        }),
      );
    });

    it('returns 404 for someone who only reaches the org through a site role', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationRole).mockResolvedValueOnce(null);

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'site-only-user',
        principal,
      });

      expect(response.status).toBe(404);
      expect(services.removeUserFromOrganization).not.toHaveBeenCalled();
    });

    // The org-emptying guard counts membership rows, so it must not be reached
    // for a target that has none: removing a site-only collaborator from an
    // account with one direct member used to fail as "cannot remove the last
    // member", naming a count the removal would not have changed.
    it('reports a site-only collaborator as a non-member even when the org has one direct member', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      vi.mocked(services.getOrganizationRole).mockResolvedValueOnce(null);
      vi.mocked(services.countOrganizationMembers).mockResolvedValueOnce(1);

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: 'site-only-user',
        principal,
      });

      expect(response.status).toBe(404);
      const body = await readJson<{ error: string }>(response);
      expect(body.error).toContain('not a direct member');
      expect(services.removeUserFromOrganization).not.toHaveBeenCalled();
    });

    it('refuses to remove yourself', async () => {
      const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');
      const services = await import('../../src/services');

      const response = await handleOrgUsersRoutes(makeRequest('DELETE'), {
        organizationId: ORG_ID,
        userId: principal.dbUserId,
        principal,
      });

      expect(response.status).toBe(409);
      expect(services.removeUserFromOrganization).not.toHaveBeenCalled();
    });
  });

  it('rejects unsupported methods', async () => {
    const { handleOrgUsersRoutes } = await import('../../src/routes/org-users-api');

    const response = await handleOrgUsersRoutes(makeRequest('PUT'), {
      organizationId: ORG_ID,
      principal,
    });

    expect(response.status).toBe(405);
  });
});
