/**
 * PROPOSAL-014 §7: one-time backfill from the legacy `{ components }`
 * manifest shape to the content shape (`{ content, root, zones }`) for
 * existing template documents.
 */

import { query } from '../db';
import { createDocumentVersion } from './document-version-service';
import { escapeLikePattern } from './document-types';

const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

interface ManifestComponent {
  type: string;
  pinned?: boolean;
  defaultProps?: Record<string, unknown>;
}

interface ManifestSnapshot {
  name?: string;
  label: string;
  description?: string;
  defaultUrlPattern?: string;
  deprecated?: boolean;
  components: ManifestComponent[];
}

interface ContentComponent {
  type: string;
  props: Record<string, unknown>;
}

interface ContentTemplateMetadata {
  label: string;
  description?: string;
  defaultUrlPattern?: string;
  deprecated: boolean;
}

interface ContentSnapshot {
  content: ContentComponent[];
  root: {
    props: {
      _template: ContentTemplateMetadata;
      _pinMap: Record<string, boolean>;
    };
  };
  zones: Record<string, unknown>;
}

/**
 * True when a snapshot is the legacy `{ components }` manifest shape rather
 * than Puck content data.
 */
export function isManifestShapedSnapshot(snapshot: unknown): snapshot is ManifestSnapshot {
  if (typeof snapshot !== 'object' || snapshot === null) return false;
  const candidate = snapshot as { components?: unknown; content?: unknown };
  return Array.isArray(candidate.components) && !Array.isArray(candidate.content);
}

/**
 * Generates a component id in the `{type}-{suffix}` style Puck assigns client-side.
 */
function generateComponentId(type: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${type}-${suffix}`;
}

/**
 * Converts a manifest-shaped template snapshot to the content shape
 * (PROPOSAL-014 §1). Each manifest component becomes a `content` entry with
 * a generated id; `pinned` flags move into `root.props._pinMap`; `label`,
 * `description`, `defaultUrlPattern`, and `deprecated` move into
 * `root.props._template`. The manifest's `name` is dropped.
 */
export function convertManifestToContent(manifest: ManifestSnapshot): ContentSnapshot {
  const pinMap: Record<string, boolean> = {};

  const content: ContentComponent[] = manifest.components.map((component) => {
    const id = generateComponentId(component.type);
    if (component.pinned === true) {
      pinMap[id] = true;
    }
    return {
      type: component.type,
      props: { ...component.defaultProps, id },
    };
  });

  const template: ContentTemplateMetadata = {
    label: manifest.label,
    ...(manifest.description !== undefined && { description: manifest.description }),
    ...(manifest.defaultUrlPattern !== undefined && { defaultUrlPattern: manifest.defaultUrlPattern }),
    deprecated: manifest.deprecated ?? false,
  };

  return {
    content,
    root: { props: { _template: template, _pinMap: pinMap } },
    zones: {},
  };
}

interface BackfillCandidateRow {
  document_id: string;
  branch_id: string;
  path: string;
  snapshot: Record<string, unknown> | null;
}

/**
 * A template document's latest version on a given branch.
 */
export interface BackfillEntry {
  documentId: string;
  branchId: string;
  path: string;
}

export interface TemplateContentBackfillResult {
  converted: BackfillEntry[];
  skipped: BackfillEntry[];
}

export interface BackfillTemplateContentShapeOptions {
  /** Report candidates without writing new versions. @default false */
  dryRun?: boolean;
}

/**
 * Converts every template document's latest manifest-shaped snapshot to the
 * content shape, writing one new version per (document, branch) pair through
 * the normal document version machinery. Snapshots already in the content
 * shape are left untouched, and older versions are never rewritten, so
 * repeat runs are a no-op.
 */
export async function backfillTemplateContentShape(
  options: BackfillTemplateContentShapeOptions = {},
): Promise<TemplateContentBackfillResult> {
  const { dryRun = false } = options;

  const templatePathPattern = escapeLikePattern('_registry/templates/') + '%';

  const candidates = await query<BackfillCandidateRow>(
    `SELECT dv.document_id, dv.branch_id, d.path, dv.snapshot
     FROM app.document_versions dv
     INNER JOIN app.documents d ON d.id = dv.document_id
     WHERE d.path LIKE $1 ESCAPE '\\'
       AND d.archived_at IS NULL
       AND dv.is_tombstone = false
       AND dv.snapshot IS NOT NULL
       AND dv.version_number = (
         SELECT MAX(dv2.version_number)
         FROM app.document_versions dv2
         WHERE dv2.document_id = dv.document_id AND dv2.branch_id = dv.branch_id
       )`,
    [templatePathPattern],
  );

  const result: TemplateContentBackfillResult = { converted: [], skipped: [] };

  for (const candidate of candidates.rows) {
    const entry: BackfillEntry = {
      documentId: candidate.document_id,
      branchId: candidate.branch_id,
      path: candidate.path,
    };

    if (!isManifestShapedSnapshot(candidate.snapshot)) {
      result.skipped.push(entry);
      continue;
    }

    if (!dryRun) {
      await createDocumentVersion({
        documentId: candidate.document_id,
        branchId: candidate.branch_id,
        snapshot: convertManifestToContent(candidate.snapshot),
        source: 'edit',
        createdById: SYSTEM_UUID,
        createdByType: 'system',
        // A shape conversion, not an authored edit: action_type stays null so a
        // migration spanning this version propagates no delta to bound pages.
        forceNonStructural: true,
      });
    }

    result.converted.push(entry);
  }

  return result;
}
