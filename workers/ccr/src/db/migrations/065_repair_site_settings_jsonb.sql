-- Migration 065: Repair site settings stored as a jsonb array
--
-- app.sites.settings is a jsonb object keyed by setting name. Some rows hold an
-- array instead. updateSiteSettings bound its merge parameter pre-stringified, and
-- postgres.js serializes a jsonb parameter itself, so the value reached Postgres
-- JSON-encoded twice and landed as a string scalar. `settings || <string>` is array
-- concatenation rather than a merge, so those rows gained one element per write and
-- read back with numeric keys — no setting on them has ever taken effect.
--
-- Each element is one write in program order, so folding the array left to right
-- with last-write-wins reconstructs the object the writes were asking for. The
-- first element is whatever the row held before the first bad write; later ones are
-- jsonb strings whose text is the intended object, so they are read out with #>>
-- and reparsed. A string that does not parse aborts the migration; an element that
-- is neither string nor object contributes no keys.
--
-- Rows already holding an object are untouched. The array is destroyed by this
-- statement and the per-write history in it is not recoverable afterwards.
--
-- The bind is fixed in site-settings-service.ts, so no new array can appear. The
-- same bug remains at six other call sites, which write app.organizations.settings,
-- app.agents.settings and app.migration_conflicts.prop_conflicts — those tables are
-- repaired alongside their own fixes, not here.

WITH elems AS (
  SELECT s.id,
         a.ord,
         CASE
           WHEN jsonb_typeof(a.elem) = 'string' THEN (a.elem #>> '{}')::jsonb
           ELSE a.elem
         END AS obj
  FROM app.sites s,
       jsonb_array_elements(s.settings) WITH ORDINALITY AS a(elem, ord)
  WHERE jsonb_typeof(s.settings) = 'array'
), pairs AS (
  SELECT e.id, e.ord, kv.key, kv.value
  FROM elems e, jsonb_each(e.obj) AS kv
  WHERE jsonb_typeof(e.obj) = 'object'
), latest AS (
  SELECT DISTINCT ON (id, key) id, key, value
  FROM pairs
  ORDER BY id, key, ord DESC
)
UPDATE app.sites s
SET settings = COALESCE(
      (SELECT jsonb_object_agg(l.key, l.value) FROM latest l WHERE l.id = s.id),
      '{}'::jsonb
    )
WHERE jsonb_typeof(s.settings) = 'array';
