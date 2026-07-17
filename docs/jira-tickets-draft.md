# Jira ticket drafts — P1 Media metadata

Draft 2026-07-10 for review before creation. All stories hang under Epic
**PCC-3163 "P1 Media Asset Management"** (Initiative PCC-3146 "Launch P1 Private Alpha").
Design of record: `docs/media-metadata-design.md`. Quick-win handoff:
`docs/alt-text-implementation.md`. Requirement IDs (R0–R11) refer to the design doc's
"Security & reliability requirements (v1)" section.

Ordering below is the recommended delivery sequence. PCC-3278 (write-role enforcement)
already exists and is referenced, not duplicated.

---

## Epic PCC-3163 — description (fills the empty epic)

Paste as the epic body. It stands alone for stakeholders; the repo design doc carries
the implementation minutiae (SQL, endpoint-by-endpoint, R0–R11).

> ### P1 Media Asset Management
>
> **Problem.** Images uploaded through the P1 media system carry no metadata. Content
> editors cannot set alt text, so rendered pages emit images with missing or hardcoded
> `alt` — an accessibility gap — and there is no home for descriptive metadata (byline,
> location, caption). Separately, R2 objects are keyed per workstream
> (`{siteId}/{workstreamId}/media/…`), so after a workstream merges the asset orphans
> from the media library even though it keeps serving. And there is no concept of asset
> identity or versioning, so "replace this image" is not expressible.
>
> **Approach.** A site-scoped, versioned asset model backed by a D1 database alongside R2:
>
> - An **asset** is a logical identity with mutable metadata defaults (alt + extensible
>   fields). Each upload or replacement creates an **immutable version**
>   (`{siteId}/assets/{assetId}/{versionId}-{filename}`), served with long-lived
>   immutable cache headers.
> - Documents **pin a specific version**. Because the document is CCR-managed, all
>   workstream semantics (draft / preview / merge / rollback) come for free — CCR stays
>   the sole source of truth for what a page shows, and the media worker knows nothing
>   about workstreams.
> - Metadata reaches placements via an **edit-time join**: selecting an asset copies its
>   metadata defaults into the document, which the editor can override per placement.
>   Published pages render from the document alone — no runtime API dependency.
> - A new **`p1-media` Puck field type** stores `{assetId, versionId, url, alt, …}` and
>   renders schema-driven metadata inputs; the existing string/text mode is preserved for
>   back-compat. Server-safe **render helpers** (`getMediaProps`, `MediaImage`,
>   `MediaFigure`) are the rendering contract.
> - "Update an asset everywhere" (e.g. a new logo version) is a **reviewable CCR
>   changeset** that re-pins usages in a workstream — never a live global mutation.
>
> **Design of record:** `docs/media-metadata-design.md` in the `p1-media-r2` repo (full
> worker API, D1 schema, and the R0–R11 security/reliability requirements).
>
> **Key constraints & decisions.**
> - **Back-compat is a hard requirement** — the published 0.1.0 plugin and existing
>   string-URL documents must keep working unchanged.
> - **Security blockers that must land with the backend:** per-asset ownership checks
>   (a site must not touch another site's assets — assetIds are not secret);
>   server-generated version ids + conditional writes (a cached, document-pinned URL must
>   not be swappable); write-role enforcement (tracked in PCC-3278); bounded public image
>   transforms (unauthenticated cost DoS).
> - **Legal takedown** needs a hard-purge + cache-invalidation path — soft delete alone
>   cannot honor DMCA / PII / GDPR because of immutable caching.
> - **Stubbed:** org-shared assets (nullable column + reserved key namespace; needs a CCR
>   org auth tier first).
> - **Deferred:** auto-alt AI worker, tombstone placeholder image, CCR content-search /
>   usage index, FTS5 search.
>
> **Child stories:** backend (D1 + worker API + backfill), `p1-media` field type +
> render helpers (plugin 0.2.0), "update usages" bulk changeset, hard-purge/takedown.
> Existing children: PCC-3164 (original Cloudflare upload), PCC-3165 (DAM access control),
> and related PCC-3278 (write-role enforcement).

---

## Story 1 — Media metadata backend: D1 versioned asset store, worker API, backfill

**Type:** Story · **Parent:** PCC-3163 · **Priority:** High
**Depends on / relates to:** PCC-3278 (write-role enforcement, R7), PCC-3279 (TF module move)

**Summary:** Introduce a site-scoped, versioned asset model backed by D1 alongside R2,
with metadata (alt + extensible fields), and expose the worker API the `p1-media` plugin
and library need. Retire the workstream-prefixed key scheme for new uploads.

**Background**
R2 objects are currently workstream-prefixed (`{siteId}/{workstreamId}/media/…`) and
carry no metadata; after a workstream merges, assets orphan from the library. The design
moves to logical assets with immutable versions (`{siteId}/assets/{assetId}/{versionId}-…`),
site-scoped, with documents pinning a version so CCR remains the sole owner of workstream
semantics. See `docs/media-metadata-design.md` (Asset model, Worker API, D1 schema,
Legacy objects, Infrastructure).

**Scope**
- Infra: 3× `cloudflare_d1_database` (one per CF account) in the Terraform module;
  `d1_databases` binding in wrangler.jsonc (all envs + local); `worker/migrations/*.sql`
  + `wrangler d1 migrations apply` step in the deploy workflow (additive-only); D1 token
  scopes in all three accounts.
- D1 schema: `assets` (+ nullable `org_id` stub, `deleted_at`) and `asset_versions`.
- Endpoints: enriched `GET /media`, `GET /media/:assetId`, `POST /media`,
  `POST /media/:assetId/versions`, `PATCH /media/:assetId`, `GET /media/schema`,
  `DELETE /media/:assetId` (soft delete).
- Backfill per env: enumerate legacy R2 objects → seed asset+version rows.

**Acceptance criteria (blockers from review)**
- **R0** Every `…/:assetId` route loads the asset and asserts `site_id ===`
  authenticated siteId (404 otherwise); R2 key built from stored `site_id`, never client
  input.
- **R1** `GET /media` stays a bare array still carrying `{key,url,filename,size,
  lastModified}` (asset fields added alongside); a legacy DELETE-by-key alias is kept —
  the already-published 0.1.0 plugin must keep working. Each env's D1-backed list is
  gated behind a per-env "backfilled" marker so no library renders empty mid-migration.
- **R2** `versionId` is server-generated (UUID); R2 writes refuse an existing key.
- **R3** R2 put succeeds before any D1 write; version row before `current_version` bump;
  `IMAGES.info()` dimension capture is best-effort and never fails the upload.
- **R5** Backfill uses a deterministic assetId from the legacy `r2_key` with
  `INSERT OR IGNORE`, scopes enumeration to the legacy prefix, and completes before cutover.
- **R7** Write endpoints require write-capable role/scope, tracked as PCC-3278. Shipped
  without it — re-derived against CSS's actual role model, no Pantheon human ever maps
  to VIEWER, so the gap needs a site admin's own deliberate grant (human via CSS's
  branch-grants API, or an agent via the Agent Access UI), not an externally reachable
  exploit. Not a go-live blocker; see `media-metadata-design.md`'s R7 entry.
- **R9** Public `/image/*` transform params are range-bounded and/or rate-limited.
- **R11** Search binds the `LIKE` param, escapes `%`/`_`/`\`, keeps `site_id` mandatory.
- **R8 (partial)** A reconcile job/endpoint reports R2-vs-D1 counts and orphan/phantom
  lists per site.

**Out of scope:** the `p1-media` plugin field (Story 2); bulk update-usages (Story 3);
hard-purge/takedown (Story 4); org endpoints (stub only).

---

## Story 2 — `p1-media` Puck field type + render helpers (plugin 0.2.0)

**Type:** Story · **Parent:** PCC-3163 · **Priority:** Medium · **Depends on:** Story 1

**Summary:** Ship a registered `p1-media` Puck field type (object value with metadata)
plus server-safe render helpers, while preserving the existing text-hijack/string mode.
Publish plugin 0.2.0.

**Background**
Rich metadata can't ride in the current text-field-hijack value (a string). Puck ≥0.20
lets a plugin register a new field type via `overrides.fieldTypes`; field transforms do
not apply to `<Render>`, so rendering is done via exported helpers. See design doc
"Two field modes", "Rendering", "Metadata schema".

**Scope**
- Register `overrides.fieldTypes["p1-media"]` + `fieldTransforms["p1-media"]`; object-aware
  field renderer (crop state lives in `value.url`).
- Value shape `{assetId, versionId, url, alt, …}`; `string | MediaValue` union preserved.
- Schema-driven metadata inputs from `GET /media/schema` (fallback `[alt]`).
- Render helpers in `server.ts`: `getMediaProps`, `<MediaImage>`, `<MediaFigure>`.
- Keep text-hijack/basic string mode unchanged.

**Acceptance criteria (blockers from review)**
- **getMediaProps URL validation:** rejects any `url` not `https` on the configured CDN
  origin (falls back to placeholder/empty) — `url` is untrusted document content.
- **R6** `PATCH` metadata enforces per-field length + field-count caps; `MediaFigure`
  renders metadata as escaped text only (no `dangerouslySetInnerHTML`).
- **R10** Plugin probes worker capability and degrades to string-only basic mode against
  an un-upgraded worker; never synthesizes a `MediaValue` unless both `assetId` and
  `versionId` are present.
- Legacy string on a `p1-media` field stays string-only until re-picked (design default
  (a)); no `MediaValue` with undefined identity is ever written.
- Basic (text-hijack) mode and existing string documents render unchanged.

**Out of scope:** library details/PATCH UI and version-history UI (later); bulk update.

---

## Story 3 — "Update usages": bulk asset-version changeset via CCR

**Type:** Story · **Parent:** PCC-3163 · **Priority:** Medium (Later) · **Depends on:** Stories 1–2

**Summary:** Let an editor replace an asset (new version) and propagate the pin across
all referencing documents as a reviewable CCR changeset — no live global mutation.

**Background**
"Update the logo everywhere" must respect draft isolation, so propagation is a workstream
changeset, not a live alias. CCR has no content search; discovery is enumerate-and-scan
over branch documents. See design doc "Updating an asset everywhere".

**Scope / acceptance criteria**
- Create/target a branch → enumerate documents → match placements by structured
  `props.<field>.assetId` (not free-text substring).
- Edits target stable Puck `props.id`, never positional `content[N]`; re-read each doc's
  current content immediately before editing; chunk to ≤100 ops/request.
- Runs as an editor-scoped principal; produces a dry-run diff with an op cap.
- Persists a run manifest (matched/edited/skipped-with-reason); merge refuses or loudly
  warns when the manifest shows skipped/failed docs; re-runs are resumable.
- Ships agent-driven via P1 MCP tools; no product UI required for v1.

**Out of scope:** a CCR content-search API or media-side usage index (later perf work).

---

## Story 4 — Media hard-purge / takedown path (compliance)

**Type:** Story · **Parent:** PCC-3163 · **Priority:** High (compliance) · **Relates to:** Story 1

**Summary:** Provide a hard-delete path that removes bytes and invalidates caches, so
legal takedown requests can be honored.

**Background (R4)**
Soft delete + `Cache-Control: max-age=31536000, immutable` means "deleted" bytes keep
serving for up to a year with no revalidation — there is no way to honor DMCA /
illegal-content / PII / GDPR-erasure. This is a legal obligation distinct from the
deferred DAM features.

**Scope / acceptance criteria**
- Hard-purge operation: delete the R2 object(s) + rows; `GET /image/*` 404s purged keys.
- Cloudflare cache-purge-by-URL step so purge is not bounded by `max-age`.
- Audit record of who purged what and when.

**Out of scope:** user-facing tombstone/"gone" placeholder image (deferred).

---

## Also noted (existing, not created here)
- **PCC-3278** — write-level permission enforcement (= review finding R7). Already Open;
  Story 1's R7 criterion depends on it. Do not duplicate.
- **PCC-3382** — plugin: build in default media URLs. Adjacent plugin work.
- **PCC-3279** — move p1-media-r2 Terraform modules into collaborative-state-system repo.
  Story 1's infra work should coordinate with this to avoid conflicting TF changes.
- **PCC-3166** — Imagor delivery. Closed/superseded by the Cloudflare Images binding.

## Future (backlog, not drafted as stories yet)
- Auto-alt AI worker (Workers AI vision model → machine-generated default alt).
- Library details/PATCH UI + version-history UI.
- CCR content-search API / media-side usage index.
- D1 FTS5 search; org-shared assets (needs CCR org auth tier first).
