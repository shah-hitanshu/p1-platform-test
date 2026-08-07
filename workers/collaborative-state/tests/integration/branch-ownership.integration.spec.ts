/**
 * A branch is only ever addressable under the site that owns it. Role resolution
 * takes a site and a branch from the caller, so a branch belonging to a different
 * site resolves to NO_ACCESS rather than inheriting the caller's role on the site
 * they named. A branch grant is scoped to its own branch and cannot carry access
 * across that boundary either.
 *
 * Prerequisites:
 * - PostgreSQL running: podman start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { getEffectiveRole, assertPermission, AuthorizationError } from '../../src/auth/authorization';
import type { AuthenticatedPrincipal } from '../../src/types';

const TEST_USER_ID = '6b1d5f2e-0000-4000-8000-00000000ba11';
const SITE_PREFIX = 'branch-ownership-test';

describe('Branch ownership - Integration Tests', () => {
  let sql: postgres.Sql;
  let ownSiteId: string;
  let ownBranchId: string;
  let foreignSiteId: string;
  let foreignBranchId: string;

  function principalFor(siteId: string): AuthenticatedPrincipal {
    return {
      id: TEST_USER_ID,
      type: 'user',
      email: 'branch-ownership-test@example.com',
      pantheonSiteRoles: { [siteId]: 'owner' },
      tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
    } as unknown as AuthenticatedPrincipal;
  }

  async function mainBranchOf(siteId: string): Promise<string> {
    const rows = await sql`
      SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true
    `;
    return rows[0].id as string;
  }

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'branch-ownership-test@example.com', 'Branch Ownership User')
      ON CONFLICT (id) DO NOTHING
    `;

    const ownSite = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-own-${String(Date.now())}`,
      name: 'Branch Ownership Own Site',
      creatorId: TEST_USER_ID,
    });
    ownSiteId = ownSite.id;
    ownBranchId = await mainBranchOf(ownSiteId);

    const foreignSite = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-foreign-${String(Date.now())}`,
      name: 'Branch Ownership Foreign Site',
      creatorId: TEST_USER_ID,
    });
    foreignSiteId = foreignSite.id;
    foreignBranchId = await mainBranchOf(foreignSiteId);
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, ownSiteId);
    await deleteSiteCascade(sql, foreignSiteId);
    await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    await sql.end();
    setDatabaseInstance(null);
  });

  it('resolves the site role for a branch the site owns', async () => {
    const result = await getEffectiveRole(principalFor(ownSiteId), ownSiteId, ownBranchId);

    expect(result.roleName).toBe('ADMIN');
  });

  it('denies a branch belonging to another site', async () => {
    const result = await getEffectiveRole(principalFor(ownSiteId), ownSiteId, foreignBranchId);

    expect(result.roleName).toBe('NO_ACCESS');
    expect(result.role.canView).toBe(false);
  });

  it('denies a service token a branch belonging to another site', async () => {
    const token = {
      id: 'token-branch-ownership',
      type: 'service',
      siteId: ownSiteId,
      scopes: ['read:all'],
      authProvider: 'site_token',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
    } as unknown as AuthenticatedPrincipal;

    await expect(
      assertPermission(token, ownSiteId, ownBranchId, 'canView'),
    ).resolves.toBeUndefined();

    await expect(
      assertPermission(token, ownSiteId, foreignBranchId, 'canView'),
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies a foreign branch the caller holds a grant on', async () => {
    await sql`
      INSERT INTO app.branch_grants (branch_id, actor_id, actor_type, role, granted_by_id, granted_by_type)
      VALUES (${foreignBranchId}, ${TEST_USER_ID}, 'user', 'ADMIN', ${TEST_USER_ID}, 'user')
      ON CONFLICT (branch_id, actor_id) DO NOTHING
    `;

    const result = await getEffectiveRole(principalFor(ownSiteId), ownSiteId, foreignBranchId);

    expect(result.roleName).toBe('NO_ACCESS');
  });
});
