# Postgres elimination — exploration — 2026-08-28

**Status: EXPLORATION — recommendation: do not proceed now.** Reopening triggers in §9.
**Question:** if `docs/published-doc-materialized-views-2026-08-21.md` materializes published
JSON to R2 anyway, why not remove JSON storage from Postgres entirely, move the relational
state to Cloudflare (D1 or Durable Object SQLite), and eliminate Postgres and GCP —
assuming the GCLBs also go (they do regardless: PCC-3740 zone migration)?
**Answer in one line:** feasible in a way it wasn't when first rejected, but the execution-model
port re-implements a database's operational layer by hand; the scope only pays for itself if a
per-site data-residency requirement lands — and even then, regional Postgres lanes (§7) are
the cheaper answer.

Platform facts below were verified against Cloudflare/Google documentation 2026-08-27/28.
Code citations are relative to `workers/collaborative-state/` unless stated otherwise.

---

## 1. The prior rejection, and what changed

`docs/css/SCALING-PLAN.md` (line 26) rejected Cloudflare-native storage:

> PostgreSQL remains the correct choice for the persistence layer. The data model … relies on
> PostgreSQL-specific features: JSONB, DISTINCT ON, BYTEA, uuid-ossp, TEXT[], typed casts, and
> multi-table transactions. Cloudflare-native alternatives (D1, DO SQLite) cannot replace this —
> D1 is single-threaded with no JSONB operators …

A fresh feature inventory (2026-08-27, all ~62 migrations + query code) shows that list is
mostly obsolete:

| Claimed blocker | Current reality |
|---|---|
| BYTEA | Gone — `document_versions.crdt_state` (001) was dropped in migration 030 |
| uuid-ossp | Not used; `gen_random_uuid()` defaults → `crypto.randomUUID()` (mechanical) |
| TEXT[] | 3 columns (`010:22`, `020:15`, `031:6`) → JSON text (mechanical) |
| JSONB | ~20 columns, almost all store-and-retrieve whole blobs (§3); the R2 designs remove most of the rest |
| DISTINCT ON | 8 sites — portable as `ROW_NUMBER()` rewrites, with a rows-read cost caveat (§3) |
| Typed casts | Mechanical |
| Multi-table transactions | **Still binding — the real blocker, see §3–§4** |

Also portable mechanically: the `app.` schema (SQLite has none — but a port would author one
consolidated schema, not replay 62 migrations), ~18 `CHECK (… IN (…))` constraints, 20
`ON DELETE CASCADE` FKs, partial indexes (SQLite supports them), both triggers (022, 060 —
expressible as SQLite triggers), `WITH RECURSIVE` (fine as-is). pgcrypto and REGEXP_REPLACE
appear only in already-applied one-time backfills (041, 045).

**The schema is portable. The execution model is where the port dies.**

## 2. Why the JSONB objection specifically is dead

Of ~20 JSONB columns, nearly all are whole-blob store/retrieve (`sites.settings`,
`merge_requests.conflict_details`, `merge_jobs.resolutions`, …) — TEXT with zero query
changes. Queries that reach *into* JSON:

- `document-queries.ts:30` — title extraction from snapshots in the branch-document listing
  (the 48.3%-of-DB-time query, `docs/prod-db-saturation-investigation-2026-08-19.md:48`).
  If snapshots leave Postgres, the title becomes an extracted metadata column — the right
  fix regardless of engine.
- `postgres-sync-manager.ts:548` — the DO-flush no-op dedupe: `latest.snapshot IS NOT
  DISTINCT FROM $3::jsonb`. This relies on Postgres's **canonical JSONB equality** (key order
  and whitespace normalized). SQLite JSON is TEXT compared bytewise; any port must replace
  this with an explicit content hash or it silently inserts duplicate version rows.
  Conditional hazard, not a live bug: both sides normally serialize through the same JS
  path, so byte equality likely holds today. It fails silently, which is why it leads this list.
- `relations-service.ts:349-434` — the deepest JSON work (jsonb_each cap-counting inside
  read-modify-write UPDATEs); `json_set`/`json_remove`/`json_each` approximate it awkwardly.
- Semantic trap for any port: Postgres `settings || $1::jsonb` is a shallow top-level merge;
  SQLite `json_patch()` is RFC 7386 recursive merge with null-deletes. Not interchangeable
  (`site-settings-service.ts:212,228`, `agent-service.ts:318`, `organization-service.ts:247`).

## 3. D1 verdict: three independent hard blockers

1. **No interactive transactions.** D1 offers `batch()` over a pre-built statement array
   only. The codebase has 19 transactional sites (15 `query('BEGIN')` + 4 `withTransaction`,
   counted post-#141), every one interactive: `checkpoint-publish.ts:43-70` takes `FOR UPDATE`, may replay a patch
   chain via `reconstructVersionSnapshot()`, then writes. These cannot be expressed —
   only re-architected. (Verified: no network call was found inside any transaction body,
   so a DO-serialized re-architecture is possible; but it is a re-architecture.)
2. **`pg_advisory_xact_lock` has no analogue.** The per-branch COW-materialization mutex
   (`branch-document-service.ts:563`, `document-service.ts:565`) is transaction-scoped;
   with no transactions there is nothing to port to. D1's global single writer "replaces"
   it by serializing every write in the database — simultaneously the substitute and the
   throughput ceiling.
3. **10 GB per database + 100 bound parameters per query.** Production Cloud SQL provisions
   a 50 GB floor (`terraform/environments/production/main.tf:115-116`, `db-custom-4-15360`)
   with `disk_autoresize` (`terraform/modules/database/main.tf:232`); no in-repo measurement of actual bytes exists (§8). The bulk
   version-insert uses seven parallel `unnest` arrays (`document-version-service.ts:967-973`)
   — ≈14 rows per D1 statement vs Postgres's 65,535-parameter cap; `= ANY($1::uuid[])`
   (59 sites) becomes `IN` lists capped at 100 ids.

Plus an operational blocker no feature grep surfaces: D1 is reachable only from Worker
bindings and its HTTP API. CI migrations via IAM roles (`src/db/migrate.ts`, migration 056's
own comment), psql/cloud-sql-proxy sessions, `pg_stat_statements`, and Cloud SQL Query
Insights (provisioned 2026-08-21) all disappear — the exact toolkit the 08-19 saturation
investigation ran on.

Also noted: 8 `DISTINCT ON` sites (e.g. checkpoint snapshot selection,
`checkpoint-service.ts:222`) rewrite as window functions that materialize and rank whole
partitions where Postgres stops at the first row per group off an ordered index — a
rows-read blow-up on 2k-doc branches, and rows read are the billing metric. p1-media
already runs on D1 (`MEDIA_DB`), which proves the `batch()` mechanics, not this workload
(small rows, no history, no branching).

## 4. The shape that actually fits: per-site DO SQLite — and what it costs

The execution-model blockers indict D1 specifically, not Cloudflare storage generally.
SQLite-backed Durable Objects (GA April 2025) offer synchronous multi-statement
transactions, actor serialization (the advisory lock for free, scoped per site), **10 GB
per site** rather than per fleet, and 30-day point-in-time recovery. Verified platform
facts relevant to a system of record:

- **Permanence:** a DO is a permanent named address for storage+compute, not a process.
  The in-memory instance hibernates after ~10 s idle and is evicted after 70–140 s; storage
  survives eviction, crashes, deploys, and host migration. No TTL. Data persists until
  `deleteAll()` or namespace deletion. Decade-lived dormant sites are a platform contract.
- **The 10 GB cap is hard** (no raisable knob; D1's support-raisable limit is the *account
  total*, not per-database). At the cap, writes that would grow the DB fail while reads
  continue (documented for D1, which runs on this same engine; the DO-specific error string
  is not documented) — i.e. a per-site write outage, not data loss. `ctx.storage.sql.databaseSize`
  makes runway a metric. With snapshots/patches in R2 and only metadata rows in the DO
  (a few hundred bytes each), 10 GB ≈ 20–40 M rows ≈ ~5,000 versions/day sustained for a
  decade — but a design would still need day-one tiering (cold epochs compacted to R2
  manifests — tiering, not deletion) plus a runway alarm.
- **Placement is decided at first access and cannot be changed** — jurisdiction namespaces
  (`eu`, `fedramp`, and since June 2026 `us`) are the hard residency guarantee (baked into
  the object ID); `locationHint` is best-effort latency affinity. System-of-record DOs must
  therefore be **provisioned deliberately** (control plane creates + verifies placement
  before the site id is ever handed out), never lazily on first request — and the DO name
  needs a generation indirection (`site:{id}:g{n}` + directory) so relocation is a defined
  heavy operation instead of an impossibility. Coordination DOs (DocumentSession et al.)
  are exempt: ephemeral state *wants* auto-placement near users.
- **No dump.** PITR is a 30-day undo buffer; Data Studio (Oct 2025) is a per-object UI,
  not a bulk API; there is no raw-file export. A schema-versioned logical export/import
  subsystem becomes first-class — it is simultaneously the restore path beyond 30 days,
  the generation-migration mechanism, the corruption heal, and (at $0.20/GB-mo DO SQLite
  vs $0.015/GB-mo R2, ~13×) the dormant-site archival lever. An untested restore is not a
  backup: scheduled restore drills required. Cold-history *reads* should be read-through
  from R2 epoch manifests, never rehydration.
- **Two-store atomicity:** version row in the DO, blob in R2 — no cross-store transaction.
  Blob-first write ordering + orphan GC replaces `BEGIN/COMMIT` for that seam.

### The scope accounting that parks it

| Postgres gives declaratively | The DO architecture makes you build |
|---|---|
| `BEGIN/COMMIT` | Two-store atomicity protocol + orphan GC |
| Disk that grows | Epoch tiering, runway alarms, shard indirection |
| `pg_dump` / PITR / replicas | Schema-versioned export/import + scheduled restore drills |
| One database, cross-site SQL | Directory DB + fan-out queries |
| psql, Query Insights | Admin endpoints, fleet tooling |
| Pick a region at provision | Placement verification, generation-migration machinery |

Plus the migration itself: 19 transactional paths re-engineered, 8 `DISTINCT ON` sites,
every `LATERAL` join, and all bulk-write sites rewritten, the merge job runner's Postgres ledger
(implemented — PR #141, in staging soak) rebuilt, and the content-hash dedupe (§2). Every
probing question asked of this architecture during the exploration added a subsystem —
because each Postgres guarantee has to be rebuilt in application code we then own forever.

## 5. What elimination buys — after the materialized-views design ships

The motivating incidents are already answered without any of this: R2 materialization takes
Postgres off the end-user serving path, and the job runner takes merges off the request
path. What remains on Postgres is editors/collaboration, branch previews, merges, and the
API — low-QPS, transaction-heavy work: precisely the worst fit for the port. The remaining
benefits are the Cloud SQL bill (hundreds/month), the Hyperdrive ~64-connection ceiling
class of problems, and the residual GCP surface (Cloud SQL, the KMS HMAC key the auth
broker signs P1 CCR tokens with — `src/auth/broker/gcp-kms-client.ts`, whose replacement
by WebCrypto + a secret binding moves key material into worker env and needs security
review — Secret Manager, and GitHub-Actions WIF). GCLBs leave via PCC-3740 regardless.
Against multiple engineer-months plus permanent ownership of ~6 new subsystems, and full
vendor concentration (today a Cloudflare outage degrades serving while data stays reachable
on GCP), payback on cost grounds is measured in decades. **Not now.**

## 6. AlloyDB: answers the other multi-region question

Verified 2026-08-28: AlloyDB's cross-region story is DR-shaped — a regional primary, up to
five **read-only** secondary clusters (≤20 read nodes each), writable only by promotion;
2026 adds automated cross-region *failover* (preview). For region-**locking** it is
contraindicated: replication copies the entire dataset into every secondary region — an EU
tenant's rows land in us-central1 by design. No managed Postgres offers per-tenant
placement inside one logical database. (CockroachDB's `REGIONAL BY ROW` genuinely does, but
its partial Postgres compatibility re-imports the same rewrite-risk class as D1.) AlloyDB's
real fit here, if any, is a per-lane engine upgrade (wire-compatible, managed connection
pooling, more connection headroom) — evaluate only if DB load still saturates after the
serving load leaves, which is the load being removed.

## 7. The residency answer, pre-staged: regional Postgres lanes

If per-site residency lands as a requirement, the right-sized design is the one already
prototyped in-repo, not the DO fleet:

- **Lanes are jurisdictional, not per-site**: 2–5 regional Postgres instances (US, EU, …),
  not thousands of placement decisions.
- **Routing precedent exists**: `src/db/resolve-connection.ts:30-45` already selects between
  two Hyperdrive bindings per request (`HYPERDRIVE` / `HYPERDRIVE_NOCACHE`). A residency
  lane is the same switch keyed on a site attribute.
- **Site residency attribute, set at creation** (a real column, not settings JSONB; it is
  load-bearing for provisioning and effectively immutable): a hard `jurisdiction` distinct
  from a soft `locationHint` affinity. **Org-level default** (prefill, overridable per
  site) is distinct from **org-level policy** (an allowlist that site-level choices must
  satisfy — "all our sites stay in the EU" is a policy, not a default). Resolution:
  explicit site value → org default → platform default, then the policy validates the
  winner. Agent-created sites inherit deliberate placement through the org policy — the
  human decision made once, enforced always.
- **One attribute drives every store** holding the site's data: published-objects bucket
  (the per-jurisdiction bucket note on PCC-3738), version-blob bucket (§8), media bucket,
  and the DB lane — otherwise a site's metadata lands in the EU while its images don't.
- New scope is boring, known SQL ops: per-lane terraform, migrations applied per lane in
  CI, backups per lane, fan-out for the rare org-level listing spanning regions (across
  ~3 databases, not thousands of DOs).

## 8. Stepping stones worth doing regardless (proposed, not ticketed)

1. **Measure the actual database size.** Nothing in the repo measures it; COST-MODEL.md's
   300–700 GB figures are assumptions. Snapshot-nulling (`document-version-service.ts:335`,
   `:1043` — prior snapshots nulled once a patch exists, sparing pinned and
   publish-checkpointed rows) means real bytes may be far below the 50 GB provisioned floor.
   Every future decision here is priced off this number.
2. **Blob externalization**: version snapshots/patches to R2 with pointer rows, while still
   on Postgres. Shrinks the DB, extends the materialized-views machinery, tests the
   two-store atomicity seam, and pre-positions residency (R2 buckets are jurisdictional).
   Now referenced from the materialized-views doc §8a as a growth-shaping tool.
3. **Content-hash dedupe on the DO flush path** (§2's `postgres-sync-manager.ts:548`):
   removes the canonical-JSONB-equality dependency; arguably hardens a latent hazard today.

## 9. Reopening triggers

1. **A per-site data-residency requirement** ships on the roadmap. First answer: §7's
   regional lanes. The DO-per-site model re-enters only if residency demands finer
   granularity than jurisdictional lanes can serve.
2. **The DO-sync connection-scaling wall** (SCALING-PLAN's ~100k-concurrent-DO math)
   arrives and connection-architecture fixes (batching, pooling, moving the hot sync path
   DO-local) are exhausted — noting that plan's own conclusion: "the scaling fix is in the
   connection architecture, not the database engine."

Absent a trigger, the standing position is the materialized-views doc §9: dual-write
permanent, Postgres remains the system of record.
