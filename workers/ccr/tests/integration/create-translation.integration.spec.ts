/**
 * Create-translation service - Integration Tests
 *
 * Exercises translation creation against a real PostgreSQL database: cloning a
 * canonical document into a locale variant preserves component slot ids exactly,
 * records a localization edge pinned to the canonical's current version, rejects
 * a second translation in a locale that already exists, lists a canonical's
 * locale variants, and inherits main's content on a branch that holds no version
 * of the canonical.
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { createRealDatabaseConnection } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createBranch, deleteBranch } from '../../src/services/branch-service';
import {
  createDocumentOnBranch,
  deleteDocumentOnBranch,
  documentExistsOnBranch,
} from '../../src/services/branch-document-service';
import { getDocument } from '../../src/services/document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { publishDocument } from '../../src/services/checkpoint-publish';
import {
  createTranslation,
  listLocaleVariants,
} from '../../src/services/create-translation-service';
import {
  getLocalizationEdgeByDerivedDocument,
  listLocalizationEdgesByUpstreamDocument,
} from '../../src/services/relations-service';
import { TranslationAlreadyExistsError, DocumentNotFoundError } from '../../src/services/errors';
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
    const { sql: pgSql } = createRealDatabaseConnection();
    sql = pgSql;

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

      expect(result.localization.derivedDocumentId).toBe(result.document.id);
      expect(result.localization.upstreamDocumentId).toBe(canonicalId);
      expect(result.localization.relationType).toBe('localization');
      expect(result.localization.syncedUpstreamVersion).toBe(1);

      const rels = await sql<RelationRow[]>`
        SELECT * FROM app.document_relations WHERE source_document_id = ${result.document.id}
      `;
      expect(rels).toHaveLength(1);
      expect(rels[0].target_document_id).toBe(canonicalId);
      expect(rels[0].relation_type).toBe('localization');
      expect(rels[0].synced_version).toBe(1);
    });

    it('reads the localization edge back by derived document', async () => {
      const edge = await getLocalizationEdgeByDerivedDocument(translationId);
      expect(edge?.upstreamDocumentId).toBe(canonicalId);
      expect(edge?.relationType).toBe('localization');
      expect(edge?.syncedUpstreamVersion).toBe(1);
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

      const edges = await listLocalizationEdgesByUpstreamDocument(canonicalId);
      expect(edges).toHaveLength(2);
      for (const edge of edges) {
        expect(edge.upstreamDocumentId).toBe(canonicalId);
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

  describe('Creating a translation on a branch holding no version of the canonical', () => {
    let canonicalId: string;
    let featureBranchId: string;
    let result: Awaited<ReturnType<typeof createTranslation>>;

    beforeAll(async () => {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/inherited',
        snapshot: makeSnapshot([HEADING, CTA]),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      canonicalId = canonical.document.id;

      await publishDocument({
        siteId,
        branchId,
        documentId: canonicalId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const branch = await createBranch({
        siteId,
        name: `inherit-${String(Date.now())}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      featureBranchId = branch.id;

      result = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: featureBranchId,
        locale: 'it-IT',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    });

    it('seeds the translation from the content the branch serves', () => {
      expect(extractComponentIds(result.version.snapshot)).toEqual([
        'HeadingBlock-1',
        'ButtonBlock-1',
      ]);
    });

    it('pins the translation to a canonical version main holds', async () => {
      expect(result.localization.syncedUpstreamVersionId).not.toBeNull();

      const pinned = await sql`
        SELECT document_id, branch_id
          FROM app.document_versions
         WHERE id = ${result.localization.syncedUpstreamVersionId}
      `;
      expect(pinned[0].document_id).toBe(canonicalId);
      expect(pinned[0].branch_id).toBe(branchId);
    });

    it('authors the translation on the branch alone', async () => {
      expect(await documentExistsOnBranch(result.document.id, featureBranchId)).toBe(true);
      expect(await documentExistsOnBranch(result.document.id, branchId)).toBe(false);
    });
  });

  describe('Taking over a translation of a canonical that has moved on since', () => {
    let firstTranslation: Awaited<ReturnType<typeof createTranslation>>;
    let takenOver: Awaited<ReturnType<typeof createTranslation>>;

    beforeAll(async () => {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/moved-on',
        snapshot: makeSnapshot([HEADING]),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const canonicalId = canonical.document.id;
      await publishDocument({
        siteId,
        branchId,
        documentId: canonicalId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const firstBranch = await createBranch({
        siteId,
        name: `bookmarked-${String(Date.now())}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      firstTranslation = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: firstBranch.id,
        locale: 'hu-HU',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      await createDocumentVersion({
        documentId: canonicalId,
        branchId,
        snapshot: makeSnapshot([HEADING, IMAGE]),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await publishDocument({
        siteId,
        branchId,
        documentId: canonicalId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const secondBranch = await createBranch({
        siteId,
        name: `taking-over-${String(Date.now())}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      takenOver = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: secondBranch.id,
        locale: 'hu-HU',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    });

    it('seeds the canonical content the translation is aligned to', () => {
      expect(extractComponentIds(takenOver.version.snapshot)).toEqual(['HeadingBlock-1']);
    });

    it('reports the alignment the seeded content matches', () => {
      expect(takenOver.localization.syncedUpstreamVersionId).toBe(
        firstTranslation.localization.syncedUpstreamVersionId,
      );
    });
  });

  describe('Taking over a translation aligned to a canonical draft another workstream holds', () => {
    let firstTranslation: Awaited<ReturnType<typeof createTranslation>>;
    let takenOver: Awaited<ReturnType<typeof createTranslation>>;
    let draftVersionId: string;

    beforeAll(async () => {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/private-draft',
        snapshot: makeSnapshot([HEADING]),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const canonicalId = canonical.document.id;
      await publishDocument({
        siteId,
        branchId,
        documentId: canonicalId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const firstBranch = await createBranch({
        siteId,
        name: `drafts-canonical-${String(Date.now())}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const draft = await createDocumentVersion({
        documentId: canonicalId,
        branchId: firstBranch.id,
        snapshot: makeSnapshot([HEADING, CTA]),
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      draftVersionId = draft.id;

      firstTranslation = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: firstBranch.id,
        locale: 'ro-RO',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const secondBranch = await createBranch({
        siteId,
        name: `takes-over-${String(Date.now())}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      takenOver = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: secondBranch.id,
        locale: 'ro-RO',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    });

    it('aligns a translation to the canonical draft its own workstream serves', () => {
      expect(firstTranslation.localization.syncedUpstreamVersionId).toBe(draftVersionId);
      expect(extractComponentIds(firstTranslation.version.snapshot)).toEqual([
        'HeadingBlock-1',
        'ButtonBlock-1',
      ]);
    });

    it('seeds the canonical the taking-over workstream serves, not the draft the alignment names', () => {
      expect(extractComponentIds(takenOver.version.snapshot)).toEqual(['HeadingBlock-1']);
    });

    it('leaves the alignment where the authoring workstream set it', () => {
      expect(takenOver.localization.syncedUpstreamVersionId).toBe(draftVersionId);
    });
  });

  describe('Creating a translation in a locale another branch holds', () => {
    let canonicalId: string;
    let firstBranchId: string;
    let secondBranchId: string;

    async function newBranch(label: string): Promise<string> {
      const branch = await createBranch({
        siteId,
        name: `${label}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      return branch.id;
    }

    beforeAll(async () => {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/shared',
        snapshot: makeSnapshot([HEADING, CTA]),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      canonicalId = canonical.document.id;

      await publishDocument({
        siteId,
        branchId,
        documentId: canonicalId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      firstBranchId = await newBranch('holds-locale');
      secondBranchId = await newBranch('wants-locale');
    });

    it('takes over the translation document the other branch authored', async () => {
      const first = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: firstBranchId,
        locale: 'nl-NL',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const second = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: secondBranchId,
        locale: 'nl-NL',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      expect(second.document.id).toBe(first.document.id);
      expect(second.document.locale).toBe('nl-NL');
    });

    it('holds each branch its own version of a shared translation', async () => {
      const created = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: firstBranchId,
        locale: 'nb-NO',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: secondBranchId,
        locale: 'nb-NO',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      expect(await documentExistsOnBranch(created.document.id, firstBranchId)).toBe(true);
      expect(await documentExistsOnBranch(created.document.id, secondBranchId)).toBe(true);
      expect(await documentExistsOnBranch(created.document.id, branchId)).toBe(false);
    });

    it('leaves the canonical a single localization edge per locale', async () => {
      await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: firstBranchId,
        locale: 'fi-FI',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: secondBranchId,
        locale: 'fi-FI',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const edges = await listLocalizationEdgesByUpstreamDocument(canonicalId);
      const documents = await Promise.all(edges.map((edge) => getDocument(edge.derivedDocumentId)));
      expect(documents.filter((document) => document?.locale === 'fi-FI')).toHaveLength(1);
    });

    it('preserves the canonical slot ids in the adopting branch version', async () => {
      await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: firstBranchId,
        locale: 'pl-PL',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const second = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: secondBranchId,
        locale: 'pl-PL',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      expect(extractComponentIds(second.version.snapshot)).toEqual([
        'HeadingBlock-1',
        'ButtonBlock-1',
      ]);
    });

    it('rejects a locale the branch already holds itself', async () => {
      await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: secondBranchId,
        locale: 'sv-SE',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      await expect(
        createTranslation({
          canonicalDocumentId: canonicalId,
          branchId: secondBranchId,
          locale: 'sv-SE',
          createdById: TEST_USER_ID,
          createdByType: 'user',
        }),
      ).rejects.toThrow(TranslationAlreadyExistsError);
    });

    it('rejects a locale the branch inherits from main', async () => {
      const onMain = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'da-DK',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await publishDocument({
        siteId,
        branchId,
        documentId: onMain.document.id,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const inheritingBranchId = await newBranch('inherits-locale');

      await expect(
        createTranslation({
          canonicalDocumentId: canonicalId,
          branchId: inheritingBranchId,
          locale: 'da-DK',
          createdById: TEST_USER_ID,
          createdByType: 'user',
        }),
      ).rejects.toThrow(TranslationAlreadyExistsError);
    });

    it('takes the locale back after a published translation was deleted', async () => {
      const published = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'ro-RO',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await publishDocument({
        siteId,
        branchId,
        documentId: published.document.id,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await deleteDocumentOnBranch({
        documentId: published.document.id,
        branchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      const retaken = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'ro-RO',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      expect(retaken.document.id).toBe(published.document.id);
      expect(await documentExistsOnBranch(retaken.document.id, branchId)).toBe(true);
    });

    it('keeps the publish history of a translation it takes back', async () => {
      const published = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'el-GR',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await publishDocument({
        siteId,
        branchId,
        documentId: published.document.id,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await deleteDocumentOnBranch({
        documentId: published.document.id,
        branchId,
        deletedById: TEST_USER_ID,
        deletedByType: 'user',
      });

      await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'el-GR',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const captured = await sql`
        SELECT COUNT(*)::int AS count
          FROM app.checkpoint_documents cd
          JOIN app.document_versions dv ON dv.id = cd.document_version_id
         WHERE dv.document_id = ${published.document.id}
      `;
      expect(captured[0].count).toBeGreaterThan(0);
    });

    it('frees the locale again once the only branch holding it is deleted', async () => {
      const soleBranchId = await newBranch('sole-holder');
      const abandoned = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId: soleBranchId,
        locale: 'pt-PT',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      await deleteBranch(soleBranchId);

      const recreated = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'pt-PT',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      expect(recreated.document.id).toBe(abandoned.document.id);
      expect(await documentExistsOnBranch(recreated.document.id, branchId)).toBe(true);
    });
  });
});
