/**
 * A document reports the document it was localized from, so a client can tell a
 * translation from a canonical without inferring it from the locale column. It is
 * the pair to `templateId`: both name the upstream on one relation type, and both
 * are absent when there is no such edge.
 *
 * Locale and upstream are independent: a page authored directly in a market locale
 * carries a locale and derives from nothing, and a translation carries both. Only
 * the localization edge decides, which is why this is always reported — explicitly
 * null rather than left off, so an absent field cannot be read as "canonical" by a
 * client talking to something that never sends it.
 */

import { describe, it, expect } from 'vitest';
import { mapRowToDocument } from '../../src/services/document-types';
import {
  DOCUMENT_READ_COLUMNS,
  DOCUMENT_READ_JOINS,
} from '../../src/services/document-queries';

function row(overrides: Record<string, unknown> = {}): never {
  return {
    id: 'doc-1',
    site_id: 'site-1',
    path: 'pages/home',
    created_at: '2026-07-07T10:00:00.000Z',
    archived_at: null,
    ...overrides,
  } as never;
}

describe('the document a document was localized from', () => {
  it('is null when no localization edge points at the document', () => {
    expect(mapRowToDocument(row({ localized_from_id: null })).localizedFromId).toBeNull();
  });

  it('is null when the read supplied no upstream column at all', () => {
    expect(mapRowToDocument(row()).localizedFromId).toBeNull();
  });

  it('names the upstream document when an edge points at it', () => {
    const doc = mapRowToDocument(row({ localized_from_id: 'doc-canonical', locale: 'fr-FR' }));
    expect(doc.localizedFromId).toBe('doc-canonical');
  });

  it('is null for a page authored in a locale with no upstream', () => {
    const doc = mapRowToDocument(row({ locale: 'ja', localized_from_id: null }));
    expect(doc.locale).toBe('ja');
    expect(doc.localizedFromId).toBeNull();
  });

  it('is independent of the template the document derives from', () => {
    const doc = mapRowToDocument(
      row({ template_id: 'doc-template', localized_from_id: 'doc-canonical' }),
    );
    expect(doc.templateId).toBe('doc-template');
    expect(doc.localizedFromId).toBe('doc-canonical');
  });
});

describe('the document read', () => {
  it('selects the localization upstream alongside the template relation', () => {
    expect(DOCUMENT_READ_COLUMNS).toContain('localized_from_id');
    expect(DOCUMENT_READ_COLUMNS).toContain('template_id');
  });

  it('joins each relation on the derived side under its own alias', () => {
    expect(DOCUMENT_READ_JOINS).toContain("relation_type = 'localization'");
    expect(DOCUMENT_READ_JOINS).toContain("relation_type = 'template'");
    expect(DOCUMENT_READ_JOINS).toContain('lr.source_document_id = d.id');
  });
});
