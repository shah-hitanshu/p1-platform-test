/**
 * Document Relations edge model - Integration Tests
 *
 * Exercises the document_relations edge table through the service layer against
 * a real PostgreSQL database: creating a document from a template records an
 * edge, readers surface templateId/templateVersion from the edge, and a template
 * migration advances the edge's synced_version.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

import { createSite } from '../../src/services/site-service';
import {
  createDocumentOnBranch,
  deleteDocumentOnBranch,
  listDocumentsOnBranch,
} from '../../src/services/branch-document-service';
import { getDocument } from '../../src/services/document-service';
import {
  createDocumentVersion,
  getLatestDocumentVersion,
} from '../../src/services/document-version-service';
import {
  triggerMigration,
  processMigration,
} from '../../src/services/migration-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const TEST_USER_ID = '88888888-8888-8888-8888-888888888888';
const SITE_PREFIX = 'relations-test';

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
      const rowCount = resultWithCount.count ?? rows.length;
      return { rows, rowCount };
    },
  };

  return { connection, sql };
}

const HEADING = { type: 'HeadingBlock', props: { id: 'heading-1', title: 'Hello', level: 'h1' } };
const IMAGE = { type: 'ImageBlock', props: { id: 'image-1', src: '/a.jpg', alt: 'A' } };
const CTA = { type: 'ButtonBlock', props: { id: 'cta-1', label: 'Go', href: '/go' } };

function makeSnapshot(components: unknown[]): Record<string, unknown> {
  return { content: components, root: { props: { title: 'Test' } }, zones: {} };
}

interface RelationRow {
  source_document_id: string;
  target_document_id: string;
  relation_type: string;
  synced_version: number | null;
}

describe('Document Relations edge model - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'relations-test@example.com', 'Relations Test User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Relations Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM app.migration_conflicts WHERE template_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId}
      )`;
      await sql`DELETE FROM app.migration_jobs WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId}
      )`;
      await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (
        SELECT id FROM app.checkpoints WHERE branch_id = ${branchId}
      )`;
      await sql`DELETE FROM app.checkpoints WHERE branch_id = ${branchId}`;
      await sql`DELETE FROM app.document_versions WHERE document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId}
      )`;
      await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
      await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    } catch {
      // Ignore cleanup errors
    }
    await sql.end();
    setDatabaseInstance(null);
  });

  describe('Creating a document from a template records an edge', () => {
    let templateDocId: string;
    let pageDocId: string;

    it('creates the template without any edge', async () => {
      const result = await createDocumentOnBranch({
        siteId,
        branchId,
        path: '_registry/templates/relations-blog',
        snapshot: makeSnapshot([HEADING, IMAGE]),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      templateDocId = result.document.id;

      expect(result.document.templateId).toBeUndefined();
      expect(result.document.templateVersion).toBeUndefined();

      const rels = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${templateDocId}
      `;
      expect(rels).toHaveLength(0);
    });

    it('records a template edge when creating a document from a template', async () => {
      const result = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'relations-post',
        snapshot: makeSnapshot([HEADING, IMAGE]),
        templateId: templateDocId,
        templateVersion: 1,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      pageDocId = result.document.id;

      expect(result.document.templateId).toBe(templateDocId);
      expect(result.document.templateVersion).toBe(1);

      const rels = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${pageDocId}
      `;
      expect(rels).toHaveLength(1);
      expect(rels[0].target_document_id).toBe(templateDocId);
      expect(rels[0].relation_type).toBe('template');
      expect(rels[0].synced_version).toBe(1);
    });

    it('reads the association back through getDocument', async () => {
      const doc = await getDocument(pageDocId);
      expect(doc?.templateId).toBe(templateDocId);
      expect(doc?.templateVersion).toBe(1);
    });

    it('surfaces the association in listDocumentsOnBranch', async () => {
      const docs = await listDocumentsOnBranch(branchId);
      const page = docs.find((d) => d.id === pageDocId);
      expect(page?.templateId).toBe(templateDocId);
      expect(page?.templateVersion).toBe(1);

      const template = docs.find((d) => d.id === templateDocId);
      expect(template?.templateId).toBeUndefined();
    });

    it('advances synced_version when the template is migrated', async () => {
      // Publish a new structural version of the template (v1 -> v2).
      await createDocumentVersion({
        documentId: templateDocId,
        branchId,
        snapshot: makeSnapshot([HEADING, IMAGE, CTA]),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
        puckActions: [{ type: 'insert', componentType: 'ButtonBlock', destinationIndex: 2 }],
      });

      const latest = await getLatestDocumentVersion(templateDocId, branchId);
      expect(latest?.versionNumber).toBe(2);

      const job = await triggerMigration(
        siteId,
        branchId,
        templateDocId,
        1,
        2,
        { id: TEST_USER_ID, type: 'user' },
      );
      await processMigration(job.id);

      const rels = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${pageDocId}
      `;
      expect(rels[0].synced_version).toBe(2);

      const doc = await getDocument(pageDocId);
      expect(doc?.templateVersion).toBe(2);
    });
  });

  describe('Recreating a tombstoned document reconciles its template edge', () => {
    async function tombstone(documentId: string): Promise<void> {
      await deleteDocumentOnBranch({
        documentId,
        branchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });
    }

    it('records the edge when a page recreated with a template had none before', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId, path: '_registry/templates/recreate-adds-edge',
        snapshot: makeSnapshot([HEADING]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      const page = await createDocumentOnBranch({
        siteId, branchId, path: 'recreate-adds-edge-page',
        snapshot: makeSnapshot([HEADING]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      const before = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${page.document.id}
      `;
      expect(before).toHaveLength(0);

      await tombstone(page.document.id);
      const recreated = await createDocumentOnBranch({
        siteId, branchId, path: 'recreate-adds-edge-page',
        snapshot: makeSnapshot([HEADING]),
        templateId: tpl.document.id, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      expect(recreated.document.id).toBe(page.document.id);
      expect(recreated.document.templateId).toBe(tpl.document.id);

      const rels = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${page.document.id}
      `;
      expect(rels).toHaveLength(1);
      expect(rels[0].target_document_id).toBe(tpl.document.id);
      expect(rels[0].synced_version).toBe(1);
    });

    it('refreshes a stale edge when a page is recreated against a newer template version', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId, path: '_registry/templates/recreate-refresh',
        snapshot: makeSnapshot([HEADING]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      const page = await createDocumentOnBranch({
        siteId, branchId, path: 'recreate-refresh-page',
        snapshot: makeSnapshot([HEADING]),
        templateId: tpl.document.id, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      await tombstone(page.document.id);
      await createDocumentOnBranch({
        siteId, branchId, path: 'recreate-refresh-page',
        snapshot: makeSnapshot([HEADING]),
        templateId: tpl.document.id, templateVersion: 2,
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      const rels = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${page.document.id}
      `;
      expect(rels).toHaveLength(1);
      expect(rels[0].synced_version).toBe(2);
    });

    it('clears a stale edge when a page is recreated without a template', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId, path: '_registry/templates/recreate-clears',
        snapshot: makeSnapshot([HEADING]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      const page = await createDocumentOnBranch({
        siteId, branchId, path: 'recreate-clears-page',
        snapshot: makeSnapshot([HEADING]),
        templateId: tpl.document.id, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      await tombstone(page.document.id);
      const recreated = await createDocumentOnBranch({
        siteId, branchId, path: 'recreate-clears-page',
        snapshot: makeSnapshot([HEADING]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      expect(recreated.document.templateId).toBeUndefined();

      const rels = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${page.document.id}
      `;
      expect(rels).toHaveLength(0);
    });
  });
});
