/**
 * Global agents: the site agent-access list, and the authorization that has to
 * agree with it.
 *
 * Runs against real PostgreSQL. The route spec mocks the service, so nothing
 * else executes this SQL — and listRolesBySite's UNION branches have to agree
 * on column types, which only a real database enforces.
 *
 * Prerequisites:
 * - PostgreSQL running: make docker-up
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection } from '../../src/db';
import { createRealDatabaseConnection } from '../helpers/database';
import {
  grantRole,
  isGlobalAgentId,
  listRolesBySite,
  resolveAgentSiteRole,
  revokeRoleBySite,
} from '../../src/services/agent-site-role-service';
import { getSiteRole } from '../../src/auth/authorization';
import { getAgentById, getAgentsByOrganization } from '../../src/services/agent-service';
import { listSites } from '../../src/services/site-service';
import type { AuthenticatedPrincipal } from '../../src/types';

const GLOBAL_AGENT_ID = 'c1000000-0000-0000-0000-000000000001';
const LOCAL_AGENT_ID = 'c1000000-0000-0000-0000-000000000002';
const GRANTED_BY = '00000000-0000-0000-0000-0000000000ff';
const ACTING_USER_EMAIL = 'global-agent-test-user@example.com';
const STRANGER_EMAIL = 'global-agent-test-stranger@example.com';

describe('global agents in the site agent-access list', () => {
  let sql: postgres.Sql;
  let connection: DatabaseConnection;
  let testOrgId: string;
  let otherOrgId: string;
  let testSiteId: string;
  let otherOrgSiteId: string;
  let actingUserId: string;

  beforeAll(async () => {
    const handles = createRealDatabaseConnection();
    sql = handles.sql;
    connection = handles.connection;
    setDatabaseInstance(connection);

    const orgResult = await sql`
      INSERT INTO app.organizations (name) VALUES ('global-agent-test-org') RETURNING id
    `;
    testOrgId = String(orgResult[0]?.id);

    // A second org proves visibility does not depend on owning the agent row.
    const otherOrgResult = await sql`
      INSERT INTO app.organizations (name) VALUES ('global-agent-other-org') RETURNING id
    `;
    otherOrgId = String(otherOrgResult[0]?.id);

    const siteResult = await sql`
      INSERT INTO app.sites (name, pantheon_site_id, organization_id)
      VALUES ('global-agent-test-site', 'global-agent-test', ${testOrgId})
      RETURNING id
    `;
    testSiteId = String(siteResult[0]?.id);

    // A site in the other org proves the organization filter still bounds a
    // global agent's listing.
    const otherSiteResult = await sql`
      INSERT INTO app.sites (name, pantheon_site_id, organization_id)
      VALUES ('global-agent-test-other-site', 'global-agent-test-other', ${otherOrgId})
      RETURNING id
    `;
    otherOrgSiteId = String(otherSiteResult[0]?.id);

    await sql`
      INSERT INTO app.agents (id, organization_id, name, capabilities, status, is_global)
      VALUES
        (${GLOBAL_AGENT_ID}, ${otherOrgId}, 'Global Test Agent', ARRAY['content_edit'], 'active', true),
        (${LOCAL_AGENT_ID}, ${testOrgId}, 'Local Test Agent', ARRAY['content_edit'], 'active', false)
    `;

    // The acting user a global agent's implicit access is delegated from. Given
    // a role on both sites, so any narrowing seen in a test comes from the code
    // under test rather than from a missing grant.
    const userResult = await sql`
      INSERT INTO app.users (email, name, system_role, is_active)
      VALUES (${ACTING_USER_EMAIL}, 'Global Agent Test User', 'member', true),
             (${STRANGER_EMAIL}, 'Global Agent Test Stranger', 'member', true)
      RETURNING id, email
    `;
    const idByEmail = new Map(userResult.map((row) => [String(row.email), String(row.id)]));
    actingUserId = idByEmail.get(ACTING_USER_EMAIL) ?? '';

    // The stranger deliberately gets no site role at all.
    await sql`
      INSERT INTO app.user_site_roles (user_id, site_id, role)
      VALUES (${actingUserId}, ${testSiteId}, 'admin'),
             (${actingUserId}, ${otherOrgSiteId}, 'admin')
    `;
  });

  beforeEach(async () => {
    await sql`DELETE FROM app.agent_site_roles WHERE agent_id IN (${GLOBAL_AGENT_ID}, ${LOCAL_AGENT_ID})`;
  });

  afterAll(async () => {
    await sql`DELETE FROM app.agent_site_roles WHERE agent_id IN (${GLOBAL_AGENT_ID}, ${LOCAL_AGENT_ID})`;
    await sql`DELETE FROM app.agents WHERE id IN (${GLOBAL_AGENT_ID}, ${LOCAL_AGENT_ID})`;
    await sql`DELETE FROM app.user_site_roles WHERE user_id IN (
      SELECT id::text FROM app.users
       WHERE email IN (${ACTING_USER_EMAIL}, ${STRANGER_EMAIL})
    )`;
    await sql`DELETE FROM app.users
       WHERE email IN (${ACTING_USER_EMAIL}, ${STRANGER_EMAIL})`;
    await sql`DELETE FROM app.sites WHERE pantheon_site_id LIKE 'global-agent-test%'`;
    await sql`DELETE FROM app.organizations WHERE id IN (${testOrgId}, ${otherOrgId})`;
    await connection.close();
  });

  it('includes a global agent from another org with no explicit grant', async () => {
    const roles = await listRolesBySite(testSiteId);

    const global = roles.filter((role) => role.agentId === GLOBAL_AGENT_ID);
    expect(global).toHaveLength(1);
    expect(global[0]?.isGlobal).toBe(true);
    expect(global[0]?.role).toBe('editor');
    expect(global[0]?.siteId).toBe(testSiteId);
    // With no grant row the synthetic row carries the agent's own id.
    expect(global[0]?.id).toBe(GLOBAL_AGENT_ID);
  });

  it('lists an explicitly granted local agent alongside it, exactly once each', async () => {
    await grantRole({
      agentId: LOCAL_AGENT_ID,
      siteId: testSiteId,
      role: 'editor',
      grantedBy: GRANTED_BY,
    });

    const roles = await listRolesBySite(testSiteId);

    expect(roles.filter((role) => role.agentId === GLOBAL_AGENT_ID)).toHaveLength(1);
    const local = roles.filter((role) => role.agentId === LOCAL_AGENT_ID);
    expect(local).toHaveLength(1);
    expect(local[0]?.isGlobal).toBe(false);
  });

  it('does not duplicate a global agent that also holds an explicit grant', async () => {
    await grantRole({
      agentId: GLOBAL_AGENT_ID,
      siteId: testSiteId,
      role: 'admin',
      grantedBy: GRANTED_BY,
    });

    const roles = await listRolesBySite(testSiteId);

    const global = roles.filter((role) => role.agentId === GLOBAL_AGENT_ID);
    expect(global).toHaveLength(1);
    expect(global[0]?.isGlobal).toBe(true);
    // The explicit grant wins over the synthetic default.
    expect(global[0]?.role).toBe('admin');
  });

  describe('revoke guard', () => {
    it('protects a global agent listed under its own agent id', async () => {
      expect(await isGlobalAgentId(GLOBAL_AGENT_ID)).toBe(true);
    });

    it('lets a global agent\'s explicit grant be revoked', async () => {
      const granted = await grantRole({
        agentId: GLOBAL_AGENT_ID,
        siteId: testSiteId,
        role: 'admin',
        grantedBy: GRANTED_BY,
      });

      // Only the implicit access is non-removable. Revoking an explicit row
      // drops the agent back to the default, which is the cleanup path for a
      // grant made before the agent was flagged global.
      expect(await isGlobalAgentId(granted.id)).toBe(false);
      expect(await revokeRoleBySite(granted.id, testSiteId)).toBe(true);
      expect(await resolveAgentSiteRole(GLOBAL_AGENT_ID, testSiteId, true))
        .toEqual({ role: 'editor', implicit: true });
    });

    it('lets an ordinary agent grant through to be revoked', async () => {
      const granted = await grantRole({
        agentId: LOCAL_AGENT_ID,
        siteId: testSiteId,
        role: 'editor',
        grantedBy: GRANTED_BY,
      });

      expect(await isGlobalAgentId(granted.id)).toBe(false);
      expect(await revokeRoleBySite(granted.id, testSiteId)).toBe(true);
    });

    it('ignores an id that is not a uuid instead of throwing', async () => {
      expect(await isGlobalAgentId('not-a-uuid')).toBe(false);
    });
  });

  // The listing shows a role, so authorization has to grant that same role —
  // otherwise a global agent displays as editor and is denied at request time.
  describe('resolveAgentSiteRole', () => {
    it('gives a global agent the default role with no explicit grant', async () => {
      expect(await resolveAgentSiteRole(GLOBAL_AGENT_ID, testSiteId, true))
        .toEqual({ role: 'editor', implicit: true });
    });

    it('withholds implicit access when there is no acting user', async () => {
      expect(await resolveAgentSiteRole(GLOBAL_AGENT_ID, testSiteId, false)).toBeNull();
    });

    it('honours an explicit grant with no acting user', async () => {
      await grantRole({
        agentId: GLOBAL_AGENT_ID,
        siteId: testSiteId,
        role: 'viewer',
        grantedBy: GRANTED_BY,
      });

      // An explicit row authorized on its own before the flag existed, and the
      // agents holding one in staging and production still depend on that.
      expect(await resolveAgentSiteRole(GLOBAL_AGENT_ID, testSiteId, false))
        .toEqual({ role: 'viewer', implicit: false });
    });

    it('prefers a global agent\'s explicit grant over the default', async () => {
      await grantRole({
        agentId: GLOBAL_AGENT_ID,
        siteId: testSiteId,
        role: 'admin',
        grantedBy: GRANTED_BY,
      });

      expect(await resolveAgentSiteRole(GLOBAL_AGENT_ID, testSiteId, true))
        .toEqual({ role: 'admin', implicit: false });
    });

    it('gives an ordinary agent nothing without a grant', async () => {
      expect(await resolveAgentSiteRole(LOCAL_AGENT_ID, testSiteId, true)).toBeNull();
    });

    it('gives an ordinary agent exactly its grant', async () => {
      await grantRole({
        agentId: LOCAL_AGENT_ID,
        siteId: testSiteId,
        role: 'viewer',
        grantedBy: GRANTED_BY,
      });

      expect(await resolveAgentSiteRole(LOCAL_AGENT_ID, testSiteId, true))
        .toEqual({ role: 'viewer', implicit: false });
    });

    it('gives a suspended global agent nothing', async () => {
      await sql`UPDATE app.agents SET status = 'suspended' WHERE id = ${GLOBAL_AGENT_ID}`;
      try {
        expect(await resolveAgentSiteRole(GLOBAL_AGENT_ID, testSiteId, true)).toBeNull();
      } finally {
        await sql`UPDATE app.agents SET status = 'active' WHERE id = ${GLOBAL_AGENT_ID}`;
      }
    });
  });

  describe('authorization and site listing follow the same flag', () => {
    function agentPrincipal(
      id: string,
      withActingUser: boolean,
      actingUserEmail = ACTING_USER_EMAIL,
    ): AuthenticatedPrincipal {
      return {
        id,
        type: 'agent',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 86_400_000).toISOString(),
        authProvider: 'agent_key',
        ...(withActingUser ? { actingUserEmail } : {}),
      };
    }

    it('authorizes a global agent on a site it was never granted', async () => {
      expect(await getSiteRole(agentPrincipal(GLOBAL_AGENT_ID, true), testSiteId)).toBe('EDITOR');
    });

    // getSiteRole is exported and handleGetSite reads it directly, so the
    // delegated bound cannot live only in getEffectiveRole. No Pantheon role
    // maps below EDITOR, so an acting user with no role is what the cap shows.
    it('bounds the implicit role by an acting user with no role on the site', async () => {
      expect(
        await getSiteRole(agentPrincipal(GLOBAL_AGENT_ID, true, STRANGER_EMAIL), testSiteId),
      ).toBe('NO_ACCESS');
    });

    it('leaves an explicit grant unbounded at this entry point', async () => {
      await grantRole({
        agentId: GLOBAL_AGENT_ID,
        siteId: testSiteId,
        role: 'admin',
        grantedBy: GRANTED_BY,
      });

      // A grant row is standalone authority, as it was before the flag; the
      // acting-user intersection still applies in getEffectiveRole.
      expect(
        await getSiteRole(agentPrincipal(GLOBAL_AGENT_ID, true, STRANGER_EMAIL), testSiteId),
      ).toBe('ADMIN');
    });

    it('refuses a global agent that forwards no acting user', async () => {
      expect(await getSiteRole(agentPrincipal(GLOBAL_AGENT_ID, false), testSiteId)).toBe('NO_ACCESS');
    });

    it('authorizes an ordinary agent nowhere without a grant', async () => {
      expect(await getSiteRole(agentPrincipal(LOCAL_AGENT_ID, true), testSiteId)).toBe('NO_ACCESS');
    });

    it('lists the acting user\'s sites in the org for a global agent', async () => {
      const sites = await listSites({
        principalId: GLOBAL_AGENT_ID,
        principalType: 'agent',
        actingUserId,
        organizationId: testOrgId,
      });

      expect(sites.map((site) => site.id)).toEqual([testSiteId]);
    });

    it('keeps the organization filter for a global agent', async () => {
      const sites = await listSites({
        principalId: GLOBAL_AGENT_ID,
        principalType: 'agent',
        actingUserId,
        organizationId: testOrgId,
      });

      // The acting user administers a site in the other org too; the filter is
      // what keeps it out.
      expect(sites.map((site) => site.id)).not.toContain(otherOrgSiteId);
    });

    it('excludes archived sites from a global agent listing', async () => {
      await sql`UPDATE app.sites SET archived_at = NOW() WHERE id = ${testSiteId}`;
      try {
        const sites = await listSites({
          principalId: GLOBAL_AGENT_ID,
          principalType: 'agent',
          actingUserId,
          organizationId: testOrgId,
        });

        expect(sites.map((site) => site.id)).not.toContain(testSiteId);
      } finally {
        await sql`UPDATE app.sites SET archived_at = NULL WHERE id = ${testSiteId}`;
      }
    });

    it('does not widen the listing without an acting user', async () => {
      const sites = await listSites({
        principalId: GLOBAL_AGENT_ID,
        principalType: 'agent',
        organizationId: testOrgId,
      });

      // Falls back to explicit grants, of which this agent has none.
      expect(sites).toHaveLength(0);
    });

    it('does not widen the listing for a suspended global agent', async () => {
      await sql`UPDATE app.agents SET status = 'suspended' WHERE id = ${GLOBAL_AGENT_ID}`;
      try {
        const sites = await listSites({
          principalId: GLOBAL_AGENT_ID,
          principalType: 'agent',
          actingUserId,
          organizationId: testOrgId,
        });

        expect(sites).toHaveLength(0);
      } finally {
        await sql`UPDATE app.agents SET status = 'active' WHERE id = ${GLOBAL_AGENT_ID}`;
      }
    });

    it('lists nothing for an ordinary agent without a grant', async () => {
      const sites = await listSites({
        principalId: LOCAL_AGENT_ID,
        principalType: 'agent',
        actingUserId,
        organizationId: testOrgId,
      });

      expect(sites).toHaveLength(0);
    });
  });

  // The roster query is the root cause the fix names: before `OR is_global =
  // true` it filtered strictly by organization_id, so an agent seeded into one
  // org was invisible to every other.
  describe('getAgentsByOrganization', () => {
    it('includes a global agent owned by a different org', async () => {
      const ids = (await getAgentsByOrganization(testOrgId)).map((agent) => agent.id);

      expect(ids).toContain(GLOBAL_AGENT_ID);
      expect(ids).toContain(LOCAL_AGENT_ID);
    });

    it('still hides an ordinary agent from other orgs', async () => {
      const ids = (await getAgentsByOrganization(otherOrgId)).map((agent) => agent.id);

      // Owned by testOrgId, so the org filter must keep it out — only the
      // global flag crosses that boundary.
      expect(ids).not.toContain(LOCAL_AGENT_ID);
      expect(ids).toContain(GLOBAL_AGENT_ID);
    });

    it('marks the global agent so the UI can render it as non-removable', async () => {
      const agents = await getAgentsByOrganization(testOrgId);

      expect(agents.find((agent) => agent.id === GLOBAL_AGENT_ID)?.isGlobal).toBe(true);
      expect(agents.find((agent) => agent.id === LOCAL_AGENT_ID)?.isGlobal).toBe(false);
    });
  });

  // The grant guard reads getAgentById, while agent_site_roles.agent_id
  // canonicalizes what it stores — so a differently-spelled uuid must resolve to
  // the same agent or the guard can be spelled around.
  describe('agent id spelling', () => {
    it('resolves a global agent by a non-canonical uuid', async () => {
      const upper = await getAgentById(GLOBAL_AGENT_ID.toUpperCase());
      expect(upper?.id).toBe(GLOBAL_AGENT_ID);
      expect(upper?.isGlobal).toBe(true);

      const braced = await getAgentById(`{${GLOBAL_AGENT_ID}}`);
      expect(braced?.id).toBe(GLOBAL_AGENT_ID);

      const hyphenless = await getAgentById(GLOBAL_AGENT_ID.replace(/-/g, ''));
      expect(hyphenless?.id).toBe(GLOBAL_AGENT_ID);
    });

    it('still returns null for an id that names no agent', async () => {
      expect(await getAgentById('c1000000-0000-0000-0000-0000000000ff')).toBeNull();
      expect(await getAgentById('not-a-uuid')).toBeNull();
    });
  });
});
