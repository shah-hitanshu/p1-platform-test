/**
 * Branch drift listing - Integration Tests
 *
 * Exercises the branch-scoped localization drift listing against a real
 * PostgreSQL database. The listing enumerates every translation on a branch,
 * computes each one's drift against its canonical with the same engine the
 * per-document upstream-diff uses, omits translations that are in sync, and
 * returns per-classification counts so the dashboard can render a collapsed row
 * without a follow-up request per translation.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { createTranslation } from '../../src/services/create-translation-service';
import {
  listBranchDrift,
  MAX_DRIFT_LIMIT,
  type BranchDriftEntry,
} from '../../src/services/branch-drift-service';

const TEST_USER_ID = '66666666-6666-6666-6666-666666666666';
const SITE_PREFIX = 'branch-drift-test';

function byDocumentId(entries: BranchDriftEntry[]): Map<string, BranchDriftEntry> {
  return new Map(entries.map((entry) => [entry.documentId, entry]));
}

async function mainBranchId(sql: postgres.Sql, siteId: string): Promise<string> {
  const branches = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
  return branches[0].id as string;
}

describe('Branch drift listing - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let emptySiteId: string;
  let branchId: string;
  let emptyBranchId: string;

  let alphaCanonicalId: string;
  let alphaFrId: string;
  let alphaEsId: string;
  let betaDeId: string;
  let plainDocId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'branch-drift-test@example.com', 'Branch Drift Test User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Branch Drift Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;
    branchId = await mainBranchId(sql, siteId);

    const emptySite = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-empty-${String(Date.now())}`,
      name: 'Branch Drift Empty Site',
      creatorId: TEST_USER_ID,
    });
    emptySiteId = emptySite.id;
    emptyBranchId = await mainBranchId(sql, emptySiteId);

    // Alpha: a canonical with two translations. Bumping the canonical drifts both.
    const alpha = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/alpha',
      snapshot: {
        content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-a', title: 'Hello', level: 'h1' } }],
        root: { props: { title: 'Alpha' } },
        zones: {},
      },
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    alphaCanonicalId = alpha.document.id;

    const alphaFr = await createTranslation({
      canonicalDocumentId: alphaCanonicalId,
      branchId,
      locale: 'fr-FR',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    alphaFrId = alphaFr.document.id;

    const alphaEs = await createTranslation({
      canonicalDocumentId: alphaCanonicalId,
      branchId,
      locale: 'es-ES',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    alphaEsId = alphaEs.document.id;

    // Alpha v2: a translatable canonical-authority prop changes -> needsTranslation.
    await createDocumentVersion({
      documentId: alphaCanonicalId,
      branchId,
      snapshot: {
        content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-a', title: 'Hello EDITED', level: 'h1' } }],
        root: { props: { title: 'Alpha' } },
        zones: {},
      },
      source: 'edit',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    // Beta: a canonical with one translation that stays in sync (no canonical bump).
    const beta = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/beta',
      snapshot: {
        content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-b', title: 'Bonjour' } }],
        root: { props: { title: 'Beta' } },
        zones: {},
      },
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });

    const betaDe = await createTranslation({
      canonicalDocumentId: beta.document.id,
      branchId,
      locale: 'de-DE',
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    betaDeId = betaDe.document.id;

    // A plain document with no localization edge is not a translation.
    const plain = await createDocumentOnBranch({
      siteId,
      branchId,
      path: 'pages/plain',
      snapshot: {
        content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-p', title: 'Plain' } }],
        root: { props: {} },
        zones: {},
      },
      createdById: TEST_USER_ID,
      createdByType: 'user',
    });
    plainDocId = plain.document.id;
  });

  afterAll(async () => {
    try {
      for (const id of [siteId, emptySiteId]) {
        await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
          SELECT id FROM app.documents WHERE site_id = ${id}
        )`;
        await sql`DELETE FROM app.document_versions WHERE document_id IN (
          SELECT id FROM app.documents WHERE site_id = ${id}
        )`;
        await sql`DELETE FROM app.documents WHERE site_id = ${id}`;
        await sql`DELETE FROM app.branches WHERE site_id = ${id}`;
        await sql`DELETE FROM app.sites WHERE id = ${id}`;
      }
      await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    } catch {
      // Ignore cleanup errors
    }
    await sql.end();
    setDatabaseInstance(null);
  });

  it('lists only the translations that have drifted from their canonical', async () => {
    const { drift } = await listBranchDrift(branchId, 'localization');
    const ids = drift.map((entry) => entry.documentId).sort();

    expect(ids).toEqual([alphaEsId, alphaFrId].sort());
  });

  it('omits an in-sync translation and non-translation documents', async () => {
    const { drift } = await listBranchDrift(branchId, 'localization');
    const ids = new Set(drift.map((entry) => entry.documentId));

    expect(ids.has(betaDeId)).toBe(false);
    expect(ids.has(plainDocId)).toBe(false);
    expect(ids.has(alphaCanonicalId)).toBe(false);
  });

  it('carries the locale, canonical reference, and classified counts for each row', async () => {
    const { drift } = await listBranchDrift(branchId, 'localization');
    const entry = byDocumentId(drift).get(alphaFrId);

    expect(entry).toBeDefined();
    expect(entry?.locale).toBe('fr-FR');
    expect(entry?.targetDocumentId).toBe(alphaCanonicalId);
    expect(typeof entry?.path).toBe('string');
    expect(entry?.path.length).toBeGreaterThan(0);
    expect(entry?.counts.needsTranslation).toBe(1);
  });

  it('reports a total equal to the sum of the per-classification counts', async () => {
    const { drift } = await listBranchDrift(branchId, 'localization');
    for (const entry of drift) {
      const summed = Object.values(entry.counts).reduce((acc, count) => acc + count, 0);
      expect(entry.total).toBe(summed);
      expect(entry.total).toBeGreaterThan(0);
    }
  });

  it('returns an empty page for a branch with no translations', async () => {
    const page = await listBranchDrift(emptyBranchId, 'localization');
    expect(page.drift).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('reports a further page from the candidates, not from the drift it kept', async () => {
    // Drift filtering runs after paging, so a page can be empty while candidates remain.
    const first = await listBranchDrift(branchId, 'localization', { limit: 1, offset: 0 });
    const last = await listBranchDrift(branchId, 'localization', { limit: 1, offset: 2 });

    expect(first.limit).toBe(1);
    expect(first.offset).toBe(0);
    expect(first.hasMore).toBe(true);
    expect(last.hasMore).toBe(false);
  });

  it('clamps a page size above the maximum', async () => {
    const page = await listBranchDrift(branchId, 'localization', {
      limit: MAX_DRIFT_LIMIT + 100,
    });

    expect(page.limit).toBe(MAX_DRIFT_LIMIT);
  });
});
