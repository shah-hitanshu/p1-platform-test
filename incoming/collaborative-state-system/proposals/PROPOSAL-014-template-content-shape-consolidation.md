# PROPOSAL-014: Consolidate Template Persistence on the Page Content Shape

**Status:** Draft
**Date:** 2026-07-07
**Author:** Andrew Glago (with Claude)
**Jira:** [PCC-3357](https://getpantheon.atlassian.net/browse/PCC-3357) (this work) · [PCC-3358](https://getpantheon.atlassian.net/browse/PCC-3358) (follow-on: durable component ids)
**Supersedes:** PROPOSAL-010 Appendix B (template storage shape) and the `{ components }` manifest as an API contract. The rest of PROPOSAL-010 (structural action capture, migration queue, conflict review, role enforcement) is unchanged and this proposal makes its shipped implementation work as designed.
**Affects:**
- CSS backend: template API persistence and response shape (`workers/src/routes/template-api.ts`), one-time data backfill, and a legacy-client compatibility window on the template API (§8). One migration-service exclusion rule: underscore-prefixed root props are editor-private and never propagate.
- Puck editor integration (`puck-css-integration`): template save and load paths, removal of the manifest rebuild on save, css-client `Template` types.
- `p1-content-validator`: `validateDocumentStructure` input moves to the content shape (major version bump; all consumers are ours and update in lockstep).
- MCP server: template tools read and present the content shape.

---

## TL;DR

Store a template's layout in the same shape as every page: Puck data (`{ content, root, zones }`), versioned through the existing document machinery. Retire the `{ components }` manifest as a stored shape: the template API persists and returns the snapshot, and the consumers that read the manifest today (MCP template tools, the structure validator, the frontend template panels) are updated to read the content shape directly. Remove the write path that replaces the stored snapshot with the manifest. Because published 0.4.x clients are embedded in customer sites, the API serves a deprecated manifest projection alongside the snapshot and accepts legacy write bodies at the boundary for a compatibility window (§8).

This fixes two verified bugs at their shared root, requires **one exclusion rule in the migration engine** (underscore-prefixed root props are editor-private and never propagate; the engine was otherwise already written against the content shape), and closes PROPOSAL-010's open question about who builds the component skeleton and how components get durable identity (comment thread on §3: build it on the backend, with stable ids as the follow-on, PCC-3358).

---

## Background: what shipped, and where it split

PROPOSAL-010 defined a template as a document at `_registry/templates/{name}` whose snapshot is a manifest:

```json
{
  "name": "blog",
  "label": "Blog Post",
  "components": [
    { "type": "HeroBlock", "pinned": true, "defaultProps": { "title": "" } }
  ]
}
```

The implementation split into two camps that never reconciled:

| Surface | Shape it writes/reads | Where |
|---|---|---|
| Template API create/PATCH | writes the **manifest** as the version snapshot | `template-api.ts` |
| Template API list/get, MCP `list_templates`/`get_template`, structure validator | read the **manifest** | `template-api.ts`, `tools.ts`, `structure-validator.ts` |
| Editor canvas autosave (template mode) | writes **Puck content** as the version snapshot | `useP1Editor` → `versions.create` |
| Editor load | reads **Puck content** (raw cast, no normalization) | `P1PuckProvider.loadDocument` |
| Migration engine (delta extraction, `snapshot_sync`, insert hydration, conflict detection) | reads **Puck content** from template versions | `migration-service.ts` |
| Migration integration tests | fixture templates in **Puck content** shape | `template-migration.integration.spec.ts` |

Both camps write into the **same storage slot** (the template document's latest version snapshot), so whichever save ran last determines the shape the next reader finds. Every reader has a mode where it silently gets nothing.

### Failure modes

1. **Saved templates reopen to a blank canvas.** The editor loads the latest snapshot directly onto the canvas. When it is manifest-shaped (a newly created template, or any template whose most recent save was a details or pin change), there is no renderable layout. A template built in one session does not round-trip. Verified locally 2026-07-06.
2. **Template migrations complete without applying anything.** Delta extraction compares template versions in the content shape. Manifest-shaped versions yield no components to compare: no prop patches are extracted and the `snapshot_sync` fallback finds nothing to sync. The job reports success having changed nothing. Only structural `puckActions` explicitly recorded at save time survive.
3. **Migration-inserted components arrive empty.** Insert hydration draws a new component's values from the content-shaped layout that manifest templates lack, so pages receive an empty shell with no default props. Conflict detection likewise never sees a template-side prop change.
4. **The clobbering runs the other way too.** Canvas autosave overwrites the manifest, leaving the latest snapshot without `name`, `label`, or `components` for the list/get API and validator. The frontend details save re-sends the full component list on every save specifically to counteract this (PCC-3225 workaround).

---

## Decision: why the content shape wins

Considered against keeping the manifest canonical and adding conversion layers:

1. **The migration engine already implements the content shape.** Prop-patch extraction, `snapshot_sync`, insert hydration, and conflict detection all key off `.content` and `props.id`. Consolidating on content requires a single engine change (the underscore exclusion rule in §6) and makes its existing test fixtures correct. The manifest path would require rewriting delta extraction, conflict detection, and insert hydration, plus building and maintaining hydrate/derive converters.
2. **The editor round-trips natively.** Templates are edited as documents today; with content persisted, load and save just work, with no normalization seam to maintain in front of the Yjs seeding path.
3. **Puck's slots model removes the manifest's structural guarantee.** Puck (>= 0.19; we ship 0.21) moved nesting from the global `zones` record into component props. Once container components adopt slot fields, nested trees ride inside `defaultProps` with no schema change, and a flat manifest becomes actively lossy against ordinary components. The content shape represents nesting natively and rides the same `migrate()` pass as pages whenever we adopt slots.
4. **The manifest has no consumer that needs it.** Every current reader is ours, and each reads better off the content shape directly: pin permissions key off `_pinMap` by id instead of matching by type, scaffolding reads `content` (its preferred branch already), and the details panels read `root.props._template`. The one semantic question the manifest answered, "which pinned component types, in what order", is a small derivation that moves into the structure validator.
5. **Stable component ids come for free.** Persisted content carries `props.id`, which PCC-3358 extends into pages for precise migration correlation. The manifest would need a new id field plus converter changes to achieve the same.

---

## Design

### 1. Canonical persisted shape

A template document's version snapshot is Puck data, identical to a page:

```json
{
  "content": [
    { "type": "HeroBlock", "props": { "id": "HeroBlock-a1b2", "title": "" } },
    { "type": "BodyBlock", "props": { "id": "BodyBlock-c3d4", "content": "" } }
  ],
  "root": { "props": { "_template": { "label": "Blog Post", "description": "", "defaultUrlPattern": "/blog/:year/:month/:slug", "deprecated": false }, "_pinMap": { "HeroBlock-a1b2": true, "BodyBlock-c3d4": true } } },
  "zones": {}
}
```

The component's props **are** its default props. No `defaultProps` key exists in storage.

### 2. Template metadata

`label`, `description`, `defaultUrlPattern`, and `deprecated` live under `root.props._template`. `name` is not stored: it is the last path segment of `_registry/templates/{name}` and remains immutable, as today.

Rationale for `root.props` over new columns: the metadata stays inside the versioned snapshot, so template versions, checkpoints, and rollback capture it with no schema change, and readers work from a single artifact.

### 3. Pin state

`root.props._pinMap` maps component id to pinned flag. The frontend already maintains exactly this structure in live editor state; this proposal persists it instead of flattening it into per-type `pinned` flags at PATCH time. Within a template document the ids are stable once persisted, so pins survive reload. Stability across template-to-page scaffolding is PCC-3358.

Pinning semantics remain top-level and type-ordered in the validator, as today. Pinning inside nested content is out of scope.

**Behavior change: the pin button is available in template mode only.** It previously also appeared on template-bound pages, where toggling it edited the shared template record from inside a page editor. With pins persisting through document saves, that same gesture on a page would instead write a page-local pin: a lock that editors see but migrations do not respect, with no defined precedence against template-derived pins and no role rule. Page-level instance pinning is deferred to a designed follow-on once PCC-3358 provides durable ids.

### 4. No stored manifest: the API returns the snapshot

The `{ components }` manifest is retired from storage. Responses additionally carry a deprecated derived projection for the duration of the compatibility window (§8).

- **Get** (`GET .../templates/{name}`): returns the template document's snapshot in content shape (a manifest-shaped stored row is converted in memory, §8), plus `name` derived from the path and the §8 legacy projection. Consumers read `content`, `root.props._template`, and `root.props._pinMap` directly.
- **List** (`GET .../templates`): returns one entry per template with `name`, the `root.props._template` metadata block, and the §8 `components` projection.
- **Structure validator**: `validateDocumentStructure` accepts the template snapshot in content shape and derives "pinned component types in order" internally by joining `content` order with `_pinMap`. This is a breaking change to the published `p1-content-validator` package, released as a major bump; every consumer is in this ticket's update set.
- **MCP tools**: `list_templates` and `get_template` present the new responses. Any agent-friendly summarising (a type-plus-pinned listing, say) is response formatting local to the tool layer, not a backend contract.
- **Frontend / css-client**: the `Template` type becomes snapshot-shaped; `dataToUpdateParams` and the feature-local manifest types are deleted.

The `defaultProps`-versus-`props` duality then exists nowhere in storage. The §8 projection is derived at response time from the single stored shape, so there is no parallel persisted shape to keep honest with round-trip tests, and the projection disappears with the compatibility window.

### 5. Write paths: one writer for layout

- **Create** (`POST /templates`): creates the document with an empty content-shaped snapshot (`{ content: [], root: { props: { _template: {...}, _pinMap: {} } }, zones: {} }`). A legacy body carrying `components` is converted to the content shape at the boundary (§8); the manifest is never stored.
- **Canvas autosave**: unchanged, and now the **only** writer of layout. Structural `puckActions` continue to be captured and stored on versions, exactly as PROPOSAL-010 designed.
- **Details save** (`PATCH /templates`): becomes metadata-only. It updates `root.props._template` fields inside the current snapshot and never replaces `content`. Legacy pin flags in a `components` body fold into `_pinMap` (§8); everything else in that field is ignored. The frontend stops rebuilding and re-sending the component list (the PCC-3225 workaround is deleted).
- **Pin toggle**: writes `_pinMap` through the normal document save path instead of issuing a template PATCH.

With one writer per concern, the last-writer-wins shape flip-flop is structurally impossible.

### 6. Migration engine: one exclusion rule

With template versions in content shape, the shipped engine starts doing what its tests always assumed:

- Prop-patch extraction diffs component props between template versions by id.
- The `snapshot_sync` fallback emits real actions when structural versions lack explicit `puckActions`.
- Insert hydration finds the inserted component in the template content and applies its props as defaults.
- Conflict detection sees template-side prop changes (id correlation across documents becomes precise with PCC-3358; until then it retains today's behavior for pages whose ids do not match).

One rule is added to root-prop extraction: **underscore-prefixed root props are editor-private and never propagate through migrations.** `_template` and `_pinMap` live inside `root.props` for versioning convenience, not as page content, so a metadata edit or pin toggle must not become a `__root__` prop patch applied to associated pages. The exclusion applies to both sides of the root-props diff; legitimate root props (no underscore prefix) propagate exactly as before.

### 7. One-time backfill

A data migration converts every existing template document's latest snapshot from manifest to content shape: generate component ids, move `pinned` flags into `_pinMap`, move metadata into `root.props._template`, lift `defaultProps` into `props`. Written as a new version through the existing version machinery, so it is auditable and reversible.

**Non-structural classification:** the backfill version is a representation change, not an authored edit, so it is written with a null `action_type`. Without this, the content-touching diff would classify as structural and the `snapshot_sync` fallback would treat the entire converted layout as newly inserted, appending every template component to every associated page on the first migration spanning the boundary. The PATCH lazy conversion below is written the same way.

**PATCH before backfill:** a metadata PATCH that lands on a still-manifest-shaped template converts the snapshot to the content shape first, then applies the metadata update, writing one content-shaped, non-structural version. Legacy top-level `label`, `description`, `defaultUrlPattern`, and `deprecated` are lifted into `_template` unless the PATCH overrides them. A subsequent backfill run then skips the template.

**Reads before backfill:** metadata extraction falls back to the legacy top-level fields when `root.props._template` is absent, so template listing and the deprecated-template guard on page creation keep working against manifest-shaped rows. Template API list/get additionally canonicalize manifest-shaped rows in memory (§8), so every template API reader sees the content shape from the moment the backend deploys.

**Version-history boundary:** older manifest-shaped versions are left as-is. Delta extraction across the boundary yields no prop patches, which matches today's behavior exactly (explicit `puckActions` still apply). Migrations gain full fidelity from the backfill version forward.

**Rollout:** the backfill must run immediately after the backend deploy. The fallbacks above keep template API reads and metadata writes safe in the interim, but the editor loads templates through the document endpoints, which serve snapshots as stored, so the blank-canvas and empty-migration fixes only take effect for a template once its latest snapshot is content-shaped. In-memory canonicalization (§8) also generates fresh component ids on every read; only the backfill persists stable ids.

### 8. Legacy client compatibility window

Published `puck-css`/`css-client` 0.4.x packages are embedded in customer sites that upgrade on their own release cadence, and the backend serves arbitrary origins by design. The template API therefore keeps 0.4.x clients working with no customer action, while storage stays single-shape:

- **Reads canonicalize.** List and get convert a manifest-shaped stored snapshot to the content shape in memory before building the response. Nothing is persisted on a read path.
- **Responses carry a deprecated legacy projection.** Every template response includes, alongside the snapshot fields: top-level `label` and `deprecated` (plus `description` and `defaultUrlPattern` when present), and a derived `components` array with one `{ type, pinned, defaultProps }` entry per content item in content order, where `pinned` comes from `_pinMap` and `defaultProps` is the item's props minus `id`. New-shape clients ignore these fields.
- **Create accepts the legacy body.** A `POST` carrying `components` is converted to the content shape by the backfill's converter and stored canonically.
- **PATCH folds legacy pin flags.** A `components` array in a PATCH body contributes per-type `pinned` flags, applied to every content item of that type in `_pinMap`. 0.4.x pin enforcement matches by component type, so the type-keyed mapping is faithful. `defaultProps` in a PATCH body is ignored: layout writes remain canvas-only, so a legacy details save cannot replace layout.

The projection is a response-shape adapter, not a stored shape: storage, versioning, and the migration engine see only the content shape, and one-writer-per-concern (§5) is unchanged.

What a 0.4.x client experiences against this backend: template creation, listing, details editing, and pin toggles keep working; the blank-canvas reopen bug disappears once a template's latest snapshot is content-shaped; and its details save applies metadata and pin flags only, so it can no longer clobber layout.

**Removal condition:** the projection and the legacy write acceptance are removed in a later change once the client fleet is on the new-shape package line (>= 0.5.x). The legacy fields are documented as deprecated in css-client and the feature README.

### 9. Frontend load path

No hydration layer is needed after the backfill: templates load as documents, which is what the editor already does. `scaffoldFromTemplate` scaffolds from template content only; the manifest fallback branch is deleted along with the manifest types. Fresh id generation at scaffold time remains until PCC-3358.

---

## Out of scope

- **Durable component ids across template-to-page** (PCC-3358, depends on this work).
- **Page-local instance pinning** (the pin button is template-mode only; see §3 for the behavior change and rationale; a designed follow-on belongs on top of PCC-3358).
- **Zones-to-slots adoption** for the document corpus (independent, unticketed).
- **Nested pinning and nested structure validation** (top-level semantics unchanged).
- **Migration review UI** (explicitly excluded from this ticket set).

## Open questions for review

1. **Starter content on create:** should `POST /templates` accept initial content (for "create template from existing page"), or stay empty-only with the canvas as the sole authoring surface? Recommend empty-only for this ticket.

## Test impact

- Template API integration tests move their stored-shape and response assertions to the content shape (list returns metadata summaries, get returns the snapshot). The phantom per-component `required` flag that only fixtures pass disappears with the manifest.
- `p1-content-validator` tests move `validateDocumentStructure` inputs to the content shape and cover the internal pinned-order derivation.
- Migration integration fixtures (`{ content }`-shaped templates) become representative of production instead of contradicting it; the e2e suite gains an assertion that a migration-inserted component carries its default props (failure mode 3).
- New unit tests: backfill conversion (manifest in, content out, pins and metadata preserved), PATCH-is-metadata-only, pin persistence across reload.
- Compatibility window (§8): legacy create body persists the canonical shape; get/list expose the projection for both stored shapes; PATCH pin folding is type-keyed and leaves content untouched. The create-rejects-`components` assertion is replaced by accept-and-convert coverage.

## Acceptance criteria (PCC-3357)

- A template created and saved in one session reopens with its layout intact.
- A template migration applies the intended structural and default-value changes to associated pages, including default values on inserted components.
- Template listing and structure validation return the same manifest information as before, regardless of which save ran last.

## Implementation order

1. **Backend: write paths and response shape.** Create seeds the content shape, PATCH becomes metadata-only, list/get return the snapshot-based responses. (TDD against the template API suite.)
2. **Validator: content-shape input.** `validateDocumentStructure` accepts the template snapshot and derives pinned order internally; major version bump; MCP call site updated.
3. **Backfill migration** for existing template rows.
4. **Frontend: save/load cleanup.** css-client `Template` types, deletion of the manifest rebuild on details save and pin toggle, pin writes through document save, scaffold reads template content only.
5. **Verification:** the two bug reproductions (blank canvas, empty migration) plus the migration e2e default-props assertion.
6. **Legacy compatibility window (§8):** canonicalized reads, response projection, legacy create conversion, PATCH pin folding, with tests for both stored shapes.
