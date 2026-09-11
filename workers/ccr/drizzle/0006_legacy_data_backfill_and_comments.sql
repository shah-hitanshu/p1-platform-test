-- Objects drizzle-kit cannot express in schema.ts: the merge-job and
-- audit-log table/column documentation, a data repair, and the organization
-- and role backfills that only make sense as one-time statements against
-- existing rows. Every statement here is idempotent: a database that already
-- carries the effect (because it ran these as numbered SQL migrations before
-- the Drizzle cut-over) takes each one as a no-op.

COMMENT ON TABLE app.merge_jobs IS
  'One merge execution attempt [PCC-3737]. Operator- and API-facing record; id doubles as the Cloudflare Workflow instance id. Status flow: queued -> planning -> running -> finalizing -> completed | completed_with_errors, with exits blocked_on_conflicts (planning), cancelled (running), failed.';
--> statement-breakpoint

COMMENT ON TABLE app.merge_job_documents IS
  'Per-document merge ledger [PCC-3737]: the work list frozen at plan time and the idempotency core. done/skipped_noop/failed rows are never re-visited; resumes claim only pending rows.';
--> statement-breakpoint

-- Incremental checkpoints capture only the documents that changed since their
-- parent, so reconstructing the full document set means walking the parent
-- chain; is_full_snapshot marks where that walk can stop instead of going all
-- the way to the branch root. session_pre_edit and pre_migration checkpoints
-- always swept the whole branch, and a parentless checkpoint terminates a
-- walk regardless of how it captured; everything else with a parent captured
-- a delta.
UPDATE app.checkpoints
SET is_full_snapshot = (
      parent_checkpoint_id IS NULL
      OR checkpoint_type IN ('session_pre_edit', 'pre_migration')
    )
WHERE is_full_snapshot IS DISTINCT FROM (
      parent_checkpoint_id IS NULL
      OR checkpoint_type IN ('session_pre_edit', 'pre_migration')
    );
--> statement-breakpoint

COMMENT ON COLUMN app.checkpoints.is_full_snapshot IS
  'True when this checkpoint captured every live document on the branch, so a parent-chain walk can stop here. False for deltas (incremental capture, or an explicit document list such as publish).';
--> statement-breakpoint

-- Checkpoint capture, getLatestVersionsForBranch, merge-base resolution and
-- merge per-document lookups all run DISTINCT ON (document_id) ... ORDER BY
-- document_id, version_number DESC over a branch. INCLUDE (id, is_tombstone)
-- makes the scan index-only for those queries; drizzle-kit has no way to
-- express an INCLUDE clause, so this index lives here instead of schema.ts.
CREATE INDEX IF NOT EXISTS idx_document_versions_branch_document_version
  ON app.document_versions (branch_id, document_id, version_number DESC)
  INCLUDE (id, is_tombstone);
--> statement-breakpoint

-- app.sites.settings is a jsonb object keyed by setting name. A prior bug bound
-- updateSiteSettings' merge parameter pre-stringified on top of postgres.js's own
-- jsonb serialization, so affected rows hold a jsonb array of double-encoded
-- history instead of an object. Folding that array left to right with
-- last-write-wins reconstructs the object the writes were asking for: each
-- element is one write in program order, read out with #>> and reparsed where
-- it is a jsonb string. Rows already holding an object are untouched.
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
--> statement-breakpoint

-- Every user needs an organization to belong to. Naming matches
-- createOrgForUser's runtime dedup (organization-service.ts): the first org to
-- claim a derived base name gets the bare name; each collision after that
-- appends " 2", " 3", etc. Checked against app.organizations directly (not the
-- TS function) since migrations must not depend on application code that can
-- change independently of this file. The email-domain list is a snapshot of
-- PUBLIC_EMAIL_DOMAINS (workers/src/constants/email-domains.ts) as it existed
-- when this backfill was written, kept fixed for the same reason.
DO $$
DECLARE
    r RECORD;
    new_org_id UUID;
    base_name TEXT;
    derived_name TEXT;
    counter INT;
BEGIN
    FOR r IN
        SELECT u.id AS user_id, u.email
        FROM app.users u
        WHERE NOT EXISTS (
            SELECT 1 FROM app.organization_members om WHERE om.user_id = u.id
        )
        AND u.email IS NOT NULL
        ORDER BY u.created_at
    LOOP
        IF SPLIT_PART(r.email, '@', 2) IN (
            'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
            'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
            'live.com', 'msn.com', 'me.com', 'mac.com', 'fastmail.com'
        ) THEN
            base_name := SPLIT_PART(r.email, '@', 1);
        ELSE
            base_name := INITCAP(SPLIT_PART(SPLIT_PART(r.email, '@', 2), '.', 1));
        END IF;

        IF NOT EXISTS (SELECT 1 FROM app.organizations WHERE name = base_name) THEN
            derived_name := base_name;
        ELSE
            counter := 2;
            WHILE EXISTS (
                SELECT 1 FROM app.organizations WHERE name = base_name || ' ' || counter::text
            ) LOOP
                counter := counter + 1;
            END LOOP;
            derived_name := base_name || ' ' || counter::text;
        END IF;

        INSERT INTO app.organizations (name, settings)
        VALUES (derived_name, '{"agentIdleTimeoutMs": 5000}'::jsonb)
        RETURNING id INTO new_org_id;

        INSERT INTO app.organization_members (organization_id, user_id)
        VALUES (new_org_id, r.user_id);
    END LOOP;
END
$$;
--> statement-breakpoint

-- Links a site with no organization to the organization of the first user
-- with a role on it, once that user has an organization membership to link
-- to (from the backfill above or from ordinary signup).
UPDATE app.sites s
SET organization_id = om.organization_id
FROM (
    SELECT DISTINCT ON (usr.site_id)
        usr.site_id,
        om2.organization_id
    FROM app.user_site_roles usr
    JOIN app.users u ON u.id = usr.user_id::uuid
    JOIN app.organization_members om2 ON om2.user_id = u.id
    ORDER BY usr.site_id, usr.created_at ASC
) om
WHERE s.id = om.site_id
AND s.organization_id IS NULL;
--> statement-breakpoint

-- Datasource and query documents were stored under _registry/, which merge
-- and checkpoint capture treat as code-owned and strip unconditionally
-- (isSystemManagedPath in merge-execution-service.ts). Moving them to
-- _datasources/* and _queries/* lets them branch, merge and revert like the
-- user content they are. Snapshots cross-reference by bare name, not by
-- document path, so they need no rewrite; a document already at the
-- destination path aborts the migration rather than silently colliding.
UPDATE app.documents
SET path = '_datasources/' || substring(path FROM length('_registry/datasources/') + 1)
WHERE starts_with(path, '_registry/datasources/');
--> statement-breakpoint

UPDATE app.documents
SET path = '_queries/' || substring(path FROM length('_registry/queries/') + 1)
WHERE starts_with(path, '_registry/queries/');
--> statement-breakpoint

-- Branch-scoped path overrides can hold rows for these documents too, so they
-- need the same sweep as app.documents above.
UPDATE app.branch_document_paths
SET path = '_datasources/' || substring(path FROM length('_registry/datasources/') + 1)
WHERE starts_with(path, '_registry/datasources/');
--> statement-breakpoint

UPDATE app.branch_document_paths
SET path = '_queries/' || substring(path FROM length('_registry/queries/') + 1)
WHERE starts_with(path, '_registry/queries/');
--> statement-breakpoint

COMMENT ON COLUMN app.organization_members.role IS
    'Role within this business account: member (default), admin (manages its users, agents and agent API keys), or owner — an admin that is also who the account belongs to, which is what owner_email reports. An account may have more than one; the roster API refuses to demote or remove the last.';
--> statement-breakpoint

-- Anyone who was a platform admin keeps administering the accounts they
-- already belong to, which is what the platform role was standing in for.
-- Superadmins pass every org check on the strength of system_role alone, but
-- are granted rows too so demoting system_role below doesn't silently strip
-- them of accounts they actually run.
UPDATE app.organization_members om
   SET role = 'admin'
  FROM app.users u
 WHERE u.id = om.user_id
   AND u.system_role IN ('admin', 'superadmin')
   AND om.role <> 'admin';
--> statement-breakpoint

-- Every account gets an owner: its earliest member. createOrgForUser inserts
-- the creator first, so that is the person the account was set up for. This
-- also settles the case an account with no admin at all leaves behind, since
-- owner counts as admin everywhere. It deliberately overwrites the admin
-- backfill above: someone who is both the earliest member and a former
-- platform admin comes out of this as owner, the stronger of the two. The NOT
-- IN guard makes the statement safe to run again: nothing can hold 'owner'
-- that shouldn't.
UPDATE app.organization_members
   SET role = 'owner'
 WHERE id IN (
        SELECT DISTINCT ON (organization_id) id
          FROM app.organization_members
         WHERE organization_id NOT IN (
                SELECT organization_id
                  FROM app.organization_members
                 WHERE role = 'owner'
               )
         ORDER BY organization_id, created_at, id
       );
--> statement-breakpoint

-- Platform-wide admin used to mean ADMIN on every site on the platform, which
-- is not what the people holding it needed; managing a business account is
-- organization_members.role now, and the backfill above already covers that
-- for everyone who held the platform role. Superadmin is granted deliberately,
-- one person at a time, rather than inherited by this backfill.
UPDATE app.users
   SET system_role = 'member', updated_at = NOW()
 WHERE system_role NOT IN ('member', 'superadmin');
--> statement-breakpoint

COMMENT ON COLUMN app.users.system_role IS
    'Platform-wide role: member (default), or superadmin (P1-only Pantheon staff: sees every organization, every site under them, and the staff tools). `admin` is legacy and grants nothing. Administering a single business account is organization_members.role, not this.';
--> statement-breakpoint

COMMENT ON TABLE app.audit_log IS
    'Append-only record of administrative actions. No foreign keys: entries must outlive the rows they describe.';
