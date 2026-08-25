-- Migration 059: Merge job ledger [PCC-3737]
--
-- Source of truth for merge execution progress and idempotency
-- (docs/merge-job-runner-architecture-2026-08-21.md, PR #133). A merge job is
-- one execution attempt; its per-document rows are the ledger the runner
-- claims work from and the write-level idempotency record that makes retries
-- and cross-job resumes free of duplicate versions.
--
-- merge_requests.status gains an app-level 'merging' value alongside this
-- migration; that column has no CHECK constraint (see 003_merge_requests.sql)
-- and stays that way. These new tables get CHECKs (042 precedent) because
-- their value sets are part of the runner's contract. prior_mr_status and the
-- resolution_strategy columns are deliberately unconstrained: they mirror
-- columns whose value sets live at the app level (MR status, resolution
-- strategies) rather than in this schema.
--
-- triggered_by_type CHECK assumes only user/agent principals can reach merge
-- execution (service tokens hold no merge-handler scope); widen the CHECK if
-- merge triggering ever opens to other actor types.

CREATE TABLE app.merge_jobs (
  -- Also the Workflow instance id: create() with an existing id fails, which
  -- backstops duplicate triggers.
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for direct branch merges (no merge request involved).
  merge_request_id         uuid REFERENCES app.merge_requests(id) ON DELETE CASCADE,
  site_id                  uuid NOT NULL REFERENCES app.sites(id) ON DELETE CASCADE,
  source_branch_id         uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  target_branch_id         uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'planning', 'running', 'finalizing',
                      'completed', 'completed_with_errors',
                      'blocked_on_conflicts', 'failed', 'cancelled')),
  -- What to restore the MR to when the job fails or is cancelled.
  prior_mr_status          text,
  -- Frozen request payload; manual resolvedSnapshots live in resolutions.
  resolution_strategy      text,
  resolutions              jsonb,
  total_documents          integer NOT NULL DEFAULT 0,
  processed_documents      integer NOT NULL DEFAULT 0,
  failed_documents         integer NOT NULL DEFAULT 0,
  noop_documents           integer NOT NULL DEFAULT 0,
  -- Cooperative cancellation; the runner checks it between chunks.
  cancel_requested         boolean NOT NULL DEFAULT false,
  -- Finalization idempotency stamps: read before create, so a crash between a
  -- checkpoint committing and the workflow step result persisting cannot
  -- create a second checkpoint.
  post_merge_checkpoint_id uuid,
  publish_checkpoint_id    uuid,
  publish_error            text,
  error                    text,
  triggered_by_id          uuid NOT NULL,
  triggered_by_type        text NOT NULL CHECK (triggered_by_type IN ('user', 'agent')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  started_at               timestamptz,
  finished_at              timestamptz
);

-- At most one active job per merge request…
CREATE UNIQUE INDEX merge_jobs_active_per_mr
  ON app.merge_jobs (merge_request_id)
  WHERE merge_request_id IS NOT NULL
    AND status IN ('queued', 'planning', 'running', 'finalizing');

-- …and at most one active MR-less (direct) job per branch pair.
CREATE UNIQUE INDEX merge_jobs_active_per_branch_pair
  ON app.merge_jobs (site_id, source_branch_id, target_branch_id)
  WHERE merge_request_id IS NULL
    AND status IN ('queued', 'planning', 'running', 'finalizing');

-- FK support + the per-MR job history listing.
CREATE INDEX merge_jobs_merge_request_id_idx
  ON app.merge_jobs (merge_request_id)
  WHERE merge_request_id IS NOT NULL;

COMMENT ON TABLE app.merge_jobs IS
  'One merge execution attempt [PCC-3737]. Operator- and API-facing record; id doubles as the Cloudflare Workflow instance id. Status flow: queued -> planning -> running -> finalizing -> completed | completed_with_errors, with exits blocked_on_conflicts (planning), cancelled (running), failed.';

CREATE TABLE app.merge_job_documents (
  job_id              uuid NOT NULL REFERENCES app.merge_jobs(id) ON DELETE CASCADE,
  document_id         uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  -- Effective path at plan time, for error reporting.
  document_path       text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('copy', 'conflict')),
  resolution_strategy text,
  -- For conflict rows: what the resolver needs to run without re-detecting
  -- (both-modified, source-deleted, target-deleted). NULL for copy rows.
  conflict_type       text,
  -- Frozen at plan time; NULL for manual/take-target resolutions. No FK: this
  -- is a provenance stamp, not a lifecycle-coupled reference.
  source_version_id   uuid,
  -- The target-branch version the conflict was detected against, frozen at
  -- plan time; feeds take-source/take-target resolution and the no-op check.
  target_version_id   uuid,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'skipped_noop', 'failed')),
  -- The target-side version this row produced; feeds checkpoint + publish.
  result_version_id   uuid,
  error               text,
  attempts            integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, document_id)
);

-- Chunk claiming: "next N pending rows for this job" without scanning
-- completed rows on resume.
CREATE INDEX merge_job_documents_pending_idx
  ON app.merge_job_documents (job_id)
  WHERE status = 'pending';

-- FK support for document deletes (the PK leads with job_id).
CREATE INDEX merge_job_documents_document_id_idx
  ON app.merge_job_documents (document_id);

COMMENT ON TABLE app.merge_job_documents IS
  'Per-document merge ledger [PCC-3737]: the work list frozen at plan time and the idempotency core. done/skipped_noop/failed rows are never re-visited; resumes claim only pending rows.';
