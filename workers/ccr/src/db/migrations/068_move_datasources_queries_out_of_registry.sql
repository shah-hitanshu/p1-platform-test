-- Migration 068: Move datasources and queries out of the _registry/ namespace
--
-- Datasource and query documents (auto-generated per content-type template)
-- were stored at _registry/datasources/* and _registry/queries/*. Everything
-- under _registry/ is treated as code-owned by merge and by checkpoint capture
-- and is unconditionally stripped from both (isSystemManagedPath in
-- merge-execution-service.ts), so a template created on a workstream merged to
-- main WITHOUT its datasource and query — and the published site, which reads
-- main, rendered every List block built on that template as silently empty.
--
-- Datasources and queries are user-derived content. At _datasources/* and
-- _queries/* they branch, merge and revert like the rest of it, with no
-- exemption list to keep in sync. Same reasoning and shape as migration 053,
-- which moved redirects to _redirects/ for the same class of bug.
--
-- Only the document path changes. Snapshots cross-reference by bare name
-- (QuerySnapshot.datasource holds a datasource NAME, LocalDatasourceSnapshot
-- holds templateName/templateId), never by document path, so snapshots are
-- untouched. Checkpoints need no rewrite either: capture always excluded these
-- documents, and revert resolves paths through a live join to app.documents.
--
-- app.documents carries a unique (site_id, path). This rename can only collide
-- if a site already holds a document at the destination path — i.e. a page
-- literally named _datasources/<x> or _queries/<x>. That aborts the migration
-- rather than silently dropping a document; resolve by renaming the offending
-- page first.
--
-- Ordering matters: the deployed services read only the new paths, so this
-- must run before the worker that depends on it. deploy-workers.yml already
-- does that — its "Run migrations" step precedes "Deploy".
--
-- To reverse (e.g. rolling the worker back to a build that reads the old paths):
--
--   UPDATE app.documents
--   SET path = '_registry/datasources/' || substring(path FROM length('_datasources/') + 1)
--   WHERE starts_with(path, '_datasources/');
--   UPDATE app.documents
--   SET path = '_registry/queries/' || substring(path FROM length('_queries/') + 1)
--   WHERE starts_with(path, '_queries/');
--   (and the same two statements against app.branch_document_paths)

UPDATE app.documents
SET path = '_datasources/' || substring(path FROM length('_registry/datasources/') + 1)
WHERE starts_with(path, '_registry/datasources/');

UPDATE app.documents
SET path = '_queries/' || substring(path FROM length('_registry/queries/') + 1)
WHERE starts_with(path, '_registry/queries/');

-- Branch-scoped path overrides (added by migration 058, after 053 ran) could
-- in principle hold rows for these documents — the document-move API has no
-- _registry/ guard. Sweep them so no branch keeps resolving the old paths.

UPDATE app.branch_document_paths
SET path = '_datasources/' || substring(path FROM length('_registry/datasources/') + 1)
WHERE starts_with(path, '_registry/datasources/');

UPDATE app.branch_document_paths
SET path = '_queries/' || substring(path FROM length('_registry/queries/') + 1)
WHERE starts_with(path, '_registry/queries/');
