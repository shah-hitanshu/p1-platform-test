# Proposal 012: Expand MCP Tool Surface for a Full Authoring Round-Trip

**Status:** Implemented in PR #153 — Groups A–C shipped together; Templates deferred
**Date:** 2026-06-16
**Author:** Claude (via collaborative session)
**Jira:** PCC-3162 (expand tool surface)
**Affects:** MCP Server (`workers/mcp-server`) only — no CSS backend changes

---

## Summary

The MCP server today gives an agent a core slice of the workflow: discover sites and
branches, read documents, run edit sessions, observe presence, and create pages and
branches. It cannot finish a piece of work on its own — it cannot merge, publish, place
a page in the site's navigation, set page metadata, or inspect and roll back version
history.

This proposal adds **28 tools** that take the surface from 14 to 42, so an autonomous
agent can complete a full authoring round-trip: create a branch, edit and place a page,
publish or merge the work, and clean up afterwards.

Every proposed tool wraps an endpoint the CSS backend already exposes. This is
MCP-layer work only — each tool is a new `api-client` method, a Zod input schema, a
handler in `createToolHandlers`, and a `server.registerTool` entry in `mcp-handler.ts`.
**No backend changes are required.**

**Content and page templates are explicitly out of scope** for this ticket — the
backend has no templates table, route, or service. Templates are deferred to a
follow-up that builds the backend first (see PROPOSAL-010 / PCC-3225).

---

## Motivation

An agent invoked to "rewrite the pricing page and ship it" can currently do only the
middle of that job. It can branch and edit, but then it stalls: it has no tool to put
the new page in the nav, no tool to publish it, no tool to merge the branch, and no
tool to undo a bad version. A human has to finish every task by hand in the dashboard.

The backend already implements all of these operations as REST endpoints. The gap is
purely that they are not surfaced through MCP. Closing that gap turns the agent from a
drafting assistant into one that can own a task end to end.

---

## Scope decisions (agreed)

| Question | Decision |
|----------|----------|
| Templates (no backend exists) | **Defer** to a follow-up; build backend first per PROPOSAL-010 |
| Merge model | **Direct merge + merge requests** — expose both the direct trio and the review flow |
| Round-trip cleanup extras | **Include all** — `archive_page` / `restore_page` / `rename_page` |

---

## Conventions

- Tool names are `snake_case`, verb-first, matching the existing surface
  (`list_sites`, `create_branch`).
- Identifier inputs are UUIDs unless noted. Tool descriptions must repeat the
  "use the UUID, not the name" guidance that the current tools establish.
- Branch-scoped tools take `site_id` + `branch_id`. Navigation and metadata tools
  additionally take `structure_id` (discovered via `list_structures`).
- A handful of tools are **site-scoped** (`/sites/{siteId}/documents/...`) rather than
  branch-scoped — their descriptions must call out that they act across the site, not
  on a single branch.
- All write tools must carry actor attribution exactly as `create_branch` does today
  (`X-Actor-*`, and `X-Acting-User-*` when an OAuth user is present), so audit and
  per-route permission checks resolve correctly.

---

## Group A — Branch lifecycle (12 tools)

**Status:** Implemented in PR #153.

The branch CRUD endpoints live in `workers/src/routes/branch-api.ts`; merge endpoints
in `workers/src/routes/merge-api.ts`.

### A1. `get_branch`
Inspect a single branch's status, source, and description.

- **Endpoint:** `GET /api/sites/{site_id}/branches/{branch_id}`
- **Permission:** `canView`
- **Input:**
  - `site_id` (string, required)
  - `branch_id` (string, required)

### A2. `update_branch`
Rename a branch, edit its description, or change its status.

- **Endpoint:** `PATCH /api/sites/{site_id}/branches/{branch_id}`
- **Permission:** `canCreateBranch`
- **Input:**
  - `site_id` (string, required)
  - `branch_id` (string, required)
  - `name` (string, optional)
  - `description` (string, optional)
  - `status` (enum, optional): `active` | `review` | `merged` | `archived`
- **Note:** at least one of `name` / `description` / `status` must be provided.

### A3. `archive_branch`
Soft-archive a branch (cleanup after work is merged or abandoned). The main branch
cannot be archived (backend returns 400).

- **Endpoint:** `DELETE /api/sites/{site_id}/branches/{branch_id}`
- **Permission:** `canManageGrants`
- **Input:**
  - `site_id` (string, required)
  - `branch_id` (string, required)

### A4. `restore_branch`
Un-archive a previously archived branch.

- **Endpoint:** `POST /api/sites/{site_id}/branches/{branch_id}/restore`
- **Permission:** `canManageGrants`
- **Input:**
  - `site_id` (string, required)
  - `branch_id` (string, required)

### A5. `preview_merge`
Show which documents and diffs a merge would apply, before committing to it.

- **Endpoint:** `POST /api/sites/{site_id}/merge/preview`
- **Permission:** `canView`
- **Input:**
  - `site_id` (string, required)
  - `source_branch_id` (string, required)
  - `target_branch_id` (string, required)
  - `include_content` (boolean, optional) — include full snapshots and diff operations
  - `exclude_path_prefixes` (string[], optional) — skip documents under these prefixes
    (e.g. `_registry/`)

### A6. `check_merge`
Check whether a merge is possible and report conflicts.

- **Endpoint:** `POST /api/sites/{site_id}/merge/check`
- **Permission:** `canView`
- **Input:**
  - `site_id` (string, required)
  - `source_branch_id` (string, required)
  - `target_branch_id` (string, required)

### A7. `execute_merge`
Perform the merge directly, optionally resolving conflicts inline.

- **Endpoint:** `POST /api/sites/{site_id}/merge/execute`
- **Permission:** `canMerge`
- **Input:**
  - `site_id` (string, required)
  - `source_branch_id` (string, required)
  - `target_branch_id` (string, required)
  - `message` (string, optional) — merge commit message
  - `conflict_resolutions` (array, optional) — per document:
    - `document_id` (string, required)
    - `strategy` (enum, required): `take-source` | `take-target` | `manual`
    - `resolved_snapshot` (object, required when `strategy` is `manual`)

### A8. `create_merge_request`
Open a merge request for human review before the work lands.

- **Endpoint:** `POST /api/sites/{site_id}/merge-requests`
- **Permission:** `canProposeMerge`
- **Input:**
  - `site_id` (string, required)
  - `source_branch_id` (string, required)
  - `target_branch_id` (string, required)
  - `title` (string, required)
  - `description` (string, optional)

### A9. `list_merge_requests`
List merge requests, optionally filtered by status.

- **Endpoint:** `GET /api/sites/{site_id}/merge-requests?status=`
- **Permission:** `canView`
- **Input:**
  - `site_id` (string, required)
  - `status` (enum, optional): `open` | `approved` | `conflicted` | `merged` | `closed`

### A10. `get_merge_request`
Fetch a single merge request's details and status.

- **Endpoint:** `GET /api/sites/{site_id}/merge-requests/{merge_request_id}`
- **Permission:** `canView`
- **Input:**
  - `site_id` (string, required)
  - `merge_request_id` (string, required)

### A11. `update_merge_request`
Edit a merge request's title/description, or change its status (e.g. approve it).

- **Endpoint:** `PATCH /api/sites/{site_id}/merge-requests/{merge_request_id}`
- **Permission:** `canMerge`
- **Input:**
  - `site_id` (string, required)
  - `merge_request_id` (string, required)
  - `title` (string, optional)
  - `description` (string, optional)
  - `status` (enum, optional): `open` | `approved` | `conflicted` | `merged` | `closed`

### A12. `execute_merge_request`
Execute an approved (or conflicted) merge request.

- **Endpoint:** `POST /api/sites/{site_id}/merge-requests/{merge_request_id}/execute`
- **Permission:** `canMerge`
- **Input:**
  - `site_id` (string, required)
  - `merge_request_id` (string, required)
  - `resolutions` (array, optional) — same shape as `execute_merge.conflict_resolutions`
- **Note:** backend rejects execution unless status is `approved` or `conflicted`.

---

## Group B — Page placement & navigation metadata (9 tools)

**Status:** Implemented in PR #153.

Navigation is modelled as **structures** (containers) → **nodes** (entries). Routes
live in `workers/src/routes/structure-api.ts`, `node-api.ts`, and `metadata-api.ts`.
`list_structures` is the discovery entry point: every other tool in this group needs a
`structure_id`, and the agent has no way to obtain one today.

### B1. `list_structures`
List the navigation structures on a branch so the agent can find the one to edit.

- **Endpoint:** `GET /api/sites/{site_id}/branches/{branch_id}/structures?type=`
- **Permission:** `canView`
- **Input:**
  - `site_id` (string, required)
  - `branch_id` (string, required)
  - `structure_type` (enum, optional): `hierarchy` | `collection`

### B2. `get_navigation`
Return the full navigation tree for a structure — where every page and section sits.

- **Endpoint:** `GET /api/sites/{site_id}/branches/{branch_id}/structures/{structure_id}/navigation`
- **Permission:** `canView`
- **Input:**
  - `site_id` (string, required)
  - `branch_id` (string, required)
  - `structure_id` (string, required)

### B3. `add_navigation_item`
Place a page, section, or external link into the navigation tree.

- **Endpoint:** `POST /api/sites/{site_id}/branches/{branch_id}/structures/{structure_id}/nodes`
- **Permission:** `canEdit`
- **Input:**
  - `site_id` (string, required)
  - `branch_id` (string, required)
  - `structure_id` (string, required)
  - `name` (string, required) — display label
  - `slug` (string, required) — unique within the parent
  - `node_type` (enum, required): `section` | `document` | `external`
  - `position` (number, required) — order within the parent
  - `parent_node_id` (string, optional) — omit/`null` for a top-level item
  - `document_id` (string, optional) — required when `node_type` is `document`
  - `external_url` (string, optional) — required when `node_type` is `external`

### B4. `update_navigation_item`
Rename a nav item, change its slug, or change its position among its siblings.

- **Endpoint:** `PATCH /api/sites/{site_id}/branches/{branch_id}/structures/{structure_id}/nodes/{node_id}`
- **Permission:** `canEdit`
- **Input:**
  - `site_id`, `branch_id`, `structure_id`, `node_id` (strings, required)
  - `name` (string, optional)
  - `slug` (string, optional)
  - `position` (number, optional)

### B5. `move_navigation_item`
Reparent a nav item and/or move it to a new position. The backend rejects moves that
would create a cycle.

- **Endpoint:** `POST /api/sites/{site_id}/branches/{branch_id}/structures/{structure_id}/nodes/{node_id}/move`
- **Permission:** `canEdit`
- **Input:**
  - `site_id`, `branch_id`, `structure_id`, `node_id` (strings, required)
  - `new_parent_id` (string, optional) — `null`/omit to move to top level
  - `new_position` (number, optional, default 0)

### B6. `reorder_navigation_items`
Reorder all siblings under one parent in a single call.

- **Endpoint:** `POST /api/sites/{site_id}/branches/{branch_id}/structures/{structure_id}/nodes/reorder`
- **Permission:** `canEdit`
- **Input:**
  - `site_id`, `branch_id`, `structure_id` (strings, required)
  - `parent_node_id` (string, optional) — `null`/omit for top-level siblings
  - `node_order` (string[], required) — node IDs in the desired order

### B7. `remove_navigation_item`
Remove an item from the navigation tree.

- **Endpoint:** `DELETE /api/sites/{site_id}/branches/{branch_id}/structures/{structure_id}/nodes/{node_id}`
- **Permission:** `canEdit`
- **Input:**
  - `site_id`, `branch_id`, `structure_id`, `node_id` (strings, required)

### B8. `get_page_metadata`
Read a page's metadata within a structure.

- **Endpoint:** `GET /api/sites/{site_id}/branches/{branch_id}/structures/{structure_id}/documents/{document_id}/metadata`
- **Permission:** `canView`
- **Input:**
  - `site_id`, `branch_id`, `structure_id`, `document_id` (strings, required)

### B9. `set_page_metadata`
Set a page's metadata. The backend validates against the structure's metadata schema
when enforcement is enabled.

- **Endpoint:** `PUT /api/sites/{site_id}/branches/{branch_id}/structures/{structure_id}/documents/{document_id}/metadata`
- **Permission:** `canEditDocuments`
- **Input:**
  - `site_id`, `branch_id`, `structure_id`, `document_id` (strings, required)
  - `metadata` (object, required) — the full metadata object to store

---

## Group C — Version history & page lifecycle (7 tools)

**Status:** Implemented in PR #153. `restore_document_version` ships as the composite
described in C3; recording restore provenance is tracked as a follow-up (PCC-3294).

Version routes live in `workers/src/routes/document-api.ts`.

### C1. `list_document_versions`
List a document's version history on a branch.

- **Endpoint:** `GET /api/sites/{site_id}/branches/{branch_id}/documents/{document_id}/versions`
- **Permission:** `canView`
- **Input:**
  - `site_id`, `branch_id`, `document_id` (strings, required)

### C2. `get_document_version`
Fetch a specific version's full snapshot. Diff-only versions are reconstructed
server-side before return.

- **Endpoint:** `GET /api/sites/{site_id}/branches/{branch_id}/documents/{document_id}/versions/{version_id}`
- **Permission:** `canView`
- **Input:**
  - `site_id`, `branch_id`, `document_id`, `version_id` (strings, required)

### C3. `restore_document_version`
Roll a document back to a prior version. There is no dedicated endpoint — history is
append-only — so this tool is a **composite**: it reads the target version's snapshot
(C2) and writes it as a new version (`POST .../versions`).

- **Endpoints:** `GET .../versions/{version_id}` then `POST .../versions`
- **Permission:** `canEditDocuments`
- **Input:**
  - `site_id`, `branch_id`, `document_id`, `version_id` (strings, required)

### C4. `publish_page`
Publish a single page so its current version becomes the live, content-delivery
version on the branch. (The per-page counterpart to a full-branch merge.)

- **Endpoint:** `POST /api/sites/{site_id}/branches/{branch_id}/documents/{document_id}/publish`
- **Permission:** `canEditDocuments`
- **Input:**
  - `site_id`, `branch_id`, `document_id` (strings, required)

### C5. `archive_page`
Remove a page from a branch (soft delete / cleanup).

- **Endpoint:** `DELETE /api/sites/{site_id}/branches/{branch_id}/documents/{document_id}`
- **Permission:** `canEditDocuments`
- **Input:**
  - `site_id`, `branch_id`, `document_id` (strings, required)

### C6. `restore_page`
Restore a previously archived page. **Site-scoped** — acts on the document record, not
a single branch.

- **Endpoint:** `POST /api/sites/{site_id}/documents/{document_id}/restore`
- **Permission:** `canEditDocuments`
- **Input:**
  - `site_id`, `document_id` (strings, required)

### C7. `rename_page`
Change a page's path/slug. **Site-scoped** — the description must make clear this is not
a branch-isolated change.

- **Endpoint:** `PATCH /api/sites/{site_id}/documents/{document_id}`
- **Permission:** `canEditDocuments`
- **Input:**
  - `site_id`, `document_id` (strings, required)
  - `path` (string, required) — the new document path

---

## Risks and notes

- **Surface jump (14 → 42).** A large set of new tools widens what an agent can do
  without a human. Tool descriptions should keep the existing "confirm with the user
  before destructive or outward-facing actions" framing, especially for `execute_merge`,
  `execute_merge_request`, `publish_page`, and `archive_*`.
- **`restore_document_version` is a composite**, not a 1:1 endpoint. It must read the
  target snapshot and re-post it; the new version's provenance should record that it is
  a restore.
- **Site-scoped vs branch-scoped.** `restore_page` and `rename_page` act at the site
  level (`/sites/{siteId}/documents/...`). Their descriptions must distinguish them from
  the branch-isolated editing tools so an agent does not assume the change is contained
  to its working branch.
- **Permissions surface as errors.** The backend enforces per-route capabilities
  (`canView`, `canEdit`, `canEditDocuments`, `canMerge`, `canProposeMerge`,
  `canCreateBranch`, `canManageGrants`). Tools should pass through 403 messages so the
  agent can explain the denial rather than retry blindly.
- **Validation reuse.** `set_page_metadata` relies on backend schema enforcement;
  unlike `apply_document_edits`/`create_page`, no client-side `p1-content-validator`
  pass is proposed for this group.

---

## Suggested build order

The project's TDD process runs component-by-component (red -> green -> review). The three
groups are independent. They were built in this order and landed together in PR #153:

1. **Group A — Branch lifecycle** — unblocks the publish/merge half of the round-trip.
2. **Group B — Placement & metadata** — the "put the page in the site" half.
3. **Group C — Version history & cleanup** — history inspection, rollback, cleanup.
4. **Follow-up ticket — Templates** — backend per PROPOSAL-010 first, then MCP tools.

---

## Out of scope

- **Content and page templates** — no backend exists (no table, route, or service).
  Deferred to a follow-up built on PROPOSAL-010 (PCC-3225). The eventual tools
  (`list_templates`, `get_template`, `create_page_from_template`) each depend on backend
  endpoints that do not yet exist.
- **Structure creation** (`POST .../structures`) — creating a brand-new navigation
  structure is an authoring-setup action, not part of the per-task round-trip; the
  editor seeds the default structure. Can be added later if agents need it.
- **CSS backend changes** — none. If any proposed tool turns out to need a backend
  change during implementation, that is a signal to pause and re-scope.
