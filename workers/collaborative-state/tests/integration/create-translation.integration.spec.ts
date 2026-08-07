/**
 * Create-translation service - Integration Tests
 *
 * Exercises translation creation against a real PostgreSQL database: cloning a
 * canonical document into a locale variant preserves component slot ids exactly,
 * records a localization edge pinned to the canonical's current version, rejects
 * a second translation in a locale that already exists, and lists a canonical's
 * locale variants.
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
import { getDocument } from '../../src/services/document-service';
import {
  createTranslation,
  listLocaleVariants,
  TranslationAlreadyExistsError,
} from '../../src/services/create-translation-service';
import {
  getLocalizationEdgeBySource,
  listLocalizationEdgesByTarget,
} from '../../src/services/relations-service';
import { DocumentNotFoundError } from '../../src/services/document-types';
import { extractComponentIds } from '../../src/services/component-identity';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'translation-test';
const MISSING_DOCUMENT_ID = '00000000-0000-0000-0000-0000000000aa';

const HEADING = { type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' } };
const IMAGE = { type: 'ImageBlock', props: { id: 'ImageBlock-1', src: '/a.jpg', alt: 'A' } };
const CTA = { type: 'ButtonBlock', props: { id: 'ButtonBlock-1', label: 'Go', href: '/go' } };

function makeSnapshot(components: unknown[]): Record<string, unknown> {
  return { content: components, root: { props: { title: 'Test' } }, zones: {} };
}

interface RelationRow {
  source_document_id: string;
  target_document_id: string;
  relation_type: string;
  synced_version: number | null;
}

describe('Create-translation service - Integration Tests', () => {
  let sql: postgres.Sql;
  let siteId: string;
  let branchId: string;

  beforeAll(async () => {
    const { connection, sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;
    setDatabaseInstance(connection);

    await sql`SELECT 1`;

    await sql`
      INSERT INTO app.users (id, email, name)
      VALUES (${TEST_USER_ID}, 'translation-test@example.com', 'Translation Test User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Translation Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;
  });

  afterAll(async () => {
    try {
      await sql`DELETE FROM app.document_relations WHERE source_document_id IN (
        SELECT id FROM app.documents WHERE site_id = ${siteId}
      )`;
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

  describe('Creating a translation from a canonical document', () => {
    let canonicalId: string;
    let translationId: string;

    it('clones the canonical snapshot preserving component slot ids exactly', async () => {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/home',
        snapshot: makeSnapshot([HEADING, IMAGE, CTA]),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      canonicalId = canonical.document.id;

      const result = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'fr-FR',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      translationId = result.document.id;

      expect(result.document.id).not.toBe(canonicalId);
      expect(result.document.locale).toBe('fr-FR');

      const canonicalIds = extractComponentIds(canonical.version.snapshot);
      const translationIds = extractComponentIds(result.version.snapshot);
      expect(translationIds).toEqual(canonicalIds);
      expect(translationIds).toEqual(['HeadingBlock-1', 'ImageBlock-1', 'ButtonBlock-1']);
    });

    it('writes a localization edge pinned to the canonical current version', async () => {
      const result = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'de-DE',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      expect(result.localization.sourceDocumentId).toBe(result.document.id);
      expect(result.localization.targetDocumentId).toBe(canonicalId);
      expect(result.localization.relationType).toBe('localization');
      expect(result.localization.syncedVersion).toBe(1);

      const rels = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${result.document.id}
      `;
      expect(rels).toHaveLength(1);
      expect(rels[0].target_document_id).toBe(canonicalId);
      expect(rels[0].relation_type).toBe('localization');
      expect(rels[0].synced_version).toBe(1);
    });

    it('reads the localization edge back by source', async () => {
      const edge = await getLocalizationEdgeBySource(translationId);
      expect(edge?.targetDocumentId).toBe(canonicalId);
      expect(edge?.relationType).toBe('localization');
      expect(edge?.syncedVersion).toBe(1);
    });

    it('surfaces locale on the persisted translation document', async () => {
      const doc = await getDocument(translationId);
      expect(doc?.locale).toBe('fr-FR');

      const canonicalDoc = await getDocument(canonicalId);
      expect(canonicalDoc?.locale).toBeUndefined();
    });

    it('rejects a second translation in a locale that already exists', async () => {
      await expect(
        createTranslation({
          canonicalDocumentId: canonicalId,
          branchId,
          locale: 'fr-FR',
          createdById: TEST_USER_ID,
          createdByType: 'user',
        }),
      ).rejects.toThrow(TranslationAlreadyExistsError);
    });

    it('rejects a second translation naming the existing locale in another casing', async () => {
      await expect(
        createTranslation({
          canonicalDocumentId: canonicalId,
          branchId,
          locale: 'FR-fr',
          createdById: TEST_USER_ID,
          createdByType: 'user',
        }),
      ).rejects.toThrow(TranslationAlreadyExistsError);
    });

    it('lists the canonical with each of its locale variants', async () => {
      const result = await listLocaleVariants(canonicalId, branchId);
      expect(result.canonical.id).toBe(canonicalId);

      const locales = result.variants.map((v) => v.document.locale).sort();
      expect(locales).toEqual(['de-DE', 'fr-FR']);

      const edges = await listLocalizationEdgesByTarget(canonicalId);
      expect(edges).toHaveLength(2);
      for (const edge of edges) {
        expect(edge.targetDocumentId).toBe(canonicalId);
        expect(edge.relationType).toBe('localization');
      }
    });

    it('rejects creating a translation for a missing canonical document', async () => {
      await expect(
        createTranslation({
          canonicalDocumentId: MISSING_DOCUMENT_ID,
          branchId,
          locale: 'es-ES',
          createdById: TEST_USER_ID,
          createdByType: 'user',
        }),
      ).rejects.toThrow(DocumentNotFoundError);
    });
  });
});
