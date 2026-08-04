# PCC-3406 Phase 0 spike — findings (subtask 1)

Run: `pnpm --filter @pantheon-systems/puck-css test:spike:3406`
Target: real Puck **0.21.1** in jsdom. 9 assertions, all green.

## Why this needed its own vitest config

`packages/puck-css/vitest.config.ts` aliases `@puckeditor/core` to
`src/__mocks__/@puckeditor/core.ts` — a 20-line stub with no store, no fields
slice, and no `resolveFields`. **Every existing test in this package that touches
Puck is testing the stub.** A role-gating test written in the normal test
directory would have proved nothing. `spike/pcc-3406/vitest.config.ts` drops that
alias; the jsdom polyfills real Puck needs (`matchMedia`, `localStorage`,
`ResizeObserver`, `DOMMatrixReadOnly`) are in `setup.ts`.

**Carry into Phase 1:** the regression test that keeps the no-derived-state rule
honest must run un-aliased. Either promote this config into the workspace or
un-stub `@puckeditor/core` for the affected tests. Otherwise the guard test
passes against a stub forever.

## Spike item 1 — role gating via `resolveFields`: works

- A role-varying root `resolveFields` renders the resolved set, and **omitting
  keys from inside an object field's `objectFields` hides them from the DOM.**
  Object fields render as a flat `<fieldset>` with inputs named
  `_meta.ogTitle`, ids `root_object__meta_ogTitle` — per-key omission needs no
  Puck change.
- The omitted key's **value survives in `root.props._meta`** and rides the next
  autosave untouched. Omission is a UI gate only, exactly as the plan states —
  server-side rejection (subtask 18) remains the enforcement.

**Decision 2 → the single `_meta` object field is confirmed viable.** No need to
flatten to prefixed root props for gating reasons.

## Spike item 2 — the staleness/mis-resolution risk is smaller than the plan assumed

Four things came out of this, and two of them change the plan.

1. **Role change re-resolves reliably, and we already get it for free.**
   `useP1Editor` sets `puckKey = \`css-${css.userRole}\`` (useP1Editor.ts:572)
   and the app passes it as `<Puck key={...}>`. A role switch remounts Puck
   entirely, so the fields slice re-resolves from scratch. This matters because
   the fields slice subscribes only to `nodes[id || "root"]` — it does **not**
   subscribe to `config` (the permissions slice does; fields doesn't). Without
   the remount, swapping in a role-varying config would not re-resolve.

2. **The Page tab is not a stale-fields hazard.** The plan worried that
   re-resolution doesn't fire on a sidebar tab switch. In our editor the Page
   tab *is* an `itemSelector` dispatch, which changes `selectedItem?.props.id` —
   the fields slice's effect dep — so it re-resolves. Verified: with a block
   selected the root resolver never runs; clearing the selector runs it and
   renders the correct role-gated set.

3. **The `getComponentConfig` fallback is real but the result is discarded.**
   Confirmed directly: with a block selected, `getComponentConfig(undefined)`
   returns the *Block's* config (`fields: ['text']`) instead of root's. To
   actually mis-resolve, a root-node mutation must land in the window between
   the store recording a new `selectedItem` and the fields effect re-running —
   reachable in principle via a realtime/Yjs root update landing on a click.
   Drove that race with a 150 ms resolver plus a concurrent `setData` +
   selection: the post-resolve guard (`selectedItem?.props.id !== id`) discarded
   it, and `FieldsInternal` only renders when `fields.id === id`, so the worst
   observed outcome is **an empty panel, never wrong fields**. The spike asserts
   the Block resolver is never handed root data, so a Puck upgrade that makes
   this reachable fails the test.

4. **New trap — `metadata` changes do not re-resolve fields.** `<Puck metadata>`
   writes to the store, but the fields slice has no metadata subscription:
   changing `metadata` after mount produced **zero** additional resolver calls.
   The plan's non-persisted channel for inherited-value placeholders
   (subtask 21) reads `params.metadata` inside `resolveFields`, so site/template
   defaults that arrive asynchronously — which is how react-query delivers them —
   **would be baked in as whatever was present at first resolve, and never
   refresh.** Placeholders must instead be read at field-render time (a custom
   field renderer using `usePuck`), or the inherited values must be resolved
   before Puck mounts. Worth reflecting in subtask 21's design before it's
   estimated.

Also noted: the root resolver fires ~4× per mount. An implementation that hits
the network per resolve needs caching.

## Spike item 3 — the autosave payload stays clean

With `metadata={{ inheritedOgTitle, userRole }}` passed and a value edited, the
`onChange` payload's `root.props` keys are exactly `['_meta', 'title']`: no
`_seo`, no `userRole`, no `readOnly` on `root`, no inherited value inside
`_meta`. The resolver *does* see the inherited value via `params.metadata` — it
just never reaches the snapshot. This is the assertion that keeps the
no-derived-state rule enforced after the plan is forgotten; it belongs in the
Phase 1 test suite (un-aliased, per above).

## Bug found in shipped code — Block tab selects nothing

`P1InspectorFields.handleTabChange` (P1InspectorFields.tsx:70) dispatches
`itemSelector: { zone: 'default-zone', index: 0 }`. Puck's `getItem()` looks up
`state.indexes.zones[selector.zone]`, and the real zone index contains exactly
one key: **`root:default-zone`** (`rootDroppableId` = `${rootAreaId}:${rootZone}`).
Verified against a real store — the bare `'default-zone'` resolves to no zone and
`selectedItem` stays unset, so clicking **Block** with nothing selected silently
does nothing. Fix is one string; worth claiming alongside the two bugs the plan
already lists (dashboard title, `ReadOnlyFieldsGuard` bypass). Needs a quick
confirm in the running editor since the tab is usually reached by clicking a
block on canvas instead.

## What this leaves for Phase 0

Settled: Decision 1 (`resolveFields`, not data-level `readOnly`), Decision 2
(object field, not flattened). The spike found no reason to hedge toward
flattening — so the remaining argument for it is only the subtask 23 applier fix
slipping, which is a scheduling question, not a Puck one.

Still open and unaffected by this spike: Q1, Q2, Q5, Q7 (and Q9/Q10 before
Phase 4 is estimated).
