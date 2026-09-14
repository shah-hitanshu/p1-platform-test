# Published-document materialized views — design — 2026-08-21

**Status: DESIGN PROPOSAL — nothing here is implemented.** Postgres stays the system of
record for state, history, and collaboration. On publish, the rendered JSON is
materialized into R2; the live site is served from R2 behind the worker, taking Postgres
out of the end-user serving path entirely. This document is the full design: read
inventory, trigger inventory, store choice, derived-view handling, consistency model,
what it replaces vs. keeps from the cache-remediation plan, rollout, failure modes, cost,
and open questions.

Background: `docs/prod-db-saturation-investigation-2026-08-19.md` (the incident this
answers), `docs/cache-remediation-execution-plan.md` (the in-flight mitigation plan this
partially supersedes), `docs/pcc-3710-isr-tag-spike-2026-08-19.md` (renderer-layer
invalidation, which composes with this design).

---

## 1. Summary of the recommendation

**Adopt the materialized-view model, with a path-keyed object layout and a per-site
manifest, written through a transactional outbox.**

- **Store**: R2, new bucket per env (`css-published-{local,staging,production}`), new
  binding on collaborative-state (worker name unchanged — names are frozen).
- **Key scheme**: `{siteId}/main/pages{path}.json` — derivable from the request URL with
  zero lookups (logical lane name `main`, never a branch UUID). Plus a small set of
  per-site derived objects: `_site.json`, `_manifest.json`, `_redirects.json`,
  `_queries/{name}.json`.
- **Write model**: push/overwrite on every publish-output-changing event, driven by a
  **transactional outbox** row committed inside the same Postgres transaction as the
  state change, consumed by a queue consumer that reads the pinned snapshot from Postgres
  and PUTs to R2. Correctness never depends on cache purge.
- **Read model**: the content routes serve main-branch requests from R2 (2 object reads
  worst case, usually 1 plus an in-isolate memoized site object). `?branch=` requests
  (previews, drafts) stay DB-backed by design. 404 = R2 miss confirmed against the
  manifest, zero DB cost.
- **Auth**: sat_ token validation moves to KV (hash → grant, written on create/revoke),
  with the existing in-isolate memo in front. Revocation lag ≤ ~2 min accepted. Postgres
  fallback retained.
- **Delete**: the materializer deletes the object. The PCC-3669 class of bug ("deleted
  page still live") becomes directly observable: is the object gone. Note this deletes
  only the **derived R2 projection** — the Postgres record keeps its full version
  history behind a tombstone, per the platform's no-delete-by-default principle (§8a
  note below); every object is rebuildable from the system of record.
- **Consistency**: per-key strong consistency from R2; per-document ordering from the
  outbox; cross-document convergence is eventual (a 535-doc merge becomes visible
  page-by-page over the fan-out). Assessed acceptable for a CMS — §6. A
  manifest-pointer-flip upgrade path is sketched for future atomic-release semantics.
- **The Workers Cache front (CachedContent entrypoint) stays**, demoted from
  correctness-critical to a latency/cost shim with short TTLs. Purge becomes best-effort.

Why this instead of finishing the current cache-remediation plan as-is: the plan makes
the DB-backed path cheaper and better-cached; it does not remove the structural coupling.
Every cache in the current plan is pull-through, so correctness depends on purge — and
PCC-3715 proved all purges had been silent no-ops (fixed in #125, deployed 2026-08-20), while Cloudflare purge rate limits
(error 1134) were hit by per-page publishes the same week. A push/overwrite model has no
purge dependency, no rate-limit exposure on the correctness path, and makes DB incidents
invisible to end users by construction rather than by luck. The plan's tickets are
dispositioned individually in §8 — several remain worth shipping.

---

## 2. Current serving path — full read inventory

Everything a public page render actually reads today, traced end to end
(`apps/p1-starter` → `packages/p1-next-sdk` → `packages/puck-css` →
`workers/collaborative-state`). Each row must be materialized, KV/edge-cached, or
consciously left dynamic.

| # | Read | Route / code | DB cost today | Disposition |
|---|------|--------------|---------------|-------------|
| RD1 | Redirect probe, **every request incl. asset paths** | `createP1Middleware` → `GET /api/sites/:id/redirects/content/<path>` → `redirect-content-api.ts` | getMainBranch + `_redirects/<path>` doc lookup + latest version; on miss, an ancestor walk of O(path-depth) more doc lookups. **Response carries no Cache-Control at all — fully uncached today.** | Materialize: per-site redirect map object (§5.3) |
| RD2 | Page document | `loadPublishedPage` → `GET /api/sites/:id/content/<path>` → `content-api.ts handleGetContent` | resolveBranch (getMainBranch) + getDocumentByPath + getLatestPublishedDocumentVersion + hasTombstoneAfterVersion + getSiteSettings + getSite ≈ 5–7 serialized queries, p50 1.1 s | Materialize: page object (§5.1) |
| RD3 | Semantic-override base page (instance pages store `{kind:"semantic", basePath, ops}`) | `resolvePageData` recursion in `puck-css/data/page-store.ts` | One more full RD2-style read (another content GET) | Materialize: base page is itself a page object; second object read |
| RD4 | Template fall-through (path has no own document) | `resolvePageData`: `store.keys()` → `GET /branches/:branchId/documents` + `store.get(templateKey)` | Full branch document listing (the PCC-3704 48%-of-DB-time flood) + one content read | Manifest object serves the key list (§5.2); template page is a page object |
| RD5 | Route template keys, every render | `loadRouteTemplateKeys` → `store.keys()` → branch document listing (30 s in-process TTL only) | Same listing flood as RD4 | Manifest object (§5.2) |
| RD6 | Query registry list, every render | `createCssQueryFetchers` → `queries.list` → `query-api` → `listQueries`: prefix listing of `_registry/queries/` + latest versions | 2–3 queries per render (in-flight dedupe only) | Manifest object carries query names; per-query result objects (§5.4) |
| RD7 | Query results, per listing/Connectable block | `queries.getResults` → `executeQuery`: query doc + datasource doc + filtered doc listing + count + latest snapshots for N rows | The heaviest single read; scales with block count | Materialize: `_queries/{name}.json` (§5.4) |
| RD8 | Cross-page references `{{ pages["/x"].blocks[…] }}` | `resolveCrossPageTemplates` → `getPage(otherPath)` per referenced page, recursive to `MAX_XREF_DEPTH` | One content read per referenced page | Each referenced page is a page object; served from R2 |
| RD9 | Remote datasources (external HTTP) | `REMOTE_DATASOURCE_FETCHERS` | No DB | **Consciously dynamic** — out of scope |
| RD10 | sat_ token validation, every worker call | index.ts auth → `site-api-token-service.ts` (in-isolate memo, 60 s TTL, 1000 entries) | 1 query per cold isolate / expired entry | KV-backed validation (§5.5) |
| RD11 | Page list (`GET /content-pages`, `getPagePaths`) | `content-api.ts handleGetContentPages` | Listing + per-doc published-version + tombstone probe for every doc | Manifest object (§5.2). No render-path consumer in-repo; external SDK/sitemap consumers keep the endpoint, served from R2 |
| RD12 | Site-derived SEO metadata (siteName, ogImage, ogLocale) + cache TTLs | folded into every content payload via `buildPageMetadata` + `getSiteSettings` | Included in RD2's 5–7 queries | `_site.json` object, memoized in-isolate (§5.1) |

Not read on the public path (verified): navigation/structures (editor-only — published
navigation lives inside page JSON as header/footer blocks), locale variants (separate
documents at their own paths; nothing extra to do), document version history, presence.

Two latent findings surfaced by the trace, listed here as findings (not fixed by this
doc):

- **F1 — redirect probes are fully uncached** (RD1): no `Cache-Control`, no `Cache-Tag`,
  and the route runs on every request including static-asset paths. This is an
  unaccounted second per-request DB path alongside the content read.
- **F2 — document rename purges nothing**: `handleUpdateDocument` (path/locale change,
  `document-api.ts`) changes the live URL mapping immediately — `app.documents.path` is
  site-scoped and branch-agnostic — but has no `purgeContentCache` call. Today that
  leaves both the old and new path stale at the edge for TTL+SWR. In the target design
  rename is an explicit trigger (T6).

---

## 3. Correctness nuance the design must decide: what "published" means for registry reads

Page documents on main serve **published** versions (`getLatestPublishedDocumentVersion`,
checkpoint-gated, tombstone-aware). But three read families serve **latest** versions on
main with no publish gate:

1. Redirects (`redirect-content-api.ts` uses `getLatestDocumentVersion`),
2. Query registry + query results (`executeQuery` lists latest snapshots),
3. Datasource registry.

So today, writing a `_registry` or `_redirects` document changes live output instantly
with no publish step — and an unpublished direct-API edit to a content document on main
leaks into listing blocks (its latest snapshot ≠ its published snapshot).

The materialized design has to pick a semantic per family. Recommendation:

- **Redirects, query definitions, datasources: keep latest-on-main semantics** (write =
  live). That is the operational model users have; these are site plumbing, not content.
  Their writes simply become materialization triggers.
- **Query RESULTS: switch to published-only.** Materialized results are rebuilt from
  published versions and tombstone-aware, matching what the pages themselves serve. This
  is a deliberate, user-visible behavior change (a fix — unpublished edits stop leaking
  into listing blocks) and needs product sign-off. Flagged in §11.

---

## 4. Materialization trigger inventory

Every state change that alters published output, with where it hooks. Triggers marked ⊗
have **no purge today** — they are currently silent staleness sources that the outbox
closes.

| # | Event | Code hook (today's purge site) | Objects to (re)write |
|---|-------|-------------------------------|----------------------|
| T1 | Single-document publish | `checkpoint-publish.ts publishDocument` — called from `document-api.ts` publish route, `internal-api.ts /internal/publish` (DocumentSession DO flush), `site-service.ts` root-page seed | page object; manifest; affected `_queries/*`; pages that cross-reference it (§5.6) |
| T2 | Merge auto-publish (N docs) | `merge-publish.ts publishMergedVersions` | N page objects; manifest once; affected `_queries/*` once; `_redirects.json` once when any merged doc is under `_redirects/` |
| T3 | Delete/tombstone on main, incl. via merge | `document-api.ts handleDeleteDocumentOnBranch` (PCC-3669) | DELETE page object; manifest; `_queries/*`; `_redirects.json` when delete-with-redirect |
| T4 | Archive document (soft delete) | `document-api.ts handleDeleteDocument` → `archiveDocument` | DELETE page object; manifest; `_queries/*` |
| T5 | Restore document | `document-api.ts handleRestoreDocument` | page object reappears (published version is pinned, PCC-3652); manifest; `_queries/*` |
| T6 ⊗ | Document rename / locale change | `document-api.ts handleUpdateDocument` → `updateDocumentFields` | DELETE old-path object + PUT new-path object; manifest; `_queries/*` (paths appear in results) |
| T7 | Site import (bulk) | `site-import-api.ts` | full site rematerialization (backfill routine, §9) |
| T8 ⊗ | Site rename | site update (site.name is in every payload's metadata; site.updatedAt is in every ETag) | `_site.json` only (why pages must not embed site metadata — §5.1) |
| T9 ⊗ | Site settings update (ogImage, ogLocale, TTLs) | `site-settings-service.ts updateSiteSettings` | `_site.json` only |
| T10 ⊗ | Redirect create/update/delete | `redirect-api.ts` writes; `deleteDocumentWithRedirect` | `_redirects.json`; manifest (redirect sources list) |
| T11 ⊗ | Query registry write | `query-api.ts` / `query-service.ts createQuery/deleteQuery` | `_queries/{name}.json` (create/delete); manifest |
| T12 ⊗ | Datasource registry write | `datasource-api.ts`, `backfill-datasources-api.ts` | any `_queries/*` bound to the datasource |
| T13 | Token create/revoke | `site-token-api.ts` | KV auth entry (§5.5) |

Non-triggers, verified: **template migration** (`migration-service.ts`) writes new
*latest* versions and a `pre_migration` checkpoint only — migrated content on main does
not go live until republished (T1/T2 fire then). **Version restore**
(`restoreDocumentVersion`) creates a new latest version, unpublished. Draft-branch writes
never touch main output.

**Underscore-path rule:** documents under `_redirects/` (and any future system path
convention) publish through T1/T2 like ordinary documents — redirects deliberately
branch/merge as user content (PCC-3616, `REDIRECTS_PATH_PREFIX` in `types/redirects.ts`)
— but they must **never get a page object**. The consumer routes them to their derived
object instead (`_redirects/*` → rebuild `_redirects.json` from published redirect docs,
consistent with §3's published-only semantics).

**Future trigger — unpublish (feature under discussion, not implemented today):** the
nearest existing operations are archive (T4) and delete/tombstone (T3). When unpublish
lands, the store operation is already defined — DELETE the page object + manifest and
`_queries/*` rewrites; re-publish is a plain T1 PUT. The one hard requirement it adds is
DB-side: unpublish must write a **durable supersession marker** (the analog of
PCC-3669's tombstone-supersedes-publish record), because the backfill/reconciler (§9,
open Q6) rebuilds the store from DB state — object absence alone is not represented in
the DB, and without a marker a full-site rematerialization would resurrect unpublished
pages from their pinned published versions.

### Outbox, not fire-and-forget

Today's purges run post-commit, best-effort, and never throw — which is exactly how
PCC-3715 stayed invisible. Materialization must not repeat that shape. Design:

- `app.publish_events` table: `(id bigserial, site_id, kind, document_id?, path?,
  version_id?, created_at, processed_at?)`. The row is INSERTed **inside the same
  transaction** as the publish/delete/rename (in `publishDocument`'s existing
  transaction; in `createCheckpoint`'s for merges; in each T-row's write path).
- A queue producer (post-commit, or a scheduled sweeper as backstop) enqueues event IDs
  to a new queue (`css-materialize-queue-{env}`). **Messages carry IDs only, never
  snapshots** — published snapshots exceed 128 KB (the DO-sync incident proved queue-side
  size failures are silent and nasty).
- The consumer loads the event + pinned snapshot from Postgres, builds the object(s),
  PUTs to R2, marks `processed_at`. Unprocessed-row age is the staleness metric and the
  alert.
- Per-document ordering: consumer processes events for the same document in `id` order
  (single consumer with batching is sufficient at current publish volume); each object
  PUT stamps `versionNumber` + event id in R2 custom metadata, and the consumer skips a
  PUT whose event id ≤ the stored one — replays and races are idempotent and monotonic.
- **Derived-object coalescing (invariant, not an optimization):** R2 allows **1
  concurrent write/second per key** (429 above it — and an analogous per-key ceiling is
  demonstrably live in this stack: Cloudflare's purge limiter (error 1134, a distinct
  mechanism) was hit by publish loops on 2026-08-21). Shared derived
  objects (`_manifest.json`, `_queries/*`, `_redirects.json`) must be written **at most
  once per consumer batch**: the consumer collects all page-level events in the batch,
  applies page PUTs/DELETEs, then rewrites each affected derived object exactly once. A
  535-doc merge fan-out that rewrote the manifest per document would 429 immediately.
  Across batches, back-to-back rewrites of the same derived key should be paced ≥1 s
  (trivial at a single consumer; restate if the consumer is ever parallelized).

This is deliberately shaped to ride the merge-job-runner's durable pipeline if that
lands: a durable job that publishes N documents just commits N outbox rows as it goes.
The only contract between the two designs is the outbox table — no dependency on the job
runner's internals.

---

## 5. Store layout and read path

All objects live under `{siteId}/main/…`. `main` is the logical lane name; if branch
lanes are ever materialized the scheme extends, but branch previews are deliberately
DB-backed (low volume, high churn, COW semantics that would churn objects).

### 5.1 Page objects — `{siteId}/main/pages{path}.json` (path lowercased, no trailing slash; root = `pages/index`... see Open Q7)

Content: the current `PageContent` response body **minus site-derived metadata** —
`documentId, path, data (the pinned published snapshot, stored exactly as authored —
semantic-override entries stay semantic entries, §5.6), branchId, branchName,
isMainBranch, versionNumber, versionCreatedAt`, plus a content hash. The serving worker
composes the response by merging in `metadata` from `_site.json` and computing the ETag
from `(versionId, site.updatedAt)` exactly as today — so T8/T9 (site rename, settings
change) rewrite **one** object instead of every page.

`_site.json`: `{ siteName, ogImage?, ogLocale?, cacheTtlMain, cacheTtlBranch,
siteUpdatedAt, materializedAt, backfillComplete: bool }`. Read per request but memoized
in-isolate (30 s TTL, same pattern as `site-api-token-service`'s memo) — steady-state
cost ≈ 0.

Serving `GET /api/sites/:id/content/<path>` on main:
1. `_site.json` (memoized) — if absent or `backfillComplete=false`, fall back to the
   existing DB path (this is the per-site migration gate, §9).
2. `GET pages{path}` — hit: compose, honor If-None-Match, return with the same
   Cache-Control/Cache-Tag headers as today. Miss: consult manifest (memoized) for a
   template fall-through key; if none, 404 with today's short-TTL miss headers. **A 404
   costs zero DB queries and at most one un-memoized R2 read.**

### 5.2 Manifest — `{siteId}/main/_manifest.json`

`{ pages: [{path, documentId, lastModifiedAt, templateId?}], templateKeys: [...paths
with :param segments...], redirectSources: [...], queryNames: [...] }`. At 800 documents
today this is tens of KB; at 100k documents ~5–10 MB, still one object (revisit sharding
then). Rewritten (read-modify-write, serialized per site by the consumer) on T1–T7,
T10, T11.

Serves: `GET /content-pages` verbatim (published+tombstone semantics are baked in at
write time — the per-doc probe loop in `handleGetContentPages` disappears);
`loadRouteTemplateKeys`/`store.keys()` via a new lightweight endpoint the SDK's `keys()`
switches to; fall-through resolution inside the serving worker. Note this **also
retires the non-main `/content-pages` COW-drop bug** for main-lane consumers by
construction.

### 5.3 Redirect map — `{siteId}/main/_redirects.json`

The full redirect set for the site: `{ "<fromPath>": {destination, redirectType,
parenting} }`. Redirect counts are bounded (site-configured, not per-visitor). The
serving worker answers `GET /redirects/content/<path>` from the memoized map, including
the parenting ancestor-walk — in memory, not as N queries. RD1 goes from
"uncached DB probe per request including assets" to zero-DB, near-zero-R2. Rewritten on
T3 (delete-with-redirect), T10, and T2 when a merge lands `_redirects/*` docs. The map
is rebuilt from **published** `_redirects/*` documents (§3 semantics).

**Size guard:** at ~100–150 bytes/entry, 10k redirects ≈ 1–1.5 MB — a cold isolate pays
one R2 GET + JSON.parse (~10 ms/MB CPU) and holds the map in memory alongside other
sites' maps (128 MB isolate). Single map is the right shape up to **~5k entries/site**
(WP-migration sites can carry more). Above the threshold, shard by **top-level path
segment** (`_redirects/{segment}.json` + a root shard) — lookup stays one read, and
unlike hash-sharding the parenting ancestor-walk stays within one shard. KV point
lookups and (post-zone-migration) Cloudflare Bulk Redirects are the escalation options —
see open Q10.

### 5.4 Query results — `{siteId}/main/_queries/{name}.json`

The `ExecuteQueryResult` payload, rebuilt by re-running `executeQuery` **against
published versions** (§3) whenever: the query or its datasource changes (T11/T12), or a
publish/delete/rename touches a document whose `templateId` matches the query's
datasource template (the consumer knows the published doc's templateId from the event).
Pagination: materialize the default page (`defaultLimit`, offset 0) — that is what
rendering uses; non-default `limit/offset` requests (API consumers) stay DB-backed and
rare. The renderer's `createCssQueryFetchers` repoints `getResults` at a new
`GET /api/sites/:id/content-queries/{name}` served from the object.

This is the derived-view core: listing pages ("latest N posts") stop costing per-render
DB work, and their freshness is event-driven — publish a post, the consumer rewrites the
affected query objects, every page embedding that query serves the new list on its next
render (subject to the renderer's own ISR window, §8/PCC-3710).

### 5.5 Auth — KV-backed sat_ validation

On token create/revoke (T13), write/delete `sat:{sha256(token)}` → `{siteId, scopes}` in
a KV namespace. Validation order: in-isolate memo (existing, 60 s) → KV
(`cacheTtl: 60`) → Postgres fallback (kept; logs when hit). Revocation lag: memo 60 s +
KV propagation ≤ 60 s + cacheTtl 60 s ≈ **≤ 2–3 minutes worst case** — accepted
trade-off, documented for security review. (Signed/self-validating tokens would remove
the lookup entirely but change the customer-visible token format; rejected for now.)
Note KV caches negative lookups too — a revoked/garbage token cannot hammer Postgres.

### 5.6 Derived views and dependency tracking — the honest version

Three dependency classes, three answers:

1. **Template → instances** (publishing `/jedi/:id` changes every `/jedi/*`): no
   re-materialization needed at all — instances resolve through the template object at
   read time (fall-through via manifest; semantic-override objects store
   `{basePath, ops}` and the worker/SDK resolves the base with a second object read,
   exactly today's model, byte-compatible with the current renderer). Flattening
   instances at publish time was considered and rejected for v1: it turns one template
   publish into an unbounded object fan-out and duplicates the base into every override.
2. **Query results → matching documents**: tracked by templateId as in §5.4 —
   deterministic, no registry of "which page embeds which query" needed because query
   results are their own objects.
3. **Cross-page references** (page B inlines a prop of page A): the resolver runs at
   render time and reads page A's object — so B's *object* never goes stale; only B's
   *rendered HTML* in the Next ISR cache can. That is precisely PCC-3710's job
   (path-keyed tags, `revalidateTag` fan-out) — see §8. We deliberately do **not**
   maintain a reverse-reference index in the store for v1; the spike already proved the
   renderer can carry this dependency with tags whose cardinality is bounded by
   `MAX_XREF_DEPTH`.

Reconciliation with the PCC-3710 ISR-tag spike: **tag-based ISR at the renderer
complements store-side materialization; neither replaces the other.** Materialization
fixes the *origin* (what a fetch returns, and what it costs); ISR tags fix the *renderer
cache* (when a cached HTML render is rebuilt). Without 3710, publish visibility is
bounded by `revalidate = 300` regardless of how fast the origin is. The publish→renderer
signal 3710 needs (webhook or cursor) should be emitted from the same outbox consumer —
one event stream feeds both layers.

---

## 6. Consistency and atomicity

Facts (Cloudflare docs, verified 2026-08-20): R2 is strongly consistent per key —
after a PUT returns, all subsequent GETs anywhere see the new object; deletes are
immediately visible. There are no cross-key transactions. Same-key writes are limited to
~1/sec (429 above that). Workers KV is eventually consistent (≤ 60 s propagation +
cacheTtl, min 30 s) with a 1 write/sec/key limit — which is why KV is used here only for
auth grants, never for content.

**Per-page**: strong. A publish is visible globally the moment its PUT lands; monotonic
via the event-id metadata guard (§4). Same-key 429s are absorbed by consumer retry with
jitter; the outbox naturally coalesces rapid republishes of one path (process only the
newest pending event per document).

**Cross-page (the 535-doc merge)**: objects appear one by one over the fan-out — seconds
to a couple of minutes through the queue. Is that acceptable for a CMS? Yes, and it is
not a regression: today a merge triggers one **site-wide purge** followed by progressive
on-demand re-fill from Postgres through per-page TTL + stale-while-revalidate windows —
viewers already see mixed old/new during every merge, and (per PCC-3715) currently see
*only* old until TTLs lapse. The materialized fan-out is strictly more ordered, and
ordering can be chosen (e.g., leaf pages before the nav-bearing homepage). What is
guaranteed: convergence, per-page monotonicity, and no window where a page 500s or
half-renders — every intermediate state is "old consistent page" or "new consistent
page".

**If atomic releases are wanted later** (product feature, not a platform need):
content-addressed objects `{siteId}/objects/{sha256}.json` + a manifest mapping
path→hash, flipped with one PUT. Costs that keep it out of v1: every read needs the
manifest (per-request second read, or a memo TTL that reintroduces bounded staleness —
the thing this design removes); orphaned-object GC; the manifest becomes a 1-write/sec
serialization point for *all* publishes on a site. The path-keyed layout loses nothing
that today's system has, and the CAS layout can be adopted incrementally later (page
objects become pointers) if "releases" become a feature.

---

## 7. Failure modes

| Failure | Behavior | Backstop |
|---|---|---|
| Publish commits, R2 PUT fails | Outbox row stays unprocessed; queue retries with backoff; page serves the previous published version (stale, not broken) | Unprocessed-row age alert; DLQ; nightly reconciler |
| Partial merge fan-out (consumer dies mid-way) | Processed pages new, rest old; resumes from outbox; converges | Same as above; per-doc idempotency makes replays safe |
| Store/DB drift (bug, manual DB surgery, missed trigger) | Wrong content served with no error — the silent failure class | Nightly reconciler: recompute expected object set + content hashes from Postgres, diff against manifest + R2, log/alert/heal; plus an admin "rematerialize site" command (same code as backfill) |
| R2 outage | Serving worker falls back to the retained DB path — **behind a concurrency cap / circuit breaker** so a full-traffic failover cannot re-saturate the 64-connection pool (fail open to *degraded*, not to *incident*); Workers Cache front continues serving hits | Worst case = today's behavior, capped |
| KV outage / miss on auth | Postgres validation fallback (memoized). Never fail open on auth | Log-on-fallback |
| R2 429 same-key write | Retry with jitter; outbox coalescing | — |
| Queue outage | Outbox rows accumulate; sweeper re-enqueues when healthy; staleness bounded and *measured* | Row-age alert |
| Rename race (T6: delete old + put new) | Ordered within the event: PUT new, then DELETE old — transient window serves both paths, never neither | — |
| Renderer staleness | Next ISR `revalidate=300` bounds it until PCC-3710 ships tags + publish signal | 3710 |

The structural improvement over today: every failure above is **visible** (unprocessed
rows, reconciler diffs, fallback logs) and **bounded** (retry until convergence). Today's
equivalent failure — purge silently no-oping — was invisible and unbounded.

---

## 8. Disposition of the cache-remediation plan, ticket by ticket

*States verified 2026-08-21 against `origin/main` and prod release
`collaborative-state-worker/2026.08.20-53` (live since 2026-08-20 16:27Z). Every merged
cache-remediation commit is in that release — nothing from this plan sits merged-but-
undeployed.*

| Ticket | Verified state (code / Jira) | Disposition under this design |
|---|---|---|
| **PCC-3712** — memoize branch resolution per isolate | **DEPLOYED** (#120, merged 08-19, in prod release). Jira lags: "In Code Review" | **Done — keep it.** Independent and still load-bearing: branch previews, the editor, redirects-during-migration, and the DB fallback path all keep hitting branch resolution. Close out the ticket. |
| **PCC-3715** — purges are success-logged no-ops (entrypoint scope bug) | **FIXED & DEPLOYED** (#125, merged 08-20, in prod release). Jira lags: "In Code Review". Post-fix, Cloudflare purge rate limits (1134) are a live constraint — observed on per-page publish loops 2026-08-21 00:18Z | **Done.** The design still demotes purge from correctness-critical to latency sugar on the main lane: with push/overwrite + short front-cache TTLs (≤ 60 s), a rate-limited purge costs seconds of staleness, not unbounded staleness. The 1134 ceiling now argues *for* the push model, not just around broken purges. |
| **PCC-3709** — granular purge-tag taxonomy (`doc:/list:/miss:` + purge matrix) | **Phase 1 DEPLOYED** (#122 narrow delete-class purges + listing tags; #124 log redaction — both in prod release). Jira: In Progress. Remaining `miss:`/matrix slice blocked on Nick's reply in PCC-3705 (Open, unassigned) | **Descope the remaining slice.** Its motivation (precise invalidation of a pull-through cache) mostly evaporates when main serving is push-based. Phase 1's shipped tags keep serving the front cache and the branch lane. Recommend: hold the `miss:`/matrix work; revisit after Phase 2 (§9) rather than building taxonomy the target state won't consume. Coordinate with Nick before descoping — 3705 overlaps. |
| **PCC-3711** — KV known-paths allowlist (miss shield) | Not started (Jira: Open, unassigned; no commits) | **Superseded on main** — an R2 miss already costs zero DB and ~$0.36/M, which *is* the miss shield. Still potentially useful for the branch lane (pathPrefix probes against DB-backed previews); rescope to branches-only or drop. |
| **PCC-3710** — tag-based ISR invalidation in renderer | Spike passed; implementation not started (Jira: Open, unassigned; no commits) | **Keep — complementary, not replaced** (§5.6). The renderer's HTML cache still needs event-driven invalidation; the publish signal should come from the materialization outbox consumer, giving one event stream for both layers. The spike's path-keyed-tag amendments stand unchanged. |

Also retired by construction on the main lane: the branch-doc-listing render flood
(RD4/RD5 — manifest), the uncached redirect probe (RD1 — F1), the `/content-pages` per-doc
probe loop, and the content-render query storm (RD2). The prod-DB-saturation
remediation's residual DB load becomes: editors/collaboration, branch previews, and the
API surface — none of it end-user-facing.

### 8a. Retention pressure and the no-delete principle

The 2026-08-20 load review (finding 7) is right that version/checkpoint growth is the
curve behind several hot-query costs — but **"retention" here must not mean deletion.
Nothing is deleted by default on this platform; content is archived or hidden instead.**
This is a deliberate agent-safety design decision: LLM agents operate on this platform
through MCP and agent APIs, and destructive primitives invite destructive goal-seeking.
Growth pressure is therefore answered by shaping storage and queries, not by dropping
rows:

- **Exclusion over deletion**: superseded/archived rows (old session-checkpoint
  manifests, registry history, incident-created duplicates) get marked and excluded from
  hot-query predicates, with partial indexes covering only the live set — the query cost
  of history goes to ~zero while the history remains.
- **Cold tiering / partitioning**: age- or state-based partitions (or archive tables)
  move dormant rows out of the hot tables the serving and merge paths scan.
- **Compaction to baselines, preserving reconstructability**: periodic re-baselining
  (fresh snapshot every K patches) bounds chain-replay cost without discarding any
  version.
- **Blob externalization**: version snapshots and patch payloads move to R2 with pointer
  rows (relational history stays queryable; content stays fully reconstructable). This
  takes the growth curve's actual bytes out of Postgres using the same machinery this
  design builds, and — because R2 buckets carry jurisdiction — pre-positions per-site
  data residency. Explored in `docs/postgres-elimination-exploration-2026-08-28.md` §8.
- **True deletion is an explicit, human-approved exception** — never an automated
  default, never agent-invocable. Candidates (write-only registry history, the ~600
  incident duplicates) each need their own signed-off task with reference-integrity
  verification.

This section exists so the review's "retention as a first-class feature" recommendation
is implemented in the compliant shape.

---

## 9. Rollout

Sites today: ~800 documents total — backfill is trivial; the phasing exists for safety,
not scale.

- **Phase 0 — plumbing** (no behavior change): outbox table + migration; queue +
  consumer skeleton; R2 bucket + binding; KV namespace; `_site.json` writer. Feature
  flag: per-site `materialization: off | dual-write | serve` in site settings JSONB.
- **Phase 1 — dual-write + backfill**: triggers T1–T13 write outbox rows; consumer
  materializes; serving unchanged (DB). Backfill command walks a site (published
  versions on main, tombstone-aware — reusing `content-api`'s exact serving rules as the
  oracle) and writes all objects, then stamps `backfillComplete` in `_site.json`.
  Reconciler runs nightly from day one. **Exit gate: N days of zero-diff reconciles on
  staging + pilot production sites.**
- **Phase 2 — read from R2, fallback to DB**: serving worker prefers R2 when
  `backfillComplete`; any R2-layer error falls back to the DB path (capped, §7) and
  logs. Misses do *not* fall back once the manifest confirms the path is absent — this
  is the moment 404 storms stop touching Postgres. Canary per site: staging → pilot
  sites → fleet.
- **Phase 3 — steady state**: R2 authoritative for main-lane reads; DB path retained
  behind the circuit breaker as the R2-outage fallback; dual-write is permanent (R2 is a
  disposable view — Postgres remains the system of record, and any site can be
  rematerialized from scratch at any time). Full Postgres elimination (JSON to R2 as
  system of record, relational state to D1 or per-site DO SQLite) was explored and
  **parked** 2026-08-27/28 — `docs/postgres-elimination-exploration-2026-08-28.md` has
  the scope accounting and the two reopening triggers (a per-site data-residency
  requirement; the DO-sync connection-scaling wall).
- **Rollback** at any phase = flip the site flag back; objects are inert.

Interim interaction: Phases 0–1 coexist with the current cache plan untouched. The
CachedContent Workers-Cache front keeps working identically in front of both origins —
it caches responses, not sources.

---

## 10. Cost estimate

Volume basis: 10–16k content requests/hour ≈ 8–12M/month, plus redirect probes (similar
order, but memoized maps make most of them free), at ~800 documents / ~50 KB average
object size.

| Item | Math | $/month |
|---|---|---|
| R2 Class B (reads) | 12M/mo, minus 10M free tier, ×$0.36/M | **~$1** (front-cache hits reduce further) |
| R2 Class A (writes) | publishes + derived rewrites ≪ 1M/mo free tier | **~$0** |
| R2 storage | 40 MB today; even 100k docs ×50 KB = 5 GB ×$0.015 | **<$0.10** |
| R2 egress | free | $0 |
| KV | auth reads mostly absorbed by in-isolate memo | **~$0** |
| Queue + consumer invocations | thousands/mo | **~$0** |

Total: **under $10/month at 10× current traffic.** The real return is operational:
p50 for a 200 goes from ~1.1 s (5–7 serialized Postgres queries through GCLB) to one
worker hop + 10–50 ms R2 read; 404s from ~334 ms + 3 queries to ~10–30 ms + 0 queries;
and the ~64-connection CloudSQL ceiling stops being an end-user availability boundary at
all — crawler storms land on R2, which is built for exactly that shape.

---

## 11. Open questions

1. **Query-results semantics** (§3): published-only materialization is a behavior change
   vs today's latest-on-main. Needs product confirmation. (Recommended: yes, it's a fix.)
2. **Non-default query pagination**: leave DB-backed (recommended), or materialize the
   first K pages per query?
3. **Instance flattening** (§5.6): revisit if two object reads per override page shows
   up in latency; requires template-publish → override-set fan-out via manifest.
4. **Branch lane**: confirmed out of scope (DB-backed previews) — consistent with the
   walked-back auth-gating direction. Revisit only if branch preview volume changes.
5. **Purge of the Workers Cache front on publish**: keep per-publish best-effort purge
   (3715's fix is deployed; the constraint is now the purge rate limit, error 1134), or drop purge entirely and run the front at TTL ≤ 30 s? Cost/latency
   tradeoff to measure in Phase 2.
6. **Reconciler cadence and blast radius**: nightly full-fleet vs. per-site on a rolling
   schedule once sites × docs grows.
7. **Path encoding in keys**: exact normalization must be byte-identical to
   `normalizePath` (lowercasing included) plus an escaping rule for `.json`-colliding and
   root paths — specify in the implementation ticket, with shared fixtures serving both
   writer and reader (the same byte-identical-normalization lesson as 3709's tags).
8. **Where the serving read lives**: inside the existing CachedContent entrypoint
   (simplest — same worker, R2 binding) vs. a separate thin serving worker (isolation,
   but new frozen-name/routing work). Recommended: same worker, new code path.
9. **PCC-3705/3709 coordination**: Nick's in-flight purge work overlaps the descoping in
   §8 — needs a conversation before either ticket moves.
10. **Redirect-map scale**: confirm the ~5k-entries/site single-map threshold (§5.3) and
    the top-level-segment sharding mechanics; decide when KV point lookups (exact-match
    profile, ~60 s eventual consistency, ancestor walk becomes ≤ path-depth lookups) or
    zone-level Cloudflare Bulk Redirects (post-zone-migration, 10k+ entries native)
    supersede sharding. Needs real customer redirect-count data.
11. **Site residency attribute** (feeds the per-jurisdiction bucket note on PCC-3738):
    sites need a residency attribute set at creation — a hard jurisdiction (contractual)
    distinct from a soft location affinity (latency) — with org-level *defaults* (prefill,
    overridable per site) distinguished from org-level *policy* (an allowlist site-level
    choices must satisfy: "all our sites stay in the EU" is a policy, not a default; it is
    also how agent-created sites inherit deliberate placement). One attribute must drive
    every store holding the site's data: published-object bucket, version-blob bucket (if
    §8a blob externalization lands), media bucket, and any future regional DB lane.
    Product gate, same class as Q1/§6's sign-offs. Design detail in
    `docs/postgres-elimination-exploration-2026-08-28.md` §7.
