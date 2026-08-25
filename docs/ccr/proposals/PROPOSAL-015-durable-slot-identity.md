# PROPOSAL-015: Durable Slot Identity

**Status:** Draft
**Date:** 2026-07-07
**Author:** Andrew Glago (with Claude)
**Jira:** [PCC-3239](https://getpantheon.atlassian.net/browse/PCC-3239) · related to [PCC-3225](https://getpantheon.atlassian.net/browse/PCC-3225) · under epic [PCC-3217](https://getpantheon.atlassian.net/browse/PCC-3217)
**Depends on:** [PROPOSAL-010](./PROPOSAL-010-content-types-and-template-migration.md) (Content Types and Template Migration), PR #179 (document relations edges), the template content-shape cutover (separate workstream; Design §2)
**Enables:** [PROPOSAL-011](./PROPOSAL-011-localization-and-translation.md) (Content Localization and Translation)
**Affects:**
- CSS backend: template persistence shape, document creation, version write paths, migration engine, conflict detection
- Content validator library: id-based structural conformance
- Puck editor integration (`puck-css-integration`): scaffolding, pinning, template editing round-trip

---

## TL;DR

Give every component in a document a durable identity that the backend depends on: it survives from a template, into every document created from it, and onward into every translation. The identity is the component's own `props.id`, minted by the backend when a component is first persisted and preserved through document initialization. Migration apply, conflict detection, pinning, and (downstream) canonical-to-translation diffing all key on this id instead of component type and array position. Templates are persisted in the same content shape as any document so the editor, the migration engine, and skeleton generation read one structure; that persistence cutover is delivered by a separate workstream that this proposal depends on but does not implement.

---

## Background and Motivation

PROPOSAL-010 shipped content-type templates with correspondence by component `type` and array position. That model cannot answer the question every consumer needs answered: *which component in this document is the same component as that one in the template?*

The consequences are live defects:

- Migration deltas replay by raw index and land in the wrong slot on documents whose structure has diverged.
- Conflict detection is type-level only; two components of the same type are indistinguishable, so duplicate types are ambiguous and `snapshot_sync` flags every structural edit as a conflict.
- Prop-conflict detection never fires: it compares template component ids against document component ids, and the two sides share no id namespace because document initialization mints fresh ids.
- Pinning resolves by component type, so pinning one `HeroBlock` pins every `HeroBlock`.
- Documents created from a template through the API or an agent start empty, because only the browser knows how to build the skeleton.

A live example from the shipped migration preview: a page two template versions behind (v20 to v22) reports as a conflict with zero clean documents, because the delta arrives through the `snapshot_sync` fallback, which has no component identity to compare, so any document with a structural edit is flagged.

Meanwhile, everything in the system that *does* work across document boundaries already keys on `props.id`: the backend migration prop-patcher (`buildIdMap` / `extractPropPatches` / `diffComponentProps` in `workers/src/services/migration-service.ts`), the client semantic-ops engine (`packages/puck-css/src/data/semantic-ops.ts`), the merge classifier (`packages/puck-css/src/merge/utils/puckFieldClassifier.ts`), version compare, collection overrides, and copy-on-write branching (which relies on the same component id appearing on multiple branches). The identity substrate exists; it is broken only at the template boundary, where ids are re-minted or absent.

PROPOSAL-011 (localization) makes this urgent: canonical-to-translation diffing needs component correspondence across documents, and per-slot policy (translatable, authority, pinned) needs a stable key to hang policy on.

### Why `props.id` and not a separate identity prop

Puck preserves supplied `props.id` values, round-trips them through the editor, and ships `transformProps` / `migrate` utilities to backfill them (verified against Puck source). A separate identity prop was rejected: Puck's duplicate action copies all props, so a parallel id would silently collide on duplication, whereas Puck re-mints `props.id` itself.

### Why a snapshot diff and not the action log

PROPOSAL-010 derived migration deltas from forwarded Puck actions stored in `action_metadata.puckActions`. The log is populated inconsistently across write paths: manifest-shaped template saves produce derived-only versions with no actions, canvas edits classify prop changes as `prop_update` which the delta builder then filters out, and programmatic writes have no actions at all. With durable ids, structural intent is derivable by diffing two template snapshots keyed by id, which works identically for every write path. The action log remains as bookkeeping; it is no longer the delta source.

---

## Design

### 1. The slot id

A **slot** is a component instance in a template. Its **slot id** is its `props.id`, minted by the backend in Puck's `Type-uuid` format (compatible with the content validator's existing id-format checks) when the template component is first persisted.

A component in a document is a **slot instance** when its `props.id` appears in the bound template's content. Membership is computed at read time from the template referenced by the document's `template` edge in `document_relations`; nothing is stored on the document itself. A component whose id is not in the template is a **local component**: it is not pinned, not a migration target, and not a localization target.

### 2. Template persistence: content shape

Templates are stored today as `{ name, label, components: [{ type, pinned, defaultProps }] }` manifests. Moving them to the shape below is **a separate workstream, delivered by its own PRs**; this proposal does not implement the cutover. This section is the identity contract that cutover must satisfy, and the phases here are cut so work proceeds without waiting: document-side identity (Phase 1) has no dependency on template shape, and the template-consuming phases (2 to 4) are developed against this target shape and integration-verified once the cutover lands. The pairing of ids and shape is inherent: a slot id needs a durable home in the persisted template, the manifest has no id field, and the migration engine's id-keyed reads already expect `.content` with `props.id`. (The alternative of adding `id` to the manifest components and pointing the migration engine's reads at `components` was rejected: it keeps two template representations alive, touches more migration code, and still leaves the template editor with no `.content` to render.)

A template document's snapshot is Puck data, the same shape as any other document:

```json
{
  "content": [
    { "type": "HeroBlock", "props": { "id": "HeroBlock-2f9a...", "title": "", "background": "dark" } },
    { "type": "BodyBlock", "props": { "id": "BodyBlock-81c4...", "content": "" } }
  ],
  "root": {
    "props": {
      "name": "blog",
      "label": "Blog Post",
      "description": "Standard structure for all blog posts",
      "defaultUrlPattern": "/blog/:year/:month/:slug",
      "deprecated": false,
      "_pinMap": { "HeroBlock-2f9a...": true, "BodyBlock-81c4...": true }
    }
  },
  "zones": {}
}
```

- Component props hold the component's baseline values (what PROPOSAL-010 called `defaultProps`).
- Template metadata lives in `root.props`. The pin map is keyed by slot id; this matches the structure the client already writes (`root.props._pinMap` in `packages/puck-css/src/features/content-type-templates/`).
- The `{ components: [...] }` manifest shape is retired. **This is a hard cutover**: the template API accepts and returns content-shaped snapshots only, the stored templates are converted by data migration, and the client updates in the same release train. No derived manifest view is maintained.
- Template updates merge by slot id: existing components keep their ids, and ids are minted only for components that arrive without one. The editing client must round-trip slot ids on PATCH. (`handleUpdateTemplate` replaces the components array wholesale today, which would discard identity on every save.)

One persistence shape resolves an entire family of defects at the root: the migration delta builder and `snapshot_sync` read `.content` that manifests never had; saved templates reopen to a blank canvas because there is no `.content` to render; and the pin toggle re-manifests a content-shaped template, stripping its content. After the cutover, a template round-trips through the editor natively and every reader sees the same structure.

### 3. Id lifecycle

| Event | Rule |
|---|---|
| Template component first persisted | Backend mints a slot id |
| Document created from a template | Backend copies template content, ids preserved |
| Translation forked from a canonical (PROPOSAL-011) | Ids preserved |
| Editor drop of a new component | Puck mints a fresh id (local component) |
| Duplicate within a document | Puck re-mints (existing behavior) |
| Cross-document paste, agent-supplied content (MCP `apply_edits` add/replace ops) | Ids re-minted on injection |
| Site import | Ids preserved; a bundle carries a template and its instances together, so verbatim ids keep their correspondence (holds while imports target empty sites) |
| Merge manual resolution | Written as resolved; the backstop re-mints true duplicates, and a foreign-but-unique id simply becomes a local component id |
| Any version write | Backend uniqueness backstop: first occurrence of an id keeps it, later duplicates are re-minted |

Re-minted ids are fresh local ids by construction: they fall out of slot membership, so injected copies are unpinned and invisible to migration and localization without any bookkeeping.

The uniqueness backstop is one shared helper applied at every content-originating database insert. The realtime paths bypass `createDocumentVersion`, so a single hook is not enough; the four sites are `createDocumentVersion` (`document-version-service.ts:237`; REST, agent, merge, conflict-resolution, migration, import, and template writes), `batchSyncToPostgres` (`document-version-service.ts:750`; sync queue), `executeDirectSync` (`postgres-sync-manager.ts:424`; Durable Object immediate sync), and `createDocumentOnBranch` (`branch-document-service.ts:280`; initial and import writes). The helper logs when it fires, since a duplicate reaching the database means an upstream boundary missed re-minting. `syncCrdtToPostgresConsolidated` (`crdt-sync-service.ts:249`) has no callers and is not wired; a future wire-up must include it.

### 4. Backend skeleton generation

`POST /api/sites/{siteId}/branches/{branchId}/documents` with a template reference makes the **backend** build the initial version: deep-copy the template's `content` (ids preserved), copy `zones`, initialize `root.props` from document metadata, write the `template` edge with `synced_version` set to the template's current version, and persist version 1. The MCP `create_page` tool and agent worker use the same path.

Two callers change contract. `handleCreateDocument` (`document-api.ts:289`) trusts a client-built `body.snapshot` today and reads the template only to check deprecation and default the version; with a template reference present, the snapshot is server-built and a client-supplied one is not accepted. MCP `create_page` (`tools.ts:1432`) assembles components client-side today, minting a fresh `generateULID()` per component (`tools.ts:39`); it delegates skeleton construction to the backend instead.

This is where slot identity is stamped, and it closes PROPOSAL-010's open question about who builds the skeleton: the browser scaffold path is retired, so API-created, agent-created, and editor-created documents are structurally identical.

### 5. Migration keyed by slot id

**Delta derivation.** The delta between template versions `from` and `to` is an id-keyed diff of the two snapshots:

- `added`: slot ids in `to` but not `from`, carried with their full props
- `removed`: slot ids in `from` but not `to`
- `moved`: slot ids present in both whose position changed, anchored by preceding-sibling slot id (`afterId`), mirroring the model in the client's `computeSemanticOps`
- `propPatches`: per-slot-id prop diffs (id key excluded)

**Application.** Per document: match components by slot id. Adds insert the template component with its full props (an added slot arrives exactly as the editor would have created it, baseline props included), replacing the current fallback that inserts a bare shell with `'migrated-' + crypto.randomUUID()` (`migration-service.ts:336`). Removes and moves apply only to components whose id matches; anchors resolve against slot instances, falling back to nearest preceding surviving slot when the anchor is absent. Prop patches keep the existing three-way merge: apply only where the document value still equals the template's old value.

**Conflict detection.** A conflict exists only when the template delta and the document's own history touch the same slot id (structurally, or the same prop on the same slot). Local components can never conflict with a template change. Prop-conflict detection reads only `.content` today; the id-keyed detector covers `zones` as well.

### 6. Pinning and conformance by membership

- `pinned` for a document component resolves from slot-id membership in the template's `_pinMap`. Duplicating a pinned component yields an unpinned local copy.
- `validateDocumentStructure` (`packages/p1-content-validator`) matches by slot id against content-shaped templates: every pinned slot id present, pinned slots in template-relative order. Error codes are unchanged.

### 7. One-time adoption pass for existing documents

Documents created before this proposal hold randomly minted ids that will never match template slot ids. Without intervention, their first post-cutover migration would see zero slot instances and duplicate every added component.

A one-time backfill job runs after the content-shape cutover lands: for each document with a `template` edge, per branch, match document components to template slots by type and relative order among occurrences of that type (the best correspondence the old model can express), rewrite matched components' `props.id` to the slot id, and persist a new version with a system source. Unmatched components stay untouched as local components. Documents that fail conformance are recorded and skipped rather than guessed at. The job is idempotent: a document whose ids already match template slots is a no-op.

Collection overrides in `puck-css` store semantic ops referencing base-document block ids, so the adoption pass rewrites ids only on documents, not on route-template bases that overrides point at, until the route-template reconciliation decision (open question 3) lands.

### 8. Traversal scope

Identity, uniqueness, skeleton generation, migration, and conformance walk top-level `content[]` and `zones[*][]`, which covers everything the backend and the starter app produce today (`zones` is a flat map of arrays keyed by parent id and zone name, so the walk involves no recursion). Recursion into slot props (Puck's newer slots-as-props model, which the content validator already understands) is **deferred**; the traversal utilities are written as the single shared walker, modeled on `extractComponentIds` (`postgres-sync-manager.ts:591`), so slot-prop descent lands in one place later.

---

## What Needs to Be Built

Each phase follows the repo's TDD process: tests first against the real create paths (templates seeded through the actual template API, not hand-written content shapes), red, implement, green, lint. Migration tests assert the migrated document's content (component present, baseline props intact, correct position) and cover diverged-shape and duplicate-type documents; the existing e2e asserts only that the synced version advanced.

### Phase 0: Rebase onto document relations

PR #179 replaces `documents.template_id` / `template_version` with `document_relations` edges and rewrites parts of `migration-service.ts`. This work builds on that branch; land it first.

### External input: template content-shape cutover (separate workstream)

Delivered by its own PRs and tracked here only as a dependency: content-shaped template persistence, server-minted slot ids on create (`handleCreateTemplate:235`), id-keyed merge on update (`handleUpdateTemplate:284`), the data migration converting stored manifest templates (minting slot ids, carrying `pinned` into `root.props._pinMap`), and the hard API cutover. Design §2 is the contract it satisfies. Only Phases 2 to 4 consume its output; Phase 1 does not wait on it.

### Phase 1: Document-side identity plumbing (no cutover dependency)

- Shared component-identity utilities (`workers/src/services/component-identity.ts`, new): walk `content` + `zones`, extract ids, mint ids (`Type-uuid`), detect and re-mint duplicates.
- Uniqueness backstop helper applied at the four insert sites (Design §3).
- Injection re-minting in MCP `apply_edits` (`tools.ts:1084`): `add`/`replace` ops re-mint incoming component ids at the op boundary, recursively over the op's content.

### Phase 2: Skeleton generation

- Document create with a template reference builds version 1 server-side (REST `handleCreateDocument`, MCP `create_page`, agent worker); a client-supplied snapshot is not accepted alongside a template reference.
- Reads the content-shaped template: implementation and unit tests proceed against the Design §2 shape; end-to-end verification through the real template create path gates on the cutover landing.

### Phase 3: Migration engine on slot ids

- Id-keyed delta builder replacing the puckActions-sourced structural delta (`migration-service.ts`).
- Id-anchored apply: adds with full template props, moves by `afterId`, removes by id.
- Conflict detection by slot id; three-way prop merge retained.
- One-time adoption backfill job for existing template-bound documents.

The delta builder and the backfill read stored templates, so this phase end-to-end verifies after the cutover lands; the engine itself is developed against the Design §2 shape.

### Phase 4: Conformance and pinning by membership

- `validateDocumentStructure` id-based matching in `packages/p1-content-validator`.
- Pinned-slot-id sets exposed wherever permissions are resolved.

This phase is detachable: Phase 3's migration payoff does not depend on it, and it can land in parallel or after.

### Phase 5: Client (`puck-css-integration`, separate PRs)

- Scaffold path consumes the backend skeleton; the local id minter in `useTemplateScaffold.ts` is deleted, and document creation stops sending `body.snapshot` when a template is selected.
- `createPuckPermissions` and `validateStructure` resolve by slot-id membership.
- Pin toggle writes `_pinMap` without re-shaping the template snapshot.
- Template editing round-trips the content shape, including slot ids on PATCH (coordinated with the cutover workstream's client changes; fixes the blank-canvas reopen).
- Verify Puck re-mints ids on cross-document paste; add re-minting at the paste boundary if it does not.

Localization (PROPOSAL-011) then builds on preserved ids: the canonical relation type, drift detection, and the locale-diff API all correspond components by slot id.

---

## Known PROPOSAL-010 Issues Addressed

Resolved by this proposal:

| Defect | Resolved by |
|---|---|
| Migration reads `.content` of manifest templates and applies nothing | Content-shape cutover (external workstream) |
| Saved templates reopen to a blank canvas | Content-shape cutover (external workstream) |
| Pin toggle strips template content | Content-shape cutover (external) + client pin path (Phase 5) |
| API/agent-created documents start empty | Backend skeleton (Phase 2) |
| Positional replay lands in the wrong slot | Id-anchored apply (Phase 3) |
| Migration inserts lose baseline props | Adds carry full template props (Phase 3) |
| `snapshot_sync` flags every structural edit as a conflict | Slot-id conflict detection (Phase 3) |
| Prop-conflict detection never fires (disjoint id namespaces) | Shared id namespace (Phases 2, 3) |
| Duplicate component types are ambiguous for pinning and conflicts | Membership by slot id (Phases 3, 4) |
| Inconsistent action capture starves the migration delta | Delta derived from id-keyed snapshot diff (Phase 3) |

Independent defects tracked as their own tickets (not addressed here): content-role resolution end-to-end (missing effective-role endpoint, `userRole` never passed to `createNextConfig`), the orphaned migration conflict-resolution UI, and the test-coverage gap beyond what the phases above re-seed.

---

## Open Questions

1. **Admin pin bypass.** `getPermissionsForRole` gives admins full structural control while `createPuckPermissions` locks pinned components for all roles. Membership changes the key, not the policy; pick the rule and collapse to one source of truth.
2. **Enforcement surface.** Pinning and structural conformance are enforced only in the editor and advisorily in MCP; REST and Durable Object writes bypass them. Decide server-side enforcement vs. advisory-only.
3. **Route/data templates vs. content-type templates.** `puck-css` route templates with id-keyed semantic-op overrides and backend content-type templates are two systems with different owners. Slot-id utilities are built to be shareable, but reconciliation is a separate decision.
4. **Silent-failure policy.** Until detect-and-bail is adopted broadly, migration cases that cannot be corresponded should route to review rather than apply a best guess; the adoption pass (Design §7) already takes this stance for non-conforming documents.

---

## Coordination Notes

- PR #179 (edges cutover) is the base for all backend phases.
- The template content-shape cutover runs as its own workstream and PRs. Phase 1 here proceeds in parallel with it; Phases 2 to 4 are developed against the Design §2 contract and integration-verify against real templates once it lands.
- PRs #180/#181 (ORM adoption) touch the same DB layer; sequence deliberately around migration `042` and service rewrites.
- The client repo's `ag-pcc-3239-foundation-bug-fixes` branch carries the independent 010 fixes; the Phase 5 changes land after it.
- The Yjs binding patches arrays positionally (`puckYjsBinding.ts` `patchYArray`), so ids survive realtime writes but CRDT-level moves are index-wise, not id-aware. Out of scope here; noted as the realtime edge of the same identity problem.
- Per-instance policy is out of scope; type and field granularity only (per PROPOSAL-011 review).

---

## Appendix: Key File Touch Points

| Area | File / symbol |
|---|---|
| Component-identity walker, id mint/dedupe | `workers/src/services/component-identity.ts` (new); traversal modeled on `extractComponentIds` (`workers/src/durable-objects/postgres-sync-manager.ts:591`) |
| Template types | `workers/src/routes/template-api.ts` (`Template`, `TemplateBody`); `packages/p1-content-validator/src/types.ts` (`TemplateComponent`) |
| Template create/update, id mint + merge (external cutover workstream) | `workers/src/routes/template-api.ts` (`handleCreateTemplate:235`, `handleUpdateTemplate:284`) |
| Skeleton generation | `templateToInitialSnapshot` (new); `workers/src/routes/document-api.ts` (`handleCreateDocument:289`); `workers/src/services/branch-document-service.ts` (`createDocumentOnBranch:200`) |
| MCP instantiate/edit | `workers/mcp-server/src/shared/tools.ts` (`create_page:1432`, `apply_edits:1084`, `generateULID:39`) |
| Uniqueness backstop | `workers/src/services/document-version-service.ts` (`createDocumentVersion:237`, `batchSyncToPostgres:750`); `workers/src/durable-objects/postgres-sync-manager.ts` (`executeDirectSync:424`); `workers/src/services/branch-document-service.ts` (`createDocumentOnBranch:280`) |
| Migration correspondence | `workers/src/services/migration-service.ts` (`extractTemplateDelta:709`, `applyDeltaToSnapshot:290`, `detectDocumentConflicts:829`, `extractComponentTypes:596`, insert fallback `:336`) |
| Conformance / pinning | `packages/p1-content-validator/src/structure-validator.ts:24`; client `createPuckPermissions` (`packages/puck-css/src/features/content-type-templates/permissions/`) |
| Adoption backfill | One-time job over template-bound documents (Design §7) |
