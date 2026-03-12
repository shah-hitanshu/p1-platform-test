# Visual Merge Conflict Resolution Plan

## Goal

Replace the text-based merge conflict resolution UI with a fully visual experience. The current `MergeResolutionPage` uses a text list + detail panel pattern with raw text/JSON for cherry-pick and CRDT preview. The new design:

1. **Consolidates** Document Diffs, Visual Compare, Merge Preview, and Resolve Conflicts into a single unified page -- eliminating the need for separate tabs in the downstream app
2. **Makes resolution visual**: every strategy (accept-draft, accept-live, cherry-pick, crdt-preview) shows rendered Puck output via `<Render>`, not raw text or JSON
3. **Enables component-level selection** by clicking on rendered components in the visual preview to choose which branch's version of a component to keep
4. **Enables prop-level cherry-pick** through a visual diff view showing rendered before/after for individual fields, with radio-button selection per conflicting prop
5. **Supports side-by-side, slider, and overlay** view modes for visual comparison, reusing the existing `MergePreviewRenderer` directly rather than recreating it
6. **Retains all keyboard navigation** for efficient processing of large merges

The `useMergeResolution` hook's public API is unchanged. This is a rendering-layer replacement.

---

## Architecture Decisions

### Decision 1: Replace rendering layer only; preserve hook API

**Why:** The `useMergeResolution` hook already correctly manages the full state machine -- document list, strategy selection, cherry-pick selections, CRDT preview fetching, navigation, and merge execution. All 28 hook tests will continue passing unchanged. The work is entirely in the component layer: replacing text-based rendering with visual Puck rendering.

**Implication:** No changes to `useMergeResolution.ts`, `packages/css-client/`, or any hook test files.

### Decision 2: Thread `config` (Puck config) through to all visual components

**Why:** The current `MergeResolutionPage` accepts `config: unknown` but never uses it (marked "reserved for future Puck Render integration"). This plan activates that prop. The Puck `<Render>` component requires both `data` (PuckData) and `config` (component registry). The config must flow from `MergeResolutionPage` to `DocumentResolutionDetail` to visual comparison and preview components.

**Type:** The config is typed as `unknown` in the page props (matching the existing interface) but cast to `Parameters<typeof Render>[0]['config']` at the `<Render>` call site, following the pattern established by `MergePreviewRenderer`.

### Decision 3: Reuse `MergePreviewRenderer` directly; do not create a parallel comparison component

**Why:** `MergePreviewRenderer` already implements side-by-side, overlay, and slider modes with diff highlighting via `createHighlightedConfig`. The visual merge resolution needs the same comparison views. Creating a parallel `VisualResolutionCompare` component would duplicate 200+ lines of rendering logic (the `SideBySideView`, `OverlayView`, `SliderView` sub-components) and create a maintenance burden where bug fixes in one must be mirrored in the other.

Instead, `DocumentResolutionDetail` composes `MergePreviewRenderer` directly for the visual comparison (accept-draft, accept-live, unresolved strategies), adding strategy-specific visual emphasis through wrapper styling (e.g., dimming the non-selected side, adding a "selected" border). For cherry-pick and CRDT modes, purpose-built layouts render the appropriate visual content.

### Decision 4: Component-level click selection via overlay positioned on top of `<Render>` output

**Why:** The plan needs clickable components in the rendered Puck preview. Rather than wrapping Puck's config render functions with click handlers (which tightly couples interactive state to config creation, forces config regeneration on every state change, and makes the component tree opaque to React DevTools), we use a transparent overlay approach:

1. Render the Puck page via `<Render>` as normal
2. Query the rendered DOM for elements with `data-component-id` attributes (already emitted by `createHighlightedConfig`)
3. Position transparent click targets over each component using absolute positioning
4. Handle clicks on the overlay to dispatch component selection

This approach is architecturally cleaner because:
- The Puck config is not polluted with interactive concerns
- Config objects remain stable (no regeneration on selection changes)
- Click handling is standard React event handling, not config wrapping
- The overlay can show selection indicators (checkmarks, borders) without touching Puck internals

**Implementation:** A new `ComponentClickOverlay` component that accepts a ref to the rendered container, reads component positions via `getBoundingClientRect`, and renders absolutely-positioned click targets.

### Decision 5: View mode state is per-document, managed in the detail panel

**Why:** When reviewing 100+ documents, users may prefer side-by-side for one document and slider for another. The `ViewModeSelector` belongs in the detail panel header (next to the strategy picker), not in the toolbar, because:
- View mode is a per-document presentation concern
- The toolbar is a page-level concern (progress, bulk actions, merge execution)
- Placing it in the toolbar creates ambiguity about whether changing it affects the current document or all documents

**Implementation:** `DocumentResolutionDetail` maintains a `viewMode` state internally (defaulting to `'side-by-side'`). If per-document persistence is needed later, this can be lifted to the page level with a `Map<string, ViewMode>`.

### Decision 6: Cherry-pick uses a two-level interaction model

**Why:** The user specified two levels of cherry-pick selection:
1. **Component level:** Click a component in the rendered preview to accept all of that component's props from Draft or Live
2. **Prop level:** For fine-grained control, expand a component to see individual conflicting props with radio buttons for source/target selection

**Layout:**
```
+--------------------------------------------------+---------------------------+
| Visual Comparison                                 | Live Merged Preview        |
| (Two rendered Puck pages with clickable           | (Rendered via <Render>)    |
|  component overlays - Draft left, Live right)     |                            |
|                                                   | Updates live as selections |
| Click a component to select that branch's version | change                     |
+--------------------------------------------------+                            |
| Prop-level controls (below comparison)            |                            |
| ComponentConflictGroup per component with         |                            |
| conflicting props, radio buttons per field         |                            |
+--------------------------------------------------+---------------------------+
```

The left column shows the visual comparison with component click targets on top. Below the visual comparison, prop-level controls (the existing `ComponentConflictGroup`) allow fine-grained selection. The right column shows a live-updating merged preview rendered via `<Render>`.

### Decision 7: CRDT preview renders via `<Render>` with three-way comparison

**Why:** The current `CrdtPreviewPanel` displays raw JSON. The visual version renders the CRDT result via `<Render>` and shows a three-way comparison: Draft | CRDT Result | Live. This lets the user visually verify the automatic merge before accepting it.

### Decision 8: Consolidate tabs into the resolution page

**Why:** The user explicitly requested: "roll all of the Document Diffs, Visual Compare, and Merge Preview into the Resolve Conflicts screen." The current downstream app (`my-app/app/merge/page.tsx`) has 4 tabs. After this change, the Resolve Conflicts tab subsumes the functionality of all other tabs:
- **Document Diffs:** The document list shows diff summary counts (added/removed/modified) per document
- **Visual Compare:** The detail panel shows rendered Puck comparisons via `MergePreviewRenderer`
- **Merge Preview:** The cherry-pick merged preview and CRDT preview are rendered visually

The downstream app can then simplify to a single "Resolve Conflicts" entry point.

---

## Component Inventory

### New files to create

| # | File | Package | Purpose |
|---|------|---------|---------|
| 1 | `packages/puck-css/src/components/merge-resolution/ComponentClickOverlay.tsx` | puck-css | Transparent overlay that positions click targets over rendered Puck components for component-level selection |
| 2 | `packages/puck-css/src/components/merge-resolution/CherryPickVisualPanel.tsx` | puck-css | Two-column layout: visual comparison with component click overlays + prop-level controls (left), live merged preview (right) |
| 3 | `packages/puck-css/src/__tests__/ComponentClickOverlay.test.tsx` | puck-css | Tests for click target rendering, click callbacks, selection indicators |
| 4 | `packages/puck-css/src/__tests__/CherryPickVisualPanel.test.tsx` | puck-css | Tests for two-column layout, merged preview rendering, component/prop selection integration |

### Files to modify (with scope of changes)

| # | File | Change |
|---|------|--------|
| 1 | `packages/puck-css/src/components/merge-resolution/MergeResolutionPage.tsx` | Major rewrite: activate `config` prop (remove `void _config`), compute per-document diffs using `diffPuckDataWithPositions`, pass `config` and diffs to `DocumentResolutionDetail`, pass diff counts to `DocumentResolutionList` |
| 2 | `packages/puck-css/src/components/merge-resolution/DocumentResolutionDetail.tsx` | Major rewrite: accept `config`, diffs, and view mode props. Render `MergePreviewRenderer` for accept-draft/accept-live/unresolved strategies with appropriate visual emphasis. Render `CherryPickVisualPanel` for cherry-pick. Render visual `CrdtPreviewPanel` for crdt-preview. Include `ViewModeSelector` in detail header. |
| 3 | `packages/puck-css/src/components/merge-resolution/DocumentResolutionList.tsx` | Moderate: accept `documentDiffCounts` prop, display per-document diff summary badges (+N added, -N removed, ~N modified) below each document path |
| 4 | `packages/puck-css/src/components/merge-resolution/CrdtPreviewPanel.tsx` | Major rewrite: accept `config`, `sourceData`, `targetData`, branch names. Replace raw JSON with three-panel `<Render>` layout (Draft \| CRDT Result \| Live). Keep loading/error states. |
| 5 | `packages/puck-css/src/components/merge-resolution/MergeResolutionToolbar.tsx` | No functional changes. Remove `ViewModeSelector` from this component (it was never added; the previous plan proposed adding it here, but this plan places it in the detail panel instead). |
| 6 | `packages/puck-css/src/components/merge-resolution/ResolutionStrategyPicker.tsx` | No changes. |
| 7 | `packages/puck-css/src/components/merge-resolution/index.ts` | Add exports for `ComponentClickOverlay` and `CherryPickVisualPanel` |
| 8 | `packages/puck-css/src/index.ts` | Add re-exports for new components |
| 9 | `packages/puck-css/src/__tests__/MergeResolutionPage.test.tsx` | Update to verify config threading, diff computation, visual component rendering |
| 10 | `packages/puck-css/src/__tests__/DocumentResolutionDetail.test.tsx` | Update to verify `MergePreviewRenderer` usage per strategy, `ViewModeSelector` presence, visual cherry-pick and CRDT rendering |
| 11 | `packages/puck-css/src/__tests__/DocumentResolutionList.test.tsx` | Update to verify diff summary badges render |
| 12 | `packages/puck-css/src/__tests__/CrdtPreviewPanel.test.tsx` | Update to verify `<Render>` three-way comparison instead of raw JSON |

### Files NOT modified (explicitly preserved)

| File | Reason |
|------|--------|
| `packages/puck-css/src/hooks/useMergeResolution.ts` | Hook API unchanged; all state management logic preserved |
| `packages/puck-css/src/__tests__/useMergeResolution.test.ts` | Hook tests unchanged; 22 tests continue passing |
| `packages/puck-css/src/__tests__/useMergeResolution-execute.test.ts` | Execution tests unchanged; 7 tests continue passing |
| `packages/puck-css/src/__tests__/ResolutionStrategyPicker.test.tsx` | Strategy picker tests unchanged; 5 tests continue passing |
| `packages/puck-css/src/components/merge-preview/*` | Read-only comparison components preserved as-is; `MergePreviewRenderer` is reused directly via composition |
| `packages/puck-css/src/components/conflict-resolution/*` | Existing conflict resolution components preserved; `ComponentConflictGroup` reused within `CherryPickVisualPanel` |
| `packages/puck-css/src/utils/puckFieldClassifier.ts` | Utility unchanged |
| `packages/puck-css/src/utils/highlightConfig.ts` | Utility unchanged; `createHighlightedConfig` and `createDiffMap` used by `MergePreviewRenderer` |
| `packages/puck-css/src/utils/branchDiff.ts` | Utility unchanged; `diffPuckDataWithPositions` used for computing per-document diffs |
| `packages/puck-css/src/components/merge-resolution/MergeResolutionToolbar.tsx` | No changes needed |
| `packages/puck-css/src/__tests__/MergeResolutionToolbar.test.tsx` | Toolbar tests unchanged |
| All `packages/css-client/*` files | No changes to the API client layer |

---

## Detailed Component Specifications

### Phase 1: Component Click Overlay

#### 1.1 `ComponentClickOverlay` (`packages/puck-css/src/components/merge-resolution/ComponentClickOverlay.tsx`)

A transparent overlay that positions click targets over rendered Puck components. Used by `CherryPickVisualPanel` to enable component-level selection without modifying Puck configs.

```typescript
export interface ComponentClickOverlayProps {
  /** Ref to the container element wrapping the <Render> output */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Map of componentId -> selection state */
  selections: Record<string, 'source' | 'target' | 'none'>;
  /** Callback when a component region is clicked */
  onComponentClick: (componentId: string) => void;
  /** Whether click interaction is enabled */
  interactive: boolean;
  /** Label to show for the branch this overlay represents (e.g., "Draft" or "Live") */
  branchLabel: string;
}
```

**How it works:**
1. Uses `useEffect` + `ResizeObserver` to track the positions of elements with `data-component-id` attributes within the container
2. Renders absolutely-positioned `<div>` elements over each component region
3. Each overlay div has:
   - `onClick` handler calling `onComponentClick(componentId)` when `interactive` is true
   - Visual selection indicator: green check overlay for 'source', blue check for 'target', neutral hover for 'none'
   - `cursor: pointer` when interactive
   - `data-testid="component-overlay-{componentId}"` for test assertions

**Why this approach vs. config wrapping:**
- No config regeneration on selection changes (Puck `<Render>` output stays stable)
- Standard React event handling
- Selection indicators are pure CSS overlays, not part of the Puck component tree
- Works with any Puck config without modification

**Edge cases:**
- Components not in the DOM yet (loading): overlay renders nothing, updates on next ResizeObserver callback
- Container resizes: overlay repositions automatically
- Components exist in one branch but not the other: overlay only shows for components present in the rendered output

### Phase 2: Visual Resolution Components

#### 2.1 `CherryPickVisualPanel` (`packages/puck-css/src/components/merge-resolution/CherryPickVisualPanel.tsx`)

Two-column layout for cherry-pick with visual comparison and live merged preview.

```typescript
export interface CherryPickVisualPanelProps {
  /** Current document being resolved */
  document: DocumentResolution;
  /** Puck config for rendering */
  config: unknown;
  /** Component-level diffs for highlighting */
  diffs: ComponentDiffWithPosition[];
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
}
```

**Layout:**
```
+----------------------------------------------+----------------------------+
| Left Column (60%)                             | Right Column (40%)         |
|                                               |                            |
| ┌──────────────────────────────────────────┐  | ┌────────────────────────┐ |
| │ Side-by-side comparison                  │  | │ "Merged Preview"       │ |
| │ Draft (with ComponentClickOverlay)       │  | │                        │ |
| │   |   Live (with ComponentClickOverlay)  │  | │ <Render> of merged     │ |
| │ Click component to select branch version │  | │ snapshot               │ |
| └──────────────────────────────────────────┘  | │                        │ |
|                                               | │ Updates live as        │ |
| ┌──────────────────────────────────────────┐  | │ selections change      │ |
| │ Prop-level controls                      │  | │                        │ |
| │ ComponentConflictGroup per component     │  | │                        │ |
| │ with conflicting props                   │  | │                        │ |
| │ [Accept all from Draft] [Accept all      │  | │                        │ |
| │  from Live] per component                │  | │                        │ |
| │ Radio buttons per conflicting prop       │  | │                        │ |
| │ "X fields auto-merged"                   │  | │                        │ |
| └──────────────────────────────────────────┘  | └────────────────────────┘ |
+----------------------------------------------+----------------------------+
```

**Left column (selection controls):**
- Top section: Two rendered Puck pages in side-by-side view using `MergePreviewRenderer` (with diff highlighting). Each side has a `ComponentClickOverlay` on top. Clicking a component in the Draft panel calls `onAcceptAllComponentProps(documentId, componentId, 'source')`. Clicking in the Live panel calls `onAcceptAllComponentProps(documentId, componentId, 'target')`.
- Below: `ComponentConflictGroup` instances for each component with conflicts, showing prop-level radio buttons (reusing existing component). Per-component "Accept all from Draft" / "Accept all from Live" buttons. Auto-merged field count.

**Right column (merged preview):**
- Rendered via `<Render>` using the current `mergedSnapshot` from the document
- Updates live as the user makes cherry-pick selections (the hook already recomputes `mergedSnapshot` on every selection change)
- Shows a "Merged preview" header
- If `mergedSnapshot` is null (no selections made yet), shows a message: "Make selections to see the merged preview"

**Component-to-hook mapping:**
- Clicking a component in Draft panel → `onAcceptAllComponentProps(documentId, componentId, 'source')` which sets all conflicting props of that component to 'source'
- Clicking a component in Live panel → `onAcceptAllComponentProps(documentId, componentId, 'target')`
- The `ComponentClickOverlay` determines the componentId from the `data-component-id` attribute on the DOM element

### Phase 3: Rewrite Existing Components

#### 3.1 `MergeResolutionPage` (rewrite)

The page becomes the single entry point for the entire merge review + resolution flow.

**Key changes from current:**
1. `config` is destructured and actively passed to `DocumentResolutionDetail` (remove `void _config`)
2. Per-document diffs are computed using `diffPuckDataWithPositions(sourceSnapshot, targetSnapshot)` and memoized. These are passed to the detail panel for `MergePreviewRenderer` and to the list for diff count badges.
3. Diff counts (added/removed/modified) are derived from the diffs and passed to `DocumentResolutionList` as a `Map<string, { added: number; removed: number; modified: number }>`

**Layout (unchanged structure, new props threading):**
```
+--------------------------------------------------------------+
| MergeResolutionToolbar                                        |
| [Back] [Draft -> Live] [3/12 resolved] [======] [Execute]    |
+------------------+-------------------------------------------+
| DocumentList     | DocumentResolutionDetail                   |
| (320px fixed)    | (flex-grow)                                |
|                  |                                            |
| /home    [Draft] | [ViewModeSelector] [Strategy Picker]       |
| +2 ~1           | [MergePreviewRenderer / CherryPickVisual   |
| /about   [?]     |  Panel / CrdtPreviewPanel]                 |
| +0 ~3           |                                            |
+------------------+-------------------------------------------+
```

**New props passed to children:**
- `DocumentResolutionDetail`: `config`, `diffs` (for current document), `sourceBranchName`, `targetBranchName`
- `DocumentResolutionList`: `diffCounts` (Map of documentId -> {added, removed, modified})

#### 3.2 `DocumentResolutionDetail` (major rewrite)

The core rendering changes. Currently renders text-based strategy views. The rewrite replaces each with visual rendering.

**New props:**
```typescript
config: unknown; // Puck config for <Render>
diffs: ComponentDiffWithPosition[]; // Pre-computed diffs for this document
```

**View mode:** Managed internally via `useState<ViewMode>('side-by-side')`. A `ViewModeSelector` is rendered in the detail header, next to the strategy picker.

**Strategy-specific rendering:**

- **`accept-draft`**: `MergePreviewRenderer` showing Draft and Live with diff highlighting. The Draft side has a green "selected" border/emphasis. The Live side is dimmed (opacity 0.6). A banner reads "Draft version will be kept."
- **`accept-live`**: Same as accept-draft but reversed: Live side emphasized, Draft side dimmed. Banner: "Live version will be kept."
- **`cherry-pick`**: `CherryPickVisualPanel` with visual component picker + prop-level controls + live merged preview
- **`crdt-preview`**: Visual `CrdtPreviewPanel` showing three-way rendered comparison (Draft | CRDT Result | Live)
- **`unresolved`**: `MergePreviewRenderer` with standard diff highlighting, no selection emphasis. A prompt: "Select a resolution strategy above."
- **Delete conflicts**: Single-panel view showing the surviving version rendered via `<Render>`, with a styled overlay message explaining the deletion

**Edge cases:**
- `sourceSnapshot` is null (deleted in source): show only Live panel with "Deleted in Draft" overlay
- `targetSnapshot` is null (new in source): show only Draft panel with "New document" overlay
- Both null: show "No content available" message

#### 3.3 `DocumentResolutionList` (moderate update)

Add per-document diff summary badges to give context at a glance.

**New prop:**
```typescript
diffCounts?: Map<string, { added: number; removed: number; modified: number }>;
```

Each list item now shows below the document path:
```
/pages/home                    [Draft]
+2 added  ~1 modified
```

The diff counts are computed by `MergeResolutionPage` and passed down. No changes to keyboard navigation logic -- all existing handlers preserved.

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
- Loading: spinner/pulse animation with "Loading CRDT merge preview..." text
- Error: styled error message (preserved from current)
- Success with `sourceData` and `targetData`: three-panel layout:
  ```
  +------------------+------------------+------------------+
  | Draft            | CRDT Result      | Live             |
  | <Render>         | <Render>         | <Render>         |
  | (sourceData)     | (snapshot)       | (targetData)     |
  +------------------+------------------+------------------+
  ```
  Each panel rendered via `<Render>` with the same config. The CRDT Result panel has a purple "Auto-merged" header.
- Success without source/target (standalone): single `<Render>` panel showing the CRDT result

### Phase 4: Integration, Exports, and Test Updates

#### 4.1 Export new components

Update `packages/puck-css/src/components/merge-resolution/index.ts` to export:
- `ComponentClickOverlay` and `ComponentClickOverlayProps`
- `CherryPickVisualPanel` and `CherryPickVisualPanelProps`

Update `packages/puck-css/src/index.ts` to re-export from the barrel.

#### 4.2 Update existing tests

Component tests need updates to match the new DOM structure:

- `MergeResolutionPage.test.tsx`: Verify config is passed through to detail, diffs are computed and passed, visual components rendered in place of text
- `DocumentResolutionDetail.test.tsx`: Verify mock `MergePreviewRenderer` receives correct data for each strategy, `ViewModeSelector` renders, cherry-pick visual panel renders, CRDT visual preview renders
- `DocumentResolutionList.test.tsx`: Verify diff summary badges render when `diffCounts` is provided, existing keyboard navigation unchanged
- `CrdtPreviewPanel.test.tsx`: Verify `<Render>` is used instead of raw JSON, three-way comparison renders when source/target provided

#### 4.3 New test files

- `ComponentClickOverlay.test.tsx` (~6 tests): Overlay renders click targets for components with `data-component-id`, click events fire correct callbacks, selection indicators display, non-interactive mode disables clicks, handles empty container, updates on resize
- `CherryPickVisualPanel.test.tsx` (~8 tests): Two-column layout renders, MergePreviewRenderer renders in left column, merged preview renders in right column with correct data, component click overlay fires acceptAllComponentProps, ComponentConflictGroup instances render for conflicting components, accept-all buttons work, empty merged snapshot shows prompt message, auto-merged count displays

---

## Implementation Order

The implementation proceeds in dependency order:

1. **`ComponentClickOverlay.tsx`** + tests -- new component, no dependencies on modified files
2. **`CherryPickVisualPanel.tsx`** + tests -- new component, depends on `ComponentClickOverlay`, `MergePreviewRenderer`, and existing `ComponentConflictGroup`
3. **`CrdtPreviewPanel.tsx`** -- rewrite to use `<Render>`, update existing tests
4. **`DocumentResolutionDetail.tsx`** -- rewrite to compose `MergePreviewRenderer`, `CherryPickVisualPanel`, visual `CrdtPreviewPanel`, and `ViewModeSelector`. Update existing tests
5. **`DocumentResolutionList.tsx`** -- add diff summary badges, update existing tests
6. **`MergeResolutionPage.tsx`** -- rewrite to thread config, compute diffs, pass new props. Update existing tests
7. **`index.ts` exports** -- barrel and package exports

---

## Testing Strategy

**Level:** Medium (as approved by user)

**Mock strategy:** `@puckeditor/core`'s `Render` component is mocked in the test environment. The mock exposes its `data` and `config` props for assertion. `MergePreviewRenderer` is mocked at the module level in tests for components that compose it (e.g., `DocumentResolutionDetail`, `CherryPickVisualPanel`), verifying it receives the correct props without needing to render actual Puck content. For `ComponentClickOverlay`, the container ref is mocked with elements that have `data-component-id` attributes.

**Test file plan:**

| Test file | Tests | Coverage |
|---|---|---|
| `useMergeResolution.test.ts` | ~22 (unchanged) | Hook state machine |
| `useMergeResolution-execute.test.ts` | ~7 (unchanged) | Merge execution |
| `ResolutionStrategyPicker.test.tsx` | ~5 (unchanged) | Strategy button behavior |
| `MergeResolutionToolbar.test.tsx` | ~9 (unchanged) | Toolbar, progress, bulk actions, shortcuts |
| `MergeResolutionPage.test.tsx` | ~8 (updated) | Config threading, diff computation, visual component rendering |
| `DocumentResolutionList.test.tsx` | ~14 (updated) | List with diff summary badges, existing keyboard navigation |
| `DocumentResolutionDetail.test.tsx` | ~10 (updated) | Visual rendering per strategy, ViewModeSelector, config threading |
| `CrdtPreviewPanel.test.tsx` | ~5 (updated) | Visual `<Render>` three-way comparison, loading/error states |
| `ComponentClickOverlay.test.tsx` | ~6 (new) | Click targets, callbacks, selection indicators, resize handling |
| `CherryPickVisualPanel.test.tsx` | ~8 (new) | Two-column layout, merged preview, component/prop selection |

**Estimated total: ~94 tests** (43 unchanged + ~37 updated + ~14 new)

---

## Non-Goals (explicitly out of scope)

- **Modifying the `useMergeResolution` hook** -- the hook API is stable and well-tested; only the rendering layer changes
- **Modifying `packages/css-client`** -- no API client changes needed
- **Creating a new `createClickableConfig` utility** -- component interactivity is handled via DOM overlays, not config wrapping
- **Creating a `VisualResolutionCompare` component** -- `MergePreviewRenderer` is reused directly via composition
- **Modifying existing read-only comparison components** (`MergePreviewRenderer`, `VisualBranchCompare`, `ViewModeSelector`) -- reused as-is, not modified
- **Modifying existing conflict-resolution components** (`ComponentConflictGroup`, `PuckFieldResolutionPanel`) -- reused as-is within `CherryPickVisualPanel`
- **Adding `ViewModeSelector` to the toolbar** -- view mode is a per-document detail concern, not a toolbar concern
- **Adding E2E/Playwright tests** -- the UX is a placeholder that may move; medium fidelity with mock-based component tests is appropriate
- **Modifying the downstream app** (`my-app/app/merge/page.tsx`) -- the library changes are self-contained; downstream updates are a separate task
- **Real Puck rendering in tests** -- `<Render>` is mocked in jsdom; visual correctness is verified through structured assertions on mock props
