/**
 * LEFT JOIN attaching a document's 'template' relation as alias `dr`.
 * Expects the documents table to be aliased `d`.
 */
export const TEMPLATE_RELATION_JOIN =
  `LEFT JOIN app.document_relations dr
     ON dr.source_document_id = d.id AND dr.relation_type = 'template'`;

/**
 * INNER JOIN restricting to documents that derive from a template, as alias `dr`.
 * Expects the documents table to be aliased `d`; scope to a template by filtering
 * on `dr.target_document_id`.
 */
export const TEMPLATE_RELATION_INNER_JOIN =
  `JOIN app.document_relations dr
     ON dr.source_document_id = d.id AND dr.relation_type = 'template'`;

/**
 * Column list selecting a document (alias `d`) with its template relation
 * exposed as template_id and template_version, the shape mapRowToDocument reads.
 */
export const DOCUMENT_WITH_TEMPLATE_COLUMNS =
  'd.*, dr.target_document_id AS template_id, dr.synced_version AS template_version';

/**
 * Whether a branch reads inherited state from a distinct main branch: true when
 * `mainBranchId` is supplied and differs from `branchId`. Selects the
 * copy-on-write query variant — inherited documents, per-branch sync overrides —
 * over the plain single-branch query. Narrows `mainBranchId` to a string so the
 * inheriting branch can use it as the fallback branch.
 */
export function branchInheritsFromMain(
  branchId: string,
  mainBranchId: string | undefined,
): mainBranchId is string {
  return mainBranchId !== undefined && mainBranchId !== branchId;
}
