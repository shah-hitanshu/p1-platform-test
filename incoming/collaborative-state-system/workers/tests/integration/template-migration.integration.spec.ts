/**
 * Template Migration CUJ — Integration Tests
 *
 * Tests the full template migration flow against a real PostgreSQL database:
 * create template → create document from template → edit template → migrate → verify.
 *
 * Prerequisites:
 * - PostgreSQL running: podman start css-postgres
 * - Migrations applied: npm run db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import {
  createDocumentVersion,
  getLatestDocumentVersion,
} from '../../src/services/document-version-service';
import {
  triggerMigration,
  processMigration,
  previewMigration,
  extractTemplateDelta,
  listMigrationConflicts,
  resolveMigrationConflict,
} from '../../src/services/migration-service';
import {
  listDocumentsOnBranch,
} from '../../src/services/branch-document-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const TEST_USER_ID = '99999999-9999-9999-9999-999999999999';
const SITE_PREFIX = 'migration-test';

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

// =============================================================================
// Template and document snapshot helpers
// =============================================================================

const HEADING = { type: 'HeadingBlock', props: { id: 'heading-1', title: 'Hello World', level: 'h1' } };
const IMAGE = { type: 'ImageBlock', props: { id: 'image-1', src: '/photo.jpg', alt: 'A photo' } };
const BUTTON = { type: 'ButtonBlock', props: { id: 'button-1', label: 'Click me', href: '/action', variant: 'primary' } };

function makeSnapshot(components: unknown[]): Record<string, unknown> {
  return { content: components, root: { props: { title: 'Test' } }, zones: {} };
}

// =============================================================================
// Tests
// =============================================================================

describe('Template Migration CUJ — Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    const result = await sql`SELECT 1 as connected`;
    expect(result[0]?.connected).toBe(1);

    // Create test user
    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'migration-test@example.com', 'Migration Test User')
      ON CONFLICT (id) DO NOTHING
    `;

    // Create test site (auto-creates main branch)
    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${Date.now()}`,
      name: 'Migration Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    // Get main branch
    const branches = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;

    // Grant admin role
    await sql`
      INSERT INTO app.user_site_roles (user_id, site_id, role)
      VALUES (${TEST_USER_ID}, ${siteId}, 'admin')
      ON CONFLICT DO NOTHING
    `;
  });

  afterAll(async () => {
    try {
      // Clean up in dependency order
      await sql`DELETE FROM app.migration_conflicts WHERE template_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})`;
      await sql`DELETE FROM app.migration_jobs WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.checkpoint_documents WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = ${branchId})`;
      await sql`DELETE FROM app.checkpoints WHERE branch_id = ${branchId}`;
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId}) OR target_document_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})`;
      await sql`DELETE FROM app.document_versions WHERE document_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})`;
      await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.user_site_roles WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
      await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
      await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    } catch {
      // Ignore cleanup errors
    }
    await sql.end();
    setDatabaseInstance(null);
  });

  // ===========================================================================
  // Full CUJ: template → document → edit template → migrate
  // ===========================================================================

  describe('CUJ: Create template → Create document → Edit template → Migrate', () => {
    let templateDocId: string;
    let pageDocId: string;

    it('should create a template with HeadingBlock and ImageBlock', async () => {
      const result = await createDocumentOnBranch({
        siteId,
        branchId,
        path: '_registry/templates/test-blog',
        snapshot: makeSnapshot([HEADING, IMAGE]),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      templateDocId = result.document.id;
      expect(result.version.versionNumber).toBe(1);

      const content = result.version.snapshot?.content as unknown[];
      expect(content).toHaveLength(2);
    });

    it('should create a document from the template', async () => {
      const result = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'test-post-1',
        snapshot: makeSnapshot([HEADING, IMAGE]),
        templateId: templateDocId,
        templateVersion: 1,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      pageDocId = result.document.id;
      expect(result.document.templateId).toBe(templateDocId);
      expect(result.document.templateVersion).toBe(1);

      const content = result.version.snapshot?.content as unknown[];
      expect(content).toHaveLength(2);
    });

    it('should show no migration available at template v1', async () => {
      const preview = await previewMigration(siteId, branchId, templateDocId, 0, 1);
      expect(preview.affectedDocuments).toBe(0);
    });

    it('should create template v2 with ButtonBlock added', async () => {
      const v2 = await createDocumentVersion({
        documentId: templateDocId,
        branchId,
        snapshot: makeSnapshot([HEADING, IMAGE, BUTTON]),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
        puckActions: [
          { type: 'insert', componentType: 'ButtonBlock', destinationIndex: 2 },
        ],
      });

      expect(v2.versionNumber).toBe(2);
      expect(v2.actionType).toBe('structural');
    });

    it('should extract the template delta with puckActions', async () => {
      const delta = await extractTemplateDelta(templateDocId, branchId, 1, 2);
      expect(delta.structuralActions).toHaveLength(1);
      expect(delta.structuralActions[0].type).toBe('insert');
      expect(delta.structuralActions[0].componentType).toBe('ButtonBlock');
    });

    it('should show migration available for 1 document', async () => {
      const preview = await previewMigration(siteId, branchId, templateDocId, 1, 2, true);
      expect(preview.affectedDocuments).toBe(1);
      expect(preview.cleanDocuments).toBe(1);
      expect(preview.estimatedConflicts).toBe(0);
      expect(preview.documents).toHaveLength(1);
      expect(preview.documents![0].path).toBe('test-post-1');
    });

    it('should migrate document to include ButtonBlock with full props', async () => {
      const job = await triggerMigration(
        siteId, branchId, templateDocId, 1, 2,
        { id: TEST_USER_ID, type: 'user' },
      );
      expect(job.totalDocuments).toBe(1);

      const result = await processMigration(job.id);
      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(0);

      // Verify document content
      const latest = await getLatestDocumentVersion(pageDocId, branchId);
      expect(latest).not.toBeNull();
      expect(latest!.source).toBe('migration');

      const content = latest!.snapshot!.content as Array<{ type: string; props: Record<string, unknown> }>;
      expect(content).toHaveLength(3);
      expect(content[0].type).toBe('HeadingBlock');
      expect(content[1].type).toBe('ImageBlock');
      expect(content[2].type).toBe('ButtonBlock');
      expect(content[2].props.label).toBe('Click me');
      expect(content[2].props.href).toBe('/action');
      expect(content[2].props.id).toBe('button-1');

      // Verify synced_version updated
      const relRow = await sql`
        SELECT synced_version FROM app.document_relations
        WHERE source_document_id = ${pageDocId} AND relation_type = 'template'
      `;
      expect(relRow[0].synced_version).toBe(2);
    });

    it('should not create duplicates on re-migration', async () => {
      // Reset synced_version to trigger migration again
      await sql`
        UPDATE app.document_relations SET synced_version = 1
        WHERE source_document_id = ${pageDocId} AND relation_type = 'template'
      `;

      const job = await triggerMigration(
        siteId, branchId, templateDocId, 1, 2,
        { id: TEST_USER_ID, type: 'user' },
      );
      const result = await processMigration(job.id);
      expect(result.processedDocuments).toBe(1);

      const latest = await getLatestDocumentVersion(pageDocId, branchId);
      const content = latest!.snapshot!.content as Array<{ type: string; props: Record<string, unknown> }>;

      // Should still have exactly 3 components, no duplicates
      expect(content).toHaveLength(3);
      const buttonCount = content.filter(c => c.type === 'ButtonBlock').length;
      expect(buttonCount).toBe(1);
    });
  });

  // ===========================================================================
  // Reorder migration
  // ===========================================================================

  describe('Reorder migration', () => {
    let templateDocId: string;
    let pageDocId: string;

    it('should set up template and document', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-reorder',
        snapshot: makeSnapshot([
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
          { type: 'C', props: { id: 'c1' } },
        ]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      templateDocId = tpl.document.id;

      const page = await createDocumentOnBranch({
        siteId, branchId,
        path: 'test-reorder-post',
        snapshot: makeSnapshot([
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
          { type: 'C', props: { id: 'c1' } },
        ]),
        templateId: templateDocId, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      pageDocId = page.document.id;
    });

    it('should migrate reorder: A,B,C → C,A,B', async () => {
      await createDocumentVersion({
        documentId: templateDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'C', props: { id: 'c1' } },
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'reorder', sourceIndex: 2, destinationIndex: 0 }],
      });

      const job = await triggerMigration(siteId, branchId, templateDocId, 1, 2, { id: TEST_USER_ID, type: 'user' });
      const result = await processMigration(job.id);
      expect(result.processedDocuments).toBe(1);

      const latest = await getLatestDocumentVersion(pageDocId, branchId);
      const content = latest!.snapshot!.content as Array<{ type: string }>;
      expect(content[0].type).toBe('C');
      expect(content[1].type).toBe('A');
      expect(content[2].type).toBe('B');
    });
  });

  // ===========================================================================
  // Conflict detection
  // ===========================================================================

  describe('Conflict detection', () => {
    let templateDocId: string;
    let conflictDocId: string;

    it('should detect conflict when document has structural edits on same component type', async () => {
      // Create template
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-conflict',
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1' } },
          { type: 'TextBlock', props: { id: 't1' } },
        ]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      templateDocId = tpl.document.id;

      // Create document from template
      const page = await createDocumentOnBranch({
        siteId, branchId,
        path: 'test-conflict-post',
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1' } },
          { type: 'TextBlock', props: { id: 't1' } },
        ]),
        templateId: templateDocId, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      conflictDocId = page.document.id;

      // Document makes a structural edit (user reorders HeadingBlock)
      await createDocumentVersion({
        documentId: conflictDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'TextBlock', props: { id: 't1' } },
          { type: 'HeadingBlock', props: { id: 'h1' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1, componentType: 'HeadingBlock' }],
      });

      // Template also makes a structural edit on HeadingBlock
      await createDocumentVersion({
        documentId: templateDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1' } },
          { type: 'TextBlock', props: { id: 't1' } },
          { type: 'HeadingBlock', props: { id: 'h2' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'insert', componentType: 'HeadingBlock', destinationIndex: 2 }],
      });

      // Preview should detect conflict
      const preview = await previewMigration(siteId, branchId, templateDocId, 1, 2, true);
      expect(preview.affectedDocuments).toBe(1);
      expect(preview.estimatedConflicts).toBe(1);
      expect(preview.documents![0].hasConflict).toBe(true);

      // Run migration — conflicted document goes to conflicts table
      const job = await triggerMigration(siteId, branchId, templateDocId, 1, 2, { id: TEST_USER_ID, type: 'user' });
      const result = await processMigration(job.id);
      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(1);

      // Verify conflict recorded
      const conflicts = await sql`
        SELECT * FROM app.migration_conflicts
        WHERE migration_job_id = ${job.id}
      `;
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].document_id).toBe(conflictDocId);
    });
  });

  // ===========================================================================
  // action_metadata stored as proper JSONB, not double-serialized
  // ===========================================================================

  describe('action_metadata JSONB serialization', () => {
    it('should store action_metadata as a JSONB object, not a JSON string', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-jsonb',
        snapshot: makeSnapshot([{ type: 'A', props: { id: 'a1' } }]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      await createDocumentVersion({
        documentId: tpl.document.id, branchId,
        snapshot: makeSnapshot([
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'insert', componentType: 'B', destinationIndex: 1 }],
      });

      // Query the raw JSONB type — should be 'object', not 'string'
      const rows = await sql`
        SELECT jsonb_typeof(action_metadata) as meta_type,
               action_metadata->'puckActions' as puck_actions
        FROM app.document_versions
        WHERE document_id = ${tpl.document.id}
          AND version_number = 2
      `;

      expect(rows[0].meta_type).toBe('object');
      // If double-serialized, -> would return null because it's a string
      expect(rows[0].puck_actions).not.toBeNull();
      const actions = rows[0].puck_actions as unknown[];
      expect(actions).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Documents with NULL template_version found by migration
  // ===========================================================================

  describe('NULL synced_version handling', () => {
    it('should find documents with a NULL synced version as migration candidates', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-null-tv',
        snapshot: makeSnapshot([{ type: 'X', props: { id: 'x1' } }]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      // Create a document with a template edge whose synced_version is NULL
      // (simulates documents created before template versioning was added)
      const docRows = await sql`
        INSERT INTO app.documents (site_id, path)
        VALUES (${siteId}, 'test-null-tv-page')
        RETURNING id
      `;
      const nullTvDocId = docRows[0].id as string;
      await sql`
        INSERT INTO app.document_relations
          (source_document_id, target_document_id, relation_type, synced_version)
        VALUES (${nullTvDocId}, ${tpl.document.id}, 'template', NULL)
      `;

      // Create an initial version for the document
      await createDocumentVersion({
        documentId: nullTvDocId, branchId,
        snapshot: makeSnapshot([{ type: 'X', props: { id: 'x1' } }]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
      });

      // Create template v2 with structural change
      await createDocumentVersion({
        documentId: tpl.document.id, branchId,
        snapshot: makeSnapshot([
          { type: 'X', props: { id: 'x1' } },
          { type: 'Y', props: { id: 'y1' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'insert', componentType: 'Y', destinationIndex: 1 }],
      });

      // Preview should find the NULL template_version document
      const preview = await previewMigration(siteId, branchId, tpl.document.id, 0, 2, true);
      expect(preview.affectedDocuments).toBeGreaterThanOrEqual(1);

      const found = preview.documents?.find(d => d.documentId === nullTvDocId);
      expect(found).toBeDefined();
      expect(found!.currentTemplateVersion).toBeNull();
    });
  });

  // ===========================================================================
  // Template API returns version number and updatedAt
  // ===========================================================================

  describe('template version and updatedAt in API response', () => {
    it('should include versionNumber and createdAt on the latest template version', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-version-fields',
        snapshot: makeSnapshot([{ type: 'A', props: { id: 'a1' } }]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      // Create v2 so we can verify the version number advances
      await createDocumentVersion({
        documentId: tpl.document.id, branchId,
        snapshot: makeSnapshot([
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
      });

      // The template list API builds its response from getLatestDocumentVersion.
      // Verify the latest version has the fields the API needs.
      const latest = await getLatestDocumentVersion(tpl.document.id, branchId);
      expect(latest).not.toBeNull();
      expect(latest!.versionNumber).toBe(2);
      expect(latest!.createdAt).toBeDefined();
      // createdAt is a valid timestamp (string from API, Date from service)
      expect(new Date(latest!.createdAt).getTime()).not.toBeNaN();
    });
  });

  // ===========================================================================
  // Prop cascade: prop-only template changes cascade to documents
  // ===========================================================================

  describe('Prop cascade: prop-only template change cascades to document', () => {
    let templateDocId: string;
    let pageDocId: string;

    it('should set up template and document with matching props', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-prop-cascade',
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Welcome', level: 'h1' } },
          { type: 'ButtonBlock', props: { id: 'b1', label: 'Sign Up', href: '/signup' } },
        ]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      templateDocId = tpl.document.id;

      const page = await createDocumentOnBranch({
        siteId, branchId,
        path: 'test-prop-cascade-page',
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Welcome', level: 'h1' } },
          { type: 'ButtonBlock', props: { id: 'b1', label: 'Sign Up', href: '/signup' } },
        ]),
        templateId: templateDocId, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      pageDocId = page.document.id;
    });

    it('should create template v2 with prop-only changes', async () => {
      const v2 = await createDocumentVersion({
        documentId: templateDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Welcome', level: 'h1' } },
          { type: 'ButtonBlock', props: { id: 'b1', label: 'Get Started', href: '/get-started' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'set' }],
      });

      expect(v2.versionNumber).toBe(2);
      expect(v2.actionType).toBe('prop_update');
    });

    it('should extract prop patches from template delta', async () => {
      const delta = await extractTemplateDelta(templateDocId, branchId, 1, 2);
      expect(delta.structuralActions).toHaveLength(0);
      expect(delta.propPatches.length).toBeGreaterThanOrEqual(1);

      const btnPatch = delta.propPatches.find(p => p.componentId === 'b1');
      expect(btnPatch).toBeDefined();
      expect(btnPatch!.operations.length).toBeGreaterThanOrEqual(1);
    });

    it('should migrate document with prop changes applied', async () => {
      const job = await triggerMigration(
        siteId, branchId, templateDocId, 1, 2,
        { id: TEST_USER_ID, type: 'user' },
      );

      const result = await processMigration(job.id);
      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(0);

      const latest = await getLatestDocumentVersion(pageDocId, branchId);
      expect(latest).not.toBeNull();

      const content = latest!.snapshot!.content as Array<{ type: string; props: Record<string, unknown> }>;
      const button = content.find(c => c.type === 'ButtonBlock');
      expect(button).toBeDefined();
      expect(button!.props.label).toBe('Get Started');
      expect(button!.props.href).toBe('/get-started');
    });
  });

  describe('Prop cascade: customized document prop is preserved (conflict)', () => {
    let templateDocId: string;
    let pageDocId: string;

    it('should set up template and document, then editor customizes a prop', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-prop-conflict',
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Default Heading', level: 'h1' } },
        ]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      templateDocId = tpl.document.id;

      const page = await createDocumentOnBranch({
        siteId, branchId,
        path: 'test-prop-conflict-page',
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Default Heading', level: 'h1' } },
        ]),
        templateId: templateDocId, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      pageDocId = page.document.id;

      // Editor customizes the heading title
      await createDocumentVersion({
        documentId: pageDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'My Custom Page Title', level: 'h1' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'set' }],
      });
    });

    it('should preserve editor customized prop after migration', async () => {
      // Template admin also changes the heading title
      await createDocumentVersion({
        documentId: templateDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Updated Default Heading', level: 'h2' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'set' }],
      });

      const job = await triggerMigration(
        siteId, branchId, templateDocId, 1, 2,
        { id: TEST_USER_ID, type: 'user' },
      );

      const result = await processMigration(job.id);
      expect(result.processedDocuments).toBe(1);

      const latest = await getLatestDocumentVersion(pageDocId, branchId);
      const content = latest!.snapshot!.content as Array<{ type: string; props: Record<string, unknown> }>;
      const heading = content.find(c => c.type === 'HeadingBlock');
      expect(heading).toBeDefined();

      // Title was customized by editor — should NOT be overwritten
      expect(heading!.props.title).toBe('My Custom Page Title');
      // Level was NOT customized (still matches template default) — should be updated
      expect(heading!.props.level).toBe('h2');
    });
  });

  describe('Prop cascade: works alongside structural changes', () => {
    let templateDocId: string;
    let pageDocId: string;

    it('should set up and migrate with both structural + prop changes', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-prop-structural',
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Original', level: 'h1' } },
        ]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      templateDocId = tpl.document.id;

      const page = await createDocumentOnBranch({
        siteId, branchId,
        path: 'test-prop-structural-page',
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Original', level: 'h1' } },
        ]),
        templateId: templateDocId, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      pageDocId = page.document.id;

      // Template v2: add a new component (structural) AND change heading props
      await createDocumentVersion({
        documentId: templateDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1', title: 'Updated Title', level: 'h1' } },
          { type: 'FooterBlock', props: { id: 'f1', text: 'Copyright 2026' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [
          { type: 'insert', componentType: 'FooterBlock', destinationIndex: 1 },
        ],
      });

      const delta = await extractTemplateDelta(templateDocId, branchId, 1, 2);
      expect(delta.structuralActions).toHaveLength(1);
      expect(delta.propPatches.length).toBeGreaterThanOrEqual(1);

      const job = await triggerMigration(
        siteId, branchId, templateDocId, 1, 2,
        { id: TEST_USER_ID, type: 'user' },
      );

      const result = await processMigration(job.id);
      expect(result.processedDocuments).toBe(1);
      expect(result.conflictedDocuments).toBe(0);

      const latest = await getLatestDocumentVersion(pageDocId, branchId);
      const content = latest!.snapshot!.content as Array<{ type: string; props: Record<string, unknown> }>;

      // Structural: FooterBlock was inserted
      expect(content).toHaveLength(2);
      expect(content.find(c => c.type === 'FooterBlock')).toBeDefined();

      // Prop: HeadingBlock title was updated
      const heading = content.find(c => c.type === 'HeadingBlock');
      expect(heading!.props.title).toBe('Updated Title');
    });
  });

  // ===========================================================================
  // puckActions recorded when snapshot is unchanged (dedup case)
  // ===========================================================================

  describe('puckActions on duplicate snapshot', () => {
    it('should record puckActions on existing version when snapshot is identical', async () => {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: '_registry/templates/test-dedup-actions',
        snapshot: makeSnapshot([
          { type: 'A', props: { id: 'a1' } },
          { type: 'B', props: { id: 'b1' } },
        ]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });

      // Create v2 with SAME snapshot but with puckActions (simulates a
      // reorder that the CRDT deduplicates because the Y.Doc already had
      // the same state from a prior sync)
      const sameSnapshot = makeSnapshot([
        { type: 'A', props: { id: 'a1' } },
        { type: 'B', props: { id: 'b1' } },
      ]);

      const result = await createDocumentVersion({
        documentId: tpl.document.id, branchId,
        snapshot: sameSnapshot,
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'reorder', sourceIndex: 1, destinationIndex: 0 }],
      });

      // Should return existing version (v1) — no new version created
      expect(result.versionNumber).toBe(1);
      // But action_type should now be set
      expect(result.actionType).toBe('structural');

      // Verify in DB
      const rows = await sql`
        SELECT action_type, action_metadata->'puckActions' as puck_actions
        FROM app.document_versions
        WHERE id = ${result.id}
      `;
      expect(rows[0].action_type).toBe('structural');
      expect(rows[0].puck_actions).not.toBeNull();
    });
  });

  // ===========================================================================
  // Migration conflict delta round-trip: write → read → resolve-apply
  // ===========================================================================

  describe('Migration conflict delta jsonb round-trip', () => {
    async function setUpConflict(pathSuffix: string): Promise<{
      templateDocId: string;
      pageDocId: string;
      jobId: string;
      conflictId: string;
    }> {
      const tpl = await createDocumentOnBranch({
        siteId, branchId,
        path: `_registry/templates/${pathSuffix}`,
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1' } },
          { type: 'TextBlock', props: { id: 't1' } },
        ]),
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      const templateDocId = tpl.document.id;

      const page = await createDocumentOnBranch({
        siteId, branchId,
        path: `${pathSuffix}-page`,
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1' } },
          { type: 'TextBlock', props: { id: 't1' } },
        ]),
        templateId: templateDocId, templateVersion: 1,
        createdById: TEST_USER_ID, createdByType: 'user',
      });
      const pageDocId = page.document.id;

      // Page reorders HeadingBlock — a structural edit on the same type the
      // template touches, which forces a conflict rather than a clean apply.
      await createDocumentVersion({
        documentId: pageDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'TextBlock', props: { id: 't1' } },
          { type: 'HeadingBlock', props: { id: 'h1' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'reorder', sourceIndex: 0, destinationIndex: 1, componentType: 'HeadingBlock' }],
      });

      // Template v2 inserts a second HeadingBlock.
      await createDocumentVersion({
        documentId: templateDocId, branchId,
        snapshot: makeSnapshot([
          { type: 'HeadingBlock', props: { id: 'h1' } },
          { type: 'TextBlock', props: { id: 't1' } },
          { type: 'HeadingBlock', props: { id: 'h2' } },
        ]),
        source: 'edit', createdById: TEST_USER_ID, createdByType: 'user',
        puckActions: [{ type: 'insert', componentType: 'HeadingBlock', destinationIndex: 2 }],
      });

      const job = await triggerMigration(siteId, branchId, templateDocId, 1, 2, { id: TEST_USER_ID, type: 'user' });
      const result = await processMigration(job.id);
      expect(result.conflictedDocuments).toBe(1);

      const conflicts = await listMigrationConflicts(job.id);
      expect(conflicts).toHaveLength(1);

      return { templateDocId, pageDocId, jobId: job.id, conflictId: conflicts[0].id };
    }

    it('stores template_delta as a jsonb array and applies it on resolve', async () => {
      const { pageDocId, conflictId } = await setUpConflict('test-conflict-roundtrip');

      // The delta is stored as a real jsonb array, not a double-encoded string.
      const typeRows = await sql`
        SELECT jsonb_typeof(template_delta) as t
        FROM app.migration_conflicts WHERE id = ${conflictId}
      `;
      expect(typeRows[0].t).toBe('array');

      await resolveMigrationConflict(conflictId, 'apply', { id: TEST_USER_ID, type: 'user' });

      const latest = await getLatestDocumentVersion(pageDocId, branchId);
      const content = latest!.snapshot!.content as Array<{ type: string; props: { id?: string } }>;
      expect(content.filter(c => c.type === 'HeadingBlock')).toHaveLength(2);
      expect(content.some(c => c.props.id === 'h2')).toBe(true);

      const relRow = await sql`
        SELECT synced_version FROM app.document_relations
        WHERE source_document_id = ${pageDocId} AND relation_type = 'template'
      `;
      expect(relRow[0].synced_version).toBe(2);
    });

    it('applies a delta stored as a double-encoded jsonb string', async () => {
      const { pageDocId, conflictId } = await setUpConflict('test-conflict-legacy');

      // Rewrite the row to the double-encoded shape older writers produced: a
      // jsonb string scalar whose text is the delta's JSON.
      const current = await sql`SELECT template_delta FROM app.migration_conflicts WHERE id = ${conflictId}`;
      const deltaJson = JSON.stringify(current[0].template_delta);
      await sql`
        UPDATE app.migration_conflicts
        SET template_delta = to_jsonb(${deltaJson}::text)
        WHERE id = ${conflictId}
      `;
      const typeRows = await sql`
        SELECT jsonb_typeof(template_delta) as t
        FROM app.migration_conflicts WHERE id = ${conflictId}
      `;
      expect(typeRows[0].t).toBe('string');

      await resolveMigrationConflict(conflictId, 'apply', { id: TEST_USER_ID, type: 'user' });

      const latest = await getLatestDocumentVersion(pageDocId, branchId);
      const content = latest!.snapshot!.content as Array<{ type: string; props: { id?: string } }>;
      expect(content.some(c => c.props.id === 'h2')).toBe(true);
    });
  });
});
