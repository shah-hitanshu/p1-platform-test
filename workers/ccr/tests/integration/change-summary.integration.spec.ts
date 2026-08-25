/**
 * Change summary - Integration Tests
 *
 * Exercises the relation-generic upstream-diff core and its classification layer
 * against a real PostgreSQL database. A change summary reports how a document's
 * upstream (the edge target) drifted between the version the document is synced to
 * and the target's current version, and classifies each change into one of the
 * localization buckets (or the plain structural/prop buckets for a template edge).
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
import { setAuthorityOverride } from '../../src/services/relations-service';
import {
  buildChangeSummary,
  type ChangeSummary,
  type ChangeSummaryEntry,
} from '../../src/services/change-summary-service';

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
        sourceDocumentId: translationId,
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
      expect(summary.sourceDocumentId).toBe(translationId);
      expect(summary.targetDocumentId).toBe(canonicalId);
      expect(summary.fromVersion).toBe(1);
      expect(summary.toVersion).toBe(2);
    });

    it('classifies a canonical-authority translatable prop change as needsTranslation', () => {
      const change = findByComponent(summary, 'HeadingBlock-1', '/title');
      expect(change).toBeDefined();
      expect(change?.classification).toBe('needsTranslation');
      expect(change?.authority).toBe('canonical');
      expect(change?.translatable).toBe(true);
      expect(change?.templateOldValue).toBe('Hello');
      expect(change?.templateNewValue).toBe('Hello EDITED');
      expect(change?.documentValue).toBe('Hello');
    });

    it('classifies a canonical-authority non-translatable prop change as autoApplied', () => {
      const change = findByComponent(summary, 'DateBlock-1', '/date');
      expect(change).toBeDefined();
      expect(change?.classification).toBe('autoApplied');
      expect(change?.authority).toBe('canonical');
      expect(change?.translatable).toBe(false);
      expect(change?.templateNewValue).toBe('2026-02-02');
    });

    it('classifies a locale-authority (edge override) prop change as advisory', () => {
      const change = findByComponent(summary, 'PriceBlock-1', '/price');
      expect(change).toBeDefined();
      expect(change?.classification).toBe('advisory');
      expect(change?.authority).toBe('locale');
      expect(change?.templateNewValue).toBe('20');
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
        sourceDocumentId: pageId,
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
      expect(summary.sourceDocumentId).toBe(pageId);
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
      expect(propChange?.templateOldValue).toBe('Template');
      expect(propChange?.templateNewValue).toBe('Template v2');

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
        sourceDocumentId: translation.document.id,
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
        sourceDocumentId: page.document.id,
        branchId,
        relationType: 'template',
      });

      expect(summary).not.toBeNull();
      expect(summary?.changes.some((change) => change.componentId === '__root__')).toBe(false);
      expect(summary?.changes).toHaveLength(0);
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
        sourceDocumentId: orphan.document.id,
        branchId,
        relationType: 'localization',
      });
      expect(result).toBeNull();
    });
  });
});
