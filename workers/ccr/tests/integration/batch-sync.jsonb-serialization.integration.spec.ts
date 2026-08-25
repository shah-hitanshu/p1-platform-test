/**
 * batchSyncToPostgres must store snapshot/action_metadata as real jsonb
 * objects, not double-encoded JSON strings. postgres.js's jsonb[] encoder
 * serializes each bound element itself, so pre-stringifying a jsonb[] bind
 * double-encodes it — Postgres stores a jsonb string scalar of escaped JSON,
 * and every consumer that reads the snapshot as an object (editor, diffing,
 * publish) gets a raw string instead.
 *
 * A mocked-query unit test sees only the value passed to the driver, never
 * what Postgres stores. Asserting on jsonb_typeof against a real connection
 * is the only way to catch this.
 *
 * Prerequisites: docker start css-postgres && migrations applied.
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

import { createSite } from '../../src/services/site-service';
import { getMainBranch } from '../../src/services/branch-service';
import { createDocument } from '../../src/services/document-service';
import { batchSyncToPostgres } from '../../src/services/document-version-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const RUN = `pcc3468-${String(Date.now())}`;
const UUID_ACTOR = '11111111-2222-3333-4444-555555555555';

let sql: postgres.Sql;
let siteId: string;
let branchId: string;
let docCounter = 0;

function realConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const client = postgres(connectionString, { transform: { undefined: null }, max: 1 });
  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await client.unsafe<T[]>(
        sqlQuery,
        params as unknown as postgres.ParameterOrJSON<never>[],
      );
      const rows = [...result] as T[];
      const withCount = result as unknown as { count?: number };
      return { rows, rowCount: withCount.count ?? rows.length };
    },
  };
  return { connection, sql: client };
}

async function freshDoc(): Promise<string> {
  docCounter += 1;
  const doc = await createDocument({ siteId, path: `${RUN}/doc-${String(docCounter)}` });
  return doc.id;
}

async function storedVersion(documentId: string): Promise<{
  snapshotType: string;
  actionMetadataType: string | null;
  snapshot: unknown;
}> {
  const rows = await sql<{
    snapshot_type: string;
    action_metadata_type: string | null;
    snapshot: unknown;
  }[]>`
    SELECT jsonb_typeof(snapshot) AS snapshot_type,
           jsonb_typeof(action_metadata) AS action_metadata_type,
           snapshot
    FROM app.document_versions
    WHERE document_id = ${documentId}
    ORDER BY version_number DESC LIMIT 1`;
  const row = rows[0];
  if (row === undefined) throw new Error(`no document_versions row for ${documentId}`);
  return { snapshotType: row.snapshot_type, actionMetadataType: row.action_metadata_type, snapshot: row.snapshot };
}

beforeAll(async () => {
  const { connection, sql: client } = realConnection(CONNECTION_STRING);
  sql = client;
  setDatabaseInstance(connection);

  const site = await createSite({ pantheonSiteId: `${RUN}-site`, name: `${RUN}-site` });
  siteId = site.id;
  const main = await getMainBranch(siteId);
  if (main === null) throw new Error('main branch missing for test site');
  branchId = main.id;
});

afterAll(async () => {
  await sql`DELETE FROM app.checkpoint_documents
            WHERE checkpoint_id IN (SELECT id FROM app.checkpoints WHERE branch_id = ${branchId})`;
  await sql`DELETE FROM app.document_versions
            WHERE document_id IN (SELECT id FROM app.documents WHERE site_id = ${siteId})`;
  await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.checkpoints WHERE branch_id = ${branchId}`;
  await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
  await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
  await sql.end();
});

describe('PCC-3468: batchSyncToPostgres stores real jsonb, not double-encoded strings', () => {
  it('stores a nested snapshot as a jsonb object, round-tripping exactly', async () => {
    const docId = await freshDoc();
    const snapshot = {
      root: { props: { title: 'Document — 日本語 émoji 🎉' } },
      zones: {},
      content: [
        { type: 'ImageBlock', props: { id: 'img-1', nested: { deep: { arr: [1, 2, 3] } } } },
      ],
    };

    const result = await batchSyncToPostgres([
      { documentId: docId, branchId, snapshot, actorId: UUID_ACTOR, actorType: 'user' },
    ]);
    expect(result.inserted).toHaveLength(1);

    const stored = await storedVersion(docId);
    // The regression: a double-encoded write reports snapshot_type = 'string'.
    expect(stored.snapshotType).toBe('object');
    expect(stored.snapshot).toEqual(snapshot);
  });

  it('stores action_metadata as a jsonb object when present, and SQL null when absent', async () => {
    const docWithMeta = await freshDoc();
    await batchSyncToPostgres([
      {
        documentId: docWithMeta,
        branchId,
        snapshot: { root: {} },
        actorId: UUID_ACTOR,
        actorType: 'user',
        actionType: 'edit',
        actionMetadata: { componentType: 'Hero', zone: 'root' },
      },
    ]);
    const withMeta = await storedVersion(docWithMeta);
    expect(withMeta.actionMetadataType).toBe('object');

    const docNoMeta = await freshDoc();
    await batchSyncToPostgres([
      { documentId: docNoMeta, branchId, snapshot: { root: {} }, actorId: UUID_ACTOR, actorType: 'user' },
    ]);
    const noMeta = await storedVersion(docNoMeta);
    expect(noMeta.actionMetadataType).toBeNull();
  });

  it('stores every snapshot in a multi-document batch as a jsonb object', async () => {
    const docIds = [await freshDoc(), await freshDoc(), await freshDoc()];
    const result = await batchSyncToPostgres(
      docIds.map((documentId, i) => ({
        documentId,
        branchId,
        snapshot: { root: { props: { title: `batch-${String(i)}` } }, content: [] },
        actorId: UUID_ACTOR,
        actorType: 'user' as const,
      })),
    );
    expect(result.inserted).toHaveLength(3);

    for (const [i, docId] of docIds.entries()) {
      const stored = await storedVersion(docId);
      expect(stored.snapshotType).toBe('object');
      expect(stored.snapshot).toEqual({ root: { props: { title: `batch-${String(i)}` } }, content: [] });
    }
  });
});
