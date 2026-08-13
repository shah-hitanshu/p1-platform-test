-- Migration 053: Move redirects out of the _registry/ namespace
--
-- Redirect records were stored as documents at _registry/redirects/*. Everything
-- under _registry/ is treated as code-owned by merge and by checkpoint capture
-- and is unconditionally stripped from both (isSystemManagedPath in
-- merge-execution-service.ts), so a redirect created on a workstream could never
-- reach the main branch a live site resolves redirects against: merging the
-- workstream deleted the page but left the redirect behind, and the URL 404'd.
--
-- Redirects are user content. At _redirects/* they branch, merge and revert like
-- the rest of it, with no exemption list to keep in sync.
--
-- Only the document path changes. The redirect snapshot's fromPath holds the
-- site-relative URL (e.g. '/old-page'), not this path, so snapshots are untouched.
--
-- app.documents carries a unique (site_id, path). This rename can only collide if
-- a site already holds a document at the destination path — i.e. a page literally
-- named _redirects/<something>. That aborts the migration rather than silently
-- dropping a redirect; resolve by renaming the offending page first.

-- Ordering matters: the deployed resolver reads only the new path, so this must
-- run before the worker that depends on it. deploy-workers.yml already does that
-- — its "Run migrations" step precedes "Deploy" — so a normal deploy is safe, but
-- a deploy with run_migrations disabled would 404 every redirect until this runs.
--
-- To reverse (e.g. rolling the worker back to a build that reads the old path):
--
--   UPDATE app.documents
--   SET path = '_registry/redirects/' || substring(path FROM length('_redirects/') + 1)
--   WHERE starts_with(path, '_redirects/');

UPDATE app.documents
SET path = '_redirects/' || substring(path FROM length('_registry/redirects/') + 1)
WHERE starts_with(path, '_registry/redirects/');
