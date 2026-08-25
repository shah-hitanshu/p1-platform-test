/**
 * Backend skeleton generation from a content-shaped template.
 *
 * A document created from a template inherits the template's component slot
 * ids: the backend deep-copies the template's content and zones, preserving
 * each component's props.id, and seeds a fresh root from the document's own
 * metadata. Template-authoring root props (the pin map and template
 * descriptor) do not carry into the created document; the inheritable ones
 * carry through an explicit allow-list.
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
 * Document-level metadata used to seed the skeleton's root props, alongside
 * the template root props named in `INHERITED_TEMPLATE_ROOT_PROPS`. The
 * template's authoring-only root props (name, label, `_pinMap`, `_template`,
 * ...) never reach `root.props`.
 */
export interface DocumentSkeletonMeta {
  title?: string;
}

/**
 * Root props a document inherits from its template, as opposed to the
 * authoring-only ones. `_meta` holds the template's page-metadata defaults, so a
 * page created from it starts with those values and can override any of them.
 */
const INHERITED_TEMPLATE_ROOT_PROPS = ['_meta'] as const;

/**
 * Builds a document's initial version from a template snapshot: content and
 * zones are deep-copied so component slot ids and props survive verbatim,
 * while root props are seeded fresh from `meta` plus the inheritable subset of
 * the template's own root props.
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

  const templateRootProps = (templateSnapshot as { root?: { props?: Record<string, unknown> } }).root?.props;
  for (const key of INHERITED_TEMPLATE_ROOT_PROPS) {
    const value = templateRootProps?.[key];
    // Object-valued by contract; anything else is malformed and not inherited.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      root.props[key] = structuredClone(value);
    }
  }

  const clonedContent = Array.isArray(content) ? (structuredClone(content) as DocumentComponent[]) : [];
  const clonedZones =
    typeof zones === 'object' && zones !== null && !Array.isArray(zones)
      ? (structuredClone(zones) as Record<string, DocumentComponent[]>)
      : {};

  return { content: clonedContent, zones: clonedZones, root };
}
