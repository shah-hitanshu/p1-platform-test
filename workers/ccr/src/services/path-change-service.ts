import { sql } from 'drizzle-orm';
import { db } from '../db/scope';

/**
 * A document at a different effective path on the source branch than on the
 * target. Travels beside content changes, never inside them — see spec D1a.
 */
export interface PathChange {
  documentId: string;
  documentPath: string;
  baseDocumentPath: string;
}

type PathChangeRow = {
  document_id: string;
  document_path: string;
  base_document_path: string;
};

/**
 * Effective path is COALESCE(override, global) per branch, matching F1's
 * resolution order. A document that exists on source but not on target is
 * omitted: that is a New page, not a Moved one.
 *
 * A path change needs an override on one of the two branches, so the candidate
 * set comes from the override table (indexed by branch) and documents are
 * reached by primary key. Starting from app.documents instead would scan every
 * document in every site.
 */
export async function getPathChangesSince(
  sourceBranchId: string,
  targetBranchId: string,
): Promise<PathChange[]> {
  // The candidate subquery, the two aliased self-joins against
  // branch_document_paths, and the COALESCE-based diff have no natural builder
  // form, so this stays a raw statement (D6).
  const rows = await db().execute<PathChangeRow>(sql`
    SELECT d.id AS document_id,
            COALESCE(src.path, d.path) AS document_path,
            COALESCE(tgt.path, d.path) AS base_document_path
     FROM app.documents d
     JOIN (
       SELECT DISTINCT document_id
       FROM app.branch_document_paths
       WHERE branch_id IN (${sourceBranchId}, ${targetBranchId})
     ) candidate ON candidate.document_id = d.id
     LEFT JOIN app.branch_document_paths src
       ON src.branch_id = ${sourceBranchId} AND src.document_id = d.id
     LEFT JOIN app.branch_document_paths tgt
       ON tgt.branch_id = ${targetBranchId} AND tgt.document_id = d.id
     WHERE d.archived_at IS NULL
       AND COALESCE(src.path, d.path) <> COALESCE(tgt.path, d.path)`);

  return rows.map((row) => ({
    documentId: row.document_id,
    documentPath: row.document_path,
    baseDocumentPath: row.base_document_path,
  }));
}

