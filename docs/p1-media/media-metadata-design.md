# Design: image metadata for P1 Media (`p1-media` field type + versioned asset store)

Status: draft for review — 2026-07-09 (rev. 2026-07-10: folded in security + reliability review, then team feedback)

> **Read the [Security & reliability requirements](#security--reliability-requirements-v1)
> section before building.** The blocker there is cross-tenant ownership checks (R0) plus a
> takedown path that gates immutable caching (R4); several guarantees this doc relies on —
> immutability, takedown, tenant isolation — hold only if those requirements are met.
> Per team feedback (few live, all-updatable consumers today), we do a **one-time migration
> of those consumers** rather than carry a permanent 0.1.0 API compatibility layer; the
> plain-URL string value format stays first-class forever (basic mode, demo-safe).
>
> **R7 (write-role granularity) is deliberately shipped as a tracked follow-up, not a
> blocker** — see the R7 entry below for the re-derived, narrower threat model
> (PCC-3278) that this decision rests on.

## Goals

1. Content editors can set alt text (and future metadata: byline, location, caption, …)
   on images placed in Puck pages.
2. Metadata is stored with the asset (queryable, editable after upload) and flows into
   placements as **defaults** that editors can override per placement.
3. **Backward compatibility of the value format, not the wire API.** The plain-URL string
   value (basic `type:"text"` mode) and existing string-valued documents keep working
   unchanged — forever; this is what keeps demos safe. The published 0.1.0 plugin's *API
   shape* (bare-array `GET /media`, DELETE-by-key) is **not** carried permanently: with
   only a handful of live, updatable consumers today, we migrate them once to the clean
   asset-shaped API instead (see R1).
4. Site builders should not hand-wire per-metadata-field plumbing in their Puck configs.
   Adding a new metadata field later must not require site config changes.
5. **CCR is the sole source of truth for workstream state.** The media system must not
   replicate workstream semantics. Asset changes that should respect draft/merge flows
   must be expressed as document changes in CCR.

## Scoping principle

The media library is **site-scoped and workstream-agnostic** (org scope is an open
question). Assets are logical identities with **immutable versions**; documents pin a
version. Anything needing workstream semantics — which version of an asset a page
shows, what alt text a placement uses — lives in the CCR-managed document, which
already has draft/preview/merge/rollback. The media worker knows nothing about
workstreams.

This replaces the current key scheme, where objects live under
`{siteId}/{workstreamId}/media/…` and become orphaned from the library after a
workstream merges (content keeps rendering — serving ignores key structure — but the
asset vanishes from the library listing in other workstreams).

## Asset model

```
Asset   (logical, mutable defaults)   assetId, siteId, filename, alt, metadata{…}
  └── Version (immutable bytes)       versionId, R2 key, dimensions, size, type
```

- R2 key: `{siteId}/assets/{assetId}/{versionId}-{filename}`
- **Org scoping is stubbed, not built** (CCR has no org auth/content tier yet — orgs
  exist only for agent management): `assets.org_id` ships as a nullable column, and
  the key namespace `orgs/{orgId}/assets/…` is reserved for future org-shared assets.
  No collision risk (siteIds are UUIDs; the literal `orgs` segment is not), and the
  public serving route is key-structure-agnostic (verified: it extracts the first
  path segment and does a tautological prefix check), so org keys will serve with
  zero worker changes when the auth story exists. No org endpoints in v1.
- Uploading "a new image" creates an asset + v1. "Replace image" on an existing asset
  creates v2 — **by itself this changes nothing anywhere**.
- Version objects are immutable → serve with `Cache-Control: public, max-age=31536000,
  immutable`, so a pinned version URL never needs cache invalidation. **This is a
  requirement, not a given**: `versionId` MUST be server-generated and R2 writes MUST
  be conditional (refuse an existing key) — otherwise the bytes under a live, cached,
  document-pinned URL can be silently swapped (see req. R2). The flip side of immutable
  caching is that removing content is NOT free — see takedown (req. R4).
- Asset-level metadata (alt, byline, …) is mutable but consists of **defaults only**:
  it feeds future selections and bulk updates via the edit-time join. Changing it has
  no effect on published pages.
- **Everything uploaded is public-by-URL.** The `GET /image/*` route has no auth and no
  embargo concept (the per-request site check is structurally a no-op — it compares the
  key against a siteId extracted from that same key). Keys carry high-entropy UUIDs so
  they are not enumerable, but the library is not private staging: treat any uploaded
  byte as world-readable to anyone with the URL.

## Architecture summary

**Edit-time join.** The editor frontend (Puck plugin) queries the Worker's D1-backed
asset API; the selected version's URL and the asset's metadata defaults are copied
into the Puck document as one object value. Published pages render from the document
alone — `<Render>` never calls the API. (Verified constraint: Puck field transforms
apply only inside `<Puck>`, not `<Render>`, and `<Render>` accepts only
`config`/`data`/`metadata` — the document must carry everything the render needs.)

## Updating an asset "everywhere" (the logo problem)

Instant global propagation and draft isolation are incompatible; this design chooses
draft isolation and makes propagation a **reviewable changeset**:

1. Editor replaces the logo in the library → creates v2. Nothing is live.
2. An "update usages" action finds documents referencing the `assetId` and writes
   v1→v2 pin edits into a workstream.
3. Preview, merge → live everywhere. Unmerged → never happened.

**v1 mechanics (grounded in the CCR OpenAPI spec — docs/openapi.yaml in
collaborative-state-system):** CCR has no content-search endpoint today, so usage
discovery is enumerate-and-scan, which the existing API supports end to end:

1. `POST /api/sites/{siteId}/branches` — create the workstream for the changeset
   (or target an existing one).
2. `GET /api/sites/{siteId}/branches/{branchId}/documents` (offset-paginated, no stable
   cursor; includes copy-on-write-inherited docs from main). The list returns metadata
   only (`{id,path,createdAt}`) — content is a per-document `GET`, so discovery is N+1.
   Fetch each document and find placements by matching the structured
   `props.<field>.assetId` value — **not** a free-text substring scan of the JSON (a
   stray string equal to an assetId in body copy would mis-target an edit).
3. `POST …/documents/{documentPath}/edits` with JSON-path operations. Target edits by a
   **stable node identity (the Puck component's `props.id`), never a positional index**
   like `content[3]`: between scan and edit a human/agent may reorder components, and a
   positional path would then overwrite the wrong element (the CCR `409` guards CRDT
   concurrency, not scan staleness). **Re-read each document's current content
   immediately before editing** and re-match by id. Max 100 ops/request → chunk, and
   because there is no cross-document transaction, persist a run manifest (docs matched
   / edited / skipped-with-reason) so a half-run is detectable and resumable.
4. `POST /api/sites/{siteId}/merge-requests` → review → execute. Merge should refuse (or
   loudly warn) if the manifest shows skipped or failed documents, so a partial rewrite
   is never merged silently.

Authorization: this flow rewrites arbitrary documents site-wide, so it MUST run as an
**editor-scoped principal** and produce a dry-run diff (with an op cap) for review —
`can-agent-edit` is coordination against live humans, not authorization, and it
silently 403s documents a human is actively editing (those land in the skipped list).

The P1 MCP tools already wrap these APIs, so v1 can ship as an agent-driven flow
before any product UI exists. A CCR content-search API and/or a media-side usage
index are later optimizations — enumerate-and-scan is O(documents) and acceptable
at current scale. Metadata fixes ("correct this alt everywhere") use the same flow.

This flow is Sequencing step 6 ("Later"); `props.id`-based targeting and the run
manifest are preconditions for it shipping at all.

Explicitly rejected: a mutable "latest" alias URL resolved at serve time. It bypasses
draft isolation, requires workstream-aware serving to preview, and reintroduces CDN
invalidation. If a customer later demands live-alias behavior, add it as an explicit
opt-in URL form — not the foundation.

## Two field modes, one plugin

### Basic mode (existing, preserved)

- Site config: `heroImage: { type: "text" }` with a name matching the media patterns.
- The plugin's existing `overrides.fieldTypes.text` hijack renders the picker.
- Stored value: bare CDN URL string (optionally with crop params). Unchanged.
- Remains supported indefinitely; not deprecated by this update. This string value format
  is the demo-safe path and is what R1 preserves permanently — distinct from the 0.1.0 API
  shape, which is not.

### Rich mode (new): the `p1-media` field type

- Site config: `heroImage: { type: "p1-media", label: "Hero image" }`.
- Registered via `overrides.fieldTypes["p1-media"]` (Puck ≥ 0.20 supports introducing
  new field types; the name is arbitrary — the `p1-` prefix namespaces it in the flat,
  editor-wide fieldTypes namespace, avoiding collisions with other plugins or any
  future Puck built-in called `media`).
- Naming: kebab-case per Pantheon identifier convention (`p1-media-r2`,
  `p1-media-worker`, `@pantheon-systems/pcc-react-sdk`) and Puck's own all-lowercase
  type names (`richtext`, `textarea`). The `-r2` suffix is deliberately dropped —
  the storage backend is an implementation detail.
- Editor UI: the existing library/picker plus metadata inputs (alt first;
  schema-driven, see below). On select, the current version's URL and the asset's
  metadata defaults are copied into the value; editors override per placement inline.
- A `fieldTransforms["p1-media"]` entry normalizes legacy string values to the object
  shape for component renders inside the editor preview.

### Stored value shapes

```ts
type MediaValue = {
  assetId: string;            // logical asset identity — FK into D1, key for usage search
  versionId: string;          // pinned version — merge/preview semantics come from CCR
  url: string;                // immutable CDN URL for the pinned version (with crop params)
  width?: number;             // captured dimensions, copied in on select (CLS win at render)
  height?: number;
  metaSchemaVersion?: number; // schema version that produced the copied metadata (req. R12)
  alt?: string;
  // extensible metadata, schema-driven:
  [meta: string]: string | number | undefined;
};

type MediaFieldValue = string | MediaValue;   // string = basic mode (kept forever)
```

The `string | object` union is the **value-format** compatibility mechanism and is
permanent — it is *not* the 0.1.0 API-shape compat (that one is dropped; see R1). Rich
fields write objects; basic fields write strings; every render consumer accepts both,
forever. An untouched string prop stays a string even after its config upgrades to
`p1-media`. `metaSchemaVersion` is stamped only on objects, when metadata defaults are
copied in at edit-time; it lets a later field-set change migrate old placements
deterministically instead of guessing (req. R12).

### Compatibility matrix

| Config field type | Stored value         | Editor                                        | Published render (via helpers) |
|-------------------|----------------------|-----------------------------------------------|--------------------------------|
| `text` (hijack)   | string (legacy)      | current picker, unchanged                     | image, `alt=""`                |
| `p1-media`        | string (pre-upgrade) | picker shows image; alt-only, no assetId (see below) | image, `alt=""` |
| `p1-media`        | `MediaValue`         | full rich UI, prefilled                       | image + metadata               |
| `text` (hijack)   | `MediaValue`         | **unsupported** (config downgrade) — helpers still render; field UI degraded | image + metadata |

**Legacy string → object is not automatic.** A pre-upgrade value is a bare CDN URL with
no `assetId`, and nothing maps a URL back to an asset (backfill mints a *new* assetId
per object; there is no URL→asset lookup). So on a `p1-media` field holding a legacy
string, the field can capture `alt` locally but cannot synthesize a real `MediaValue` —
and it MUST NOT write one with `assetId: undefined` (that value is unfindable by "update
usages" and can render `src=undefined`). Two acceptable v1 positions, pick one and state
it: **(a)** legacy-string placements stay string-only until the editor re-picks the
image from the library (which yields a full `MediaValue`); or **(b)** add a
`GET /media?url=` resolver + deterministic backfill keying (req. R5) so the field can
reconstruct `{assetId, versionId}` from a legacy URL. Default recommendation: (a).

## Rendering

No plugin hook exists on `<Render>`, so the render-side contract is helpers exported
by the plugin (server-safe, added to `server.ts` exports):

- `getMediaProps(value, { mediaBaseUrl, transform })` → `{ src, alt, width?, height? }` —
  accepts `string | MediaValue | null`; strings yield `{ src, alt: "" }`. Spreadable onto
  `<img>` or `next/image`. Width/height come from the value's captured dimensions (CLS win).
  **`url` is untrusted document content** (anyone who can edit a document, or call the CCR
  `/edits` API directly, controls it). `mediaBaseUrl` is the CDN image origin, passed by
  the consuming app **at render** (render helpers run in RSC and can't read plugin config,
  and the image host differs from `workerUrl`). `getMediaProps` MUST reject any `url` that
  is not `https` on `mediaBaseUrl`, and **fail closed (empty src) when `mediaBaseUrl` is
  absent** — otherwise a crafted document turns every published-page render into a
  visitor-IP exfil beacon, and (with `next/image`, which fetches server-side) an SSRF
  against the consuming site. If consumers use `next/image`, they must also set
  `remotePatterns` to the CDN origin. One deviation shipped for local dev: when the
  configured base is itself `http` on a loopback host (`localhost`/`127.0.0.1`/`[::1]`,
  i.e. a local `wrangler dev` worker), same-origin `http` urls are allowed — exact-origin
  matching still holds, and production https bases are unaffected.
- `<MediaImage image={value} … />` — common case.
- `<MediaFigure image={value} />` — renders the schema-advertised text fields
  **generically** (iterates the metadata schema, emits each as escaped text), so adding a
  new text field is **backend-only — no plugin release** (req. R14). Never
  `dangerouslySetInnerHTML` (req. R6).
- `buildImageUrl` unchanged (still works on bare strings).

Scope note: generic rendering covers components that use `MediaFigure`. A bespoke
component that places a field in a specific spot (a byline overlaid on a hero) still
references `{image.byline}` explicitly — no helper can infer *placement*. "Backend-only
to add a field" is therefore true for the generic figure, not for every custom layout.

## Metadata schema (single source of truth)

The set of metadata fields is defined once, served by the Worker
(`GET /media/schema` → `[{ name, label, type: "string", required? }, …]`), consumed by:

- the `p1-media` field UI (renders one input per schema entry),
- the library details pane and upload flow,
- `PATCH /media/:assetId` validation.

Adding "location" later = D1 is untouched (JSON column), schema endpoint updated,
zero plugin or site-config changes. v1 fallback: plugin option `metadataFields`
defaulting to `[alt]` if the endpoint is absent (lets the plugin ship before/without
the Worker upgrade).

**Schema authority — decided for v1: Pantheon-defined, global (req. R13).** The set of
fields is defined by us, one schema for all sites. This is *not* a ceiling baked into the
DB: because storage is a schemaless JSON blob, moving to customer-defined or per-org
schemas later is an additive worker feature (a schema-source table + scope-dependent
`GET /media/schema` and `PATCH` validation), not a D1 rewrite. The `org_id` stub column is
where an org-level schema would key. What makes a later migration of already-placed
metadata safe is stamping the schema version into each placement (req. R12).

## Worker API (editor-authenticated via existing CSS_SERVICE flow, except serving)

| Endpoint                          | Change                                                     |
|-----------------------------------|------------------------------------------------------------|
| `GET /media`                      | D1-backed asset list (site-scoped): asset-shaped, indexed search (filename+alt), pagination. Clean shape — consumers migrated once (R1) |
| `GET /media/:assetId`             | new — asset record incl. version history                   |
| `POST /media`                     | upload → new asset + v1; dimension capture is **non-fatal** (req. R3); accepts optional metadata form fields |
| `POST /media/:assetId/versions`   | new — replacement bytes → new immutable version; **server-generated `versionId`, conditional write** (req. R2) |
| `PATCH /media/:assetId`           | new — update metadata defaults; per-field length + field-count caps (req. R6). **Add `PATCH` to CORS `Access-Control-Allow-Methods`** (currently `GET, POST, DELETE, OPTIONS` — preflight fails otherwise) |
| `GET /media/schema`               | new — metadata field schema                                |
| `DELETE /media/:assetId`          | **soft delete** (`deleted_at`) for the normal case; a separate hard-purge path is required for takedown (req. R4) |
| `GET /image/*` (public)           | unchanged; public-by-URL, immutable cache headers          |

**Every `…/:assetId` route MUST enforce ownership (req. R0)**: `validateAuth` only
proves the caller can access the `siteId` query param — it does not tie that to the
path `assetId`. Load the asset from D1, confirm `assets.site_id === authenticatedSiteId`
(404 otherwise), and build the R2 key from the looked-up `site_id`, never from client
input.

Auth granularity (req. R7): `validateAuth` today returns `true` on *any* 200 from
`GET /api/sites/{siteId}`, i.e. "can see the site" — it does not distinguish CSS's
`VIEWER|EDITOR|ADMIN` roles, so a VIEWER-role bearer token can currently upload/delete,
and the write endpoints (`PATCH`, `.../versions/finalize`) inherit that. **Re-derived
against CSS's actual role model (not just the theoretical enum) — the real exposure is
much narrower than "any read-only user":** no Pantheon human ever resolves to VIEWER
(`owner|admin|developer|team_member` all map to EDITOR or ADMIN — there is no viewer
option in the ordinary invite/collaborator flow). A real VIEWER bearer token is only
obtainable via one of two admin-gated paths: (1) a site admin calling CSS's
branch-grants API directly (no UI) to grant a human VIEWER on the main branch, or (2) a
site admin using CSS's UI-exposed Agent Access panel to grant an AI agent's key the
`viewer` role. Site API tokens are NOT a vector for this specific check — CSS's
service-principal scope gate has no rule permitting the `sites` route handler for any
token scope, so a site API token 403s before `canView` is ever evaluated (this
corrects PCC-3278's description, which lists service tokens as a vector for this
endpoint without accounting for that separate gate). **Decision: ship without the role
check, track the CSS-side fix as PCC-3278** — the gap requires a site admin's own
deliberate action, not an externally reachable exploit, so it isn't a go-live blocker.
(The workstream boundary is genuinely moot now that the library is site-scoped — but
that is orthogonal to read-vs-write.)

## D1 schema (sketch)

```sql
CREATE TABLE assets (
  asset_id        TEXT PRIMARY KEY,
  site_id         TEXT NOT NULL,
  org_id          TEXT,               -- stub: unused until CCR grows an org auth tier
  filename        TEXT NOT NULL,
  alt             TEXT,               -- first-class: core + searchable (promoted for indexed LIKE)
  metadata        TEXT,               -- JSON blob (SQLite TEXT + JSON1): byline, location, caption, …
  meta_schema_version INTEGER,        -- schema version the metadata conforms to (req. R12)
  current_version TEXT NOT NULL,      -- latest versionId; what the picker selects
  created_at      TEXT,
  created_by      TEXT,
  deleted_at      TEXT                -- soft delete: hidden from library, keeps serving
);
CREATE INDEX idx_assets_site ON assets(site_id, created_at DESC);

CREATE TABLE asset_versions (
  version_id   TEXT NOT NULL,
  asset_id     TEXT NOT NULL REFERENCES assets(asset_id),
  r2_key       TEXT NOT NULL,         -- {siteId}/assets/{assetId}/{versionId}-{filename}
  content_type TEXT,
  size         INTEGER,
  width        INTEGER,
  height       INTEGER,
  uploaded_at  TEXT,
  uploaded_by  TEXT,
  PRIMARY KEY (asset_id, version_id)
);
```

**Metadata storage & extensibility.** D1 is SQLite, which has no `jsonb` column type
(the SQLite 3.45+ `jsonb()` binary form is a function-level read optimization stored in
an ordinary column, not a declared type — adopt later only if profiling warrants). So
`metadata` is plain `TEXT` holding a JSON object, queried with JSON1 (`json_extract`
etc.). `alt` is the one field promoted to its own column, because it's universal and
must be in the indexed search (R11).

Because the DB is schemaless about the blob's keys, extensibility is free and the
"which fields exist" contract lives entirely at the worker layer (`GET /media/schema`):
- Adding a field (e.g. `location`) is zero-migration — new key in the blob, new schema
  entry.
- **Per-site / per-org schemas** need no DB change: they are just a scope-dependent
  `GET /media/schema` response plus scope-dependent `PATCH` validation. The `org_id`
  column is the stub to key an org-level schema on later.
- If a blob field later needs indexed search/filter, promote it without a data migration
  via a generated column —
  `ALTER TABLE assets ADD COLUMN byline TEXT GENERATED ALWAYS AS (json_extract(metadata,'$.byline')) STORED`
  — then index it.

## Legacy objects (one-time migration)

Existing `{siteId}/{workstreamId}/media/…` objects keep serving untouched (public
serving is key-structure-agnostic). A **one-time migration** registers each as a logical
asset with its existing R2 key as v1 (no object copying — `r2_key` is stored per version),
and it is a small job: only a handful of live sites today. Legacy URL strings in documents
keep rendering forever via the helpers; individual placements upgrade to a full
`MediaValue` when an editor re-picks the image. The workstream-prefixed key scheme is
retired for new uploads.

Migration requirements (req. R5), kept minimal given the tiny volume:
- **Deterministic assetId** from the legacy `r2_key` (e.g. a hash) with `INSERT OR IGNORE`,
  so a re-run is idempotent.
- **Enumerate only the legacy prefix** (`{siteId}/{workstreamId}/media/`), skip
  `{siteId}/assets/…`.
- **Run the migration before flipping consumers to the new API** (part of the lockstep
  cutover, R1) so no library is briefly empty.
- Deterministic keying also enables an optional `GET /media?url=` resolver (compat-matrix
  option b) if we later choose to auto-upgrade placements instead of re-pick.

## Infrastructure (delta from today)

- 3× `cloudflare_d1_database` (one per env/account) in the Terraform module;
  `database_id` wired into wrangler.jsonc like `bucket_name`.
- `d1_databases` binding in wrangler.jsonc (all envs + local).
- Migration machinery: `worker/migrations/*.sql` + `wrangler d1 migrations apply`
  step in the deploy workflow (before worker deploy; additive-only discipline).
- D1 edit scope added to CI/Terraform Cloudflare tokens in all three accounts.
- One-time migration per env: enumerate legacy R2 objects → seed asset + version rows
  (req. R5); run before flipping consumers to the new API.
- **Migrations run additively before the worker deploy, per account.** Three separate
  accounts mean three independent runs; sequence staging → prod and verify each before the
  next. Additive-only, so a stalled run leaves the old worker + new (unused) columns, not a
  broken env.
- **Reconcile is a nice-to-have script, not a v1 gate (req. R8).** At current volume, an
  R2-vs-`asset_versions` count + orphan/phantom lister is a handy ad-hoc diagnostic; it is
  worth automating only as content grows. (The update-usages run manifest, by contrast,
  stays a requirement of that flow when it ships.)

## Security & reliability requirements (v1)

From the 2026-07-10 adversarial review. IDs are referenced inline above. These are
requirements, not suggestions — the design's isolation, immutability, and back-compat
guarantees do not hold without them. Tags: **[new]** introduced here, **[inherited]**
pre-existing in the shipped worker and now in scope.

### Blockers — must be settled before build

- **R0 — Per-asset ownership check.** [new] The `…/:assetId` routes trust a path id while
  `validateAuth` only proves access to the `siteId` *query param*; assetIds are not secret
  (they live in published documents). Without a join, a user of site A can read/overwrite/
  delete site B's assets. → Load the asset, assert `site_id === authenticatedSiteId` (else
  404), derive the R2 key from the stored `site_id`. Mirrors the existing safe pattern in
  `delete.ts` (which checks the key prefix rather than trusting a path id).
- **R1 — One-time consumer migration (not a permanent compat layer).** [new, revised per
  team feedback] 0.1.0 is published and running in a few sites; it reads `GET /media` as a
  bare array of `{key,url,filename,…}` and deletes by full R2 key. Rather than carry that
  wire shape forever, ship the **clean asset-shaped API** and migrate the handful of live
  consumers once, in a coordinated (lockstep) cutover: migrate R2→assets, deploy the new
  worker, bump each consuming site to plugin 0.2.0, ordered so no library is briefly empty.
  The plain-URL **string value format stays first-class forever** (basic mode) — a separate
  thing from the API shape, and what keeps demos working. A short transitional dual-shape
  window is optional insurance if a lockstep deploy proves hard to coordinate, not the plan
  of record.

### High

- **R2 — Enforce version immutability.** [new] The immutable-cache guarantee assumes bytes
  never change under a key. → Server-generated `versionId` (UUID); conditional R2 write
  that refuses an existing key; `versionId` never derived from client input.
- **R3 — Ordered, non-fatal dual write.** [new] R2 and D1 writes are non-transactional. A
  D1-row-before-bytes ordering yields a phantom asset that pins to a 404 on the *published*
  page. → R2 put fully succeeds *before* any D1 write; version row before the
  `current_version` bump; `IMAGES.info()` dimension capture is best-effort (try/catch,
  nullable width/height) and never fails the upload; a failed D1 write leaves a harmless
  invisible orphan (swept by R8), never a phantom row.
- **R4 — Takedown path (a present gap, gates immutable reliance).** [inherited + new] Not
  just future-design: `image.ts:108` **already** serves every object with
  `max-age=31536000, immutable` in production, so a takedown today cannot be honored within
  the cache window even after the R2 object is deleted. → v1 needs a hard-purge (delete R2
  object + rows; serving 404s the key) plus a cache-purge-by-URL step, and it should gate
  further reliance on immutable caching. Two specifics: (a) confirm which CDN fronts the
  live path — p1 public hostnames serve via the **GCP content LB**, so the purge likely
  targets GCP Cloud CDN, not Cloudflare; (b) purge stops origin/CDN serving but **cannot
  recall already-cached browser copies** within `max-age` — that latency is inherent, state
  it honestly.
- **R5 — Idempotent one-time migration.** [new] Deterministic assetId from `r2_key`,
  `INSERT OR IGNORE`, legacy-prefix-only enumeration, run before the consumer flip (R1). A
  small job at current volume. Deterministic keying also enables the optional
  `GET /media?url=` resolver (compat-matrix option b) if we later auto-upgrade placements.
- **R7 — Write-role granularity.** [inherited, re-derived against CSS's actual role
  model — narrower than originally stated] `validateAuth` authorizes on "can see the
  site," so a VIEWER-role bearer token can upload/delete today. But no Pantheon human
  user is ever VIEWER (the invite/collaborator flow only ever produces EDITOR/ADMIN); a
  real VIEWER token requires a site admin to deliberately grant it — via CSS's
  branch-grants API (human, no UI) or the Agent Access UI (AI agent). Site API tokens
  are not a vector here: CSS's service-principal scope gate blocks the `sites` route
  handler for every defined scope, so those 403 before `canView` runs at all. →
  **Decision: shipped without the role check; tracked as [PCC-3278](https://getpantheon.atlassian.net/browse/PCC-3278)**,
  not a go-live blocker, since the gap needs a site admin's own deliberate
  (mis)configuration, not an externally reachable exploit. The CSS-side fix (surface
  the effective role on `GET /api/sites/{siteId}`, or a dedicated permission-check
  endpoint) is CSS's to build, not this worker's.
- **R9 — Bound public image transforms.** [inherited] `GET /image/*` is unauthenticated and
  `num()` caps nothing; `?width=1,2,3,…` mints unlimited distinct (billed, separately cached)
  transforms — a no-credential cost/resource DoS. → Cap width/height/blur/quality ranges
  and/or move to signed/allowlisted presets; add rate limiting on `/image/*`.
- **R12 — Stamp a schema version on copied metadata.** [new, per team feedback] When metadata
  defaults are copied into a document (edit-time join) and on the asset row, record the
  metadata schema version (`metaSchemaVersion` on the value, `meta_schema_version` column on
  `assets`). One field now; without it, migrating already-placed metadata to a new field set
  later is guesswork. Cheap to bake, expensive to retrofit.
- **R13 — Decide schema authority now: Pantheon-defined, global (v1).** [new, per team
  feedback] Fields are Pantheon-defined for v1. This does not bake a ceiling into D1 (storage
  is a schemaless blob); customer-defined / per-org schemas stay an additive worker feature
  later, keyed on the `org_id` stub and made migratable by R12. Decide it explicitly so the
  worker's schema source is built as one authority, not accidentally hard-wired.

### Medium

- **R6 — Metadata limits and escaped rendering.** [new] `PATCH` metadata has no size/count
  cap and is copied into every placement (edit-time join) and every bulk rewrite. → Per-field
  length caps + max field count; specify all metadata renders as escaped text — `MediaFigure`
  must never use `dangerouslySetInnerHTML`.
- **R8 — Bulk-update manifest (reconcile optional at this size).** [new] The update-usages
  flow's persisted run manifest (matched/edited/skipped) stays a requirement of that flow. The
  R2-vs-`asset_versions` reconcile is a nice-to-have diagnostic script at current volume, not a
  v1 gate — automate it as content grows.
- **R10 — Never write a MediaValue with undefined identity.** [new, relaxed] With a lockstep
  cutover (R1) the new plugin talks to the new worker, so full capability detection is no
  longer required. The invariant remains: the plugin **never synthesizes a `MediaValue` unless
  both `assetId` and `versionId` are present** — otherwise fall back to a string value. (Full
  capability probing is only needed if we keep a transitional dual-shape window.)
- **R11 — Safe search.** [new] Bind the `LIKE` parameter, escape `%`/`_`/`\` with `ESCAPE`,
  keep the `site_id` filter mandatory.
- **R14 — Generic schema-driven rendering.** [new, per team feedback] `MediaFigure` /
  `getMediaProps` render any schema-advertised text field as escaped output by iterating the
  schema, so **adding a text field is backend-only — no plugin release**. Explicit AC on the
  plugin story. Caveat (see Rendering): covers the generic figure; bespoke component layouts
  still reference specific fields for placement.

### Cleared by the review (no action)
- SVG stored XSS — mitigated by the SVG upload exclusion + stored-content-type replay +
  `X-Content-Type-Options: nosniff`.
- `javascript:`/`data:` URIs via `buildImageUrl` — already stripped by its scheme guard;
  the residual gap is only in the new `getMediaProps` (covered under Rendering).
- CORS `Access-Control-Allow-Origin: *` on authenticated routes — not a CSRF vector because
  bearer tokens are non-ambient. (The missing `PATCH` method is a real correctness bug — fixed
  in the API table.)

## Sequencing

1. Infra: Terraform D1 + migrations + token scopes (staging first).
2. Worker: D1 integration, asset/version model, clean asset-shaped endpoints with ownership
   checks (R0); server-generated versionId + conditional writes (R2); ordered non-fatal
   dual write (R3); schema-version stamping (R12); Pantheon-defined schema source (R13);
   transform bounds (R9). Write-role checks (R7) deferred — tracked as PCC-3278, not a
   go-live blocker (see R7 above).
3. One-time migration (R5) + lockstep cutover (R1): migrate R2→assets, deploy the new
   worker, then bump each live consuming site to plugin 0.2.0 — ordered so no library is
   briefly empty. The plain-URL string value keeps working throughout.
4. Plugin 0.2.0: `p1-media` field type + `fieldTransforms` + render helpers (`getMediaProps`
   URL validation, generic `MediaFigure` per R14); never emit a `MediaValue` without full
   identity (R10); string basic mode retained. npm publish.
5. Consumers flip fields `type: "text"` → `type: "p1-media"` per component (mechanical
   one-liner) and swap renders to `getMediaProps`/`<MediaImage>`.
6. Later: library details pane (PATCH UI), version-history UI, and the "update usages"
   bulk-changeset flow — which requires `props.id`-based edit targeting and a run manifest
   (R8) as preconditions, not a CCR search.

**Independent of the above:** the takedown/hard-purge path (R4, PCC-3386) addresses a
*present* production gap (immutable headers are already live) and can proceed in parallel;
it should land before we lean further on immutable caching.

## Decided (was open)

- **Back-compat**: keep the plain-URL string value format forever (basic mode, demo-safe);
  do *not* carry the 0.1.0 API shape permanently — migrate the few live consumers once (R1).
- **Schema authority**: Pantheon-defined, global for v1 (R13); customer-defined / per-org is
  a later additive worker feature, not a schema rewrite.
- **Metadata schema versioning**: stamp `metaSchemaVersion` on placements + `assets` (R12).
- **Org scoping**: stubbed only — nullable `org_id` column + reserved `orgs/` key
  namespace. CCR's auth model doesn't define org-level content access yet; revisit
  when it does.
- **"Update usages"**: enumerate-and-scan via existing CCR document/edit/merge APIs
  (see mechanics above). No CCR search exists; agent-driven via P1 MCP tools for v1.
- **Delete**: soft delete is the normal-case default. A hard-purge path (with cache
  purge) is nonetheless required in v1 for legal takedown (R4) — that is not a DAM
  feature. What stays deferred: a user-facing tombstone/"gone" placeholder image.
- **Alt at upload**: v1 nudges (non-blocking prompt in upload flow + visible
  "missing alt" indicator in the library); never hard-required.
- **Search**: v1 is `LIKE` over filename + alt (indexed scope: site_id). Upgrade to
  D1 FTS5 only if relevance/scale demands it.

## Future (post-v1, noted for direction)

- **Auto-alt AI worker**: generate alt text on upload with an open-source vision
  model, as cheaply as possible — Workers AI hosts open image-to-text models and is
  already in-platform, so the natural shape is: upload → async captioning → fills the
  asset's default alt (marked machine-generated) → editors accept/override at
  selection time. Fits the defaults-only model: no live effect on published pages.
- Tombstone/placeholder mechanism for removed images.
- CCR content-search API and/or media-side usage index (perf for "update usages").
- D1 FTS5 for library search, if LIKE stops being good enough.
