# PROPOSAL-016: Template Migration Dashboard Tab

**Status:** Draft
**Date:** 2026-07-10
**Author:** Andrew Glago (with Claude)
**Jira:** PCC-3387
**Builds on:** PROPOSAL-010 (migration engine), PROPOSAL-014 (template content shape). Forward-compatible with PROPOSAL-011 (localization conflict review).

---

## TL;DR

A "Migrations" tab under the site detail in the Pantheon Content Cloud dashboard: list each template a branch is behind on, preview the change before running it, press Migrate and watch progress, and resolve any conflicts in place with the engine's three resolution verbs. Built as a set of React components inside the dashboard's site detail in `pantheon-content-cloud`, talking to the CSS REST API through the dashboard's existing axios client and react-query hooks (the same convention branches already use), not the css-client package. One small CSS-side addition: the per-template migration-status endpoint reports the current migration's progress so the UI never has to list or track jobs.

Migration jobs are an implementation detail with a short life. The UI never lists them or shows history; it only ever asks "how far behind is this template, is a migration running, and are there conflicts to resolve," all answered by the migration-status query.

The conflict resolution card is a generic two-writers-one-target primitive. Template migrations are its first consumer; PROPOSAL-011 localization conflicts are its second, with different labels and the same verbs.

## Goals and non-goals

Goals: make migrations triggerable, inspectable, and resolvable without API scripts; expose the engine's delta so an empty or wrong migration is visible before it runs; establish the conflict review surface localization will reuse.

Non-goals: a jobs list or migration history surface, a standalone job view, editor canvas highlighting, cross-site or cross-branch aggregate dashboards, migration scheduling, snapshot-level diff viewing, editing conflicting values inline (the manual verb links to the page instead).

## Placement and architecture

- **Components in the dashboard**, not a separate package: a `components/migrations/` folder under the site detail owning `<MigrationsTab>` and its children (list, preview modal, inline progress, conflict card). No publish step or build tooling of its own.
- **Data access** through the dashboard's existing `cssApi` axios client and react-query hooks in `hooks.ts` / `mutations.ts`, matching how branches, collaborators, and every other CSS-backed surface already fetch. The tab does not depend on `@pantheon-systems/css-client`; that package still ships the same endpoints for external consumers.
- **Branch picker inside the tab**, populated from the existing `useFetchCssBranches` hook, defaulting to the site's main branch. Every query in the tab is scoped to the selected branch. Selection is reflected in the URL (`?branch=`) for deep linking; job ids are never put in the URL.
- **Why branch-scoped:** a template and the pages built from it live per branch, each with independent version histories, and a migration is a bulk edit of those pages against that branch's template versions. Running one on a feature branch never moves `main`, which also makes a branch the rehearsal space for a template change before it merges.
- **Permissions:** the whole migrations surface is admin-gated in CSS, so a non-admin gets a 403 on these calls. The tab handles that with a plain "you need admin access" state rather than a separate read-only mode.

## UX

### 1. Tab list view

One table row per template that needs attention on the selected branch: pages behind > 0, or a non-null `activeMigration` (a run in flight, or one that finished with conflicts still to resolve). Fully migrated, idle templates stay out of the table. Rows come from `GET .../templates` joined with per-template `GET .../templates/{id}/migration-status`; the filter applies at that join.

| Column | Source |
|---|---|
| Template (label, name, deprecated chip) | list endpoint metadata |
| Version | migration-status `currentVersion` |
| Pages behind | migration-status `staleDocumentCount`; the headline signal |
| Status / action | migration-status `activeMigration` (see below) |

The status/action cell is state-driven from `activeMigration`:
- running (`pending` / `in_progress`): an inline progress indicator from `processedDocuments / totalDocuments`, kept live by polling migration-status.
- finished with conflicts (`completed_with_conflicts`, `unresolvedConflicts > 0`): a "Resolve conflicts (N)" control.
- otherwise, pages behind > 0: Preview and Migrate actions.

Deprecated templates appear only while behind or mid-migration and lose the Migrate action. Empty state: "Everything is up to date on this branch."

### 2. Preview modal

Opened from a row. Version span defaults to the document's recorded `template_version` floor up to the current version; an advanced disclosure exposes explicit from/to pickers. Calls `GET .../templates/{id}/migrate/preview?detail=true`.

Rendered from `MigrationPreview`:

- Summary line: `affectedDocuments` pages, `estimatedConflicts` predicted conflicts, `cleanDocuments` clean.
- **Template changes**: the `templateDelta` actions grouped per component: prop changes as old value -> new value rows, structural actions (insert, remove, reorder) as labelled entries.
- **Affected pages**: collapsible list from `documents[]`, flagging `hasConflict` rows.
- **Empty delta callout**: when `templateDelta` is empty, a prominent notice ("No changes derived between v{from} and v{to}") replaces the run button's default styling. An empty migration should look suspicious, not routine.

Footer: Cancel / Run migration.

### 3. Run and progress

Run posts `{fromVersion, toVersion}` to `.../templates/{id}/migrate`. The row's status cell then shows progress driven by re-polling `GET .../templates/{id}/migration-status` every 2 seconds (`activeMigration.processedDocuments / totalDocuments`), stopping when `activeMigration` clears or reaches a terminal state. Progress is read from the resource, not a tracked job id, so a reload or a return trip rehydrates it from the same query with no client-side state.

### 4. Conflict resolution

Handled in place, not on a separate route. When `activeMigration` reports `completed_with_conflicts` with unresolved conflicts, the row expands (or opens a panel) that loads `GET .../migrations/{activeMigration.jobId}/conflicts` and renders one card per unresolved conflict.

- Each card shows the page path (linked via an editor URL builder when the dashboard supplies one), the component type and id, and value rows derived from the stored `template_delta` and `document_actions`: previous default -> template's new value alongside the page's current value. Three actions map 1:1 to the resolve endpoint verbs:
  - **Apply template change** (`apply`)
  - **Keep page's version** (`skip`)
  - **Flag for manual edit** (`manual`)
  Resolved cards collapse to a single line with the resolution, timestamp, and actor. An **Apply all remaining** bulk action (confirmation required) resolves every open conflict with `apply`. After each resolve, conflicts and migration-status refetch.
- **Rollback:** on the just-run migration, when its job carries a `checkpoint_id`, a Rollback action behind a confirmation dialog that states what the checkpoint restores. It targets `activeMigration.jobId`; there is no separate history from which to roll back an older job.

## The generic conflict card (localization forward-compatibility)

`ConflictCard` takes its content as data, not domain knowledge:

```typescript
interface ConflictCardProps {
  target: { documentPath: string; componentType: string; componentId?: string; href?: string };
  incoming: { label: string; values: ValueChange[] };   // "Template v5" | "Source (en) changed"
  current: { label: string; values: ValueChange[] };    // "This page" | "Translation (de)"
  verbs: { id: string; label: string }[];               // apply/skip/manual, relabelled per domain
  resolution?: { verb: string; at: string; by: string };
  onResolve: (verbId: string) => Promise<void>;
}
```

Migration review is the first consumer. Localization review (PROPOSAL-011) reuses the card with incoming = source-locale change, current = the translation, and verbs relabelled (apply = retranslate, skip = keep translation, manual = flag for a translator); nothing in the card changes.

## CSS-side additions

1. **Migration progress on status:** the per-template `GET .../templates/{id}/migration-status` gains an `activeMigration` field: `null`, or `{ jobId, status, processedDocuments, totalDocuments, unresolvedConflicts }` for the template's current run. It resolves the template's most recent job and returns it while the job is running (`pending` / `in_progress`) or finished with unresolved conflicts (`completed_with_conflicts`, `unresolvedConflicts > 0`); otherwise `null`. This is what the UI polls for progress and what tells it conflicts await, so there is no jobs-list endpoint. Additive; the existing status fields are unchanged.
2. **css-client conflict methods:** `migrationConflicts.list()` and `migrationConflicts.resolve()`, plus a `detail` parameter on `previewMigration`. These ship for external consumers; the dashboard itself uses its own axios hooks. `migrate`, `getMigrationJob`, and `rollbackMigration` already exist.

Migration deltas are derived from an id-keyed snapshot diff (PROPOSAL-015 / PCC-3239), so there is no recorded-vs-derived provenance to surface; the earlier `deltaSource` idea is dropped.

## Polling and performance

Progress polling at 2 seconds while a template has a running `activeMigration`, stopped once it clears or reaches a terminal state. The list view's per-template `migration-status` calls run in parallel and are acceptable for realistic template counts.

## Verification value

The tab replaces the API-script harness for day-to-day testing: the preview surfaces the delta (the signal both PCC-3357 bugs hid), conflict cards exercise every resolve verb, and rollback is one click. The `verify-template-compat.py` flow maps onto it: create and edit a template in the editor, then preview, run, and resolve from the dashboard.

## Open questions

1. Where the dashboard's site detail defines its tabs, and the mount point for this one.
2. Whether the dashboard already exposes an editor URL builder for deep links into pages, or the prop stays optional and links render only when supplied.

## Implementation order

1. **CSS addition** (this repo): `activeMigration` on migration-status. TDD against the migration status suite.
2. **Tab + list view** in the dashboard's site detail: branch picker, attention-only template table, status/progress cell.
3. **Preview modal and run.**
4. **Inline conflict resolution: conflict cards, resolve verbs, apply-all, rollback.**
