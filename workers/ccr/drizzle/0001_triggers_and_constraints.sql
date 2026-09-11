-- Objects that drizzle-kit cannot express in schema.ts: database-level objects
-- (an implicit cast, an extension), the plpgsql trigger that enforces
-- copy-on-write branching, the time-fenced content invariant on
-- document_versions, and the table and column documentation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- Connections run with prepare: false, which sends parameters as text. Comparing
-- one to a uuid column resolves only if text -> uuid is IMPLICIT; the built-in
-- cast is ASSIGNMENT, which requires an explicit $n::uuid at every call site.
DROP CAST IF EXISTS (text AS uuid);
--> statement-breakpoint
CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT;
--> statement-breakpoint

-- Branch integrity: non-main branches must reference a main branch as their
-- source. CHECK constraints cannot look at other rows, so this is a trigger.
CREATE OR REPLACE FUNCTION app.enforce_main_only_branching()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_main = FALSE AND NEW.source_branch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM app.branches
      WHERE id = NEW.source_branch_id AND is_main = TRUE
    ) THEN
      RAISE EXCEPTION 'Branches can only be created from the main branch. source_branch_id must reference a main branch.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_enforce_main_only_branching
  BEFORE INSERT OR UPDATE ON app.branches
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_main_only_branching();

--> statement-breakpoint

-- Every document_versions row must be rebuildable: it either holds a full
-- snapshot, or holds a patch applying to its predecessor. The fence on
-- created_at is stamped when this migration runs, so rows written before it stay
-- writable — a CHECK is re-evaluated on every UPDATE, and publishing or merging
-- back-links published_to_version_id onto the source row whatever its age.
-- NOT VALID skips the initial scan; enforcement on later INSERT and UPDATE is
-- unaffected.
DO $$
BEGIN
  EXECUTE format(
    'ALTER TABLE app.document_versions'
    ' ADD CONSTRAINT document_versions_content_present'
    ' CHECK (snapshot IS NOT NULL OR patch IS NOT NULL OR created_at < %L)'
    ' NOT VALID',
    now()
  );
END $$;

--> statement-breakpoint

COMMENT ON COLUMN app.agents.id IS 'Agent identifier. Must be a valid UUID string (e.g., "a0000000-0000-0000-0000-000000000001").
If not provided during creation, a UUID will be auto-generated.
Note: UUID format is required for compatibility with checkpoints.created_by_id.';
--> statement-breakpoint
COMMENT ON COLUMN app.agents.capabilities IS 'Array of capability strings describing what the agent can do.
Examples: ["edit", "create", "delete", "merge", "approve"]';
--> statement-breakpoint
COMMENT ON COLUMN app.agents.settings IS 'Agent settings JSON schema:
{
  "priorityTier": "default",           // Future: tier reference
  "allowedOperationTypes": ["*"],      // Future: operation restrictions
  "maxConcurrentDocuments": 10         // Future: concurrency limits
}';
--> statement-breakpoint
COMMENT ON COLUMN app.checkpoints.trigger IS 'How the checkpoint was created:
- manual: User explicitly created checkpoint
- human_requested: Agent created after user requested work
- autonomous: Agent created during autonomous operation';
--> statement-breakpoint
COMMENT ON COLUMN app.checkpoints.requested_by_id IS 'User ID who requested the agent action (populated when trigger = human_requested)';
--> statement-breakpoint
COMMENT ON COLUMN app.checkpoints.affected_regions IS 'JSON array of JSON paths affected by this checkpoint.
Example: ["/content/0", "/content/0/props/title"]';
--> statement-breakpoint
COMMENT ON COLUMN app.checkpoints.status IS 'Checkpoint completion status:
- completed: Operation finished successfully
- rolled_back: Operation was rolled back (agent yielded to human)
- partial: Operation was interrupted before completion';
--> statement-breakpoint
COMMENT ON TABLE app.document_relations IS 'Edges between documents by derivation type (e.g. template).';
--> statement-breakpoint
COMMENT ON COLUMN app.document_relations.source_document_id IS 'The dependent document; target_document_id is what it derives from.';
--> statement-breakpoint
COMMENT ON COLUMN app.document_relations.synced_version IS 'Version of the target this source is aligned to; NULL when unbound.';
--> statement-breakpoint
COMMENT ON COLUMN app.document_relations.metadata IS 'Relation-type-specific attributes; shape varies by relation_type.';
--> statement-breakpoint
COMMENT ON TABLE app.document_relation_branch_sync IS 'Per-branch synced_version override for a document_relations edge; absent rows inherit the edge base.';
--> statement-breakpoint
COMMENT ON COLUMN app.document_relation_branch_sync.synced_version IS 'Version of the target this source is aligned to on this branch.';
--> statement-breakpoint
COMMENT ON COLUMN app.documents.locale IS 'BCP-47 language tag of this document''s content; NULL when unrecorded. A translation is identified by its localization edge, not by this column.';
--> statement-breakpoint
COMMENT ON TABLE app.migration_conflicts IS 'Records migration conflicts requiring manual resolution';
--> statement-breakpoint
COMMENT ON COLUMN app.migration_conflicts.template_delta IS 'Structural changes from template (extracted from action_metadata)';
--> statement-breakpoint
COMMENT ON COLUMN app.migration_conflicts.document_actions IS 'Document''s own structural changes since last template version';
--> statement-breakpoint
COMMENT ON COLUMN app.migration_conflicts.resolution IS 'How conflict was resolved: apply (use template), skip (keep document), manual (custom)';
--> statement-breakpoint
COMMENT ON TABLE app.migration_jobs IS 'Tracks template migration jobs that update documents to new template versions';
--> statement-breakpoint
COMMENT ON COLUMN app.organizations.settings IS 'Organization settings JSON schema:
{
  "agentIdleTimeoutMs": number,        // How long humans must be idle (default: 5000ms)
  "agentPriorityTiers": {}             // Future: tier configurations
}';
--> statement-breakpoint
COMMENT ON COLUMN app.sites.allowed_origins IS 'Allowed origin patterns, used for CORS enforcement (see utils/cors.ts) and intended for OAuth redirect URI validation. Each entry must be an origin including its protocol and no path: exact (https://example.com) or a single wildcard in the leftmost label, below a registrable domain (https://*-mysite.pantheonsite.io), which covers every Pantheon branch URL for that site. Note: a non-empty list also switches this site from default-open CORS to allowing only the listed origins.';
