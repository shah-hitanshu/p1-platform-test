/**
 * Document Relation
 *
 * Whether a document derives from another one, which is what every localization
 * control gates on. A document's locale says which language it is written in and
 * nothing about what it inherits — a site may author its canonical pages in a
 * locale — so the page it was localized from is the only thing that answers this.
 */

import type { Document } from '@pantheon-systems/css-client';

/** The document is a translation: it was localized from a canonical page. */
export function isTranslationDocument(document: Document | null | undefined): boolean {
  return document?.localizedFromId != null;
}

/** The document is a canonical page: it exists and was localized from nothing. */
export function isCanonicalDocument(document: Document | null | undefined): boolean {
  return Boolean(document) && document?.localizedFromId == null;
}

/** The document derives from a content-type template. */
export function isTemplateDerivedDocument(document: Document | null | undefined): boolean {
  return document?.templateId != null;
}

/**
 * The document has an upstream along the given edge. A translation is localized
 * from a canonical; a page bound to a content-type template derives from that
 * template. Each edge answers this from its own field.
 */
export function derivesFromUpstream(
  relationType: 'localization' | 'template',
  document: Document | null | undefined,
): boolean {
  return relationType === 'template'
    ? isTemplateDerivedDocument(document)
    : isTranslationDocument(document);
}
