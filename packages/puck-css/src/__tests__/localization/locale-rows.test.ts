// @vitest-environment node
/**
 * Locale rows
 *
 * The switcher's list: one row per market the site publishes in, each either
 * pointing at a document that exists or offering to create it. The canonical is
 * the origin every row is measured against, so the rows are the same whether the
 * canonical or one of its translations is open.
 */

import { describe, it, expect } from 'vitest';
import type { Document } from '@pantheon-systems/css-client';
import { buildLocaleRows } from '../../features/localization/locale-rows.js';

const canonical = {
  id: 'doc-canonical',
  siteId: 'site-1',
  path: 'pricing',
  createdAt: '2026-07-07T10:00:00.000Z',
} as Document;

function variant(id: string, locale: string): Document {
  return {
    id,
    siteId: 'site-1',
    path: `pricing.${locale}`,
    locale,
    localizedFromId: canonical.id,
    createdAt: '2026-07-07T10:00:00.000Z',
  } as Document;
}

const markets = ['fr-FR', 'de-DE', 'ja-JP'];

describe('buildLocaleRows', () => {
  it('lists a row for every market the site publishes in', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [],
      currentDocumentId: canonical.id,
    });

    expect(rows.filter((r) => r.locale !== null).map((r) => r.locale)).toEqual(markets);
  });

  it('keeps the markets in the order the site configured them', () => {
    const rows = buildLocaleRows({
      markets: ['ja-JP', 'de-DE', 'fr-FR'],
      canonical,
      variants: [],
      currentDocumentId: canonical.id,
    });

    expect(rows.filter((r) => r.locale !== null).map((r) => r.locale)).toEqual([
      'ja-JP',
      'de-DE',
      'fr-FR',
    ]);
  });

  it('points a market with a translation at the document to open', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [variant('doc-fr', 'fr-FR')],
      currentDocumentId: canonical.id,
    });

    const fr = rows.find((r) => r.locale === 'fr-FR');
    expect(fr?.state).toBe('exists');
    expect(fr?.documentId).toBe('doc-fr');
  });

  it('offers a market with no translation for creation, naming no document', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [variant('doc-fr', 'fr-FR')],
      currentDocumentId: canonical.id,
    });

    const ja = rows.find((r) => r.locale === 'ja-JP');
    expect(ja?.state).toBe('available');
    expect(ja?.documentId).toBeNull();
  });

  it('marks the open document as current', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [variant('doc-fr', 'fr-FR')],
      currentDocumentId: 'doc-fr',
    });

    expect(rows.find((r) => r.locale === 'fr-FR')?.state).toBe('current');
  });

  it('gives the same rows whether the canonical or one of its translations is open', () => {
    const variants = [variant('doc-fr', 'fr-FR')];
    const fromCanonical = buildLocaleRows({
      markets,
      canonical,
      variants,
      currentDocumentId: canonical.id,
    });
    const fromTranslation = buildLocaleRows({
      markets,
      canonical,
      variants,
      currentDocumentId: 'doc-fr',
    });

    expect(fromTranslation.map((r) => r.locale)).toEqual(fromCanonical.map((r) => r.locale));
    expect(fromTranslation.map((r) => r.documentId)).toEqual(
      fromCanonical.map((r) => r.documentId),
    );
  });

  it('leads with the untagged canonical when it carries no locale', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [],
      currentDocumentId: canonical.id,
    });

    expect(rows[0]).toMatchObject({
      locale: null,
      documentId: canonical.id,
      state: 'current',
    });
  });

  it('lists a canonical born in a market as that market, not as a second row', () => {
    const bornInMarket = { ...canonical, locale: 'fr-FR' } as Document;
    const rows = buildLocaleRows({
      markets,
      canonical: bornInMarket,
      variants: [],
      currentDocumentId: bornInMarket.id,
    });

    expect(rows.filter((r) => r.locale === null)).toEqual([]);
    const fr = rows.find((r) => r.locale === 'fr-FR');
    expect(fr?.documentId).toBe(bornInMarket.id);
    expect(fr?.state).toBe('current');
    expect(rows.filter((r) => r.documentId === bornInMarket.id)).toHaveLength(1);
  });

  it('keeps a translation in a locale the site no longer publishes reachable', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [variant('doc-es', 'es-ES')],
      currentDocumentId: canonical.id,
    });

    const es = rows.find((r) => r.locale === 'es-ES');
    expect(es?.state).toBe('exists');
    expect(es?.documentId).toBe('doc-es');
  });

  it('lists an unconfigured locale after the markets, so the registry leads', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [variant('doc-es', 'es-ES')],
      currentDocumentId: canonical.id,
    });

    expect(rows[rows.length - 1]?.locale).toBe('es-ES');
  });

  it('keeps a canonical in a locale the site does not publish reachable', () => {
    const offMarket = { ...canonical, locale: 'es-ES' } as Document;
    const rows = buildLocaleRows({
      markets,
      canonical: offMarket,
      variants: [],
      currentDocumentId: offMarket.id,
    });

    const es = rows.find((r) => r.locale === 'es-ES');
    expect(es?.documentId).toBe(offMarket.id);
    expect(es?.state).toBe('current');
    expect(rows.filter((r) => r.locale === null)).toEqual([]);
    expect(rows.filter((r) => r.documentId === offMarket.id)).toHaveLength(1);
  });

  it('reaches an unpublished canonical from one of its translations', () => {
    const offMarket = { ...canonical, locale: 'es-ES' } as Document;
    const rows = buildLocaleRows({
      markets,
      canonical: offMarket,
      variants: [variant('doc-fr', 'fr-FR')],
      currentDocumentId: 'doc-fr',
    });

    expect(rows.find((r) => r.locale === 'es-ES')).toMatchObject({
      documentId: offMarket.id,
      state: 'exists',
    });
  });

  it('reaches both pages where two share an off-market locale', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [variant('doc-es-a', 'es-ES'), variant('doc-es-b', 'es-ES')],
      currentDocumentId: canonical.id,
    });

    expect(rows.filter((r) => r.locale === 'es-ES')).toEqual([
      { locale: 'es-ES', documentId: 'doc-es-a', state: 'exists' },
      { locale: 'es-ES', documentId: 'doc-es-b', state: 'exists' },
    ]);
  });

  it('reaches both pages where two share a market', () => {
    const rows = buildLocaleRows({
      markets,
      canonical,
      variants: [variant('doc-fr-a', 'fr-FR'), variant('doc-fr-b', 'fr-FR')],
      currentDocumentId: 'doc-fr-b',
    });

    expect(rows.filter((r) => r.locale === 'fr-FR')).toEqual([
      { locale: 'fr-FR', documentId: 'doc-fr-a', state: 'exists' },
      { locale: 'fr-FR', documentId: 'doc-fr-b', state: 'current' },
    ]);
  });

  it('lists a canonical alongside a variant that took its market', () => {
    const bornInMarket = { ...canonical, locale: 'fr-FR' } as Document;
    const rows = buildLocaleRows({
      markets,
      canonical: bornInMarket,
      variants: [variant('doc-fr', 'fr-FR')],
      currentDocumentId: bornInMarket.id,
    });

    expect(rows.filter((r) => r.locale === 'fr-FR')).toEqual([
      { locale: 'fr-FR', documentId: bornInMarket.id, state: 'current' },
      { locale: 'fr-FR', documentId: 'doc-fr', state: 'exists' },
    ]);
  });

  it('offers no markets when the site publishes in none', () => {
    const rows = buildLocaleRows({
      markets: [],
      canonical,
      variants: [],
      currentDocumentId: canonical.id,
    });

    expect(rows).toEqual([
      { locale: null, documentId: canonical.id, state: 'current' },
    ]);
  });
});
