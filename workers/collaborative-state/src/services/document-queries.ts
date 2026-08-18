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
 * Columns the document listing reads off a document's latest version, selected
 * inside {@link latestVersionOnBranchJoin}.
 */
export const LATEST_VERSION_LISTING_COLUMNS = `dv.is_tombstone,
          COALESCE(dv.snapshot->'root'->'props'->>'title', dv.snapshot->>'title') AS snapshot_title,
          dv.created_at AS latest_version_at,
          dv.created_by_id AS last_modified_by_id,
          dv.created_by_type AS last_modified_by_type`;

/**
 * INNER JOIN LATERAL binding alias `top` to document `d`'s latest version on the
 * branch at `branchParam`, selecting `columns` from it. Emits one row per
 * document and none when the document has no version on that branch, so the join
 * also serves as the existence check; pair it with `top.is_tombstone = false` to
 * drop documents deleted on the branch.
 *
 * Expects the documents table to be aliased `d`. The version is aliased `dv`
 * inside the lateral, so `columns` names its fields as such.
 */
export function latestVersionOnBranchJoin(branchParam: string, columns: string): string {
  return `INNER JOIN LATERAL (
        SELECT ${columns}
        FROM app.document_versions dv
        WHERE dv.document_id = d.id AND dv.branch_id = ${branchParam}
        ORDER BY dv.version_number DESC
        LIMIT 1
      ) top ON true`;
}

/**
 * LEFT JOIN LATERAL binding alias `pub` to the most recent publish checkpoint
 * covering document `d` on the branch at `branchParam`.
 *
 * Expects the documents table to be aliased `d`.
 */
export function latestPublishOnBranchJoin(branchParam: string): string {
  return `LEFT JOIN LATERAL (
        SELECT cd.document_version_id, cp.created_at AS published_at
        FROM app.checkpoint_documents cd
        INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
        WHERE cd.document_id = d.id AND cp.branch_id = ${branchParam}
          AND cp.checkpoint_type = 'publish'
        ORDER BY cp.created_at DESC
        LIMIT 1
      ) pub ON true`;
}

/**
 * Restricts documents (alias `d`) to the site owning the branch at `branchParam`.
 *
 * A correlated lateral cannot be reordered, so whatever drives it is scanned in
 * full: without this the listing probes every document in the database, across
 * every site, once per row. The predicate bounds that scan to one site.
 */
export function documentInBranchSitePredicate(branchParam: string): string {
  return `d.site_id = (SELECT site_id FROM app.branches WHERE id = ${branchParam})`;
}

/**
 * EXISTS predicate holding when document `d` has a version on the branch at
 * `branchParam` that a publish checkpoint on that same branch captured.
 *
 * Expects the documents table to be aliased `d`.
 */
export function publishedOnBranchPredicate(branchParam: string): string {
  return `EXISTS (
          SELECT 1
          FROM app.checkpoint_documents cd_pub
          INNER JOIN app.checkpoints cp_pub ON cp_pub.id = cd_pub.checkpoint_id
          INNER JOIN app.document_versions dv_pub ON dv_pub.id = cd_pub.document_version_id
          WHERE cd_pub.document_id = d.id
            AND dv_pub.branch_id = ${branchParam}
            AND cp_pub.branch_id = ${branchParam}
            AND cp_pub.checkpoint_type = 'publish'
        )`;
}

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
