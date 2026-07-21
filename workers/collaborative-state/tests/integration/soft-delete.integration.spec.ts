/**
 * PCC-3211: Soft Delete Integration Tests
 *
 * Validates archive/restore behaviour for Sites and Branches against
 * the actual PostgreSQL database.
 *
 * Prerequisites:
 * - PostgreSQL running (docker start css-postgres)
 * - Migrations applied (cd workers && npx tsx src/db/migrate.ts)
 *
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

import {
  createSite,
  archiveSite,
  restoreSite,
  listSites,
} from '../../src/services/site-service';

import {
  archiveBranch,
  restoreBranch,
  listBranches,
  createBranch,
  getMainBranch,
  MainBranchProtectionError,
} from '../../src/services/branch-service';
import type { Branch } from '../../src/types';

import { createDocument } from '../../src/services/document-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const TEST_PREFIX = 'soft-delete-integ';
const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const ALICE_ID = '11111111-1111-1111-1111-111111111111';

const createdSiteIds: string[] = [];

function createRealDatabaseConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const sql = postgres(connectionString, {
    transform: { undefined: null },
    max: 1,
  });

  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await sql.unsafe<T[]>(
        sqlQuery,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );
      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      return { rows, rowCount: resultWithCount.count ?? rows.length };
    },
  };

  return { connection, sql };
}

/** Create a feature branch off the site's main branch. */
async function createFeatureBranch(siteId: string, name: string): Promise<Branch> {
  const main = await getMainBranch(siteId);
  if (!main) throw new Error(`No main branch for site ${siteId}`);
  return createBranch({
    siteId,
    name,
    sourceBranchId: main.id,
    createdById: SYSTEM_ID,
    createdByType: 'user',
  });
}

describe('PCC-3211: Soft Delete Integration Tests', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);
    console.log('Database connection established');
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM app.sites WHERE pantheon_site_id LIKE ${TEST_PREFIX + '-%'}`;
    } catch {
      for (const id of createdSiteIds) {
        try { await sql`DELETE FROM app.sites WHERE id = ${id}`; } catch { /* ignore */ }
      }
    }
    setDatabaseInstance(null);
    await sql.end();
    console.log('Database connection closed, test data cleaned up');
  });

  beforeEach(() => {
    expect(sql).toBeDefined();
  });

  // ===========================================================================
  // Sites — archiveSite
  // ===========================================================================

  describe('archiveSite', () => {
    it('should set archived_at on the site and cascade to branches and documents', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-cascade-${String(Date.now())}`,
        name: 'Cascade Test',
      });
      createdSiteIds.push(site.id);

      const main = await getMainBranch(site.id);
      expect(main).not.toBeNull();

      await createDocument({
        siteId: site.id,
        path: 'test-doc',
        createdById: SYSTEM_ID,
      });

      const result = await archiveSite(site.id);
      expect(result).toBe(true);

      const siteRow = await sql`SELECT archived_at FROM app.sites WHERE id = ${site.id}`;
      expect(siteRow[0]?.archived_at).not.toBeNull();

      const branchRows = await sql`SELECT archived_at FROM app.branches WHERE site_id = ${site.id}`;
      expect(branchRows.every((b: { archived_at: unknown }) => b.archived_at !== null)).toBe(true);

      const docRows = await sql`SELECT archived_at FROM app.documents WHERE site_id = ${site.id}`;
      expect(docRows.every((d: { archived_at: unknown }) => d.archived_at !== null)).toBe(true);
    });

    it('should return false when site does not exist', async () => {
      const result = await archiveSite('00000000-0000-0000-0000-ffffffffffff');
      expect(result).toBe(false);
    });

    it("should return 'already_archived' on double-archive", async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-double-${String(Date.now())}`,
        name: 'Double Archive Test',
      });
      createdSiteIds.push(site.id);

      await archiveSite(site.id);
      const second = await archiveSite(site.id);
      expect(second).toBe('already_archived');
    });
  });

  // ===========================================================================
  // Sites — listSites archived filter
  // ===========================================================================

  describe('listSites — archived filter', () => {
    it('should exclude archived sites by default and include with archived=true', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-list-${String(Date.now())}`,
        name: 'List Filter Test',
        creatorId: ALICE_ID,
      });
      createdSiteIds.push(site.id);

      const before = await listSites({ principalId: ALICE_ID });
      expect(before.some(s => s.id === site.id)).toBe(true);

      await archiveSite(site.id);

      const active = await listSites({ principalId: ALICE_ID });
      expect(active.some(s => s.id === site.id)).toBe(false);

      const archived = await listSites({ principalId: ALICE_ID, archived: true });
      expect(archived.some(s => s.id === site.id)).toBe(true);
    });
  });

  // ===========================================================================
  // Sites — restoreSite
  // ===========================================================================

  describe('restoreSite', () => {
    it('should restore site and cascade-archived branches/docs, leaving independently-archived branches alone', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-restore-${String(Date.now())}`,
        name: 'Restore Cascade Test',
        creatorId: ALICE_ID,
      });
      createdSiteIds.push(site.id);

      const main = await getMainBranch(site.id);
      expect(main).not.toBeNull();

      // Archive a feature branch independently BEFORE archiving the site
      const feature = await createFeatureBranch(site.id, 'independent-branch');
      await archiveBranch(feature.id);

      // Archive the site (main branch is cascade-archived)
      await archiveSite(site.id);

      const restored = await restoreSite(site.id);
      expect(restored).not.toBeNull();
      expect(restored?.archivedAt).toBeNull();

      // Main branch (cascade) should be restored
      const mainRow = await sql`SELECT archived_at FROM app.branches WHERE id = ${main?.id ?? ''}`;
      expect(mainRow[0]?.archived_at).toBeNull();

      // Independently-archived feature branch should remain archived
      const featureRow = await sql`SELECT archived_at FROM app.branches WHERE id = ${feature.id}`;
      expect(featureRow[0]?.archived_at).not.toBeNull();
    });

    it('should return null for non-existent site', async () => {
      expect(await restoreSite('00000000-0000-0000-0000-ffffffffffff')).toBeNull();
    });

    it('should return null when site is not archived', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-notarchived-${String(Date.now())}`,
        name: 'Not Archived',
      });
      createdSiteIds.push(site.id);
      expect(await restoreSite(site.id)).toBeNull();
    });
  });

  // ===========================================================================
  // Branches — archiveBranch
  // ===========================================================================

  describe('archiveBranch', () => {
    it('should set archived_at on a feature branch', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-branch-arch-${String(Date.now())}`,
        name: 'Branch Archive Test',
      });
      createdSiteIds.push(site.id);

      const branch = await createFeatureBranch(site.id, 'feature-to-archive');
      const result = await archiveBranch(branch.id);
      expect(result).toBe(true);

      const row = await sql`SELECT archived_at FROM app.branches WHERE id = ${branch.id}`;
      expect(row[0]?.archived_at).not.toBeNull();
    });

    it('should throw MainBranchProtectionError for the main branch', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-main-protect-${String(Date.now())}`,
        name: 'Main Branch Protection Test',
      });
      createdSiteIds.push(site.id);

      const main = await getMainBranch(site.id);
      expect(main).not.toBeNull();
      await expect(archiveBranch(main?.id ?? '')).rejects.toThrow(MainBranchProtectionError);
    });

    it("should return 'already_archived' on double-archive", async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-branch-double-${String(Date.now())}`,
        name: 'Branch Double Archive Test',
      });
      createdSiteIds.push(site.id);

      const branch = await createFeatureBranch(site.id, 'double-archive-branch');
      await archiveBranch(branch.id);
      expect(await archiveBranch(branch.id)).toBe('already_archived');
    });
  });

  // ===========================================================================
  // Branches — listBranches archived filter
  // ===========================================================================

  describe('listBranches — archived filter', () => {
    it('should exclude archived branches by default and include with archived=true', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-branch-list-${String(Date.now())}`,
        name: 'Branch List Filter Test',
      });
      createdSiteIds.push(site.id);

      const branch = await createFeatureBranch(site.id, 'filterable-branch');

      const before = await listBranches(site.id);
      expect(before.some(b => b.id === branch.id)).toBe(true);

      await archiveBranch(branch.id);

      const active = await listBranches(site.id);
      expect(active.some(b => b.id === branch.id)).toBe(false);

      const archived = await listBranches(site.id, { archived: true });
      expect(archived.some(b => b.id === branch.id)).toBe(true);
    });
  });

  // ===========================================================================
  // Branches — restoreBranch
  // ===========================================================================

  describe('restoreBranch', () => {
    it('should restore an archived branch and clear archived_at', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-branch-restore-${String(Date.now())}`,
        name: 'Branch Restore Test',
      });
      createdSiteIds.push(site.id);

      const branch = await createFeatureBranch(site.id, 'restorable-branch');
      await archiveBranch(branch.id);

      const restored = await restoreBranch(branch.id);
      expect(restored).not.toBeNull();
      expect(restored?.archivedAt).toBeNull();

      const row = await sql`SELECT archived_at FROM app.branches WHERE id = ${branch.id}`;
      expect(row[0]?.archived_at).toBeNull();
    });

    it('should return null when branch is not archived', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-branch-notarch-${String(Date.now())}`,
        name: 'Branch Not Archived Test',
      });
      createdSiteIds.push(site.id);

      const branch = await createFeatureBranch(site.id, 'active-branch');
      expect(await restoreBranch(branch.id)).toBeNull();
    });

    it('should return null when parent site is archived', async () => {
      const site = await createSite({
        pantheonSiteId: `${TEST_PREFIX}-branch-sitearch-${String(Date.now())}`,
        name: 'Branch Parent Archived Test',
      });
      createdSiteIds.push(site.id);

      const branch = await createFeatureBranch(site.id, 'orphaned-branch');

      // Archive branch independently, then archive site
      await archiveBranch(branch.id);
      await archiveSite(site.id);

      expect(await restoreBranch(branch.id)).toBeNull();
    });
  });
});
