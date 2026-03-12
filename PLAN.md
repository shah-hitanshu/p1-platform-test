# Visual Merge Conflict Resolution Plan

## Goal

Replace the text-based merge conflict resolution UI with a fully visual experience. The current `MergeResolutionPage` uses a text list + detail panel pattern with raw text/JSON for cherry-pick and CRDT preview. The new design:

1. **Consolidates** Document Diffs, Visual Compare, Merge Preview, and Resolve Conflicts into a single unified page -- eliminating the need for separate tabs in the downstream app
2. **Makes resolution visual**: every strategy (accept-draft, accept-live, cherry-pick, crdt-preview) shows rendered Puck output via `<Render>`, not raw text or JSON
3. **Enables component-level selection** by clicking on rendered components in the visual preview
4. **Enables prop-level cherry-pick** through a visual diff view showing rendered before/after for individual fields
5. **Supports side-by-side, slider, and overlay** view modes throughout (reusing existing patterns from `MergePreviewRenderer`)
6. **Retains all keyboard navigation** for efficient processing of large merges

The `useMergeResolution` hook's public API is unchanged. This is a rendering-layer replacement.

---

## Architecture Decisions

### Decision 1: Replace rendering layer only; preserve hook API

**Why:** The `useMergeResolution` hook already correctly manages the full state machine -- document list, strategy selection, cherry-pick selections, CRDT preview fetching, navigation, and merge execution. All 28 hook tests will continue passing unchanged. The work is entirely in the component layer: replacing text-based rendering with visual Puck rendering.

**Implication:** No changes to `useMergeResolution.ts`, `packages/css-client/`, or any hook test files.

### Decision 2: Thread `config` (Puck config) through to all visual components

**Why:** The current `MergeResolutionPage` accepts `config: unknown` but never uses it (marked "reserved for future Puck Render integration"). This plan activates that prop. The Puck `<Render>` component requires both `data` (PuckData) and `config` (component registry). The config must flow from `MergeResolutionPage` → `DocumentResolutionDetail` → visual comparison components and `CrdtPreviewPanel`.

**Type:** The config is typed as `unknown` in the page props (matching the existing interface) but cast to `Parameters<typeof Render>[0]['config']` at the `<Render>` call site, following the pattern established by `MergePreviewRenderer` and `VisualBranchCompare`.

### Decision 3: Create new `VisualResolutionCompare` component rather than reusing `MergePreviewRenderer` directly

**Why:** `MergePreviewRenderer` is designed for read-only comparison. The visual merge resolution needs:
- **Clickable components** in the rendered output to select Draft vs Live at the component level
- **Strategy-aware rendering** (e.g., when cherry-pick is selected, show the merged result; when accept-draft is selected, highlight the Draft side)
- **Diff highlighting** for the currently selected strategy

A new `VisualResolutionCompare` component wraps the same `<Render>` + `createHighlightedConfig` pattern but adds interactive component selection. This avoids polluting the existing read-only `MergePreviewRenderer` with resolution-specific logic.

### Decision 4: Component-level click selection via highlight config wrapper

**Why:** Puck's `<Render>` renders components through config-defined render functions. The existing `createHighlightedConfig` already wraps render functions to add visual overlays (diff highlighting). We extend this pattern with `createClickableConfig` that wraps each component's render function to:
1. Add a click handler that fires `onComponentClick(componentId, componentType)`
2. Add a hover highlight showing which component would be selected
3. Add a visual indicator showing which branch's version is currently selected

This approach is architecturally consistent with the existing diff-highlighting pattern and requires no modification to Puck internals.

### Decision 5: View mode state is per-document, not global

**Why:** When reviewing 100+ documents, users may prefer side-by-side for one document and slider for another. Storing view mode per-document in the component state (not in the hook, since it's a presentation concern) prevents jarring view mode resets when navigating between documents.

**Implementation:** `MergeResolutionPage` maintains a `Map<string, ViewMode>` keyed by documentId, defaulting to `'side-by-side'`.

### Decision 6: Cherry-pick visual flow uses a two-panel layout

**Why:** For cherry-pick, the user needs to see:
1. The current merged result (rendered via `<Render>`) on the left/top
2. The component/prop selection controls on the right/bottom

As the user changes cherry-pick selections, the rendered preview updates in real-time. This gives immediate visual feedback on the impact of each selection, which is the core improvement over the text-based approach.

### Decision 7: CRDT preview renders via `<Render>` with three-way comparison

**Why:** The current `CrdtPreviewPanel` displays raw JSON. The visual version renders the CRDT result via `<Render>` and shows a three-way comparison: Draft | CRDT Result | Live. This lets the user visually verify the automatic merge before accepting it.

### Decision 8: Consolidate tabs into the resolution page

**Why:** The user explicitly requested: "roll all of the Document Diffs, Visual Compare, and Merge Preview into the Resolve Conflicts screen." The current downstream app (`my-app/app/merge/page.tsx`) has 4 tabs. After this change, the Resolve Conflicts tab subsumes the functionality of all other tabs. The document list shows diff summaries (from Document Diffs), the detail panel shows visual comparison (from Visual Compare), and the rendered previews serve as merge preview. The downstream app can then simplify to a single "Resolve Conflicts" entry point.

---

## Component Inventory

### New files to create

| # | File | Package | Purpose |
|---|------|---------|---------|
| 1 | `packages/puck-css/src/components/merge-resolution/VisualResolutionCompare.tsx` | puck-css | Visual comparison with `<Render>`, view mode selector, and diff highlighting for the selected resolution strategy |
| 2 | `packages/puck-css/src/components/merge-resolution/ComponentVisualPicker.tsx` | puck-css | Rendered Puck output with clickable component overlays for selecting which branch's component to keep |
| 3 | `packages/puck-css/src/components/merge-resolution/CherryPickVisualPanel.tsx` | puck-css | Two-panel layout: rendered merged preview + component/prop selection controls |
| 4 | `packages/puck-css/src/utils/clickableConfig.ts` | puck-css | `createClickableConfig` utility that wraps Puck config render functions to add click handlers and selection indicators |
| 5 | `packages/puck-css/src/__tests__/VisualResolutionCompare.test.tsx` | puck-css | Tests for view mode switching, correct data to `<Render>`, strategy-aware rendering |
| 6 | `packages/puck-css/src/__tests__/ComponentVisualPicker.test.tsx` | puck-css | Tests for component click selection, highlight state, callback invocation |
| 7 | `packages/puck-css/src/__tests__/CherryPickVisualPanel.test.tsx` | puck-css | Tests for two-panel layout, merged preview rendering, prop selection integration |

### Files to modify (with scope of changes)

| # | File | Change |
|---|------|--------|
| 1 | `packages/puck-css/src/components/merge-resolution/MergeResolutionPage.tsx` | Major rewrite: add `config` threading, per-document view mode state, replace split list+detail layout with visual-first layout, integrate `VisualResolutionCompare` |
| 2 | `packages/puck-css/src/components/merge-resolution/DocumentResolutionDetail.tsx` | Major rewrite: replace text-based strategy views with visual rendering. Accept-draft/accept-live show rendered preview. Cherry-pick uses `CherryPickVisualPanel`. CRDT preview uses rendered `<Render>` with three-way comparison |
| 3 | `packages/puck-css/src/components/merge-resolution/DocumentResolutionList.tsx` | Moderate: add diff summary counts per document (added/removed/modified badges), conflict type indicators, mini-preview thumbnails (optional based on feasibility) |
| 4 | `packages/puck-css/src/components/merge-resolution/CrdtPreviewPanel.tsx` | Major rewrite: replace raw JSON with `<Render>` visual preview and optional three-way comparison |
| 5 | `packages/puck-css/src/components/merge-resolution/ResolutionStrategyPicker.tsx` | Minor: no functional changes, styling adjustments to fit visual layout |
| 6 | `packages/puck-css/src/components/merge-resolution/MergeResolutionToolbar.tsx` | Moderate: add `ViewModeSelector` integration, adjust layout for consolidated page |
| 7 | `packages/puck-css/src/components/merge-resolution/index.ts` | Add exports for new components |
| 8 | `packages/puck-css/src/index.ts` | Add exports for new components and utility |
| 9 | `packages/puck-css/src/__tests__/MergeResolutionPage.test.tsx` | Update to match new visual layout structure |
| 10 | `packages/puck-css/src/__tests__/DocumentResolutionDetail.test.tsx` | Update to match new visual rendering |
| 11 | `packages/puck-css/src/__tests__/DocumentResolutionList.test.tsx` | Update to match new diff summary display |
| 12 | `packages/puck-css/src/__tests__/CrdtPreviewPanel.test.tsx` | Update to verify `<Render>` usage instead of raw JSON |
| 13 | `packages/puck-css/src/__tests__/MergeResolutionToolbar.test.tsx` | Update for ViewModeSelector integration |

### Files NOT modified (explicitly preserved)

| File | Reason |
|------|--------|
| `packages/puck-css/src/hooks/useMergeResolution.ts` | Hook API unchanged; all state management logic preserved |
| `packages/puck-css/src/__tests__/useMergeResolution.test.ts` | Hook tests unchanged; 22 tests continue passing |
| `packages/puck-css/src/__tests__/useMergeResolution-execute.test.ts` | Execution tests unchanged; 7 tests continue passing |
| `packages/puck-css/src/__tests__/ResolutionStrategyPicker.test.tsx` | Strategy picker tests unchanged; 5 tests continue passing |
| `packages/puck-css/src/components/merge-preview/*` | Read-only comparison components preserved as-is; patterns reused but components not modified |
| `packages/puck-css/src/components/conflict-resolution/*` | Existing conflict resolution components preserved; `ComponentConflictGroup` reused within `CherryPickVisualPanel` |
| `packages/puck-css/src/utils/puckFieldClassifier.ts` | Utility unchanged |
| `packages/puck-css/src/utils/highlightConfig.ts` | Utility unchanged; pattern extended by new `clickableConfig.ts` |
| All `packages/css-client/*` files | No changes to the API client layer |

---

## Detailed Component Specifications

### Phase 1: Clickable Config Utility

#### 1.1 `createClickableConfig` (`packages/puck-css/src/utils/clickableConfig.ts`)

Follows the exact pattern of `createHighlightedConfig` from `highlightConfig.ts`. Wraps each component's render function to add interactive behavior.

```typescript
import React from 'react';
import type { PuckConfig } from './highlightConfig.js';

export type ComponentSelectionState = 'source' | 'target' | 'merged' | 'none';

export interface ClickableConfigOptions {
  /** Map of componentId -> which branch is currently selected */
  selections: Map<string, ComponentSelectionState>;
  /** Callback when a component is clicked */
  onComponentClick: (componentId: string, componentType: string) => void;
  /** Whether click interaction is enabled (false = view-only) */
  interactive: boolean;
}

export function createClickableConfig(
  config: PuckConfig,
  options: ClickableConfigOptions
): PuckConfig;
```

**Behavior:**
- Wraps each component's render function in a `<div>` with:
  - `onClick` handler that calls `onComponentClick(id, componentType)` (only when `interactive` is true)
  - `onMouseEnter`/`onMouseLeave` for hover highlighting (only when `interactive` is true)
  - CSS class indicating selection state: `component-selection--source`, `component-selection--target`, `component-selection--merged`, or none
  - `data-component-id` attribute for test assertions
  - `cursor: pointer` style when interactive
- The selection state visual treatment:
  - `source` (Draft selected): green-tinted left border
  - `target` (Live selected): blue-tinted left border
  - `merged` (cherry-pick result): yellow-tinted left border
  - `none`: no special styling (used in non-interactive view-only mode)

**Justification for new file vs. modifying `highlightConfig.ts`:** The highlight config is read-only visual decoration with no state or event handlers. The clickable config adds interactivity (click handlers, hover state, selection tracking). Mixing these concerns would make `highlightConfig.ts` do too many things. Keeping them separate allows composing both together when needed (highlight + clickable).

### Phase 2: Visual Resolution Components

#### 2.1 `VisualResolutionCompare` (`packages/puck-css/src/components/merge-resolution/VisualResolutionCompare.tsx`)

The core visual comparison component for the resolution flow. Adapts `MergePreviewRenderer`'s pattern for resolution-aware rendering.

```typescript
export interface VisualResolutionCompareProps {
  /** PuckData from source (Draft) branch */
  sourceData: PuckData | null;
  /** PuckData from target (Live) branch */
  targetData: PuckData | null;
  /** Puck config for rendering */
  config: unknown;
  /** Current view mode */
  viewMode: ViewMode;
  /** Name of source branch */
  sourceBranchName: string;
  /** Name of target branch */
  targetBranchName: string;
  /** Component-level diffs for highlighting */
  diffs: ComponentDiffWithPosition[];
  /** Current document resolution strategy (affects rendering) */
  strategy: DocumentResolutionStrategy;
  /** Optional merged snapshot to show (for cherry-pick or CRDT) */
  mergedSnapshot?: PuckData | null;
}
```

**Rendering behavior by strategy:**

- **`accept-draft`**: Side-by-side shows Draft (highlighted as selected, green border) and Live (dimmed). Slider/overlay show Draft prominently.
- **`accept-live`**: Side-by-side shows Draft (dimmed) and Live (highlighted as selected, blue border). Slider/overlay show Live prominently.
- **`cherry-pick`**: Side-by-side shows Draft and Live. If `mergedSnapshot` is provided, a third "Merged result" panel is shown below the comparison. The merged panel is rendered with the base config (no diff highlighting) and has a green "This will be merged" header.
- **`crdt-preview`**: Shows three panels: Draft | CRDT Result (from `mergedSnapshot`) | Live. The CRDT result panel has a purple "Auto-merged" header.
- **`unresolved`**: Standard side-by-side with diff highlighting (same as current Visual Compare), no selection indicators.

**Edge cases:**
- `sourceData` is null (deleted in source): show only Live panel with "Deleted in Draft" overlay
- `targetData` is null (new in source): show only Draft panel with "New document" overlay
- Both null: show "No content available" message

This component does NOT handle click interactions -- it is purely visual. Click interactions are handled by `ComponentVisualPicker` which is only shown when appropriate.

#### 2.2 `ComponentVisualPicker` (`packages/puck-css/src/components/merge-resolution/ComponentVisualPicker.tsx`)

Renders two Puck previews (Draft and Live) side-by-side with clickable components. Clicking a component in either panel selects that branch's version for that component.

```typescript
export interface ComponentVisualPickerProps {
  /** PuckData from source (Draft) branch */
  sourceData: PuckData;
  /** PuckData from target (Live) branch */
  targetData: PuckData;
  /** Puck config for rendering */
  config: unknown;
  /** Source branch display name */
  sourceBranchName: string;
  /** Target branch display name */
  targetBranchName: string;
  /** Current per-component selections (componentId -> 'source' | 'target') */
  componentSelections: Map<string, 'source' | 'target'>;
  /** Callback when a component is clicked in either panel */
  onComponentSelect: (componentId: string, componentType: string, choice: 'source' | 'target') => void;
}
```

**Rendering:**
- Two panels: "Draft" (left) and "Live" (right), each rendering the full page via `<Render>` with `createClickableConfig`
- Each panel's components show a selection indicator:
  - In the Draft panel: components selected as 'source' show a green checkmark overlay; components selected as 'target' show a faded/dimmed appearance
  - In the Live panel: components selected as 'target' show a blue checkmark overlay; components selected as 'source' show a faded/dimmed appearance
  - Unselected components (no selection yet) show neutral styling with a subtle "Click to select" hover state
- Clicking a component in the Draft panel calls `onComponentSelect(componentId, componentType, 'source')`
- Clicking a component in the Live panel calls `onComponentSelect(componentId, componentType, 'target')`

**Integration with hook:** The component-level selections map to the hook's `acceptAllComponentProps(documentId, componentId, choice)`. When a component is clicked, the page handler calls `acceptAllComponentProps` for all fields of that component.

#### 2.3 `CherryPickVisualPanel` (`packages/puck-css/src/components/merge-resolution/CherryPickVisualPanel.tsx`)

Two-panel layout for prop-level cherry-pick with visual feedback.

```typescript
export interface CherryPickVisualPanelProps {
  /** Current document being resolved */
  document: DocumentResolution;
  /** Puck config for rendering */
  config: unknown;
  /** Source branch display name */
  sourceBranchName: string;
  /** Target branch display name */
  targetBranchName: string;
  /** Callback for individual prop selection */
  onCherryPickSelection: (
    documentId: string,
    componentId: string,
    propName: string,
    choice: 'source' | 'target'
  ) => void;
  /** Callback for accepting all props of a component */
  onAcceptAllComponentProps: (
    documentId: string,
    componentId: string,
    choice: 'source' | 'target'
  ) => void;
  /** Component click handler for visual component-level selection */
  onComponentClick?: (componentId: string, choice: 'source' | 'target') => void;
}
```

**Layout:**
```
┌───────────────────────────────────┬──────────────────────────────────┐
│ Component-level visual picker     │ Merged Preview                   │
│ (Draft | Live with clickable     │ (Rendered via <Render>)           │
│  components)                      │                                  │
├───────────────────────────────────┤ Updates live as selections       │
│ Prop-level controls               │ change                          │
│ (ComponentConflictGroup per       │                                  │
│  component with conflicts)        │                                  │
│                                   │                                  │
│ "X fields auto-merged"            │                                  │
│ [Accept all Draft] [Accept all    │                                  │
│  Live] per component              │                                  │
│ Radio buttons per conflicting     │                                  │
│ prop                              │                                  │
└───────────────────────────────────┴──────────────────────────────────┘
```

**Left side (selection controls):**
- Top section: `ComponentVisualPicker` for component-level selection (clickable rendered components)
- Below: `ComponentConflictGroup` instances for each component with conflicts, showing prop-level radio buttons (reusing existing component)
- Auto-merged field count
- Per-component "Accept all from Draft" / "Accept all from Live" buttons

**Right side (merged preview):**
- Rendered via `<Render>` using the current `mergedSnapshot` from the document
- Updates live as the user makes cherry-pick selections (the hook already recomputes `mergedSnapshot` on every selection change)
- Shows a "Merged result" header
- If `mergedSnapshot` is null (no selections made yet), shows a message: "Make selections to see the merged preview"

### Phase 3: Rewrite Existing Components

#### 3.1 `MergeResolutionPage` (rewrite)

The page becomes the single entry point for the entire merge review + resolution flow.

**New state additions** (component-level, not in hook):
- `viewModes: Map<string, ViewMode>` -- per-document view mode, default `'side-by-side'`

**New props accepted:**
- `config` is now actively used (no longer void-suppressed)

**Layout restructure:**

```
┌──────────────────────────────────────────────────────────────┐
│ MergeResolutionToolbar                                       │
│ [← Back] [Draft → Live] [3/12 resolved] [ViewMode] [Execute]│
├──────────────────┬───────────────────────────────────────────┤
│ DocumentList     │ Visual Detail Panel                       │
│ (320px fixed)    │ (flex-grow)                               │
│                  │                                           │
│ /home    [Draft] │ [Strategy Picker]                         │
│ /about   [?]     │ [VisualResolutionCompare]                 │
│ /contact [Live]  │ or [CherryPickVisualPanel]                │
│ +2 -0 ~1         │ or [CRDT 3-way visual preview]            │
│                  │                                           │
└──────────────────┴───────────────────────────────────────────┘
```

**Key changes from current:**
1. `config` is destructured and passed to child components
2. `viewModes` state managed at page level, passed to detail panel
3. `ViewModeSelector` integrated into toolbar or detail header
4. Detail panel uses `VisualResolutionCompare` / `CherryPickVisualPanel` / visual `CrdtPreviewPanel` based on strategy

#### 3.2 `DocumentResolutionList` (moderate update)

Add per-document diff summary information to give context at a glance:

- Each list item now shows: document path, strategy badge, and diff counts (e.g., "+2 -0 ~1")
- Diff counts are computed from the document's `sourceSnapshot` and `targetSnapshot` using `createBranchDocumentComparison` (already available in the codebase)
- Conflict type shown as a subtle icon/label for delete conflicts

**New prop:**
```typescript
config?: unknown; // Puck config, reserved for future mini-preview thumbnails
```

No changes to keyboard navigation logic -- all existing handlers preserved.

#### 3.3 `DocumentResolutionDetail` (major rewrite)

Currently renders text-based strategy views. The rewrite replaces each strategy view with visual rendering:

**New props:**
```typescript
config: unknown; // Puck config for <Render>
viewMode: ViewMode; // Current view mode for this document
onViewModeChange: (mode: ViewMode) => void;
diffs: ComponentDiffWithPosition[]; // Pre-computed diffs for this document
```

**Strategy-specific rendering:**

- **`accept-draft` / `accept-live`**: `VisualResolutionCompare` with the selected strategy, showing which side will be kept with visual emphasis
- **`cherry-pick`**: `CherryPickVisualPanel` with visual component picker + prop-level controls + live merged preview
- **`crdt-preview`**: Visual `CrdtPreviewPanel` showing three-way rendered comparison (Draft | CRDT Result | Live)
- **`unresolved`**: `VisualResolutionCompare` with no selection emphasis, standard diff highlighting, encouraging the user to pick a strategy
- **Delete conflicts**: Single-panel view showing the surviving version rendered via `<Render>`, with an overlay message explaining the deletion

#### 3.4 `CrdtPreviewPanel` (major rewrite)

Replace raw JSON with visual rendering.

**New props:**
```typescript
export interface CrdtPreviewPanelProps {
  snapshot: PuckData | null;
  loading: boolean;
  error: string | null;
  /** Puck config for rendering */
  config: unknown;
  /** Source data for three-way comparison */
  sourceData?: PuckData | null;
  /** Target data for three-way comparison */
  targetData?: PuckData | null;
  /** Source branch name */
  sourceBranchName?: string;
  /** Target branch name */
  targetBranchName?: string;
}
```

**Rendering:**
- Loading: spinner/pulse animation
- Error: styled error message
- Success with `sourceData` and `targetData`: three-panel layout -- Draft | CRDT Result | Live, each rendered via `<Render>`
- Success without source/target (standalone): single `<Render>` panel showing the CRDT result

#### 3.5 `MergeResolutionToolbar` (moderate update)

Add `ViewModeSelector` to the toolbar so it applies globally or per-document.

**New props:**
```typescript
viewMode: ViewMode;
onViewModeChange: (mode: ViewMode) => void;
```

The `ViewModeSelector` is placed between the progress indicator and the bulk action buttons. No other functional changes.

#### 3.6 `DocumentResolutionList` diff summary

Each list item shows a compact diff summary below the document path:

```
/pages/home                    [Draft]
+2 added  ~1 modified
```

The diff is computed by the `MergeResolutionPage` and passed as a new prop:

```typescript
documentDiffs: Map<string, { added: number; removed: number; modified: number }>;
```

### Phase 4: Integration, Exports, and Test Updates

#### 4.1 Export new components

Update `packages/puck-css/src/components/merge-resolution/index.ts` to export:
- `VisualResolutionCompare` and `VisualResolutionCompareProps`
- `ComponentVisualPicker` and `ComponentVisualPickerProps`
- `CherryPickVisualPanel` and `CherryPickVisualPanelProps`

Update `packages/puck-css/src/index.ts` to re-export from the barrel.

Export `createClickableConfig` and its types from `packages/puck-css/src/index.ts`.

#### 4.2 Update existing tests

All component tests need updates to match the new DOM structure:

- `MergeResolutionPage.test.tsx`: Verify config is passed through, visual components are rendered, view mode state management works
- `DocumentResolutionDetail.test.tsx`: Verify `<Render>` mock receives correct data for each strategy, visual comparison renders, cherry-pick visual panel renders
- `DocumentResolutionList.test.tsx`: Verify diff summary badges render, existing keyboard navigation unchanged
- `CrdtPreviewPanel.test.tsx`: Verify `<Render>` is used instead of raw JSON, three-way comparison renders
- `MergeResolutionToolbar.test.tsx`: Verify `ViewModeSelector` renders and callbacks fire

#### 4.3 New test files

- `VisualResolutionCompare.test.tsx` (~8 tests): View mode switching, correct data to `<Render>` per strategy, edge cases (null snapshots), diff highlighting integration
- `ComponentVisualPicker.test.tsx` (~6 tests): Click events on components fire correct callbacks with correct choice, selection state visual indicators, hover state
- `CherryPickVisualPanel.test.tsx` (~6 tests): Two-panel layout renders, merged preview updates, component conflict groups display, accept-all buttons work

---

## Implementation Order

All changes are implemented as a single cutover. The implementation order within the cutover is:

1. **`clickableConfig.ts`** -- new utility, no dependencies on modified files
2. **`VisualResolutionCompare.tsx`** -- new component, depends only on existing utilities + new `clickableConfig`
3. **`ComponentVisualPicker.tsx`** -- new component, depends on `clickableConfig`
4. **`CherryPickVisualPanel.tsx`** -- new component, depends on `ComponentVisualPicker` and existing `ComponentConflictGroup`
5. **`CrdtPreviewPanel.tsx`** -- rewrite, adds `<Render>` usage
6. **`DocumentResolutionDetail.tsx`** -- rewrite, composes new visual components
7. **`DocumentResolutionList.tsx`** -- moderate update, adds diff summaries
8. **`MergeResolutionToolbar.tsx`** -- moderate update, adds ViewModeSelector
9. **`MergeResolutionPage.tsx`** -- rewrite, threads config and view mode, new layout
10. **`index.ts` exports** -- barrel and package exports
11. **All test files** -- update existing + create new

---

## Testing Strategy

**Level:** Medium (as approved by user)

**Mock strategy:** `@puckeditor/core`'s `Render` component is mocked in the test environment (it is already mocked for other component tests). The mock exposes its `data` and `config` props for assertion. Tests verify that the correct PuckData reaches `<Render>` for each view mode and strategy combination.

**Test file plan:**

| Test file | Tests | Coverage |
|---|---|---|
| `useMergeResolution.test.ts` | ~22 (unchanged) | Hook state machine |
| `useMergeResolution-execute.test.ts` | ~7 (unchanged) | Merge execution |
| `ResolutionStrategyPicker.test.tsx` | ~5 (unchanged) | Strategy button behavior |
| `MergeResolutionPage.test.tsx` | ~8 (updated) | Page layout, config threading, view mode state |
| `DocumentResolutionList.test.tsx` | ~12 (updated) | List with diff summaries, keyboard navigation |
| `DocumentResolutionDetail.test.tsx` | ~8 (updated) | Visual rendering per strategy, config threading |
| `CrdtPreviewPanel.test.tsx` | ~5 (updated) | Visual `<Render>` instead of JSON, three-way comparison |
| `MergeResolutionToolbar.test.tsx` | ~6 (updated) | ViewModeSelector integration |
| `VisualResolutionCompare.test.tsx` | ~8 (new) | View modes, strategy-aware rendering, edge cases |
| `ComponentVisualPicker.test.tsx` | ~6 (new) | Click selection, indicators, hover |
| `CherryPickVisualPanel.test.tsx` | ~6 (new) | Two-panel layout, merged preview, accept-all |

**Estimated total: ~93 tests** (34 unchanged + ~39 updated + ~20 new)

---

## Non-Goals (explicitly out of scope)

- **Modifying the `useMergeResolution` hook** -- the hook API is stable and well-tested; only the rendering layer changes
- **Modifying `packages/css-client`** -- no API client changes needed
- **Modifying existing read-only comparison components** (`MergePreviewRenderer`, `VisualBranchCompare`, `ViewModeSelector`) -- patterns are reused, components are not modified
- **Modifying existing conflict-resolution components** (`ComponentConflictGroup`, `PuckFieldResolutionPanel`) -- reused as-is within `CherryPickVisualPanel`
- **Adding E2E/Playwright tests** -- the UX is a placeholder that may move; medium fidelity with mock-based component tests is appropriate
- **Modifying the downstream app** (`my-app/app/merge/page.tsx`) -- the library changes are self-contained; downstream updates are a separate task
- **Real Puck rendering in tests** -- `<Render>` is mocked in jsdom; visual correctness is verified through structured assertions on mock props
