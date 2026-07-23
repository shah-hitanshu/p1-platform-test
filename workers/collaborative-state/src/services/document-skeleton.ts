/**
 * Backend skeleton generation from a content-shaped template.
 *
 * A document created from a template inherits the template's component slot
 * ids: the backend deep-copies the template's content and zones, preserving
 * each component's props.id, and seeds a fresh root from the document's own
 * metadata. Template-authoring root props (the pin map and template
 * descriptor) do not carry into the created document.
 *
 * @see PROPOSAL-015 Design 2, 3, 4
 */

import { type DocumentComponent } from './component-identity';

/**
 * The initial snapshot for a document created from a template.
 */
export interface DocumentSkeleton {
  content: DocumentComponent[];
  zones: Record<string, DocumentComponent[]>;
  root: { props: Record<string, unknown> };
}

/**
 * Document-level metadata used to seed the skeleton's root props. Only
 * fields present here reach `root.props`; the template's own root props
 * (name, label, `_pinMap`, `_template`, ...) never do.
 */
export interface DocumentSkeletonMeta {
  title?: string;
}

/**
 * Builds a document's initial version from a template snapshot: content and
 * zones are deep-copied so component slot ids and props survive verbatim,
 * while root props are seeded fresh from `meta` instead of the template's
 * authoring metadata.
 *
 * A `templateSnapshot` that is not a content-shaped object (for example, the
 * pre-cutover `{ components: [...] }` manifest) yields an empty skeleton
 * rather than an error, since this builder only targets the content shape.
 */
export function buildDocumentSkeletonFromTemplate(
  templateSnapshot: unknown,
  meta: DocumentSkeletonMeta = {},
): DocumentSkeleton {
  const root: { props: Record<string, unknown> } = { props: {} };
  if (meta.title !== undefined) {
    root.props.title = meta.title;
  }

  if (typeof templateSnapshot !== 'object' || templateSnapshot === null || Array.isArray(templateSnapshot)) {
    return { content: [], zones: {}, root };
  }

  const { content, zones } = templateSnapshot as { content?: unknown; zones?: unknown };

  const clonedContent = Array.isArray(content) ? (structuredClone(content) as DocumentComponent[]) : [];
  const clonedZones =
    typeof zones === 'object' && zones !== null && !Array.isArray(zones)
      ? (structuredClone(zones) as Record<string, DocumentComponent[]>)
      : {};

  return { content: clonedContent, zones: clonedZones, root };
}
