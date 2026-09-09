/**
 * The one place a document's content is cloned for insertion into another
 * document. Duplicating a page and seeding a translation both need the same
 * three steps, and drifted apart while each owned its own copy of them.
 */

import { query } from '../db';
import { getFirstRow } from './checkpoint-mappers';
import { isUniqueConstraintViolation } from './document-types';
import type { DocumentRow, DocumentVersionRow } from './document-types';
import {
  getLatestDocumentVersionWithFallback,
  reconstructVersionSnapshot,
} from './document-version-service';
import { enforceUniqueSlotIds } from './slot-id-backstop';
import { DuplicateDocumentPathError } from './errors';

/** A cloned snapshot, and the version it was taken from. */
export interface ClonedSnapshot {
  snapshot: Record<string, unknown>;
  versionNumber: number;
  /** The source version's id, which names it on whichever branch holds it. */
  versionId: string;
}

/**
 * Reads a document's latest version on a branch and returns its snapshot,
 * deep-cloned and safe to insert as another document's version 1. Pass
 * `mainBranchId` to inherit main's published content when the branch holds no
 * version of its own; omit it to read the branch alone.
 *
 * Returns null when there is nothing to clone — no version, or a diff chain
 * that cannot be rebuilt. Callers decide which error that is.
 */
export async function cloneLatestSnapshot(
  documentId: string,
  branchId: string,
  mainBranchId: string = branchId,
): Promise<ClonedSnapshot | null> {
  const latest = await getLatestDocumentVersionWithFallback(documentId, branchId, mainBranchId);
  if (latest === null) {
    return null;
  }

  const stored = latest.version.snapshot as Record<string, unknown> | null | undefined;
  const source =
    stored ??
    (await reconstructVersionSnapshot(
      documentId,
      // An inherited version lives on main, and so does the diff chain behind
      // it. Rebuilding it against the branch finds nothing.
      latest.inherited ? mainBranchId : branchId,
      latest.version.versionNumber,
    ));
  if (source === null) {
    return null;
  }

  // Cloning a valid snapshot leaves every slot id in place; the backstop only
  // re-mints ids that collide within a single document.
  return {
    snapshot: enforceUniqueSlotIds(documentId, structuredClone(source)),
    versionNumber: latest.version.versionNumber,
    versionId: latest.version.id,
  };
}

/** A new document and the content it starts life with. */
export interface InsertDocumentWithVersionParams {
  siteId: string;
  path: string;
  /** The language the document is authored in; null for an unlocalized one. */
  locale?: string | null;
  branchId: string;
  snapshot: Record<string, unknown>;
  createdById: string;
  createdByType: 'user' | 'agent' | 'service';
}

/**
 * Inserts a document and the version 1 holding its content. Callers add
 * whatever relation makes the new document what it is — a template edge, a
 * localization edge — once they have the row back.
 *
 * The version rows come back unwrapped: only a caller that needs the inserted
 * version has reason to insist one came back.
 *
 * @throws DuplicateDocumentPathError if another document already holds the path
 */
export async function insertDocumentWithVersion(
  params: InsertDocumentWithVersionParams,
): Promise<{ row: DocumentRow; versionRows: DocumentVersionRow[] }> {
  let row: DocumentRow;
  try {
    const inserted = await query<DocumentRow>(
      `INSERT INTO app.documents (site_id, path, locale)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [params.siteId, params.path, params.locale ?? null],
    );
    row = getFirstRow(inserted.rows);
  } catch (error) {
    // A caller finding the path free and this insert are not one step, so
    // another document can claim it in between.
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateDocumentPathError(params.path, params.siteId);
    }
    throw error;
  }

  const versions = await query<DocumentVersionRow>(
    `INSERT INTO app.document_versions (
       document_id, branch_id, version_number, snapshot,
       source, created_by_id, created_by_type
     )
     VALUES ($1, $2, 1, $3, 'edit', $4, $5)
     RETURNING *`,
    [row.id, params.branchId, params.snapshot, params.createdById, params.createdByType],
  );

  return { row, versionRows: versions.rows };
}
