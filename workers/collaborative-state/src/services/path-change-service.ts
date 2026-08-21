import { query } from '../db';

/**
 * A document at a different effective path on the source branch than on the
 * target. Travels beside content changes, never inside them — see spec D1a.
 */
export interface PathChange {
  documentId: string;
  documentPath: string;
  baseDocumentPath: string;
}

interface PathChangeRow {
  document_id: string;
  document_path: string;
  base_document_path: string;
}

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
  const result = await query<PathChangeRow>(
    `SELECT d.id AS document_id,
            COALESCE(src.path, d.path) AS document_path,
            COALESCE(tgt.path, d.path) AS base_document_path
     FROM (
       SELECT DISTINCT document_id
       FROM app.branch_document_paths
       WHERE branch_id IN ($1, $2)
     ) candidate
     JOIN app.documents d ON d.id = candidate.document_id
     LEFT JOIN app.branch_document_paths src
       ON src.branch_id = $1 AND src.document_id = d.id
     LEFT JOIN app.branch_document_paths tgt
       ON tgt.branch_id = $2 AND tgt.document_id = d.id
     WHERE d.archived_at IS NULL
       AND COALESCE(src.path, d.path) <> COALESCE(tgt.path, d.path)`,
    [sourceBranchId, targetBranchId],
  );

  return result.rows.map((row) => ({
    documentId: row.document_id,
    documentPath: row.document_path,
    baseDocumentPath: row.base_document_path,
  }));
}

