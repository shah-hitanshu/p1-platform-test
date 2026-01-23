/**
 * Phase 3.2: Branch Service - Integration Tests
 *
 * These tests validate Branch CRUD operations against the actual PostgreSQL database.
 * Run with: npm test -- tests/integration/branch-service.integration.spec.ts
 *
 * Prerequisites:
 * - PostgreSQL running: make docker-up
 * - Migrations applied: npm run db:migrate
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance, getDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

// Import site service for setting up test sites
import { createSite, deleteSite } from '../../src/services/site-service';

// Import branch service (to be implemented)
import {
  createBranch,
  createMainBranch,
  getBranch,
  getBranchByName,
  getMainBranch,
  listBranches,
  updateBranch,
  updateBranchStatus,
  deleteBranch,
  DuplicateBranchNameError,
  InvalidBranchParamsError,
  SiteNotFoundError,
  MainBranchProtectionError,
  InvalidBranchStatusTransitionError,
} from '../../src/services/branch-service';

// Test configuration
const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';

// Track created resources for cleanup
const createdSiteIds: string[] = [];
const createdBranchIds: string[] = [];

/**
 * Helper function to get an array element with guaranteed type.
 * Throws if the element is undefined (test should fail).
 */
function getFirst<T>(arr: T[]): T {
  const first = arr[0];
  if (first === undefined) {
    throw new Error('Expected array to have at least one element');
  }
  return first;
}

/**
 * Creates a real database connection adapter for testing.
 */
function createRealDatabaseConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const sql = postgres(connectionString, {
    transform: {
      undefined: null,
    },
  });

  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await sql.unsafe<T[]>(sqlQuery, params as unknown as postgres.ParameterOrJSON<never>[]);
      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;

      return {
        rows,
        rowCount,
      };
    },
  };

  return { connection, sql };
}

describe('Phase 3.2: Integration Tests - Branch Service', () => {
  let sql: postgres.Sql;
  let testSiteId: string;

  beforeAll(async () => {
    // Create real database connection
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    // Verify connection
    const result = await sql`SELECT 1 as connected`;
    expect(result[0]?.connected).toBe(1);
    console.log('Database connection established');

    // Create a test site for branch operations
    const site = await createSite({
      pantheonSiteId: `branch-test-site-${String(Date.now())}`,
      name: 'Branch Test Site',
    });
    testSiteId = site.id;
    createdSiteIds.push(site.id);
    console.log(`Created test site: ${site.id}`);
  });

  afterAll(async () => {
    // Clean up test branches first (due to FK constraints)
    try {
      await sql`
        DELETE FROM app.branches
        WHERE site_id IN (
          SELECT id FROM app.sites
          WHERE pantheon_site_id LIKE 'branch-test-%'
        )
      `;
    } catch {
      // Ignore cleanup errors
    }

    // Clean up test sites
    try {
      await sql`
        DELETE FROM app.sites
        WHERE pantheon_site_id LIKE 'branch-test-%'
      `;
    } catch {
      // Ignore cleanup errors
    }

    // Also clean up by tracked IDs as backup
    for (const branchId of createdBranchIds) {
      try {
        await sql`DELETE FROM app.branches WHERE id = ${branchId}`;
      } catch {
        // Ignore errors during cleanup
      }
    }

    for (const siteId of createdSiteIds) {
      try {
        // Delete branches first
        await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
        await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Close database connection
    setDatabaseInstance(null);
    await sql.end();
    console.log('Database connection closed, test data cleaned up');
  });

  beforeEach(() => {
    // Verify database instance is set
    expect(getDatabaseInstance()).not.toBeNull();
  });

  describe('Main Branch Operations', () => {
    it('should create main branch for a site', async () => {
      const mainBranch = await createMainBranch({
        siteId: testSiteId,
        createdById: 'test-user-id',
        createdByType: 'user',
      });

      createdBranchIds.push(mainBranch.id);

      expect(mainBranch.id).toBeDefined();
      expect(mainBranch.name).toBe('main');
      expect(mainBranch.isMain).toBe(true);
      expect(mainBranch.status).toBe('active');
      expect(mainBranch.siteId).toBe(testSiteId);
      expect(mainBranch.sourceBranchId).toBeUndefined();
      expect(mainBranch.createdAt).toBeDefined();

      console.log(`Created main branch: ${mainBranch.id}`);
    });

    it('should retrieve main branch by site ID', async () => {
      const mainBranch = await getMainBranch(testSiteId);

      expect(mainBranch).not.toBeNull();
      expect(mainBranch?.isMain).toBe(true);
      expect(mainBranch?.name).toBe('main');
    });

    it('should throw DuplicateBranchNameError when creating second main branch', async () => {
      await expect(
        createMainBranch({
          siteId: testSiteId,
          createdById: 'test-user-id',
          createdByType: 'user',
        }),
      ).rejects.toThrow(DuplicateBranchNameError);
    });

    it('should not allow deleting main branch', async () => {
      const mainBranch = await getMainBranch(testSiteId);
      expect(mainBranch).not.toBeNull();

      await expect(deleteBranch(mainBranch!.id)).rejects.toThrow(MainBranchProtectionError);

      // Verify main branch still exists
      const stillExists = await getMainBranch(testSiteId);
      expect(stillExists).not.toBeNull();
    });

    it('should not allow archiving main branch', async () => {
      const mainBranch = await getMainBranch(testSiteId);
      expect(mainBranch).not.toBeNull();

      await expect(
        updateBranchStatus(mainBranch!.id, 'archived'),
      ).rejects.toThrow(MainBranchProtectionError);
    });
  });

  describe('Feature Branch Operations', () => {
    let mainBranchId: string;

    beforeAll(async () => {
      const mainBranch = await getMainBranch(testSiteId);
      if (!mainBranch) {
        throw new Error('Main branch should exist from previous tests');
      }
      mainBranchId = mainBranch.id;
    });

    it('should create a feature branch from main', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: 'feature-login',
        description: 'Implement login functionality',
        sourceBranchId: mainBranchId,
        createdById: 'test-user-id',
        createdByType: 'user',
      });

      createdBranchIds.push(branch.id);

      expect(branch.id).toBeDefined();
      expect(branch.name).toBe('feature-login');
      expect(branch.description).toBe('Implement login functionality');
      expect(branch.siteId).toBe(testSiteId);
      expect(branch.sourceBranchId).toBe(mainBranchId);
      expect(branch.status).toBe('active');
      expect(branch.isMain).toBe(false);

      console.log(`Created feature branch: ${branch.id}`);
    });

    it('should retrieve branch by ID', async () => {
      const branchId = getFirst(createdBranchIds.filter((id) => id !== mainBranchId));
      const branch = await getBranch(branchId);

      expect(branch).not.toBeNull();
      expect(branch?.id).toBe(branchId);
      expect(branch?.name).toBe('feature-login');
    });

    it('should retrieve branch by name', async () => {
      const branch = await getBranchByName(testSiteId, 'feature-login');

      expect(branch).not.toBeNull();
      expect(branch?.name).toBe('feature-login');
      expect(branch?.siteId).toBe(testSiteId);
    });

    it('should return null for non-existent branch', async () => {
      const branch = await getBranch('00000000-0000-0000-0000-000000000000');
      expect(branch).toBeNull();
    });

    it('should return null for non-existent branch name', async () => {
      const branch = await getBranchByName(testSiteId, 'non-existent-branch');
      expect(branch).toBeNull();
    });

    it('should create agent-created branch', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: 'agent-updates',
        description: 'Automated content updates',
        sourceBranchId: mainBranchId,
        createdById: 'agent-uuid-123',
        createdByType: 'agent',
      });

      createdBranchIds.push(branch.id);

      expect(branch.createdById).toBe('agent-uuid-123');
      expect(branch.createdByType).toBe('agent');
    });

    it('should throw DuplicateBranchNameError for duplicate name in same site', async () => {
      await expect(
        createBranch({
          siteId: testSiteId,
          name: 'feature-login', // Already exists
          sourceBranchId: mainBranchId,
          createdById: 'test-user-id',
          createdByType: 'user',
        }),
      ).rejects.toThrow(DuplicateBranchNameError);
    });

    it('should throw InvalidBranchParamsError for empty name', async () => {
      await expect(
        createBranch({
          siteId: testSiteId,
          name: '',
          sourceBranchId: mainBranchId,
          createdById: 'test-user-id',
          createdByType: 'user',
        }),
      ).rejects.toThrow(InvalidBranchParamsError);
    });

    it('should throw SiteNotFoundError for non-existent site', async () => {
      await expect(
        createBranch({
          siteId: '00000000-0000-0000-0000-000000000000',
          name: 'orphan-branch',
          sourceBranchId: mainBranchId,
          createdById: 'test-user-id',
          createdByType: 'user',
        }),
      ).rejects.toThrow(SiteNotFoundError);
    });
  });

  describe('Branch Listing', () => {
    it('should list all branches for a site', async () => {
      const branches = await listBranches(testSiteId);

      // Should have main + feature-login + agent-updates from previous tests
      expect(branches.length).toBeGreaterThanOrEqual(3);
      expect(branches.some((b) => b.isMain)).toBe(true);
      expect(branches.some((b) => b.name === 'feature-login')).toBe(true);
    });

    it('should filter branches by status', async () => {
      const activeBranches = await listBranches(testSiteId, { status: 'active' });

      expect(activeBranches.length).toBeGreaterThanOrEqual(1);
      expect(activeBranches.every((b) => b.status === 'active')).toBe(true);
    });

    it('should support pagination', async () => {
      // Create additional branches for pagination test
      const branch1 = await createBranch({
        siteId: testSiteId,
        name: `pagination-test-${String(Date.now())}-1`,
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch1.id);

      const branch2 = await createBranch({
        siteId: testSiteId,
        name: `pagination-test-${String(Date.now())}-2`,
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch2.id);

      const allBranches = await listBranches(testSiteId);
      expect(allBranches.length).toBeGreaterThanOrEqual(5);

      const limitedBranches = await listBranches(testSiteId, { limit: 2 });
      expect(limitedBranches.length).toBe(2);

      const offsetBranches = await listBranches(testSiteId, { limit: 2, offset: 1 });
      expect(offsetBranches.length).toBe(2);
      expect(getFirst(offsetBranches).id).not.toBe(getFirst(limitedBranches).id);
    });
  });

  describe('Branch Updates', () => {
    it('should update branch name', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: `update-test-${String(Date.now())}`,
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch.id);

      const newName = `renamed-${String(Date.now())}`;
      const updated = await updateBranch(branch.id, { name: newName });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe(newName);

      // Verify in database
      const fetched = await getBranch(branch.id);
      expect(fetched?.name).toBe(newName);
    });

    it('should update branch description', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: `desc-test-${String(Date.now())}`,
        description: 'Original description',
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch.id);

      const updated = await updateBranch(branch.id, { description: 'Updated description' });

      expect(updated?.description).toBe('Updated description');
    });

    it('should return null when updating non-existent branch', async () => {
      const result = await updateBranch('00000000-0000-0000-0000-000000000000', { name: 'new-name' });
      expect(result).toBeNull();
    });
  });

  describe('Branch Status Transitions', () => {
    it('should transition from active to review', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: `status-test-${String(Date.now())}`,
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch.id);

      expect(branch.status).toBe('active');

      const updated = await updateBranchStatus(branch.id, 'review');
      expect(updated?.status).toBe('review');
    });

    it('should transition from review to merged', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: `merge-test-${String(Date.now())}`,
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch.id);

      // First move to review
      await updateBranchStatus(branch.id, 'review');

      // Then merge
      const merged = await updateBranchStatus(branch.id, 'merged');
      expect(merged?.status).toBe('merged');
    });

    it('should transition from active to archived', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: `archive-test-${String(Date.now())}`,
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch.id);

      const archived = await updateBranchStatus(branch.id, 'archived');
      expect(archived?.status).toBe('archived');
    });

    it('should reject invalid status transition (merged to active)', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: `invalid-transition-${String(Date.now())}`,
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch.id);

      // Move to merged state
      await updateBranchStatus(branch.id, 'review');
      await updateBranchStatus(branch.id, 'merged');

      // Try to go back to active
      await expect(
        updateBranchStatus(branch.id, 'active'),
      ).rejects.toThrow(InvalidBranchStatusTransitionError);
    });
  });

  describe('Branch Deletion', () => {
    it('should delete a non-main branch', async () => {
      const branch = await createBranch({
        siteId: testSiteId,
        name: `delete-test-${String(Date.now())}`,
        sourceBranchId: (await getMainBranch(testSiteId))!.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      // Don't add to createdBranchIds since we're deleting it

      const deleted = await deleteBranch(branch.id);
      expect(deleted).toBe(true);

      // Verify it's gone
      const fetched = await getBranch(branch.id);
      expect(fetched).toBeNull();
    });

    it('should return false when deleting non-existent branch', async () => {
      const deleted = await deleteBranch('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });

    it('should not allow deleting main branch', async () => {
      const mainBranch = await getMainBranch(testSiteId);
      expect(mainBranch).not.toBeNull();

      await expect(deleteBranch(mainBranch!.id)).rejects.toThrow(MainBranchProtectionError);
    });
  });

  describe('Cross-Site Branch Isolation', () => {
    it('should allow same branch name in different sites', async () => {
      // Create a second test site
      const site2 = await createSite({
        pantheonSiteId: `branch-test-site-2-${String(Date.now())}`,
        name: 'Branch Test Site 2',
      });
      createdSiteIds.push(site2.id);

      // Create main branch for site2
      const mainBranch2 = await createMainBranch({
        siteId: site2.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(mainBranch2.id);

      // Create feature-login in site2 (should succeed even though it exists in testSite)
      const branch = await createBranch({
        siteId: site2.id,
        name: 'feature-login', // Same name as in testSiteId
        sourceBranchId: mainBranch2.id,
        createdById: 'test-user-id',
        createdByType: 'user',
      });
      createdBranchIds.push(branch.id);

      expect(branch.name).toBe('feature-login');
      expect(branch.siteId).toBe(site2.id);

      // Verify both exist in their respective sites
      const site1Branch = await getBranchByName(testSiteId, 'feature-login');
      const site2Branch = await getBranchByName(site2.id, 'feature-login');

      expect(site1Branch).not.toBeNull();
      expect(site2Branch).not.toBeNull();
      expect(site1Branch?.id).not.toBe(site2Branch?.id);
    });
  });
});
