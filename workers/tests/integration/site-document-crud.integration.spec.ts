/**
 * Phase 3.1: Site and Document Services - Integration Tests
 *
 * These tests validate CRUD operations against the actual PostgreSQL database.
 * Run with: npm test -- tests/integration/
 *
 * Prerequisites:
 * - PostgreSQL running: make docker-up
 * - Migrations applied: npm run db:migrate
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance, getDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

// Import services
import {
  createSite,
  getSite,
  getSiteByPantheonId,
  updateSite,
  deleteSite,
  listSites,
  DuplicatePantheonSiteIdError,
  InvalidSiteParamsError,
} from '../../src/services/site-service';

import {
  createDocument,
  getDocument,
  getDocumentByPath,
  updateDocumentPath,
  deleteDocument,
  listDocuments,
  documentExists,
  SiteNotFoundError,
  DuplicateDocumentPathError,
  InvalidDocumentPathError,
} from '../../src/services/document-service';

// Test configuration
const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';

// Track created resources for cleanup
const createdSiteIds: string[] = [];
const createdDocumentIds: string[] = [];

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
      // Automatically parse JSONB columns
      undefined: null,
    },
    // Use max: 1 to ensure all queries use the same connection.
    // This is required for manual transaction handling (BEGIN/COMMIT/ROLLBACK)
    // to work correctly, as transactions are connection-scoped.
    max: 1,
  });

  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      // Execute the query using postgres template literal format
      const result = await sql.unsafe<T[]>(sqlQuery, params as unknown as postgres.ParameterOrJSON<never>[]);

      // The postgres package returns a Result object that extends Array
      // For INSERT/UPDATE/DELETE with RETURNING, rows are in the array
      // For DELETE without RETURNING, we get the count from result.count
      const rows = [...result] as T[];

      // Get row count - for DELETE/UPDATE, use result.count; for SELECT, use rows.length
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

describe('Phase 3.1: Integration Tests - Site and Document CRUD', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    // Create real database connection
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    // Verify connection
    const result = await sql`SELECT 1 as connected`;
    expect(result[0]?.connected).toBe(1);
    console.log('Database connection established');
  });

  afterAll(async () => {
    // Clean up all test data by pattern (more reliable than tracking IDs)
    // This catches any sites/documents created during tests that may have been
    // missed in the tracking arrays
    try {
      // First delete all documents from test sites
      await sql`
        DELETE FROM app.documents
        WHERE site_id IN (
          SELECT id FROM app.sites
          WHERE pantheon_site_id LIKE 'test-%'
          OR pantheon_site_id LIKE 'cascade-%'
          OR pantheon_site_id LIKE 'fk-test-%'
          OR pantheon_site_id LIKE 'delete-order-%'
          OR pantheon_site_id LIKE 'doc-test-%'
        )
      `;
      // Then delete test sites
      await sql`
        DELETE FROM app.sites
        WHERE pantheon_site_id LIKE 'test-%'
        OR pantheon_site_id LIKE 'cascade-%'
        OR pantheon_site_id LIKE 'fk-test-%'
        OR pantheon_site_id LIKE 'delete-order-%'
        OR pantheon_site_id LIKE 'doc-test-%'
      `;
    } catch {
      // Ignore cleanup errors
    }

    // Also clean up by tracked IDs as backup
    for (const docId of createdDocumentIds) {
      try {
        await sql`DELETE FROM app.documents WHERE id = ${docId}`;
      } catch {
        // Ignore errors during cleanup
      }
    }

    for (const siteId of createdSiteIds) {
      try {
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

  describe('Site Service - Real Database Operations', () => {
    const testPantheonId = `test-pantheon-${String(Date.now())}`;

    it('should create a site with default workflow settings', async () => {
      const site = await createSite({
        pantheonSiteId: testPantheonId,
        name: 'Integration Test Site',
      });

      createdSiteIds.push(site.id);

      expect(site.id).toBeDefined();
      expect(site.pantheonSiteId).toBe(testPantheonId);
      expect(site.name).toBe('Integration Test Site');
      expect(site.workflowSettings).toBeDefined();
      expect(site.workflowSettings.mergeApprovalMode).toBe('optional');
      expect(site.createdAt).toBeDefined();
      expect(site.updatedAt).toBeDefined();

      console.log(`Created site: ${site.id}`);
    });

    it('should retrieve site by ID', async () => {
      const siteId = getFirst(createdSiteIds);
      const site = await getSite(siteId);

      expect(site).not.toBeNull();
      expect(site?.id).toBe(siteId);
      expect(site?.name).toBe('Integration Test Site');
    });

    it('should retrieve site by Pantheon ID', async () => {
      const site = await getSiteByPantheonId(testPantheonId);

      expect(site).not.toBeNull();
      expect(site?.pantheonSiteId).toBe(testPantheonId);
    });

    it('should return null for non-existent site', async () => {
      const site = await getSite('00000000-0000-0000-0000-000000000000');
      expect(site).toBeNull();
    });

    it('should update site name', async () => {
      const siteId = getFirst(createdSiteIds);
      const updated = await updateSite(siteId, { name: 'Updated Site Name' });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated Site Name');

      // Verify in database
      const fetched = await getSite(siteId);
      expect(fetched?.name).toBe('Updated Site Name');
    });

    it('should update site workflow settings partially', async () => {
      const siteId = getFirst(createdSiteIds);
      const updated = await updateSite(siteId, {
        workflowSettings: { minApprovers: 3 },
      });

      expect(updated).not.toBeNull();
      expect(updated?.workflowSettings.minApprovers).toBe(3);
      // Other settings should be preserved
      expect(updated?.workflowSettings.mergeApprovalMode).toBe('optional');
    });

    it('should throw DuplicatePantheonSiteIdError for duplicate', async () => {
      await expect(
        createSite({
          pantheonSiteId: testPantheonId, // Already exists
          name: 'Duplicate Site',
        }),
      ).rejects.toThrow(DuplicatePantheonSiteIdError);
    });

    it('should throw InvalidSiteParamsError for empty name', async () => {
      await expect(
        createSite({
          pantheonSiteId: `unique-${String(Date.now())}`,
          name: '',
        }),
      ).rejects.toThrow(InvalidSiteParamsError);
    });

    it('should list sites with pagination', async () => {
      // Create additional sites for pagination test
      const site2 = await createSite({
        pantheonSiteId: `test-pagination-${String(Date.now())}-1`,
        name: 'Pagination Test Site 1',
      });
      createdSiteIds.push(site2.id);

      const site3 = await createSite({
        pantheonSiteId: `test-pagination-${String(Date.now())}-2`,
        name: 'Pagination Test Site 2',
      });
      createdSiteIds.push(site3.id);

      const allSites = await listSites();
      expect(allSites.length).toBeGreaterThanOrEqual(3);

      const limitedSites = await listSites({ limit: 2 });
      expect(limitedSites.length).toBe(2);

      const offsetSites = await listSites({ limit: 2, offset: 1 });
      expect(offsetSites.length).toBe(2);
      // First result should be different from non-offset query
      expect(getFirst(offsetSites).id).not.toBe(getFirst(limitedSites).id);
    });
  });

  describe('Document Service - Real Database Operations', () => {
    let testSiteId: string;

    beforeAll(async () => {
      // Create a site for document tests
      const site = await createSite({
        pantheonSiteId: `doc-test-site-${String(Date.now())}`,
        name: 'Document Test Site',
      });
      testSiteId = site.id;
      createdSiteIds.push(site.id);
    });

    it('should create a document', async () => {
      const doc = await createDocument({
        siteId: testSiteId,
        path: 'pages/home',
      });

      createdDocumentIds.push(doc.id);

      expect(doc.id).toBeDefined();
      expect(doc.siteId).toBe(testSiteId);
      expect(doc.path).toBe('pages/home');
      expect(doc.createdAt).toBeDefined();

      console.log(`Created document: ${doc.id}`);
    });

    it('should retrieve document by ID', async () => {
      const docId = getFirst(createdDocumentIds);
      const doc = await getDocument(docId);

      expect(doc).not.toBeNull();
      expect(doc?.id).toBe(docId);
      expect(doc?.path).toBe('pages/home');
    });

    it('should retrieve document by path', async () => {
      const doc = await getDocumentByPath(testSiteId, 'pages/home');

      expect(doc).not.toBeNull();
      expect(doc?.path).toBe('pages/home');
      expect(doc?.siteId).toBe(testSiteId);
    });

    it('should return null for non-existent document', async () => {
      const doc = await getDocument('00000000-0000-0000-0000-000000000000');
      expect(doc).toBeNull();
    });

    it('should return null for non-existent path', async () => {
      const doc = await getDocumentByPath(testSiteId, 'non/existent/path');
      expect(doc).toBeNull();
    });

    it('should check document existence', async () => {
      const exists = await documentExists(testSiteId, 'pages/home');
      expect(exists).toBe(true);

      const notExists = await documentExists(testSiteId, 'non/existent');
      expect(notExists).toBe(false);
    });

    it('should update document path', async () => {
      const docId = getFirst(createdDocumentIds);
      const updated = await updateDocumentPath(docId, 'pages/index');

      expect(updated).not.toBeNull();
      expect(updated?.path).toBe('pages/index');

      // Verify old path no longer exists
      const oldPath = await getDocumentByPath(testSiteId, 'pages/home');
      expect(oldPath).toBeNull();

      // New path should work
      const newPath = await getDocumentByPath(testSiteId, 'pages/index');
      expect(newPath).not.toBeNull();
    });

    it('should throw SiteNotFoundError for invalid site', async () => {
      await expect(
        createDocument({
          siteId: '00000000-0000-0000-0000-000000000000',
          path: 'test/path',
        }),
      ).rejects.toThrow(SiteNotFoundError);
    });

    it('should throw DuplicateDocumentPathError for duplicate path', async () => {
      // Create a second document
      const doc2 = await createDocument({
        siteId: testSiteId,
        path: 'pages/about',
      });
      createdDocumentIds.push(doc2.id);

      // Try to create with same path
      await expect(
        createDocument({
          siteId: testSiteId,
          path: 'pages/about',
        }),
      ).rejects.toThrow(DuplicateDocumentPathError);
    });

    it('should throw InvalidDocumentPathError for invalid paths', async () => {
      await expect(
        createDocument({
          siteId: testSiteId,
          path: '/leading/slash',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);

      await expect(
        createDocument({
          siteId: testSiteId,
          path: 'trailing/slash/',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);

      await expect(
        createDocument({
          siteId: testSiteId,
          path: '',
        }),
      ).rejects.toThrow(InvalidDocumentPathError);
    });

    it('should list documents with filtering', async () => {
      // Create additional documents
      const doc3 = await createDocument({
        siteId: testSiteId,
        path: 'components/header',
      });
      createdDocumentIds.push(doc3.id);

      const doc4 = await createDocument({
        siteId: testSiteId,
        path: 'components/footer',
      });
      createdDocumentIds.push(doc4.id);

      // List all documents
      const allDocs = await listDocuments(testSiteId);
      expect(allDocs.length).toBeGreaterThanOrEqual(4);

      // Filter by pathPrefix
      const componentDocs = await listDocuments(testSiteId, { pathPrefix: 'components/' });
      expect(componentDocs.length).toBe(2);
      expect(componentDocs.every((d) => d.path.startsWith('components/'))).toBe(true);

      // Pagination
      const limitedDocs = await listDocuments(testSiteId, { limit: 2 });
      expect(limitedDocs.length).toBe(2);
    });

    it('should delete a document', async () => {
      // Create a document to delete
      const toDelete = await createDocument({
        siteId: testSiteId,
        path: 'to-delete/test',
      });

      const deleted = await deleteDocument(toDelete.id);
      expect(deleted).toBe(true);

      // Verify it's gone
      const fetched = await getDocument(toDelete.id);
      expect(fetched).toBeNull();
    });

    it('should return false when deleting non-existent document', async () => {
      const deleted = await deleteDocument('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  describe('Site Deletion Behavior', () => {
    it('should cascade delete documents when deleting site', async () => {
      // Create a new site with documents
      const site = await createSite({
        pantheonSiteId: `cascade-test-${String(Date.now())}`,
        name: 'Cascade Delete Test Site',
      });

      const doc1 = await createDocument({
        siteId: site.id,
        path: 'cascade-test/doc1',
      });

      // Verify document exists
      expect(await getDocument(doc1.id)).not.toBeNull();

      // deleteSite should succeed and cascade delete all related data
      const deleted = await deleteSite(site.id);
      expect(deleted).toBe(true);

      // Verify site is deleted
      expect(await getSite(site.id)).toBeNull();

      // Verify document is also deleted (cascaded by deleteSite)
      expect(await getDocument(doc1.id)).toBeNull();
    });

    it('should delete site after documents are removed', async () => {
      // Create a new site with documents
      const site = await createSite({
        pantheonSiteId: `delete-order-test-${String(Date.now())}`,
        name: 'Delete Order Test Site',
      });

      const doc1 = await createDocument({
        siteId: site.id,
        path: 'delete-order/doc1',
      });

      const doc2 = await createDocument({
        siteId: site.id,
        path: 'delete-order/doc2',
      });

      // Verify documents exist
      expect(await getDocument(doc1.id)).not.toBeNull();
      expect(await getDocument(doc2.id)).not.toBeNull();

      // Delete documents first
      await deleteDocument(doc1.id);
      await deleteDocument(doc2.id);

      // Now delete the site
      const deleted = await deleteSite(site.id);
      expect(deleted).toBe(true);

      // Verify site is gone
      expect(await getSite(site.id)).toBeNull();
    });
  });
});
