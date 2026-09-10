/**
 * Change summary - Integration Tests
 *
 * Exercises the relation-generic upstream-diff core and its classification layer
 * against a real PostgreSQL database. A change summary reports how a document's
 * upstream drifted between the version the document is synced to and the
 * upstream's current version, and classifies each change into one of the
 * localization buckets (or the plain structural/prop buckets for a template edge).
 *
 * Prerequisites:
 * - PostgreSQL running: docker start css-postgres
 * - Migrations applied: pnpm db:migrate
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import { createRealDatabaseConnection, deleteSiteCascade } from '../helpers/database';

import { createSite } from '../../src/services/site-service';
import { createDocumentOnBranch } from '../../src/services/branch-document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { createTranslation } from '../../src/services/create-translation-service';
import {
  setAuthorityOverride,
  setUpstreamResolutions,
} from '../../src/services/relations-service';
import {
  buildChangeSummary,
  indexPropsById,
  readAtPointer,
  type ChangeSummary,
  type ChangeSummaryEntry,
} from '../../src/services/change-summary-service';
import { createBranch } from '../../src/services/branch-service';
import { publishDocument } from '../../src/services/checkpoint-publish';
import { getLatestSnapshot } from '../../src/services/template-read';
import { fingerprintValue } from '../../src/utils/value-fingerprint';

const TEST_USER_ID = '77777777-7777-7777-7777-777777777777';
const SITE_PREFIX = 'change-summary-test';

function findByComponent(
  summary: ChangeSummary,
  componentId: string,
  propPath?: string,
): ChangeSummaryEntry | undefined {
  return summary.changes.find(
    (change) => change.componentId === componentId && change.propPath === propPath,
  );
}

describe('Change summary - Integration Tests', () => {
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
      VALUES (${TEST_USER_ID}, 'change-summary-test@example.com', 'Change Summary Test User')
      ON CONFLICT (id) DO NOTHING
    `;

    const site = await createSite({
      pantheonSiteId: `${SITE_PREFIX}-${String(Date.now())}`,
      name: 'Change Summary Test Site',
      creatorId: TEST_USER_ID,
    });
    siteId = site.id;

    const branches = await sql`SELECT id FROM app.branches WHERE site_id = ${siteId} AND is_main = true`;
    branchId = branches[0].id as string;
  });

  afterAll(async () => {
    await deleteSiteCascade(sql, siteId);
    await sql`DELETE FROM app.users WHERE id = ${TEST_USER_ID}`;
    await sql.end();
    setDatabaseInstance(null);
  });

  describe('localization edge classification', () => {
    let translationId: string;
    let canonicalId: string;
    let summary: ChangeSummary;

    beforeAll(async () => {
      // Canonical v1: a heading (canonical authority, translatable), a date
      // (canonical authority, explicitly non-translatable), and a price
      // (canonical authority by default; a per-prop edge override makes it
      // locale-owned on the translation).
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/product',
        snapshot: {
          content: [
            { type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello', level: 'h1' } },
            { type: 'DateBlock', props: { id: 'DateBlock-1', date: '2026-01-01' } },
            { type: 'PriceBlock', props: { id: 'PriceBlock-1', price: '10' } },
          ],
          root: {
            props: {
              title: 'Product',
              _localeTranslatable: { 'DateBlock-1': { date: false } },
            },
          },
          zones: {},
        },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      canonicalId = canonical.document.id;

      const translation = await createTranslation({
        canonicalDocumentId: canonicalId,
        branchId,
        locale: 'fr-FR',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      translationId = translation.document.id;

      // The translation owns its price: a per-prop authority override flips this
      // one prop to locale authority.
      await setAuthorityOverride(translationId, 'PriceBlock-1', 'price', 'locale');

      // Canonical v2: edits every prop and adds a new slot.
      await createDocumentVersion({
        documentId: canonicalId,
        branchId,
        snapshot: {
          content: [
            { type: 'HeadingBlock', props: { id: 'HeadingBlock-1', title: 'Hello EDITED', level: 'h1' } },
            { type: 'DateBlock', props: { id: 'DateBlock-1', date: '2026-02-02' } },
            { type: 'PriceBlock', props: { id: 'PriceBlock-1', price: '20' } },
            { type: 'CtaBlock', props: { id: 'CtaBlock-1', label: 'Buy' } },
          ],
          root: {
            props: {
              title: 'Product',
              _localeTranslatable: { 'DateBlock-1': { date: false } },
            },
          },
          zones: {},
        },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const result = await buildChangeSummary({
        derivedDocumentId: translationId,
        branchId,
        relationType: 'localization',
      });
      if (result === null) {
        throw new Error('expected a change summary for the translation');
      }
      summary = result;
    });

    it('reports the edge endpoints and the version range being diffed', () => {
      expect(summary.relationType).toBe('localization');
      expect(summary.derivedDocumentId).toBe(translationId);
      expect(summary.upstreamDocumentId).toBe(canonicalId);
      expect(summary.fromVersion).toBe(1);
      expect(summary.toVersion).toBe(2);
    });

    it('classifies a canonical-authority translatable prop change as needsTranslation', () => {
      const change = findByComponent(summary, 'HeadingBlock-1', '/title');
      expect(change).toBeDefined();
      expect(change?.classification).toBe('needsTranslation');
      expect(change?.authority).toBe('canonical');
      expect(change?.translatable).toBe(true);
      expect(change?.upstreamOldValue).toBe('Hello');
      expect(change?.upstreamNewValue).toBe('Hello EDITED');
      expect(change?.documentValue).toBe('Hello');
    });

    it('classifies a canonical-authority non-translatable prop change as autoApplied', () => {
      const change = findByComponent(summary, 'DateBlock-1', '/date');
      expect(change).toBeDefined();
      expect(change?.classification).toBe('autoApplied');
      expect(change?.authority).toBe('canonical');
      expect(change?.translatable).toBe(false);
      expect(change?.upstreamNewValue).toBe('2026-02-02');
    });

    it('classifies a locale-authority (edge override) prop change as advisory', () => {
      const change = findByComponent(summary, 'PriceBlock-1', '/price');
      expect(change).toBeDefined();
      expect(change?.classification).toBe('advisory');
      expect(change?.authority).toBe('locale');
      expect(change?.upstreamNewValue).toBe('20');
    });

    it('classifies an added slot as structural and carries it in the slot delta', () => {
      const change = findByComponent(summary, 'CtaBlock-1', undefined);
      expect(change).toBeDefined();
      expect(change?.classification).toBe('structural');
      expect(change?.structuralKind).toBe('added');

      expect(summary.slotDelta.added.map((add) => add.component.props.id)).toContain('CtaBlock-1');
    });

    it('tallies one change in each of the four localization buckets', () => {
      expect(summary.counts.needsTranslation).toBe(1);
      expect(summary.counts.autoApplied).toBe(1);
      expect(summary.counts.advisory).toBe(1);
      expect(summary.counts.structural).toBe(1);
      expect(summary.counts.prop).toBe(0);
    });
  });

  describe('template edge classification (regression)', () => {
    let pageId: string;
    let summary: ChangeSummary;

    beforeAll(async () => {
      const template = await createDocumentOnBranch({
        siteId,
        branchId,
        path: '_registry/templates/marketing',
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-t', title: 'Template' } }],
          root: { props: {} },
          zones: {},
        },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const templateId = template.document.id;

      const page = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/landing',
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-t', title: 'Template' } }],
          root: { props: {} },
          zones: {},
        },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      pageId = page.document.id;

      await sql`
        INSERT INTO app.document_relations
          (source_document_id, target_document_id, relation_type, synced_version)
        VALUES (${pageId}, ${templateId}, 'template', 1)
      `;

      // Template v2: edits a prop and adds a slot.
      await createDocumentVersion({
        documentId: templateId,
        branchId,
        snapshot: {
          content: [
            { type: 'HeadingBlock', props: { id: 'HeadingBlock-t', title: 'Template v2' } },
            { type: 'FooterBlock', props: { id: 'FooterBlock-t', text: 'Footer' } },
          ],
          root: { props: {} },
          zones: {},
        },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const result = await buildChangeSummary({
        derivedDocumentId: pageId,
        branchId,
        relationType: 'template',
      });
      if (result === null) {
        throw new Error('expected a change summary for the page');
      }
      summary = result;
    });

    it('reports a template relation with the upstream template as the target', () => {
      expect(summary.relationType).toBe('template');
      expect(summary.derivedDocumentId).toBe(pageId);
      expect(summary.fromVersion).toBe(1);
      expect(summary.toVersion).toBe(2);
    });

    it('classifies changes only as structural or prop, never with localization buckets', () => {
      for (const change of summary.changes) {
        expect(['structural', 'prop']).toContain(change.classification);
        expect(change.authority).toBeUndefined();
        expect(change.translatable).toBeUndefined();
      }
      expect(summary.counts.advisory).toBe(0);
      expect(summary.counts.needsTranslation).toBe(0);
      expect(summary.counts.autoApplied).toBe(0);
    });

    it('keeps the plain structural/prop shape for a template prop change and added slot', () => {
      const propChange = findByComponent(summary, 'HeadingBlock-t', '/title');
      expect(propChange?.classification).toBe('prop');
      expect(propChange?.upstreamOldValue).toBe('Template');
      expect(propChange?.upstreamNewValue).toBe('Template v2');

      const structural = findByComponent(summary, 'FooterBlock-t', undefined);
      expect(structural?.classification).toBe('structural');
      expect(structural?.structuralKind).toBe('added');
    });
  });

  describe('editor-private config maps do not leak as drift', () => {
    it('excludes a canonical _localeTranslatable change from a localization summary', async () => {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/config-loc',
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-c', title: 'Hi' } }],
          root: { props: { title: 'Cfg', _localeTranslatable: { 'HeadingBlock-c': { title: true } } } },
          zones: {},
        },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const translation = await createTranslation({
        canonicalDocumentId: canonical.document.id,
        branchId,
        locale: 'de-DE',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      // v2 changes only the editor-private translatability map; no authored content moves.
      await createDocumentVersion({
        documentId: canonical.document.id,
        branchId,
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-c', title: 'Hi' } }],
          root: { props: { title: 'Cfg', _localeTranslatable: { 'HeadingBlock-c': { title: false } } } },
          zones: {},
        },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const summary = await buildChangeSummary({
        derivedDocumentId: translation.document.id,
        branchId,
        relationType: 'localization',
      });

      expect(summary).not.toBeNull();
      expect(summary?.changes.some((change) => change.componentId === '__root__')).toBe(false);
      expect(summary?.changes).toHaveLength(0);
      expect(summary?.counts.needsTranslation).toBe(0);
    });

    it('excludes a template _localeAuthority change from a template summary', async () => {
      const template = await createDocumentOnBranch({
        siteId,
        branchId,
        path: '_registry/templates/config-tpl',
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-a', title: 'A' } }],
          root: { props: { _localeAuthority: { 'HeadingBlock-a': 'canonical' } } },
          zones: {},
        },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const page = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/config-tpl-page',
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-a', title: 'A' } }],
          root: { props: {} },
          zones: {},
        },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      await sql`
        INSERT INTO app.document_relations
          (source_document_id, target_document_id, relation_type, synced_version)
        VALUES (${page.document.id}, ${template.document.id}, 'template', 1)
      `;

      // v2 changes only the editor-private authority map; no authored content moves.
      await createDocumentVersion({
        documentId: template.document.id,
        branchId,
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-a', title: 'A' } }],
          root: { props: { _localeAuthority: { 'HeadingBlock-a': 'locale' } } },
          zones: {},
        },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const summary = await buildChangeSummary({
        derivedDocumentId: page.document.id,
        branchId,
        relationType: 'template',
      });

      expect(summary).not.toBeNull();
      expect(summary?.changes.some((change) => change.componentId === '__root__')).toBe(false);
      expect(summary?.changes).toHaveLength(0);
    });
  });

  describe('root prop changes', () => {
    it('carries the upstream and document values for a root prop change', async () => {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/root-prop',
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-r', title: 'Hi' } }],
          root: { props: { title: 'Canonical v1' } },
          zones: {},
        },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const translation = await createTranslation({
        canonicalDocumentId: canonical.document.id,
        branchId,
        locale: 'de-DE',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      // The translator gives the root prop their own value, so the document value
      // is distinguishable from both sides of the upstream diff.
      await createDocumentVersion({
        documentId: translation.document.id,
        branchId,
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-r', title: 'Hi' } }],
          root: { props: { title: 'Übersetzt' } },
          zones: {},
        },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      await createDocumentVersion({
        documentId: canonical.document.id,
        branchId,
        snapshot: {
          content: [{ type: 'HeadingBlock', props: { id: 'HeadingBlock-r', title: 'Hi' } }],
          root: { props: { title: 'Canonical v2' } },
          zones: {},
        },
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const summary = await buildChangeSummary({
        derivedDocumentId: translation.document.id,
        branchId,
        relationType: 'localization',
      });

      expect(summary).not.toBeNull();
      const entry = findByComponent(summary!, '__root__', '/title');
      expect(entry).toBeDefined();
      expect(entry?.upstreamOldValue).toBe('Canonical v1');
      expect(entry?.upstreamNewValue).toBe('Canonical v2');
      expect(entry?.documentValue).toBe('Übersetzt');
    });
  });

  describe('resolved changes', () => {
    const SLOT = 'HeadingBlock-res';

    function snapshotWith(title: string, subtitle: string): Record<string, unknown> {
      return {
        content: [{ type: 'HeadingBlock', props: { id: SLOT, title, subtitle } }],
        root: { props: {} },
        zones: {},
      };
    }

    /** A canonical at v1 and a translation of it, pinned to that version. */
    async function setup(path: string): Promise<{ canonicalId: string; translationId: string }> {
      const canonical = await createDocumentOnBranch({
        siteId,
        branchId,
        path,
        snapshot: snapshotWith('Title v1', 'Sub v1'),
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const translation = await createTranslation({
        canonicalDocumentId: canonical.document.id,
        branchId,
        locale: 'de-DE',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      return { canonicalId: canonical.document.id, translationId: translation.document.id };
    }

    async function publish(canonicalId: string, snapshot: Record<string, unknown>): Promise<void> {
      await createDocumentVersion({
        documentId: canonicalId,
        branchId,
        snapshot,
        source: 'edit',
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
    }

    const summarise = async (
      translationId: string,
      includeResolved?: boolean,
    ): Promise<ChangeSummary> => {
      const summary = await buildChangeSummary({
        derivedDocumentId: translationId,
        branchId,
        relationType: 'localization',
        includeResolved,
      });
      expect(summary).not.toBeNull();
      return summary!;
    };

    /**
     * Settles a change against the canonical's value as it stands, which is what
     * the route does with the version the caller was shown.
     */
    const settle = async (
      translationId: string,
      canonicalId: string,
      propPath: string,
      on = branchId,
    ): Promise<void> => {
      const props = indexPropsById(await getLatestSnapshot(canonicalId, branchId)).get(SLOT);
      await setUpstreamResolutions(
        translationId,
        on,
        [{ slotId: SLOT, propPath, hash: await fingerprintValue(readAtPointer(props, propPath)) }],
        branchId,
      );
    };

    it('omits a change its resolution covers and counts it apart', async () => {
      const { canonicalId, translationId } = await setup('pages/res-omit');
      await publish(canonicalId, snapshotWith('Title v2', 'Sub v1'));

      const before = await summarise(translationId);
      expect(findByComponent(before, SLOT, '/title')).toBeDefined();
      expect(before.resolvedCount).toBe(0);

      await settle(translationId, canonicalId, '/title');

      const after = await summarise(translationId);
      expect(findByComponent(after, SLOT, '/title')).toBeUndefined();
      expect(after.resolvedCount).toBe(1);
      expect(after.counts.needsTranslation).toBe(0);
    });

    it('lists a resolved change on request, with the time it was resolved', async () => {
      const { canonicalId, translationId } = await setup('pages/res-include');
      await publish(canonicalId, snapshotWith('Title v2', 'Sub v1'));
      const before = Date.now();
      await settle(translationId, canonicalId, '/title');

      const summary = await summarise(translationId, true);
      const resolvedAt = findByComponent(summary, SLOT, '/title')?.resolvedAt ?? '';
      expect(Date.parse(resolvedAt)).toBeGreaterThanOrEqual(before);
      expect(summary.counts.needsTranslation).toBe(1);
      expect(summary.resolvedCount).toBe(1);
    });

    it('holds a resolution while the canonical leaves that prop alone', async () => {
      const { canonicalId, translationId } = await setup('pages/res-sibling');
      await publish(canonicalId, snapshotWith('Title v2', 'Sub v1'));
      await settle(translationId, canonicalId, '/title');

      await publish(canonicalId, snapshotWith('Title v2', 'Sub v3'));

      const summary = await summarise(translationId);
      expect(findByComponent(summary, SLOT, '/title')).toBeUndefined();
      expect(findByComponent(summary, SLOT, '/subtitle')).toBeDefined();
      expect(summary.resolvedCount).toBe(1);
    });

    it('returns a change to the list once the canonical moves that prop again', async () => {
      const { canonicalId, translationId } = await setup('pages/res-removed');
      await publish(canonicalId, snapshotWith('Title v2', 'Sub v1'));
      await settle(translationId, canonicalId, '/title');
      await publish(canonicalId, snapshotWith('Title v3', 'Sub v1'));

      const summary = await summarise(translationId);
      const entry = findByComponent(summary, SLOT, '/title');
      expect(entry).toBeDefined();
      expect(entry?.resolvedAt).toBeUndefined();
      expect(summary.resolvedCount).toBe(0);
    });

    it('holds a resolution the canonical moves away from and back to', async () => {
      const { canonicalId, translationId } = await setup('pages/res-revert');
      await publish(canonicalId, snapshotWith('Title v2', 'Sub v1'));
      await settle(translationId, canonicalId, '/title');

      await publish(canonicalId, snapshotWith('Title v3', 'Sub v1'));
      expect(findByComponent(await summarise(translationId), SLOT, '/title')).toBeDefined();

      await publish(canonicalId, snapshotWith('Title v2', 'Sub v1'));

      // The translation is aligned to the value the canonical holds again, so there
      // is nothing left to reconcile.
      const summary = await summarise(translationId);
      expect(findByComponent(summary, SLOT, '/title')).toBeUndefined();
      expect(summary.resolvedCount).toBe(1);
    });

    it("reads main's resolutions on a branch that has settled nothing", async () => {
      const { canonicalId, translationId } = await setup('pages/res-inherit');
      await publish(canonicalId, snapshotWith('Title v2', 'Sub v1'));
      await settle(translationId, canonicalId, '/title');

      // A branch reads the canonical it inherits from main's published version, so
      // there has to be one for the branch to have anything to compare.
      await publishDocument({
        siteId,
        branchId,
        documentId: canonicalId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });
      const other = await createBranch({
        siteId,
        name: `res-inherit-${String(Date.now())}`,
        sourceBranchId: branchId,
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const summary = await buildChangeSummary({
        derivedDocumentId: translationId,
        branchId: other.id,
        relationType: 'localization',
      });

      expect(findByComponent(summary!, SLOT, '/title')).toBeUndefined();
      expect(summary?.resolvedCount).toBe(1);
    });

    it('leaves a structural change listed', async () => {
      const { canonicalId, translationId } = await setup('pages/res-structural');
      await publish(canonicalId, {
        content: [
          { type: 'HeadingBlock', props: { id: SLOT, title: 'Title v1', subtitle: 'Sub v1' } },
          { type: 'TextBlock', props: { id: 'TextBlock-new', body: 'Added' } },
        ],
        root: { props: {} },
        zones: {},
      });
      await setUpstreamResolutions(
        translationId,
        branchId,
        [{ slotId: 'TextBlock-new', propPath: '/body', hash: await fingerprintValue('Added') }],
      );

      const summary = await summarise(translationId);
      expect(findByComponent(summary, 'TextBlock-new')?.structuralKind).toBe('added');
      expect(summary.counts.structural).toBe(1);
    });
  });

  describe('missing edge', () => {
    it('returns null when the document has no edge of the requested relation type', async () => {
      const orphan = await createDocumentOnBranch({
        siteId,
        branchId,
        path: 'pages/orphan',
        snapshot: { content: [], root: { props: {} }, zones: {} },
        createdById: TEST_USER_ID,
        createdByType: 'user',
      });

      const result = await buildChangeSummary({
        derivedDocumentId: orphan.document.id,
        branchId,
        relationType: 'localization',
      });
      expect(result).toBeNull();
    });
  });
});
