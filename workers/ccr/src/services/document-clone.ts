/**
 * The one place a document's content is cloned for insertion into another
 * document. Duplicating a page and seeding a translation both need the same
 * three steps, and drifted apart while each owned its own copy of them.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/scope';
import { driverErrorCode, violatedConstraint } from '../db/driver-error';
import { getFirstRow } from './checkpoint-mappers';
import { isUniqueConstraintViolation } from './document-types';
import type { DocumentRow, DocumentVersionRow } from './document-types';
import {
  getLatestDocumentVersionWithFallback,
  reconstructVersionSnapshot,
} from './document-version-service';
import { enforceUniqueSlotIds } from './slot-id-backstop';
import { DuplicateDocumentPathError, VersionReconstructionError } from './errors';

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

/**
 * Reads one named version of a document and returns its snapshot, deep-cloned and
 * safe to insert as another document's content. A version id names a version on
 * whichever branch holds it, so `branchIds` says which of those branches the
 * caller may read: content on a branch outside that list is unreleased work
 * belonging to whoever holds it.
 *
 * Returns null when no version of this document on one of those branches has that
 * id, or when its diff chain cannot be rebuilt.
 */
export async function cloneSnapshotAtVersion(
  documentId: string,
  versionId: string,
  branchIds: string[],
): Promise<ClonedSnapshot | null> {
  const found = await db().execute<{
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown> | null;
  }>(sql`
    SELECT branch_id, version_number, snapshot
      FROM app.document_versions
     WHERE id = ${versionId} AND document_id = ${documentId}
       AND branch_id = ANY(${sql.param(branchIds)}::uuid[])`);
  const row = found[0];
  if (row === undefined) {
    return null;
  }

  const source = row.snapshot ?? (await rebuildOrNull(documentId, row));
  if (source === null) {
    return null;
  }

  return {
    snapshot: enforceUniqueSlotIds(documentId, structuredClone(source)),
    versionNumber: row.version_number,
    versionId,
  };
}

/**
 * Rebuilds a version stored as a diff, reporting a chain too damaged to replay as
 * nothing to clone rather than as an error. A caller naming one version out of a
 * document's history has somewhere else to read from; the read failing is not the
 * failure of whatever it was asked to do.
 */
async function rebuildOrNull(
  documentId: string,
  row: { branch_id: string; version_number: number },
): Promise<Record<string, unknown> | null> {
  try {
    // A version stored as a diff rebuilds against the branch holding it, which is
    // the branch the version id resolved to rather than any caller's.
    return await reconstructVersionSnapshot(documentId, row.branch_id, row.version_number);
  } catch (error) {
    if (error instanceof VersionReconstructionError) {
      return null;
    }
    throw error;
  }
}

/** An existing document and the content a branch starts its own history of it with. */
export interface InsertVersionOnBranchParams {
  documentId: string;
  branchId: string;
  snapshot: Record<string, unknown>;
  createdById: string;
  createdByType: 'user' | 'agent' | 'service';
}

/**
 * Appends a version of an existing document on one branch, numbered after whatever
 * that branch already holds of it. Version numbers run per branch, so a branch
 * holding none of the document starts at 1 however long the document's history
 * elsewhere.
 *
 * The number comes from a read of the current maximum, so two writers of the same
 * document and branch can choose the same one. Holding the document row locked
 * serializes callers that take that lock against each other; the ordinary version
 * write does not take it, and absorbs the collision itself. A caller that cannot
 * be serialized against every other writer handles the rejection instead, which
 * {@link isVersionNumberCollision} recognizes.
 */
export async function insertVersionOnBranch(
  params: InsertVersionOnBranchParams,
): Promise<DocumentVersionRow[]> {
  const versions = await db().execute<DocumentVersionRow>(sql`
    INSERT INTO app.document_versions (
       document_id, branch_id, version_number, snapshot,
       source, created_by_id, created_by_type
     )
     SELECT ${params.documentId}, ${params.branchId},
            COALESCE(MAX(version_number), 0) + 1, ${JSON.stringify(params.snapshot)},
            'edit', ${params.createdById}, ${params.createdByType}
       FROM app.document_versions
      WHERE document_id = ${params.documentId} AND branch_id = ${params.branchId}
     RETURNING *`);
  return [...versions];
}

/** The unique constraint that makes a version number unrepeatable per branch. */
const VERSION_NUMBER_CONSTRAINT = 'document_versions_document_id_branch_id_version_number_key';

/**
 * Whether a rejected write is two writers having chosen one document, branch and
 * version number. The number is the whole of what went wrong: the content was
 * acceptable and a later number is free, so a caller can number it again.
 *
 * The constraint is named rather than the SQLSTATE matched alone, so a duplicate
 * path or any other unique constraint on the way stays the failure it is.
 */
export function isVersionNumberCollision(error: unknown): boolean {
  return (
    driverErrorCode(error) === '23505' && violatedConstraint(error) === VERSION_NUMBER_CONSTRAINT
  );
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
    const inserted = await db().execute<DocumentRow>(sql`
      INSERT INTO app.documents (site_id, path, locale)
       VALUES (${params.siteId}, ${params.path}, ${params.locale ?? null})
       RETURNING *`);
    row = getFirstRow(inserted);
  } catch (error) {
    // A caller finding the path free and this insert are not one step, so
    // another document can claim it in between.
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicateDocumentPathError(params.path, params.siteId);
    }
    throw error;
  }

  const versions = await db().execute<DocumentVersionRow>(sql`
    INSERT INTO app.document_versions (
       document_id, branch_id, version_number, snapshot,
       source, created_by_id, created_by_type
     )
     VALUES (${row.id}, ${params.branchId}, 1, ${JSON.stringify(params.snapshot)},
             'edit', ${params.createdById}, ${params.createdByType})
     RETURNING *`);

  return { row, versionRows: [...versions] };
}
