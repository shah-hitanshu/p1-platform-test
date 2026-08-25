/**
 * Slot-id adoption runner — integration tests.
 *
 * Runs the one-time adoption pass against a real PostgreSQL database:
 * template-bound documents holding legacy component ids are rewritten to the
 * template's slot ids in a new migration-sourced version; documents that
 * fail pinned-slot conformance are recorded and skipped; re-running is a
 * no-op. The optional site scope confines a run to one site's documents.
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
import { getLatestDocumentVersion } from '../../src/services/document-version-service';
import { runSlotIdAdoption } from '../../src/services/slot-id-adoption';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const TEST_USER_ID = '88888888-8888-8888-8888-888888888888';
const SITE_PREFIX = 'slot-adoption-test';

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

interface Comp {
  type: string;
  props: { id: string; [key: string]: unknown };
}

function comp(type: string, id: string, extra: Record<string, unknown> = {}): Comp {
  return { type, props: { id, ...extra } };
}

const TEMPLATE_SNAPSHOT = {
  content: [
    comp('HeadingBlock', 'HeadingBlock-slot-h1', { title: 'Default heading' }),
    comp('ImageBlock', 'ImageBlock-slot-i1', { src: '', alt: '' }),
  ],
  root: { props: { _pinMap: { 'HeadingBlock-slot-h1': true } } },
  zones: {
    'HeadingBlock-slot-h1:cta': [comp('CtaBlock', 'CtaBlock-slot-c1', { label: 'Go' })],
  },
};

describe('Slot-id adoption runner — Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;
  let templateDocId: string;
  let legacyDocId: string;
  let nonConformantDocId: string;
  let unboundDocId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'slot-adoption-test@example.com', 'Slot Adoption Test User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Slot Adoption Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;

    await sql`
      INSERT INTO app.user_site_roles (user_id, site_id, role)
      VALUES (${TEST_USER_ID}, ${siteId}, 'admin')
      ON CONFLICT DO NOTHING
    `;

    const template = await createDocumentOnBranch({
      siteId,
      branchId,
      path: '_registry/templates/adoption-test',
      snapshot: TEMPLATE_SNAPSHOT,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    templateDocId = template.document.id;

    const legacy = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'adoption-post-1',
      snapshot: {
        content: [
          comp('HeadingBlock', 'comp_1700_heading', { title: 'My custom heading' }),
          comp('ImageBlock', 'comp_1700_image', { src: '/photo.jpg', alt: 'Photo' }),
        ],
        root: { props: { title: 'Post 1' } },
        zones: {
          'comp_1700_heading:cta': [comp('CtaBlock', 'comp_1700_cta', { label: 'Buy' })],
        },
      },
      templateId: templateDocId,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    legacyDocId = legacy.document.id;

    const nonConformant = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'adoption-post-2',
      snapshot: {
        content: [comp('ImageBlock', 'comp_1701_image', { src: '/other.jpg', alt: '' })],
        root: { props: { title: 'Post 2' } },
        zones: {},
      },
      templateId: templateDocId,
      templateVersion: 1,
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    nonConformantDocId = nonConformant.document.id;

    const unbound = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'adoption-standalone',
      snapshot: {
        content: [comp('HeadingBlock', 'comp_1702_heading', { title: 'Standalone' })],
        root: { props: {} },
        zones: {},
      },
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    unboundDocId = unbound.document.id;
  });

  afterAll(async () => {
    try {
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

  it('reports what would be adopted on a dry run without writing versions', async () => {
    const summary = await runSlotIdAdoption({ dryRun: true, siteId });

    const adoptedHere = summary.adopted.filter((a) => a.documentId === legacyDocId);
    expect(adoptedHere).toHaveLength(1);
    expect(adoptedHere[0].path).toBe('adoption-post-1');
    expect(adoptedHere[0].rewrites).toBe(3);

    const skippedHere = summary.skipped.filter((s) => s.documentId === nonConformantDocId);
    expect(skippedHere).toHaveLength(1);
    expect(skippedHere[0].reason).toBe('missing-pinned-slot');

    const latest = await getLatestDocumentVersion(legacyDocId, branchId);
    expect(latest?.versionNumber).toBe(1);
  });

  it('does not examine documents without a template relation', async () => {
    const summary = await runSlotIdAdoption({ dryRun: true, siteId });

    const allMentioned = [
      ...summary.adopted.map((a) => a.documentId),
      ...summary.skipped.map((s) => s.documentId),
    ];
    expect(allMentioned).not.toContain(unboundDocId);
  });

  it('rewrites matched components to slot ids in a migration-sourced version', async () => {
    const summary = await runSlotIdAdoption({ dryRun: false, siteId });

    expect(summary.adopted.some((a) => a.documentId === legacyDocId)).toBe(true);

    const latest = await getLatestDocumentVersion(legacyDocId, branchId);
    expect(latest?.versionNumber).toBe(2);

    const content = (latest?.snapshot?.content ?? []) as Comp[];
    expect(content.map((c) => c.props.id)).toEqual(['HeadingBlock-slot-h1', 'ImageBlock-slot-i1']);
    expect(content[0].props.title).toBe('My custom heading');

    const zones = latest?.snapshot?.zones as Record<string, Comp[]>;
    expect(zones['HeadingBlock-slot-h1:cta'][0].props.id).toBe('CtaBlock-slot-c1');
    expect(zones['HeadingBlock-slot-h1:cta'][0].props.label).toBe('Buy');
    expect(zones['comp_1700_heading:cta']).toBeUndefined();

    const versionRows = await sql`
      SELECT source FROM app.document_versions
      WHERE document_id = ${legacyDocId} AND branch_id = ${branchId} AND version_number = 2
    `;
    expect(versionRows[0]?.source).toBe('migration');
  });

  it('leaves non-conformant documents unmodified and recorded', async () => {
    const latest = await getLatestDocumentVersion(nonConformantDocId, branchId);
    expect(latest?.versionNumber).toBe(1);

    const summary = await runSlotIdAdoption({ dryRun: true, siteId });
    const skippedHere = summary.skipped.filter((s) => s.documentId === nonConformantDocId);
    expect(skippedHere[0]?.reason).toBe('missing-pinned-slot');
  });

  it('is idempotent: a second run adopts nothing new', async () => {
    const summary = await runSlotIdAdoption({ dryRun: false, siteId });

    expect(summary.adopted.some((a) => a.documentId === legacyDocId)).toBe(false);
    expect(summary.alreadyAdopted).toBeGreaterThanOrEqual(1);

    const latest = await getLatestDocumentVersion(legacyDocId, branchId);
    expect(latest?.versionNumber).toBe(2);
  });
});
