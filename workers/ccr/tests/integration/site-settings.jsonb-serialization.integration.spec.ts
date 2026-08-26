/**
 * updateSiteSettings must merge into app.sites.settings, leaving a jsonb object.
 *
 * postgres.js serializes a jsonb parameter itself, so a pre-stringified value is
 * JSON-encoded twice and Postgres stores a string scalar. `settings || $1::jsonb`
 * then appends rather than merges, so the column grows into an array one element
 * per write and every setting reads back under a numeric key.
 *
 * A mocked-query unit test sees only the value handed to the driver, never what
 * Postgres stores. Asserting on jsonb_typeof against a real connection is the
 * only way to catch this.
 *
 * Prerequisites: docker start css-postgres && migrations applied.
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';

import { createSite } from '../../src/services/site-service';
import { getSiteSettings, updateSiteSettings } from '../../src/services/site-settings-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const RUN = `pcc3485-${String(Date.now())}`;

let sql: postgres.Sql;
const siteIds: string[] = [];

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
        params,
      );
      const rows = [...result] as T[];
      const withCount = result as unknown as { count?: number };
      return { rows, rowCount: withCount.count ?? rows.length };
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
  return { connection, sql: client };
}

async function freshSite(): Promise<string> {
  const suffix = `${RUN}-${String(siteIds.length + 1)}`;
  const site = await createSite({ pantheonSiteId: suffix, name: suffix });
  siteIds.push(site.id);
  return site.id;
}

async function storedSettings(siteId: string): Promise<{ type: string; value: unknown }> {
  const rows = await sql<{ type: string; value: unknown }[]>`
    SELECT jsonb_typeof(settings) AS type, settings AS value
    FROM app.sites WHERE id = ${siteId}`;
  const row = rows[0];
  if (row === undefined) throw new Error(`no sites row for ${siteId}`);
  return { type: row.type, value: row.value };
}

beforeAll(() => {
  const { connection, sql: client } = realConnection(CONNECTION_STRING);
  sql = client;
  setDatabaseInstance(connection);
});

afterAll(async () => {
  for (const siteId of siteIds) {
    await sql`DELETE FROM app.checkpoint_documents
              WHERE checkpoint_id IN (
                SELECT id FROM app.checkpoints
                WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${siteId}))`;
    await sql`DELETE FROM app.document_versions
              WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${siteId})`;
    await sql`DELETE FROM app.documents WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.checkpoints
              WHERE branch_id IN (SELECT id FROM app.branches WHERE site_id = ${siteId})`;
    await sql`DELETE FROM app.branches WHERE site_id = ${siteId}`;
    await sql`DELETE FROM app.sites WHERE id = ${siteId}`;
  }
  await sql.end();
});

describe('updateSiteSettings stores real jsonb, not double-encoded strings', () => {
  it('stores a written setting as a jsonb object', async () => {
    const siteId = await freshSite();

    await updateSiteSettings(siteId, { cacheTtlMain: 120 });

    const stored = await storedSettings(siteId);
    // The regression: a double-encoded write reports type 'array'.
    expect(stored.type).toBe('object');
    expect(stored.value).toEqual({ cacheTtlMain: 120 });
  });

  it('merges successive writes into one object rather than accumulating them', async () => {
    const siteId = await freshSite();

    await updateSiteSettings(siteId, { cacheTtlMain: 120 });
    await updateSiteSettings(siteId, { cacheTtlBranch: 10 });
    const result = await updateSiteSettings(siteId, { cacheTtlMain: 300 });

    expect(result).toEqual({ cacheTtlMain: 300, cacheTtlBranch: 10 });

    const stored = await storedSettings(siteId);
    expect(stored.type).toBe('object');
    expect(stored.value).toEqual({ cacheTtlMain: 300, cacheTtlBranch: 10 });
  });

  it('round-trips a locale registry through the column', async () => {
    const siteId = await freshSite();
    const locales = {
      markets: ['fr-FR', 'ja', 'pt-BR'],
      policy: 'localized-only' as const,
    };

    await updateSiteSettings(siteId, { locales });

    const stored = await storedSettings(siteId);
    expect(stored.type).toBe('object');
    expect(stored.value).toEqual({ locales });

    const read = await getSiteSettings(siteId);
    expect(read?.locales).toEqual(locales);
  });

  it('stores a registry the caller wrote in another casing in its canonical form', async () => {
    const siteId = await freshSite();

    await updateSiteSettings(siteId, {
      locales: { markets: ['fr-fr', 'PT-br'], policy: 'fallback' },
    });

    const read = await getSiteSettings(siteId);
    expect(read?.locales).toEqual({
      markets: ['fr-FR', 'pt-BR'],
      policy: 'fallback',
    });
  });

  it('removes a setting without disturbing the one written alongside it', async () => {
    const siteId = await freshSite();
    await updateSiteSettings(siteId, { cacheTtlMain: 120, cacheTtlBranch: 10 });

    const result = await updateSiteSettings(siteId, { cacheTtlMain: 300, cacheTtlBranch: null });

    expect(result).toEqual({ cacheTtlMain: 300, cacheTtlBranch: 5 });
    const stored = await storedSettings(siteId);
    expect(stored.type).toBe('object');
    expect(stored.value).toEqual({ cacheTtlMain: 300 });
  });
});
