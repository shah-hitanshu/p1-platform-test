/**
 * Locale Rows
 *
 * The switcher's list, built from the site's markets and the variants a
 * canonical page holds. Rows are measured from the canonical rather than from
 * the open document, so a translation sees the same set its canonical does and
 * "add a locale" means the same thing wherever the editor is standing.
 */

import type { Document } from '@pantheon-systems/css-client';

/**
 * `exists` names a document to open, `available` offers to create one, and
 * `current` is the document already open.
 */
export type LocaleRowState = 'current' | 'exists' | 'available';

export interface LocaleRow {
  /** The market this row publishes, or null for the canonical's untagged page. */
  locale: string | null;
  /** The document to open, or null when this locale has none yet. */
  documentId: string | null;
  state: LocaleRowState;
}

export interface BuildLocaleRowsParams {
  /** The site's configured markets, in the order editors should see them. */
  markets: string[];
  canonical: Document;
  /** The canonical's locale variants. */
  variants: Document[];
  currentDocumentId: string | null;
}

export function buildLocaleRows({
  markets,
  canonical,
  variants,
  currentDocumentId,
}: BuildLocaleRowsParams): LocaleRow[] {
  const state = (documentId: string | null): LocaleRowState => {
    if (documentId === null) return 'available';
    return documentId === currentDocumentId ? 'current' : 'exists';
  };

  // A canonical authored directly in a market is that market's page, so it is
  // considered alongside the variants: without it the market would list as
  // available and offer to create a second one.
  const documents = [canonical, ...variants];

  // Nothing bounds a locale to one document. Every document carrying it gets a
  // row, so neither of two pages in the same locale becomes unreachable.
  const documentsIn = (locale: string): Document[] =>
    documents.filter((document) => document.locale === locale);

  const rows: LocaleRow[] = [];

  if (canonical.locale == null) {
    rows.push({ locale: null, documentId: canonical.id, state: state(canonical.id) });
  }

  for (const locale of markets) {
    const held = documentsIn(locale);
    if (held.length === 0) {
      rows.push({ locale, documentId: null, state: 'available' });
      continue;
    }
    for (const document of held) {
      rows.push({ locale, documentId: document.id, state: state(document.id) });
    }
  }

  // A locale can exist on a document the registry no longer names — the backend
  // does not bound writes to the markets. Listing it last keeps it reachable
  // without displacing a market from the order the site configured.
  for (const document of documents) {
    const locale = document.locale;
    if (locale == null || markets.includes(locale)) continue;
    rows.push({ locale, documentId: document.id, state: state(document.id) });
  }

  return rows;
}
