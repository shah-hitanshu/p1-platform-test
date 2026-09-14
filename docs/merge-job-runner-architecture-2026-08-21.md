# Merge Job Runner — Architecture

**Date:** 2026-08-21
**Status:** IMPLEMENTED (Phases 0+1) — PR #141; Phase 1 runner behind the
`MERGE_JOB_RUNNER` flag (Phase 0 schema + `merging` status are unconditional); staging
Phase 2 soak enabled 2026-08-25 (`5a1a0a6a`, PCC-3737); production off pending soak exit.
See "Implementation status" below for how the open design questions were resolved.
**Motivating incident:** a 535-document merge request permanently stalled at 170/535 docs ("Cellar Door" / large-MR execute wall, 2026-08-20). The verified mechanics are recapped in §1 below.
**Scope:** merge execution in `workers/collaborative-state` — both the MR execute path and the direct branch-merge path, including merges triggered through `workers/css-mcp-server` agent tools.

## Implementation status (2026-08-28)

The design below is preserved as written (2026-08-21). PR #141 implemented Phases 0+1 and
resolved the open decision points as follows — see that PR's description for as-built
detail, review findings, and follow-ups:

- **Workflows vs DO+alarms** → **Cloudflare Workflows adopted** (`MergeWorkflow`:
  `plan → apply-chunk-{i} → finalize-*` steps, one Hyperdrive connection per step,
  adaptive pacing, cooperative cancellation). The DO+alarms fallback was not needed.
- **`merging` MR status** → shipped app-level (type unions, transition map, MCP zod enum,
  `css-client` union); clients cannot PATCH into it (route guard + test). The legacy direct
  `approved→merged` transition is retained until Phase 4.
- **§8 finalization default** → **all-or-nothing adopted**; per-doc failures are recorded
  without aborting the job (`completed_with_errors` restores the MR and lists exactly which
  documents failed).
- **Bounded-wait route** → shipped at ≤15 s: small merges keep the legacy response shape,
  large ones return 202 + jobId; concurrent executes 409 with the active job id + statusUrl.
- **Two-layer idempotency (§5)** → shipped: ledger rows are never re-visited; insert-time
  `source_version_id` stamp + write-level probe replace `skipDuplicateCheck`. The incident
  regression (replay creating duplicate versions) is covered by an integration test.
- **MCP** → `get_merge_job` / `cancel_merge_job` tools shipped, with polling guidance on
  both execute tools.

---

## 1. Problem recap (verified facts)

1. The entire merge runs inline in one HTTP request: `handleExecuteMergeRequest` (`workers/collaborative-state/src/routes/merge-api.ts:444`) → `executeMerge` / `executeMergeWithResolution` (`src/services/merge-execution-service.ts`). The copy loop (`copySourceChangesToTarget`) is strictly sequential, ~3 DB round-trips per document (getDocumentVersion, getLatestDocumentVersion, INSERT with full snapshot) on a single Postgres connection (`max: 1` in `src/db.ts`, request-scoped via AsyncLocalStorage; Hyperdrive in prod; 20 s per-query timeout in `runSqlUnsafe`).
2. Post-merge checkpoint, MR status flip, auto-publish, DO `/reload` notifications, and KV branch invalidation all run only **after** the complete loop. A timeout mid-loop leaves versions on main unpublished and un-checkpointed.
3. The Worker invocation dies when the client disconnects (`outcome=canceled` at exactly the client timeout). Effective windows: ~70 s via the claude.ai MCP client, 30 s via GCLB-fronted REST (`timeout_sec=30`, external Terraform — fixed for now).
4. Retries do not resume: the copy loop passes `skipDuplicateCheck: true` to `createDocumentVersion`, so every retry re-INSERTs a full-snapshot duplicate for every already-merged doc it re-walks. Re-walk cost ≈ merge cost, so once merged-count ≈ window capacity, retries land ~0 new docs. (~600 junk unpublished versions on main from the incident.) The conflict-resolution path (take-source/take-target/manual) dedupes correctly.
5. Per-doc pace: ~30–60 ms/doc healthy, ~370–500 ms/doc with the shared Postgres pinned at its ~64-connection ceiling. The design must tolerate 10× latency swings and must not itself saturate the pool.
6. Overlapping concurrent execute attempts happen in the wild — must be serialized or rejected.
7. `POST /api/sites/{siteId}/merge/execute` (`handleExecuteMerge`) is a direct branch-merge endpoint with no MR status gate; the MCP `execute_merge` tool calls it.

---

## 2. Design goals

| # | Goal |
|---|------|
| G1 | Execute API returns fast (202 + job id); progress durable and queryable; client disconnects irrelevant |
| G2 | Idempotent per-document application: no duplicate versions on retry/resume; keep `source='merge'` history semantics |
| G3 | Chunked, paced execution with explicit DB backpressure; a big merge cannot pin the shared pool |
| G4 | Single atomic-enough finalization: post_merge checkpoint over exactly the merge-touched docs across ALL chunks, status flip, auto-publish covering all merge versions, DO reloads, KV invalidation, cache purge — with defined ordering and crash recovery at each boundary |
| G5 | Correct MR state machine (`merging` status, cancellation, poison-doc capture without whole-job abort) |
| G6 | Safe rollout alongside the inline path; sane behavior for in-flight jobs across frequent deploys |

---

## 3. Pattern evaluation

Platform facts below were verified against Cloudflare docs (2026-08).

### (a) Cloudflare Workflows — **recommended**

Durable execution engine: `step.do()` results are persisted and replayed; per-step retry policy (count, delay, backoff — default 5 retries exponential from 10 s, per-attempt timeout); `step.sleep()` free of step-count limits; instances survive isolate eviction **and Worker deploys** (completed steps replay from persisted results; only un-run steps execute new code).

- **Idempotency:** engine guarantees a *step result* is computed once, but a step interrupted mid-flight re-executes — per-document idempotency still needs the DB ledger (§5). The engine removes the *re-walk* problem entirely: resumption starts at the failed step.
- **Resumability after eviction:** native — this is the product.
- **Serialization:** instance IDs are caller-chosen and unique; creating a second instance with the same ID fails. Combined with a DB compare-and-swap on MR status (§7), duplicate triggers are structurally excluded.
- **Hyperdrive/Postgres access:** Workflows run inside this same Worker (a `WorkflowEntrypoint` class in the bundle) with the full `env` — `HYPERDRIVE` binding and `runWithConnection` work per step, exactly like the existing queue consumer (`src/queues/sync-consumer.ts` opens its own connection per batch). `nodejs_compat` (AsyncLocalStorage) is already on.
- **Observability:** instance status API, `wrangler workflows instances describe`, dashboard visualizer + step timeline; p1Logger works inside steps (must call `ensureLogger(env)` at the top of `run()` — same caveat as queue/DO paths, per CLAUDE.md).
- **Testability:** first-class vitest introspectors in `@cloudflare/vitest-plugin` ≥ 1.0.0: `introspectWorkflowInstance`, `mockStepResult`, `mockStepError`, `disableSleeps`, `disableRetryDelays`, `forceStepTimeout`, `waitForStatus` — purpose-built for "prove resume-without-duplicates" tests.
- **Limits:** 10,000 steps/instance default (configurable to 25,000; `step.sleep` doesn't count). At ~25 docs/chunk a 535-doc merge is ~22 chunk steps + ~6 finalization steps; even a 10,000-doc merge fits comfortably. Step return values must stay small (serialized state; return counts/ids, never snapshots). Instance state retained 30 days on Workers Paid. Instance-creation rate limits are far above merge frequency.
- **Deploy-mid-job caveat:** in-flight instances resume on the newest deployed code with completed step results replayed, so step *names and order* must stay stable across deploys for the running shape. Our workflow shape is a fixed, data-driven loop (step names derived from chunk index, work list frozen in Postgres), so routine deploys are safe; the rule "step naming is append-only" gets documented in the workflow file.
- **Maturity:** GA since 2025; step limits and tooling actively improving (25k steps, visualizer, vitest introspectors all landed in the last year). Newer than DOs/Queues but past the bleeding edge, and it is the Cloudflare-recommended primitive for exactly this shape of problem.

### (b) Per-MR Durable Object with alarms — viable, more code for fewer guarantees

A `MergeJob` DO (id = merge request id) naturally serializes concurrent triggers and can drive chunked execution via alarms (at-least-once, retried on uncaught exception with exponential backoff from 2 s up to 6 times, then you must re-`setAlarm` yourself). The team already operates four DOs, and vitest helpers exist (`runDurableObjectAlarm`).

Why not: everything Workflows gives declaratively is hand-rolled here — retry budgets and backoff beyond 6 attempts, step/timeout semantics, progress persistence discipline ("write state incrementally, no shutdown hooks"), stuck-alarm watchdogs, and observability (no engine timeline; you build it from logs and the ledger). DOs also restart on every deploy (this worker deploys frequently), which is safe only if the alarm loop is written with exactly the same idempotent-chunk discipline the Workflow needs anyway — so the DO buys serialization we can get more cheaply, at the cost of owning an execution engine. DOs remain the right tool for the *coordination* pieces this design doesn't touch (DocumentState reloads).

### (c) Queues consumer with checkpointed progress — poor fit for a serialized pipeline

Chunk messages with a Postgres progress ledger would work mechanically (the repo already has the consumer wiring pattern), but: consumers scale out and messages are not tied to a consumer, so two chunks for the same job can run concurrently — serialization needs DB locking bolted on; delivery is at-least-once with possible duplicates (same ledger needed, no engine benefits); ordering is not guaranteed; a poison chunk exhausts `max_retries` and lands in the DLQ, silently stalling the job unless we build DLQ monitoring + job-repair machinery; finalization sequencing across "last chunk wins" is exactly the fragile hand-rolled state machine Workflows replaces. Queues stay what they are here: fire-and-forget fan-out (sync, screenshots).

### (d) `ctx.waitUntil` continuation — insufficient

`waitUntil` extends the invocation past the response, but the extension is short and best-effort (designed for log flushes, not multi-minute jobs), provides zero durability — isolate eviction, deploy, or runtime rescheduling kills the work with no resume — and offers no progress model, no retry, no serialization. It would convert "stalls at 170 docs, visibly" into "sometimes finishes, sometimes silently half-merges". Rejected.

### Decision

**Cloudflare Workflows for orchestration + a Postgres job ledger as the source of truth for progress and idempotency.** The ledger (not workflow state) is what the status API, the MCP tool, resume-across-jobs, and operators read; the Workflow is a durable driver that could in principle be swapped later without changing the data model.

---

## 4. Components

```
                    ┌────────────────────────────────────────────────────┐
                    │ collaborative-state-worker (name frozen)           │
 MCP tool ──┐       │                                                    │
 (svc bind) │  POST /merge-requests/{id}/execute                        │
 Dashboard ─┴──────▶│  route: CAS MR status → 'merging'                  │
 REST               │         INSERT app.merge_jobs (queued)             │
                    │         env.MERGE_WORKFLOW.create({id: jobId})     │
                    │         bounded-wait poll (≤15s) → 200 or 202      │
                    │                                                    │
                    │  GET /merge-jobs/{jobId}  ── reads app.merge_jobs  │
                    │  POST /merge-jobs/{jobId}/cancel ── CAS cancel flag│
                    │                                                    │
                    │  MergeWorkflow (WorkflowEntrypoint, new binding)   │
                    │   plan → apply-chunk-N* → finalize-checkpoint →    │
                    │   finalize-status → finalize-publish →             │
                    │   finalize-notify → finalize-job                   │
                    │   each step: runWithConnection(HYPERDRIVE, …)      │
                    └────────────────────────────────────────────────────┘
                                        │
                          Postgres (Hyperdrive, shared pool)
                          app.merge_jobs / app.merge_job_documents
                          + existing document_versions / checkpoints / merge_requests
```

New wrangler config (all three env lanes): a `workflows` block binding `MERGE_WORKFLOW` → class `MergeWorkflow`. No worker renames; no new worker.

### 4.1 Data model (new migrations, 056+)

**`app.merge_jobs`** — one row per execution attempt; the operator- and API-facing record.

| column | notes |
|---|---|
| `id uuid` PK | also the Workflow instance id (`create()` with an existing id fails → duplicate-trigger backstop) |
| `merge_request_id uuid NULL` | NULL for direct branch merges (§10) |
| `site_id`, `source_branch_id`, `target_branch_id` | |
| `status text` | `queued → planning → running → finalizing → completed \| completed_with_errors \| blocked_on_conflicts \| failed \| cancelled` |
| `prior_mr_status text` | what to restore the MR to on failure/cancel (`approved` or `conflicted`) |
| `resolution_strategy text NULL`, `resolutions jsonb NULL` | frozen request payload (manual `resolvedSnapshot`s live here; MR `conflict_details` already stores comparable payloads) |
| `total_documents int`, `processed_documents int`, `failed_documents int`, `noop_documents int` | progress counters |
| `cancel_requested boolean default false` | cooperative cancellation flag, checked between chunks |
| `post_merge_checkpoint_id uuid NULL`, `publish_checkpoint_id uuid NULL` | finalization idempotency stamps |
| `publish_error text NULL`, `error text NULL` | |
| `triggered_by_id/type`, `created_at`, `started_at`, `finished_at` | |

Partial unique index: `UNIQUE (merge_request_id) WHERE status IN ('queued','planning','running','finalizing')` — at most one active job per MR. Equivalent partial unique on `(site_id, source_branch_id, target_branch_id)` for MR-less direct merges.

**`app.merge_job_documents`** — the per-document ledger; the idempotency core.

| column | notes |
|---|---|
| `job_id uuid`, `document_id uuid` | PK (job_id, document_id) |
| `document_path text` | for error reporting |
| `kind text` | `copy` \| `conflict` |
| `resolution_strategy text NULL` | for `conflict` rows |
| `source_version_id uuid NULL` | frozen at plan time; NULL for manual/take-target resolutions |
| `status text` | `pending → done \| skipped_noop \| failed` |
| `result_version_id uuid NULL` | the main-side version created (feeds checkpoints/publish) |
| `error text NULL`, `attempts int`, `updated_at` | |

`merge_requests.status` has no CHECK constraint (migration `003_merge_requests.sql` documents valid values in a comment), so adding `'merging'` is app-level: the `VALID_STATUS_TRANSITIONS` map in `merge-request-service.ts` plus the API validators.

---

## 5. Idempotent per-document application

Two layers, both required.

**Layer 1 — the ledger (fixes the re-walk wall).** A chunk step claims the next N `pending` rows and processes only those. `done`/`skipped_noop`/`failed` rows are never re-visited. On any resume — step retry, eviction, deploy — the cost of already-merged documents is one indexed `SELECT`, not 3 round-trips each. This alone dissolves the "retries land ~0 new docs" ceiling.

**Layer 2 — write-level probe (closes the crash window and cross-job resume).** There is a window between the version INSERT committing and the ledger row flipping to `done`; a retry inside that window (or a *fresh job* after a failed one) must not duplicate. Replace the blind `skipDuplicateCheck: true` with a merge-aware guard in the chunk applier:

1. At INSERT time, stamp provenance on the new version itself: pass `sourceVersionId` (the parameter already exists on `createDocumentVersion` and maps to the generic `source_version_id` column — today merge provenance is only backfilled post-publish by `merge-publish.ts`).
2. Before inserting for a `copy` doc, probe: *is the **latest** version of this document on the target branch already `source='merge'` with `source_version_id` = this row's planned source version?* If yes → record it as `done` with that `result_version_id`, insert nothing.

This preserves the documented reason `skipDuplicateCheck` was set ("Always create for merge operations — the `source='merge'` marker matters for history", `merge-execution-service.ts:730`): a genuine re-merge of the *same content from a different source version* still creates its marker row; only a literal replay of the *same planned write* is suppressed. The "latest version" qualifier keeps deliberate re-merges after intervening target edits working. Scoping the probe to (document, target branch, source version) rather than to the job id is what makes a **new job after a failed job** resume cheaply without duplicates.

Conflict rows keep their existing (verified-correct) dedupe path: the resolver's `isPreExistingTargetVersionId` no-op detection and `createDocumentVersion`'s unique-violation fallback, now additionally recorded in the ledger (`skipped_noop`). Manual resolutions (no clean source version) rely on the ledger plus the existing pre-existing-latest comparison — the crash window there is a single document wide, and the outcome of a rare replay is one extra identical `merge` version, not a runaway.

The existing `preExistingLatest` no-op skip (checkpoint-pollution guard, `merge-execution-service.ts:717`) is retained unchanged and mapped to `skipped_noop`.

---

## 6. The workflow

Instance id = `merge_jobs.id`. `run()` opens with `ensureLogger(env)` + `withRequestContext(contextForTask({ route: 'workflow:merge' }))` — mirroring the queue dispatcher in `index.ts` — so nothing logs as `app: 'unknown'`. Every step body wraps its DB work in `runWithConnection(env.HYPERDRIVE.connectionString, { isHyperdrive: true }, …)`: **one connection per step, sequential steps → at most one pool slot per running job.**

Step bodies live in plain service functions (`merge-job-service.ts`: `planMergeJob`, `applyMergeChunk`, `finalizeMergeJob…`) so they unit-test with the existing harness; the `WorkflowEntrypoint` is a thin shell.

### Steps

**1. `plan`** *(retries: 5, exponential; timeout 3 min)*
- Load job + MR; verify MR status is `merging` (set by the route CAS) — otherwise terminate as superseded.
- `detectConflicts(source, target)` → `applySystemManagedExclusions` (unchanged semantics).
- If conflicts exist and the job carries no covering resolutions: persist `updateMergeRequestConflicts`, CAS MR `merging → conflicted`, job → `blocked_on_conflicts`, **end instance successfully** (the job outcome, not an engine error).
- Freeze the work list into `merge_job_documents`: one `copy` row per non-conflicting source change (with `latestVersionId` as `source_version_id`), one `conflict` row per conflict with its resolved strategy. Set `total_documents`. Detection runs **once**; the frozen source-version ids make the merge a consistent snapshot even if the source branch keeps moving — strictly better than today's read-during-loop behavior.
- Return counts only (step state must stay small).

**2. `apply-chunk-{i}`** — loop until no `pending` rows remain *(per step: retries 8, exponential from 30 s — rides out a multi-minute DB incident; timeout 3 min per attempt)*
- Claim up to `CHUNK_SIZE` (default **25**) pending rows.
- Per doc, inside try/catch: apply Layer-2 probe → copy or resolve → mark `done`/`skipped_noop`; on error mark `failed` with the message, increment `attempts`, **continue** — a poison document never throws out of the chunk. Only infrastructure errors (connection refused, query timeout) propagate, triggering the step's retry/backoff.
- Wall-clock guard: stop claiming further docs once the chunk exceeds ~10 s so one step never holds a connection long under a degraded DB (at 500 ms/doc a 25-doc chunk ≈ 12.5 s — the guard trims it).
- Update job counters; return `{ done, failed, noop, remaining, avgMsPerDoc }`.
- **Backpressure:** if `avgMsPerDoc` > 150 ms, insert `step.sleep('pace-{i}', 5–30 s)` before the next chunk (sleep is free of step limits). A saturated pool slows merges down instead of merges pinning the pool.
- **Cancellation:** read `cancel_requested` at chunk start; if set, stop the loop and jump to the cancel epilogue (job → `cancelled`, MR restored to `prior_mr_status`). Copied-so-far versions remain as *unpublished* `merge` versions recorded in the ledger — invisible on the live site (publish happens only in finalization), enumerable for later remediation (archive/exclude — see §13's no-delete note).
- Within-chunk batching (`WHERE id = ANY(…)` reads, multi-row INSERT) is a worthwhile optimization, not a correctness requirement.

**3. `finalize-checkpoint`** — post_merge checkpoint via `createCheckpoint` with the explicit `documentVersionIds` allowlist built from **all** ledger rows with status `done`, across every chunk. Chunk the manifest INSERT at ~10k rows: the current single-statement build hits Postgres' 65,535-bind-parameter cap above ~32k documents (load review, finding 5) — far above today's merges, but the runner exists precisely for the large cases. Idempotency stamp: read `post_merge_checkpoint_id` first; if set, skip (covers a crash between checkpoint commit and step-result persistence). Stamp it in the same connection after commit.

**4. `finalize-status`** — CAS `merging → merged` with merge metadata (no-op if already merged).

**5. `finalize-publish`** *(only when target is main; gate: `failed_documents = 0`, see §8 poison policy)* — `publishMergedVersions` over all `done` rows (`result_version_id` + `source_version_id` provenance — now redundant with the insert-time stamp for copy docs, kept for the back-link `published_to_version_id`). Collapse the current two-UPDATEs-per-document loop (`merge-publish.ts:92-108`) into set-based `UPDATE … FROM unnest(…)` statements — two statements total regardless of N (adopted from the 2026-08-20 load review, finding 3; on one `max: 1` connection the loop is 2N serialized round trips). Idempotency stamp: `publish_checkpoint_id`. On publish failure after step retries: record `publish_error` on the job, continue — matches today's contract (merge committed, publish error surfaced).

**6. `finalize-notify`** — best-effort, logged, bounded retries (2), never fails the job:
- `writeBranchInvalidation(CONFIG_KV, targetBranchId)`;
- DO `/reload` per published document (same session-id scheme as `notifyDocumentStateAfterMerge`);
- `purgeContentCache({siteId, branchId})` — purges actually evict as of PCC-3715's fix (#125, deployed to prod 2026-08-20 16:27Z): the purge RPC runs inside the `CachedContent` entrypoint scope. The live constraint is now Cloudflare's purge **rate limit** (error 1134, observed in prod on per-page publish loops 2026-08-21): the workflow keeps the merge purge a **single site/branch-scoped call**, never a per-document fan-out.
- Post-merge template migrations (`triggerPostMergeTemplateMigrations`) move here as their own step — no longer time-boxed to 10 s inside a request; still best-effort per template.

**7. `finalize-job`** — job → `completed` (or `completed_with_errors` when `failed_documents > 0`), `finished_at = now()`.

---

## 7. Serialization of concurrent triggers

Three independent gates; any one suffices, together they are belt-and-braces:

1. **Route-level CAS** (the primary gate): `UPDATE app.merge_requests SET status='merging' WHERE id=$1 AND status IN ('approved','conflicted') RETURNING status` — the loser of a race gets 0 rows → **409** with the active job id in the body.
2. **Partial unique index** on active `merge_jobs` rows per MR (and per branch-pair for direct merges).
3. **Workflow instance id = job id** — `create()` for an existing id throws, making "job row inserted, response lost, client retried create" idempotent.

## 8. State machines

**Merge request** (additions in bold):

```
open ──▶ approved ──▶ **merging** ──▶ merged            (terminal)
  │         ▲  │            │
  │         │  └─▶ closed   ├─▶ conflicted   (plan found unresolved conflicts)
  │         │               └─▶ approved/conflicted = prior_mr_status
  │         │                   (job failed or cancelled)
  └─▶ conflicted ──▶ **merging** (with resolutions) / open / closed
closed ──▶ open
```

The legacy direct transitions `approved → merged` and `conflicted → merged` remain valid while the inline path exists (rollout §11) and are removed in the final phase.

**Job:** `queued → planning → running → finalizing → completed | completed_with_errors`, with exits `blocked_on_conflicts` (from planning), `cancelled` (cooperative, from running), `failed` (engine retries exhausted / non-retryable error; MR restored to `prior_mr_status`).

**Poison-document policy:** per-doc failures are captured in the ledger and never abort the job. Finalization is **all-or-nothing by default**: `finalize-status`/`finalize-publish` run only when `failed_documents = 0`; otherwise the job ends `completed_with_errors`, the MR returns to `prior_mr_status`, and the response/status payload lists exactly which documents failed and why. Retrying is now cheap — a new execute creates a new job whose Layer-2 probes skip everything already copied, so only the previously-failed docs are attempted. Rationale: silently publishing a half-merge to main is worse than a clearly-reported blocked merge; the incident pain was *undiagnosable, unresumable* stalls, not the absence of partial commits. An explicit `allowPartial: true` execute option (operator/API-level) can force finalization over the `done` subset — listed as an open question rather than a default.

## 9. Failure-mode table

| Failure | Behavior | Recovery |
|---|---|---|
| Worker eviction / isolate death mid-chunk | Step re-executes from its start after engine retry; ledger rows already `done` are skipped; the ≤1 doc in the INSERT-vs-ledger window is caught by the Layer-2 probe | Automatic; zero duplicates |
| Client disconnect (MCP 70 s, GCLB 30 s) | Irrelevant after the 202/bounded-wait response; workflow runs detached | None needed |
| DB outage (minutes) | Chunk step fails → exponential backoff (8 retries from 30 s ≈ rides out >1 h); pacing already slowed writes as latency climbed | Automatic resume; if retries exhaust, job `failed`, MR restored; next execute resumes via Layer-2 probes |
| Deploy mid-job | Instance persists; completed steps replay from stored results; new code runs remaining steps. Step names are data-driven and stable; "append-only step naming" documented in the workflow file | Automatic |
| Concurrent execute triggers | Route CAS → 409 with active job id; unique index and instance-id collision as backstops | Client polls the existing job |
| Poison document (bad snapshot, FK violation) | Marked `failed` in ledger with error; job continues; finalization gated (§8) | User fixes/excludes doc, re-executes; new job skips all `done` docs |
| Publish step fails (target=main) | Merge committed (checkpoint + status), `publish_error` recorded — same contract as today, but now visible on a queryable job | Re-drive publish (ops) or re-execute path per current runbook |
| Crash between checkpoint/publish commit and step persistence | Idempotency stamps (`post_merge_checkpoint_id`, `publish_checkpoint_id`) read before create → no duplicate checkpoints | Automatic |
| Workflow create() fails at trigger time | Job row + MR status rolled back in the route; 503 to client | Client retries |
| Job stuck (engine or logic bug) | `wrangler workflows instances describe/pause/terminate` by `workflow_instance_id`; job row shows last counter movement | Ops terminate → job `failed`, MR restored; re-execute resumes |
| Cancellation | `cancel_requested` CAS; chunk loop exits at next boundary; unpublished partial copies recorded in ledger | MR restored; partial versions remain recorded for archive/exclude remediation (§13) |

## 10. API + MCP contract

### REST (collaborative-state)

- `POST /api/sites/{siteId}/merge-requests/{id}/execute`
  - Gates unchanged (auth, `canMerge`, status must be `approved`/`conflicted`).
  - Creates job + instance, then **bounded-wait**: poll the job row up to ~15 s. If the job reaches a terminal state within the window (small merges, conflict rejections), return **200** with a legacy-shaped result (+ `jobId`); otherwise **202** `{ jobId, status, statusUrl }`. This keeps small-merge UX and error semantics (409-equivalent conflict responses) identical for existing clients while staying safely inside the 30 s GCLB window, with no client flag-day.
- `GET /api/sites/{siteId}/merge-jobs/{jobId}` → full job row projection: status, counters, `failedDocuments: [{documentId, path, error}]`, checkpoint ids, `publishError`, timestamps. Auth: `canView` on the site.
- `POST /api/sites/{siteId}/merge-jobs/{jobId}/cancel` → sets `cancel_requested` (auth: `canMerge`).
- `GET /api/sites/{siteId}/merge-requests/{id}/jobs` (optional) → job history for an MR.
- `POST /api/sites/{siteId}/merge/execute` (direct branch merge): **moves onto the runner** as an MR-less job (`merge_request_id NULL`; plan step skips MR status handling). It cannot fold into MRs because MRs are main-target-only (`TargetBranchNotMainError`) while direct merge allows arbitrary targets, and the MCP `execute_merge` tool plus REST users depend on it. Same bounded-wait behavior. (Deprecation instead is a product call — open question — but the runner supports it for one extra route-glue file either way.)

### MCP (css-mcp-server)

- `execute_merge_request` / `execute_merge`: unchanged inputs. With bounded-wait, small merges return the final result exactly as today. For long merges the tool returns `{ jobId, status: 'running', …progress }` with description text updated to instruct polling: *"If the response contains a jobId with status running, the merge continues in the background; poll get_merge_job every few seconds until status is completed, completed_with_errors, blocked_on_conflicts, failed, or cancelled."*
- New tool **`get_merge_job`** (site_id, merge_job_id) → the status projection. Mirrors the existing `get_query`/`get_query_results` async precedent in the tool surface.
- Optional `cancel_merge_job`.
- `api-client.ts` gains `getMergeJob`/`cancelMergeJob` (same service-binding `doFetch` pattern).
- MCP client timeouts (~70 s) become irrelevant: every tool call now completes in ≤ ~15 s.

## 11. Rollout

Feature flag: `MERGE_JOB_RUNNER` env var (`vars` per lane), read by the execute routes. Worker names untouched.

1. **Phase 0 — schema.** Migrations for `merge_jobs`, `merge_job_documents`; app-level `'merging'` status (no DB constraint change needed). Additive, deployable independently.
2. **Phase 1 — runner behind flag (off in prod).** `MergeWorkflow` + bindings in all three wrangler env lanes, job endpoints, MCP `get_merge_job`. Inline path untouched and default. Insert-time `sourceVersionId` stamping ships here (harmless on the inline path too, and it starts building the Layer-2 probe's data).
3. **Phase 2 — staging soak.** Flag on in staging. Scripted large-merge test (recreate the 535-doc shape), a mid-run `wrangler deploy`, a mid-run cancellation, and a forced DB-latency run. Verify ledger counts, zero duplicate versions, checkpoint/publish contents, and actual edge eviction (PCC-3715's fix is deployed).
4. **Phase 3 — prod enable.** Bounded-wait keeps the Dashboard (external repo) working without UI changes; Dashboard adds a progress view against `GET /merge-jobs/{id}` on its own schedule.
5. **Phase 4 — retire the inline path.** Remove the inline copy loop and the blind `skipDuplicateCheck` merge call; drop legacy `approved→merged` direct transitions; execute the direct-endpoint decision (migrated or deprecated).

**In-flight jobs on deploy** are safe from Phase 1 onward (Workflows persistence + stable step naming). A deploy that *changes the workflow's step structure* must ship behind a drain: let active instances finish (minutes) or terminate-and-re-execute (cheap, resumable) — noted in the workflow file header.

## 12. Testing strategy

- **Unit (existing harness, `setDatabaseInstance` / `vitest.db.config.ts`):** ledger claim/mark transitions; Layer-2 probe truth table (latest-merge-from-same-source → skip; intervening edit → insert; different source version → insert); plan freezing incl. system-managed exclusions; finalization allowlist assembly across chunks; CAS transitions incl. the new `merging` edges.
- **Incident regression (encodes the *why*):** run `applyMergeChunk` twice over the same pending rows (simulated retry) and assert exactly one `merge` version per document — this test fails if anyone reintroduces blind `skipDuplicateCheck` semantics.
- **Workflow-level (`@cloudflare/vitest-plugin` introspectors, new dev-dep):** `forceStepTimeout` on `apply-chunk-2` → assert resume without duplicates and correct counters; `mockStepError` on publish → assert merge-committed-with-publishError contract; `disableSleeps`/`disableRetryDelays` keep runs instant; cancellation via flag between chunks. If adopting the plugin proves disruptive to the current test setup, the same coverage lands on the extracted service functions plus one staging smoke — the thin-shell design keeps this optional.
- **Staging integration:** the Phase-2 soak scenarios above, plus MCP end-to-end (execute → poll → completed) through the service binding.

## 13. Out of scope (noted)

- **Remediation of the ~600 existing duplicate versions:** platform design principle — **nothing is deleted by default; archive/hide instead** (a deliberate agent-safety decision: LLM agents operate on this platform, and destructive primitives invite destructive goal-seeking). The compliant shape is exclusion, not deletion: mark the *unpublished*, checkpoint-unreferenced `source='merge'` duplicates from the incident window as superseded/archived so hot queries and version listings skip them, and shape indexes/predicates so they stop costing anything. True deletion, if ever wanted, is an explicit human-approved exception with the patch-chain/checkpoint-reference verification noted here — its own careful task, not this runner.
- GCLB `timeout_sec=30` (external Terraform) — the design makes it irrelevant rather than changing it.
- PCC-3715 purge-entrypoint fix — already shipped (#125, in prod since 2026-08-20); `finalize-notify` simply calls it.

## 14. Open questions

1. **Direct `merge/execute` endpoint:** migrate onto the runner (designed above, cheap) or deprecate? Product call; affects the MCP `execute_merge` tool.
2. **Partial finalization:** is an explicit `allowPartial` option wanted, or is all-or-nothing + cheap retry always sufficient?
3. **Global concurrency cap:** should job creation gate on "N running jobs per site / per DB" beyond the per-MR uniqueness? (Each job holds ≤1 connection, so pressure is bounded; a cap of e.g. 3 concurrent jobs is a one-query guard if wanted.)
4. **Bounded-wait window:** 15 s proposed (safe under GCLB 30 s); tune against real small-merge latency distribution.
5. **Chunk size / pacing thresholds:** defaults 25 docs, 10 s wall-clock guard, 150 ms/doc pacing trigger — validate on staging under induced load.
6. **Dashboard progress UI** (pantheon-content-cloud repo): timeline for consuming `GET /merge-jobs/{id}`; bounded-wait covers the interim.
7. **Job retention:** merge_jobs rows are small — keep indefinitely, or prune ledgers (`merge_job_documents`) after ~90 days?
