# Visual Merge Conflict Resolution - Test Plan

## Harness Requirements

### H1: Puck Render Mock (exists, needs minor extension)

**What it does:** Mocks `@puckeditor/core`'s `Render` component in the jsdom test environment, capturing the `data` and `config` props passed to it for assertion.

**What it exposes:**
- `data-testid="puck-render"` on the mock element for DOM querying
- Rendered content derived from `data.content` items so structural assertions can verify which PuckData snapshot was passed
- The `config` prop is captured so tests can verify highlighted configs vs plain configs are used appropriately

**Estimated complexity:** Low (~15 minutes). The mock pattern already exists in `MergePreviewRenderer.spec.tsx`. It needs to be standardized as a reusable mock across the new test files.

**Which tests depend on it:** All scenario, integration, and component tests that render visual comparison components (tests 1-8, 11-16, 19-24, 28-36).

### H2: DocumentResolution Factory (exists)

**What it does:** Creates `DocumentResolution` objects with sensible defaults and selective overrides, matching the `createDocument()` helper already established in `DocumentResolutionDetail.test.tsx`.

**What it exposes:** `createDocument(overrides?: Partial<DocumentResolution>): DocumentResolution`

**Estimated complexity:** Zero -- already exists. Needs to be extracted to a shared test utility file for reuse across multiple test files.

**Which tests depend on it:** All tests that construct `DocumentResolution` objects (tests 1-36).

### H3: Hook Mock Harness (exists)

**What it does:** Mocks `useMergeResolution` at the module level, returning a configurable object with all hook fields and callbacks. Already established in `MergeResolutionPage.test.tsx`.

**What it exposes:** `defaultHookReturn` object with all fields, `hookReturnOverrides` for per-test customization.

**Estimated complexity:** Zero -- already exists. May need minor extensions for new fields (e.g., if the page computes diffs).

**Which tests depend on it:** Page-level scenario and integration tests (tests 1-3, 11-14).

---

## Test Plan

### Scenario Tests

#### 1. User resolves a document with accept-draft and sees the Draft version visually emphasized

- **Name:** Selecting accept-draft strategy shows Draft panel highlighted and Live panel dimmed in the visual comparison
- **Type:** scenario
- **Harness:** H1 (Puck Render mock), H2 (DocumentResolution factory), H3 (Hook mock)
- **Preconditions:** `MergeResolutionPage` rendered with one document having both `sourceSnapshot` and `targetSnapshot` populated. Strategy is `unresolved`.
- **Actions:**
  1. Render `MergeResolutionPage` with hook returning a document with `strategy: 'accept-draft'`, both snapshots non-null, and a `config` object.
  2. Query the DOM for the detail panel area.
- **Expected outcome:**
  - `MergePreviewRenderer` is rendered (asserted via its `.merge-preview-renderer__panel` class elements or mock presence).
  - The page passes `config` through to the detail panel (not `void`ed).
  - A `ViewModeSelector` is present in the detail panel.
  - A banner reading "Draft version will be kept." is rendered.
  - The `StrategyEmphasisWrapper` applies a semi-transparent overlay (pointer-events: none) on the Live panel side.
  - **Source of truth:** PLAN.md Phase 3, Section 3.2 (accept-draft rendering specification).
- **Interactions:** `MergeResolutionPage` -> `DocumentResolutionDetail` -> `MergePreviewRenderer`, `StrategyEmphasisWrapper`

#### 2. User navigates through documents with keyboard and resolves each with different strategies

- **Name:** Keyboard navigation (J/K) cycles documents; number keys (1-4) set strategies; visual detail updates per strategy
- **Type:** scenario
- **Harness:** H2, H3
- **Preconditions:** `MergeResolutionPage` with 3 documents, all `unresolved`, all with both snapshots.
- **Actions:**
  1. Render the page.
  2. Press `j` to advance to document 2.
  3. Press `1` to set accept-draft.
  4. Press `j` to advance to document 3.
  5. Press `2` to set accept-live.
  6. Press `k` to go back to document 2.
- **Expected outcome:**
  - `goToNext` called twice, `goToPrevious` called once.
  - `setStrategy` called with `('doc-2', 'accept-draft')` then `('doc-3', 'accept-live')`.
  - After pressing `k`, the detail panel shows document 2's content.
  - **Source of truth:** PLAN.md Section 3.2 (keyboard navigation), existing `DocumentResolutionList.test.tsx` pattern.
- **Interactions:** `DocumentResolutionList` keyboard handler -> hook callbacks

#### 3. User cherry-picks at component level by clicking rendered components, then refines at prop level

- **Name:** Cherry-pick flow: component click selects all props from that branch, then individual prop radio buttons refine selections
- **Type:** scenario
- **Harness:** H1, H2
- **Preconditions:** `CherryPickVisualPanel` rendered with a document having `classifiedFields` with two conflicting props on component `h1` (type `Heading`), both `sourceSnapshot` and `targetSnapshot` populated, `diffs` containing a `modified` entry for `h1`.
- **Actions:**
  1. Render `CherryPickVisualPanel` with the test data.
  2. Find the Draft panel's `ComponentClickOverlay` target for `h1` (via `data-testid="component-overlay-h1"`).
  3. Click the overlay target.
  4. Verify `onAcceptAllComponentProps` was called with `(documentId, 'h1', 'source')`.
  5. Find the Live panel's overlay target for `h1`.
  6. Click it.
  7. Verify `onAcceptAllComponentProps` was called with `(documentId, 'h1', 'target')`.
- **Expected outcome:**
  - Two separate `<Render>` instances in the left column (Draft and Live), NOT a single `MergePreviewRenderer`.
  - Each panel has its own `ComponentClickOverlay`.
  - Clicking Draft panel's overlay calls `onAcceptAllComponentProps(documentId, componentId, 'source')`.
  - Clicking Live panel's overlay calls `onAcceptAllComponentProps(documentId, componentId, 'target')`.
  - The right column shows a "Merged Preview" rendered via `<Render>`.
  - **Source of truth:** PLAN.md Decision 3, Decision 6, Phase 2 Section 2.1.
- **Interactions:** `CherryPickVisualPanel` -> `ComponentClickOverlay` -> `onAcceptAllComponentProps` callback

#### 4. User previews CRDT merge result visually with three-way comparison

- **Name:** CRDT preview shows three rendered panels (Draft, CRDT Result, Live) via Puck Render
- **Type:** scenario
- **Harness:** H1, H2
- **Preconditions:** `DocumentResolutionDetail` rendered with a document having `strategy: 'crdt-preview'`, `crdtPreviewSnapshot` populated, `sourceSnapshot` and `targetSnapshot` both populated, and `config` prop provided.
- **Actions:**
  1. Render `DocumentResolutionDetail` with the test data including `config`.
  2. Query for three `Render` instances.
- **Expected outcome:**
  - `CrdtPreviewPanel` renders three `<Render>` instances (Draft, CRDT Result, Live) when `sourceData`, `targetData`, and `snapshot` are all provided.
  - The CRDT Result panel has a "CRDT Result" or "Auto-merged" label.
  - `ViewModeSelector` is NOT shown (CRDT preview uses fixed three-panel layout).
  - **Source of truth:** PLAN.md Phase 3, Section 3.4, Decision 7.
- **Interactions:** `DocumentResolutionDetail` -> `CrdtPreviewPanel` -> `<Render>`

#### 5. User resolves all documents and executes merge with confirmation

- **Name:** Full resolution flow: resolve all documents, confirmation dialog appears, confirm executes merge
- **Type:** scenario
- **Harness:** H3
- **Preconditions:** `MergeResolutionPage` with `allResolved: true`.
- **Actions:**
  1. Render the page with `allResolved: true`.
  2. Click the "Execute merge" button.
  3. Verify inline confirmation appears ("Are you sure?" / "Confirm merge" / "Cancel").
  4. Click "Confirm merge".
- **Expected outcome:**
  - `onExecuteMerge` callback is called after confirmation (not before).
  - The Execute merge button is enabled when `allResolved` is true.
  - **Source of truth:** PLAN.md Section 3.6 (toolbar spec), existing `MergeResolutionToolbar.test.tsx`.
- **Interactions:** `MergeResolutionToolbar` -> `executeMerge`

#### 6. User switches view modes while resolving accept-live document

- **Name:** View mode selector toggles between side-by-side, overlay, and slider for accept-live strategy
- **Type:** scenario
- **Harness:** H1, H2
- **Preconditions:** `DocumentResolutionDetail` rendered with `strategy: 'accept-live'`, both snapshots, config, and diffs.
- **Actions:**
  1. Render with `accept-live` strategy.
  2. Verify `ViewModeSelector` is present.
  3. Click "Overlay" button.
  4. Verify the `MergePreviewRenderer` receives `viewMode="overlay"`.
  5. Click "Slider" button.
  6. Verify `viewMode="slider"`.
- **Expected outcome:**
  - `ViewModeSelector` is rendered for `accept-live` strategy.
  - Clicking view mode buttons updates the `viewMode` passed to `MergePreviewRenderer`.
  - A banner reads "Live version will be kept." with the Live panel highlighted and Draft dimmed.
  - **Source of truth:** PLAN.md Decision 5, Phase 3 Section 3.2.
- **Interactions:** `DocumentResolutionDetail` internal state -> `ViewModeSelector` -> `MergePreviewRenderer`

### Integration Tests

#### 7. MergeResolutionPage threads config to DocumentResolutionDetail

- **Name:** Config prop flows from page to detail panel for Puck Render usage
- **Type:** integration
- **Harness:** H1, H3
- **Preconditions:** `MergeResolutionPage` rendered with a non-empty `config` object.
- **Actions:**
  1. Render `MergeResolutionPage` with `config: { components: { Text: {} } }`.
  2. Inspect the detail panel's rendered output.
- **Expected outcome:**
  - `config` is destructured and passed to `DocumentResolutionDetail` (not `void`ed).
  - The detail panel's visual components receive the config for `<Render>`.
  - **Source of truth:** PLAN.md Decision 2, Phase 3 Section 3.1.
- **Interactions:** `MergeResolutionPage` -> `DocumentResolutionDetail` prop threading

#### 8. MergeResolutionPage computes per-document diffs and passes to children

- **Name:** Diffs computed from sourceSnapshot/targetSnapshot via diffPuckDataWithPositions and passed to detail panel and list
- **Type:** integration
- **Harness:** H1, H2, H3
- **Preconditions:** Hook returns documents with `sourceSnapshot` and `targetSnapshot` containing differing content.
- **Actions:**
  1. Render `MergeResolutionPage`.
  2. Inspect what `DocumentResolutionDetail` receives as `diffs` prop.
  3. Inspect what `DocumentResolutionList` receives as `diffCounts` prop.
- **Expected outcome:**
  - The page calls `diffPuckDataWithPositions(sourceSnapshot, targetSnapshot)` for each document.
  - Diff counts (added/removed/modified) are derived and passed to `DocumentResolutionList`.
  - The full `ComponentDiffWithPosition[]` array is passed to `DocumentResolutionDetail`.
  - **Source of truth:** PLAN.md Phase 3 Section 3.1.
- **Interactions:** `MergeResolutionPage` -> `diffPuckDataWithPositions` -> `DocumentResolutionDetail`, `DocumentResolutionList`

#### 9. DocumentResolutionList shows diff summary badges per document

- **Name:** Each document in the list shows diff count badges (+N added, -N removed, ~N modified)
- **Type:** integration
- **Harness:** H2
- **Preconditions:** `DocumentResolutionList` rendered with `diffCounts` map containing counts for each document.
- **Actions:**
  1. Render `DocumentResolutionList` with `diffCounts` map: `{ 'doc-1': { added: 2, removed: 0, modified: 1 } }`.
  2. Query for badge text content.
- **Expected outcome:**
  - Below the document path `/home`, badges showing "+2 added" and "~1 modified" are rendered.
  - Documents with zero counts for a category do not show that badge.
  - **Source of truth:** PLAN.md Phase 3 Section 3.3.
- **Interactions:** `DocumentResolutionList` rendering

#### 10. CherryPickVisualPanel derives per-component selection state from cherryPickSelections

- **Name:** Component overlay indicators reflect aggregated selection state (all-source=green, all-target=blue, mixed=neutral)
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** `CherryPickVisualPanel` rendered with a document having two conflicting props on component `h1`, `cherryPickSelections: { 'h1:text': 'source', 'h1:color': 'source' }`.
- **Actions:**
  1. Render `CherryPickVisualPanel`.
  2. Query for the overlay selection indicator on `h1`.
- **Expected outcome:**
  - When all props for a component are `'source'`, the overlay shows a "source selected" indicator.
  - When all props are `'target'`, it shows "target selected".
  - When mixed or any unresolved, it shows `'none'` (neutral).
  - **Source of truth:** PLAN.md Phase 2 Section 2.1 ("Deriving per-component selection state").
- **Interactions:** `CherryPickVisualPanel` -> `ComponentClickOverlay` selections prop

#### 11. DocumentResolutionDetail renders MergePreviewRenderer for unresolved strategy

- **Name:** Unresolved strategy shows MergePreviewRenderer with standard diff highlighting and no emphasis overlay
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** `DocumentResolutionDetail` rendered with `strategy: 'unresolved'`, both snapshots, config, diffs.
- **Actions:**
  1. Render the component.
  2. Query for `MergePreviewRenderer` presence and `StrategyEmphasisWrapper` absence.
- **Expected outcome:**
  - `MergePreviewRenderer` is rendered with correct `sourceData`, `targetData`, `diffs`, and `config`.
  - No dimming overlay or emphasis wrapper is applied.
  - `ViewModeSelector` is present.
  - A prompt reads "Select a resolution strategy above."
  - **Source of truth:** PLAN.md Phase 3 Section 3.2 (unresolved rendering).
- **Interactions:** `DocumentResolutionDetail` -> `MergePreviewRenderer`

#### 12. DocumentResolutionDetail hides ViewModeSelector for cherry-pick and crdt-preview strategies

- **Name:** ViewModeSelector only shown for accept-draft, accept-live, and unresolved strategies
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** `DocumentResolutionDetail` rendered with different strategies.
- **Actions:**
  1. Render with `strategy: 'cherry-pick'`, query for `ViewModeSelector`.
  2. Render with `strategy: 'crdt-preview'`, query for `ViewModeSelector`.
  3. Render with `strategy: 'accept-draft'`, query for `ViewModeSelector`.
- **Expected outcome:**
  - `ViewModeSelector` is NOT rendered for `cherry-pick` (fixed side-by-side + merged preview layout).
  - `ViewModeSelector` is NOT rendered for `crdt-preview` (fixed three-panel layout).
  - `ViewModeSelector` IS rendered for `accept-draft`, `accept-live`, and `unresolved`.
  - **Source of truth:** PLAN.md Phase 3 Section 3.2 (ViewModeSelector visibility rules).
- **Interactions:** `DocumentResolutionDetail` conditional rendering

### Boundary and Edge-Case Tests

#### 13. DocumentResolutionDetail handles null sourceSnapshot (deleted in source)

- **Name:** When sourceSnapshot is null, a single-panel Render of targetSnapshot is shown with "Deleted in Draft" overlay
- **Type:** boundary
- **Harness:** H1, H2
- **Preconditions:** `DocumentResolutionDetail` rendered with `sourceSnapshot: null`, `targetSnapshot` populated, `conflictType: 'deleted-in-source'`.
- **Actions:** Render the component with `strategy: 'accept-live'`.
- **Expected outcome:**
  - `MergePreviewRenderer` is NOT used (it requires non-null source and target).
  - A single `<Render>` panel shows the Live (target) version.
  - `ViewModeSelector` is hidden.
  - A "Deleted in Draft" overlay message is shown.
  - **Source of truth:** PLAN.md Phase 3 Section 3.2 (null-safety, edge cases).
- **Interactions:** `DocumentResolutionDetail` null guard path

#### 14. DocumentResolutionDetail handles null targetSnapshot (new in source)

- **Name:** When targetSnapshot is null, a single-panel Render of sourceSnapshot is shown with "New document" overlay
- **Type:** boundary
- **Harness:** H1, H2
- **Preconditions:** `DocumentResolutionDetail` rendered with `targetSnapshot: null`, `sourceSnapshot` populated, `conflictType: 'deleted-in-target'`.
- **Actions:** Render the component.
- **Expected outcome:**
  - Single `<Render>` panel showing the Draft (source) version.
  - `MergePreviewRenderer` is NOT used.
  - A "New document" overlay message is shown.
  - **Source of truth:** PLAN.md Phase 3 Section 3.2 (edge cases).
- **Interactions:** `DocumentResolutionDetail` null guard path

#### 15. DocumentResolutionDetail handles both snapshots null

- **Name:** When both snapshots are null, a "No content available" message is shown
- **Type:** boundary
- **Harness:** H2
- **Preconditions:** `DocumentResolutionDetail` rendered with both snapshots null.
- **Actions:** Render the component.
- **Expected outcome:**
  - A "No content available" message is rendered.
  - No `<Render>` instances.
  - **Source of truth:** PLAN.md Phase 3 Section 3.2 (edge cases).
- **Interactions:** None

#### 16. CherryPickVisualPanel shows prompt when mergedSnapshot is null

- **Name:** Before any selections are made, the merged preview column shows a prompt message
- **Type:** boundary
- **Harness:** H1, H2
- **Preconditions:** `CherryPickVisualPanel` rendered with `document.mergedSnapshot: null`.
- **Actions:** Render the component.
- **Expected outcome:**
  - The right column shows "Make selections to see the merged preview" instead of a `<Render>` instance.
  - The left column still shows the two comparison panels.
  - **Source of truth:** PLAN.md Phase 2 Section 2.1 (right column spec).
- **Interactions:** `CherryPickVisualPanel` conditional rendering

#### 17. CrdtPreviewPanel renders standalone single panel when source/target not provided

- **Name:** CrdtPreviewPanel without sourceData/targetData renders single Render panel
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** `CrdtPreviewPanel` rendered with `snapshot` populated but no `sourceData` or `targetData`.
- **Actions:** Render the component.
- **Expected outcome:**
  - A single `<Render>` panel showing the CRDT result.
  - No three-panel layout.
  - **Source of truth:** PLAN.md Phase 3 Section 3.4 (standalone rendering).
- **Interactions:** `CrdtPreviewPanel` rendering

#### 18. ComponentClickOverlay handles empty container (no data-component-id elements)

- **Name:** Overlay renders nothing when container has no components with data-component-id
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** `ComponentClickOverlay` rendered with a `containerRef` pointing to a div with no `data-component-id` children.
- **Actions:** Render the component.
- **Expected outcome:**
  - No overlay click targets are rendered.
  - No errors thrown.
  - **Source of truth:** PLAN.md Phase 1 Section 1.1 (edge cases).
- **Interactions:** `ComponentClickOverlay` DOM query

### Phase 0: Inline Style Conversion Tests

#### 19. MergePreviewRenderer renders with inline styles in side-by-side mode

- **Name:** MergePreviewRenderer side-by-side panels have inline flexbox styles applied
- **Type:** integration
- **Harness:** H1
- **Preconditions:** `MergePreviewRenderer` rendered with `viewMode="side-by-side"`.
- **Actions:**
  1. Render the component.
  2. Query for side-by-side container element.
- **Expected outcome:**
  - The side-by-side container has `display: flex` and `gap: '16px'` inline styles.
  - Each panel has `flex: '1 1 50%'` and `border` inline styles.
  - Panel labels have `fontWeight: 600` and background inline styles.
  - BEM class names are still present for DOM querying compatibility.
  - **Source of truth:** PLAN.md Phase 0 Section 0.1.
- **Interactions:** `MergePreviewRenderer` rendering

#### 20. MergePreviewRenderer renders with inline styles in overlay mode

- **Name:** MergePreviewRenderer overlay mode has position: relative/absolute inline styles
- **Type:** integration
- **Harness:** H1
- **Preconditions:** `MergePreviewRenderer` rendered with `viewMode="overlay"`.
- **Actions:** Render and query overlay container.
- **Expected outcome:**
  - Overlay container has `position: 'relative'` inline style.
  - Target layer has `position: 'absolute', top: 0, left: 0, width: '100%'`.
  - BEM class `merge-preview-renderer--overlay` is present.
  - **Source of truth:** PLAN.md Phase 0 Section 0.1.
- **Interactions:** `MergePreviewRenderer` rendering

#### 21. ViewModeSelector renders with inline styles for active/inactive states

- **Name:** ViewModeSelector buttons have inline styles distinguishing active from inactive state
- **Type:** integration
- **Harness:** None (direct component render)
- **Preconditions:** `ViewModeSelector` rendered with `viewMode="side-by-side"`.
- **Actions:**
  1. Render the component.
  2. Query the active button and an inactive button.
- **Expected outcome:**
  - Active button has `background: '#2563eb'` and `color: '#fff'` inline styles.
  - Inactive buttons have `background: '#fff'` and `color: '#374151'` inline styles.
  - Container has `display: 'flex'` and `gap: '4px'` inline styles.
  - BEM class names retained for test assertions.
  - **Source of truth:** PLAN.md Phase 0 Section 0.2.
- **Interactions:** `ViewModeSelector` rendering

#### 22. createHighlightedConfig applies inline styles to highlight wrappers

- **Name:** Highlight wrappers have colored borders and badges with inline styles
- **Type:** unit
- **Harness:** None (pure function)
- **Preconditions:** A diffMap with `added`, `removed`, and `modified` entries.
- **Actions:**
  1. Call `createHighlightedConfig(config, diffMap, 'after')`.
  2. Render a component through the highlighted config.
  3. Inspect the wrapper div styles.
- **Expected outcome:**
  - `added` wrappers have `border: '2px solid #22c55e'` inline style.
  - `removed` wrappers have `border: '2px solid #ef4444'` and `opacity: 0.6`.
  - `modified` wrappers have `border: '2px solid #eab308'`.
  - Diff badges have `position: 'absolute'` and background colors matching diff type.
  - `data-component-id` and `data-diff-type` attributes preserved.
  - **Source of truth:** PLAN.md Phase 0 Section 0.3.
- **Interactions:** `createHighlightedConfig` utility

#### 23. ComponentConflictGroup renders with inline styles

- **Name:** ComponentConflictGroup elements have inline layout styles
- **Type:** unit
- **Harness:** None (direct component render)
- **Preconditions:** `ComponentConflictGroup` rendered with conflicting fields.
- **Actions:** Render and inspect DOM elements.
- **Expected outcome:**
  - Container has `marginBottom: '16px'`.
  - Header has `display: 'flex'`, `alignItems: 'center'`.
  - Field rows have `padding`, `border`, and `borderRadius` inline styles.
  - Radio button labels have `cursor: 'pointer'`.
  - BEM class names retained.
  - **Source of truth:** PLAN.md Phase 0 Section 0.4.
- **Interactions:** `ComponentConflictGroup` rendering

### Phase 1: ComponentClickOverlay Tests

#### 24. ComponentClickOverlay renders click targets for components with data-component-id

- **Name:** Overlay positions click target divs over each component with a data-component-id attribute
- **Type:** unit
- **Harness:** H1
- **Preconditions:** A container div with child elements having `data-component-id="h1"` and `data-component-id="t1"` attributes.
- **Actions:**
  1. Render `ComponentClickOverlay` with `containerRef` pointing to the container, `interactive: true`.
  2. Query for elements with `data-testid="component-overlay-h1"` and `data-testid="component-overlay-t1"`.
- **Expected outcome:**
  - Two overlay divs are rendered, one per component.
  - Each has `cursor: pointer` style when interactive.
  - Each has the correct `data-testid` attribute.
  - **Source of truth:** PLAN.md Phase 1 Section 1.1.
- **Interactions:** `ComponentClickOverlay` DOM positioning

#### 25. ComponentClickOverlay fires onComponentClick with correct componentId

- **Name:** Clicking an overlay target calls onComponentClick with the component's ID
- **Type:** unit
- **Harness:** H1
- **Preconditions:** `ComponentClickOverlay` rendered with interactive mode and `onComponentClick` callback.
- **Actions:**
  1. Click the overlay for component `h1`.
- **Expected outcome:**
  - `onComponentClick` called with `'h1'`.
  - **Source of truth:** PLAN.md Phase 1 Section 1.1.
- **Interactions:** `ComponentClickOverlay` click handler

#### 26. ComponentClickOverlay shows selection indicators based on selections prop

- **Name:** Overlay targets display visual indicators for source-selected, target-selected, and none states
- **Type:** unit
- **Harness:** H1
- **Preconditions:** `ComponentClickOverlay` rendered with `selections: { h1: 'source', t1: 'target', p1: 'none' }`.
- **Actions:** Render and query overlay indicators.
- **Expected outcome:**
  - The `h1` overlay has a "source selected" visual indicator (e.g., green check or border).
  - The `t1` overlay has a "target selected" indicator (e.g., blue check).
  - The `p1` overlay has a neutral/hover indicator.
  - **Source of truth:** PLAN.md Phase 1 Section 1.1 (selection indicators).
- **Interactions:** `ComponentClickOverlay` rendering

#### 27. ComponentClickOverlay does not fire clicks when interactive is false

- **Name:** Non-interactive overlay prevents click handlers from firing
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** `ComponentClickOverlay` rendered with `interactive: false`.
- **Actions:** Click an overlay target.
- **Expected outcome:**
  - `onComponentClick` is NOT called.
  - Overlay targets do not have `cursor: pointer` style.
  - **Source of truth:** PLAN.md Phase 1 Section 1.1.
- **Interactions:** `ComponentClickOverlay` click guard

### Phase 2: CherryPickVisualPanel Tests

#### 28. CherryPickVisualPanel renders two-column layout with correct structure

- **Name:** Cherry-pick panel has left column (60%) with comparison and right column (40%) with merged preview
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** `CherryPickVisualPanel` rendered with all required props.
- **Actions:** Render and query layout structure.
- **Expected outcome:**
  - Two-column flexbox layout is present.
  - Left column contains two `<Render>` instances (Draft and Live) with `ComponentClickOverlay` on each.
  - Right column contains "Merged Preview" header and a `<Render>` instance with `mergedSnapshot` data.
  - `MergePreviewRenderer` is NOT used in the left column (verified by absence of `.merge-preview-renderer__panel`).
  - **Source of truth:** PLAN.md Decision 3, Phase 2 Section 2.1.
- **Interactions:** `CherryPickVisualPanel` structure

#### 29. CherryPickVisualPanel uses createHighlightedConfig for Draft and Live panels

- **Name:** Draft panel uses highlighted config with 'after' side, Live panel uses 'before' side
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** `CherryPickVisualPanel` rendered with diffs containing a `modified` component.
- **Actions:** Render and inspect what configs are passed to the two `<Render>` instances.
- **Expected outcome:**
  - Draft panel's `<Render>` receives a config processed by `createHighlightedConfig(config, diffMap, 'after')`.
  - Live panel's `<Render>` receives a config processed by `createHighlightedConfig(config, diffMap, 'before')`.
  - **Source of truth:** PLAN.md Phase 2 Section 2.1 (left column spec).
- **Interactions:** `CherryPickVisualPanel` -> `createHighlightedConfig`

#### 30. CherryPickVisualPanel renders ComponentConflictGroup for conflicting components

- **Name:** Below the visual comparison, prop-level controls appear for each component with conflicts
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** `CherryPickVisualPanel` rendered with `document.classifiedFields` containing conflicting fields for two components.
- **Actions:** Render and query for `ComponentConflictGroup` instances.
- **Expected outcome:**
  - One `ComponentConflictGroup` per component with conflicting fields.
  - Per-component "Accept all from Draft" / "Accept all from Live" buttons present.
  - Auto-merged field count shown.
  - **Source of truth:** PLAN.md Phase 2 Section 2.1 (left column, below spec).
- **Interactions:** `CherryPickVisualPanel` -> `ComponentConflictGroup`

#### 31. CherryPickVisualPanel merged preview updates with selection changes

- **Name:** Right column Render receives the current mergedSnapshot data
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** `CherryPickVisualPanel` rendered with a non-null `document.mergedSnapshot`.
- **Actions:** Render and inspect the right column's `<Render>` instance.
- **Expected outcome:**
  - The right column `<Render>` receives `document.mergedSnapshot` as its `data` prop.
  - The "Merged Preview" header is present.
  - **Source of truth:** PLAN.md Phase 2 Section 2.1 (right column spec).
- **Interactions:** `CherryPickVisualPanel` -> `<Render>`

### Phase 3: Rewritten Component Tests

#### 32. CrdtPreviewPanel renders three-way visual comparison when all data provided

- **Name:** CRDT panel shows Draft, CRDT Result, and Live in three rendered panels
- **Type:** integration
- **Harness:** H1
- **Preconditions:** `CrdtPreviewPanel` rendered with `snapshot`, `sourceData`, `targetData`, and `config` all provided.
- **Actions:** Render and query for three `<Render>` instances.
- **Expected outcome:**
  - Three `<Render>` instances present, each receiving the correct data prop.
  - Panel labels: source branch name, "CRDT Result" (or "Auto-merged"), target branch name.
  - **Source of truth:** PLAN.md Phase 3 Section 3.4.
- **Interactions:** `CrdtPreviewPanel` -> `<Render>`

#### 33. CrdtPreviewPanel loading and error states still work

- **Name:** Loading shows spinner/text, error shows styled message
- **Type:** regression
- **Harness:** None (direct render)
- **Preconditions:** `CrdtPreviewPanel` rendered in loading and error states.
- **Actions:**
  1. Render with `loading: true`. Assert "Loading CRDT merge preview..." text.
  2. Render with `error: 'CRDT state not available'`. Assert error message.
- **Expected outcome:**
  - Loading text present when `loading: true`.
  - Error message present when `error` is non-null.
  - **Source of truth:** Existing `CrdtPreviewPanel.test.tsx` behavior, PLAN.md Phase 3 Section 3.4.
- **Interactions:** `CrdtPreviewPanel` state rendering

#### 34. DocumentResolutionDetail renders StrategyEmphasisWrapper for accept-draft

- **Name:** Accept-draft strategy wraps MergePreviewRenderer with emphasis on Draft panel
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** `DocumentResolutionDetail` with `strategy: 'accept-draft'`, both snapshots, config, diffs.
- **Actions:** Render and inspect DOM for emphasis overlay divs.
- **Expected outcome:**
  - `MergePreviewRenderer` is rendered.
  - A semi-transparent overlay div (pointer-events: none, `rgba(255,255,255,0.5)` background) covers the Live panel.
  - The Draft panel has a green border highlight.
  - Banner: "Draft version will be kept."
  - **Source of truth:** PLAN.md Phase 3 Section 3.2 (accept-draft rendering, StrategyEmphasisWrapper).
- **Interactions:** `DocumentResolutionDetail` -> `StrategyEmphasisWrapper` -> `MergePreviewRenderer`

#### 35. DocumentResolutionDetail renders StrategyEmphasisWrapper for accept-live

- **Name:** Accept-live strategy wraps MergePreviewRenderer with emphasis on Live panel
- **Type:** integration
- **Harness:** H1, H2
- **Preconditions:** Same as test 34 but with `strategy: 'accept-live'`.
- **Actions:** Render and inspect.
- **Expected outcome:**
  - Dimming overlay on Draft panel, green border on Live panel.
  - Banner: "Live version will be kept."
  - **Source of truth:** PLAN.md Phase 3 Section 3.2 (accept-live rendering).
- **Interactions:** `DocumentResolutionDetail` -> `StrategyEmphasisWrapper` -> `MergePreviewRenderer`

### Invariant Tests

#### 36. All visual components use inline styles (no unstyled BEM-only elements)

- **Name:** New and converted components render with inline styles on all user-visible elements
- **Type:** invariant
- **Harness:** H1, H2
- **Preconditions:** Each visual component rendered individually.
- **Actions:** For each of `MergePreviewRenderer`, `ViewModeSelector`, `ComponentConflictGroup`, `ComponentClickOverlay`, `CherryPickVisualPanel`, `CrdtPreviewPanel`, `DocumentResolutionDetail`, `DocumentResolutionList`, `MergeResolutionToolbar`, `ResolutionStrategyPicker`:
  1. Render the component.
  2. Query all elements with BEM class names.
  3. Assert each has a non-empty `style` attribute.
- **Expected outcome:**
  - Every element with a BEM class name also has inline styles.
  - No unstyled structural elements.
  - **Source of truth:** PLAN.md Styling Convention section; user's previous bug report ("resolve conflicts page is unstyled and generally not usable").
- **Interactions:** All visual components

### Regression Tests

#### 37. Existing keyboard shortcuts continue to work in new layout

- **Name:** J/K navigation, 1-4 strategy, N next unresolved, Shift+D/L bulk, Enter toggle all function
- **Type:** regression
- **Harness:** H2
- **Preconditions:** `DocumentResolutionList` rendered with 3 documents, keyboard event handlers attached.
- **Actions:** Fire each keyboard shortcut and assert callbacks.
- **Expected outcome:**
  - All shortcuts from the existing `DocumentResolutionList.test.tsx` continue to work identically.
  - Shortcuts do not fire when input, textarea, select, or contentEditable elements are focused.
  - **Source of truth:** Existing `DocumentResolutionList.test.tsx`, PLAN.md keyboard navigation spec.
- **Interactions:** `DocumentResolutionList` keyboard handler

#### 38. useMergeResolution hook tests unchanged

- **Name:** All 22 hook state machine tests and 7 execution tests continue passing
- **Type:** regression
- **Harness:** Existing hook test harness
- **Preconditions:** No changes to `useMergeResolution.ts` hook API.
- **Actions:** Run existing test suites.
- **Expected outcome:**
  - All tests in `useMergeResolution.test.ts` pass (22 tests).
  - All tests in `useMergeResolution-execute.test.ts` pass (7 tests).
  - **Source of truth:** Existing test files; PLAN.md explicitly states hook API unchanged.
- **Interactions:** Hook state machine

#### 39. ResolutionStrategyPicker tests unchanged

- **Name:** Strategy picker button behavior and delete-conflict disabling unchanged
- **Type:** regression
- **Harness:** Existing test harness
- **Preconditions:** No changes to `ResolutionStrategyPicker.tsx`.
- **Actions:** Run existing test suite.
- **Expected outcome:**
  - All 5 tests in `ResolutionStrategyPicker.test.tsx` pass.
  - **Source of truth:** Existing test file; PLAN.md states no changes.
- **Interactions:** `ResolutionStrategyPicker` component

---

## Coverage Summary

### Covered areas

| Area | Tests | Types |
|------|-------|-------|
| Visual comparison rendering (accept-draft, accept-live, unresolved) | 1, 6, 11, 19, 20, 34, 35 | scenario, integration |
| Cherry-pick at component level | 3, 10, 24-27, 28-31 | scenario, integration, unit, boundary |
| Cherry-pick at prop level | 3, 30 | scenario, integration |
| CRDT visual preview | 4, 17, 32, 33 | scenario, boundary, integration, regression |
| View mode switching | 6, 12, 21 | scenario, integration |
| Keyboard navigation | 2, 37 | scenario, regression |
| Config threading | 7 | integration |
| Diff computation and display | 8, 9 | integration |
| Inline style conversions (Phase 0) | 19, 20, 21, 22, 23, 36 | integration, unit, invariant |
| Null/delete snapshot edge cases | 13, 14, 15 | boundary |
| Merge execution | 5 | scenario |
| Hook state machine (unchanged) | 38 | regression |
| Strategy picker (unchanged) | 39 | regression |

### Explicitly excluded per agreed strategy

| Area | Reason | Risk |
|------|--------|------|
| **Playwright browser tests** | Placeholder UX; no Playwright infrastructure configured; Medium fidelity agreed | Visual rendering bugs only catchable through manual QA in downstream app |
| **Accessibility testing (axe-core)** | Not in Medium scope | Accessibility regressions possible but components use semantic HTML |
| **Real Puck rendering in jsdom** | `<Render>` is mocked; actual Puck rendering requires browser context | Wrong data could reach Render without detection, mitigated by structured mock assertions |
| **Cross-browser testing** | Out of scope for placeholder UX | Inline styles are cross-browser safe |
| **Performance benchmarks** | No meaningful measurement possible with mocked Render in jsdom | Performance issues deferred to downstream app testing |
| **E2E with real backend** | API client layer unchanged; no new endpoints | API integration bugs already covered by existing `merge.spec.ts` (17 tests) |

### Test count summary

| Category | Count |
|----------|-------|
| Scenario tests | 6 (tests 1-6) |
| Integration tests | 12 (tests 7-12, 19-20, 28-32) |
| Boundary/edge-case tests | 7 (tests 13-18, 27) |
| Unit tests | 4 (tests 22-26) |
| Invariant tests | 1 (test 36) |
| Regression tests | 3 (tests 37-39) |
| **Existing unchanged** | **~34** (22 hook + 7 execute + 5 strategy picker) |
| **Total new/updated** | **39** |
| **Grand total** | **~73** |

The balance is scenario-and-integration-heavy (18 of 39 new tests) with unit tests comprising only 4 of 39 (~10%), well within the "no more than a third" guideline.
