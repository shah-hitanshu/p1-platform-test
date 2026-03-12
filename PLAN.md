# Merge Conflict Resolution Plan

## Goal

Extend the existing merge visualization into a full merge conflict resolution UX. A non-technical user should be able to:

1. Page through changed documents in a merge (supporting dozens or hundreds)
2. For each document, choose a resolution strategy: Accept All Draft, Accept All Live, cherry-pick individual components/props, or preview the CRDT auto-merge result
3. Execute the merge with their chosen resolutions
4. Use keyboard shortcuts for efficient navigation at scale

The existing per-document visual comparisons (side-by-side, overlay, slider) are retained and integrated into the new workflow.

---

## Architecture Decisions

### Decision 1: Dedicated `MergeEndpoint` in `@pantheon/css-client`

**Why:** The backend already has a full merge API (`/merge/check`, `/merge/preview`, `/merge/execute`, `/merge/crdt-preview`, plus merge request CRUD). The css-client currently has zero merge endpoint support. All merge API calls in the downstream app (`my-app/app/merge/page.tsx`) are raw `fetch()` calls. Adding a proper endpoint class makes merge operations type-safe, testable, and consistent with the existing client architecture (`BranchesEndpoint`, `DocumentsEndpoint`, etc.).

### Decision 2: `useMergeResolution` hook as the central state machine

**Why:** Merge conflict resolution is a multi-step, multi-document workflow with complex state (per-document strategy selections, per-component/prop cherry-picks, CRDT preview requests, and final merge execution). A single hook encapsulating this state machine is idiomatic React, keeps components thin, and is straightforward to test with Vitest. The hook manages:
- The list of documents with conflicts
- Per-document resolution strategy (accept-source, accept-target, cherry-pick, crdt-preview)
- Per-component/prop selections for cherry-pick mode
- Merged snapshot computation for cherry-pick mode (using existing `buildMergedSnapshot` from `PuckFieldResolutionPanel`)
- CRDT preview fetching and display
- Navigation (current document index, keyboard shortcut bindings)
- Final merge execution

### Decision 3: `MergeResolutionPage` as a new top-level component (not modifying existing components)

**Why:** The user confirmed this should be a dedicated page. The existing `VisualBranchCompare` and `BranchMergeCompare` are read-only comparison views. Rather than retrofitting interactive resolution into read-only components, a new `MergeResolutionPage` composes the existing comparison components alongside new resolution controls. This avoids breaking the existing comparison UX while adding the conflict resolution workflow.

### Decision 4: Keyboard-first navigation design

**Why:** The user explicitly called out production merges with dozens or hundreds of documents. Sequential mouse clicking through 200 documents is impractical. The design uses:
- `J`/`K` or `ArrowDown`/`ArrowUp` to navigate between documents
- `N` to jump to the next unresolved document
- `1`/`2`/`3`/`4` to quickly assign strategy (Accept Draft / Accept Live / Cherry-pick / CRDT Preview)
- `Shift+D` to accept all remaining as Draft, `Shift+L` to accept all remaining as Live
- `Enter` to expand/collapse current document detail view
- These shortcuts only fire when no input/textarea is focused (standard shortcut guard)

### Decision 5: Resolution strategy types map to backend `ConflictResolutionStrategy`

**Why:** The backend supports four strategies: `take-source`, `take-target`, `merge-crdt`, and `manual`. The UI strategies map directly:
- "Accept All Draft" = `take-source` (Draft is the source branch)
- "Accept All Live" = `take-target` (Live is the main/target branch)
- "Cherry-pick" = `manual` (client builds a merged snapshot from selected props)
- "CRDT Preview" = `merge-crdt` (backend merges CRDT states)

This direct mapping means no translation layer is needed at merge execution time.

### Decision 6: Reuse existing `PuckFieldResolutionPanel` internals, compose new UI around them

**Why:** The existing `classifyPuckFields`, `groupFieldsByComponent`, and `buildMergedSnapshot` logic is exactly what cherry-pick resolution needs. The existing `ComponentConflictGroup` radio-button UI is also reused as-is within the cherry-pick detail view, since it already handles per-field source/target selection.

**Important implementation detail:** `buildMergedSnapshot` is currently a local (non-exported) function inside `PuckFieldResolutionPanel.tsx`. It must be extracted to `packages/puck-css/src/utils/puckFieldClassifier.ts` (alongside `classifyPuckFields` and `groupFieldsByComponent`) so both the existing `PuckFieldResolutionPanel` and the new `useMergeResolution` hook can import it. The original `PuckFieldResolutionPanel.tsx` is updated to import from the utility instead.

### Decision 7: Delete-type conflicts handled as document-level choices only

**Why:** When a document is `deleted-in-source` or `deleted-in-target`, prop-level cherry-picking is meaningless (there is no "other side" to compare props against). These conflicts only allow Accept Draft or Accept Live as strategies. The Cherry-pick and CRDT Preview options are disabled for delete-type conflicts. The UI shows an explanatory message (e.g., "This document was deleted in Draft" or "This document was deleted in Live") instead of a field comparison view.

### Decision 8: Non-conflicting documents are included in the list but pre-resolved

**Why:** A merge may include documents that changed only on one side (no conflict). These are still shown in the document list so the user can review what will be merged, but they are pre-resolved (`accept-draft` for source-only changes, `accept-live` for target-only changes). The user can override these pre-resolved strategies if needed. This gives full visibility into the merge while keeping the "unresolved" count focused on actual conflicts requiring decisions.

---

## Component Inventory

### New files to create

| # | File | Package | Purpose |
|---|------|---------|---------|
| 1 | `packages/css-client/src/endpoints/merge.ts` | css-client | `MergeEndpoint` class wrapping all backend merge API calls |
| 2 | `packages/css-client/tests/merge.spec.ts` | css-client | Tests for MergeEndpoint |
| 3 | `packages/puck-css/src/hooks/useMergeResolution.ts` | puck-css | State machine hook for the multi-document resolution workflow |
| 4 | `packages/puck-css/src/__tests__/useMergeResolution.test.ts` | puck-css | Tests for the hook |
| 5 | `packages/puck-css/src/components/merge-resolution/MergeResolutionPage.tsx` | puck-css | Top-level page component |
| 6 | `packages/puck-css/src/components/merge-resolution/DocumentResolutionList.tsx` | puck-css | Scrollable document list with strategy badges and keyboard navigation |
| 7 | `packages/puck-css/src/components/merge-resolution/DocumentResolutionDetail.tsx` | puck-css | Expanded view for a single document showing strategy options and cherry-pick/CRDT preview |
| 8 | `packages/puck-css/src/components/merge-resolution/ResolutionStrategyPicker.tsx` | puck-css | Button group for choosing Accept Draft / Accept Live / Cherry-pick / CRDT Preview |
| 9 | `packages/puck-css/src/components/merge-resolution/CrdtPreviewPanel.tsx` | puck-css | Renders the CRDT auto-merge preview for a single document |
| 10 | `packages/puck-css/src/components/merge-resolution/MergeResolutionToolbar.tsx` | puck-css | Top toolbar with progress indicator, bulk actions, keyboard shortcut hints, and Execute Merge button |
| 11 | `packages/puck-css/src/components/merge-resolution/index.ts` | puck-css | Barrel export |
| 12 | `packages/puck-css/src/__tests__/MergeResolutionPage.test.tsx` | puck-css | Integration tests for the page component |
| 13 | `packages/puck-css/src/__tests__/DocumentResolutionList.test.tsx` | puck-css | Tests for keyboard navigation and list behavior |

### Files to modify

| # | File | Change |
|---|------|--------|
| 1 | `packages/css-client/src/client.ts` | Add `merge` property exposing `MergeEndpoint` |
| 2 | `packages/css-client/src/endpoints/index.ts` | Export `MergeEndpoint` |
| 3 | `packages/css-client/src/types.ts` | Add merge-related types (`MergePreview`, `MergeabilityResult`, `DocumentDiff`, `ConflictResolutionStrategy`, `MergeRequest`, etc.) |
| 4 | `packages/css-client/src/index.ts` | Re-export new merge types |
| 5 | `packages/puck-css/src/index.ts` | Export new merge resolution components and hook |
| 6 | `packages/puck-css/src/components/merge-resolution/index.ts` | Barrel export |
| 7 | `packages/puck-css/src/utils/puckFieldClassifier.ts` | Extract `buildMergedSnapshot` from `PuckFieldResolutionPanel.tsx` into this shared utility and export it |
| 8 | `packages/puck-css/src/components/conflict-resolution/PuckFieldResolutionPanel.tsx` | Replace local `buildMergedSnapshot` with import from `../../utils/puckFieldClassifier.js` |

---

## Detailed Component Specifications

### Phase 1: CSS Client Merge Endpoint

#### 1.1 Types (`packages/css-client/src/types.ts`)

Add the following types to the css-client types file:

```typescript
// Merge conflict resolution strategies (matches backend)
export type ConflictResolutionStrategy = 'take-source' | 'take-target' | 'merge-crdt' | 'manual';

// Merge request workflow states
export type MergeRequestStatus = 'open' | 'approved' | 'merged' | 'closed' | 'conflicted';

// Document-level conflict types
export type DocumentConflictType = 'both-modified' | 'deleted-in-source' | 'deleted-in-target';

export interface DocumentConflict {
  documentId: string;
  documentPath: string;
  conflictType: DocumentConflictType;
  sourceVersion?: number;
  targetVersion?: number;
  baseVersion?: number;
}

export interface ConflictDetails {
  documentConflicts: DocumentConflict[];
  structureConflicts: unknown[];
}

export interface MergeabilityResult {
  canMerge: boolean;
  conflicts: DocumentConflict[];
  mergeBase: { checkpointId: string; branchId: string };
  changes: {
    documentsModifiedInSource: string[];
    documentsModifiedInTarget: string[];
  };
}

export interface DocumentDiff {
  documentId: string;
  documentPath: string;
  sourceSnapshot: Record<string, unknown> | null;
  targetSnapshot: Record<string, unknown> | null;
  diffOperations: unknown[];
}

export interface MergePreview {
  canMerge: boolean;
  hasConflicts: boolean;
  conflicts: ConflictDetails;
  sourceChanges: { documentId: string; documentPath: string }[];
  targetChanges: { documentId: string; documentPath: string }[];
  mergeBase: { checkpointId: string; branchId: string } | null;
  documentDiffs?: DocumentDiff[];
}

export interface CrdtPreviewResult {
  success: boolean;
  snapshot: Record<string, unknown>;
}

export interface MergeExecuteParams {
  sourceBranchId: string;
  targetBranchId: string;
  message?: string;
  conflictResolutions?: {
    documentId: string;
    strategy: ConflictResolutionStrategy;
    resolvedSnapshot?: Record<string, unknown>;
  }[];
}

export interface MergeExecuteResult {
  success: boolean;
  checkpointId?: string;
  documentsUpdated?: number;
}

export interface MergeRequest {
  id: string;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  title: string;
  description?: string;
  status: MergeRequestStatus;
  hasConflicts: boolean;
  conflictDetails?: ConflictDetails;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
}
```

#### 1.2 MergeEndpoint (`packages/css-client/src/endpoints/merge.ts`)

Methods (with backend API paths):
- `checkMergeability(siteId, sourceBranchId, targetBranchId)` → `MergeabilityResult` — `POST /api/sites/{siteId}/merge/check`
- `preview(siteId, sourceBranchId, targetBranchId, options?)` → `MergePreview` — `POST /api/sites/{siteId}/merge/preview`
- `crdtPreview(siteId, documentId, sourceBranchId, targetBranchId)` → `CrdtPreviewResult` — `POST /api/sites/{siteId}/merge/crdt-preview`
- `execute(siteId, params: MergeExecuteParams)` → `MergeExecuteResult` — `POST /api/sites/{siteId}/merge/execute`
- `createRequest(siteId, params)` → `MergeRequest` — `POST /api/sites/{siteId}/merge-requests`
- `getRequest(siteId, requestId)` → `MergeRequest` — `GET /api/sites/{siteId}/merge-requests/{requestId}`
- `listRequests(siteId, options?)` → `MergeRequest[]` — `GET /api/sites/{siteId}/merge-requests`
- `updateRequest(siteId, requestId, params)` → `MergeRequest` — `PATCH /api/sites/{siteId}/merge-requests/{requestId}`
- `deleteRequest(siteId, requestId)` → `void` — `DELETE /api/sites/{siteId}/merge-requests/{requestId}`
- `executeRequest(siteId, requestId, options?)` → `MergeExecuteResult` — `POST /api/sites/{siteId}/merge-requests/{requestId}/execute` — `options` includes optional `resolutions` array and optional `defaultStrategy` (defaults to `'take-source'` to match backend behavior)

#### 1.3 Client integration (`packages/css-client/src/client.ts`)

Add `merge: MergeEndpoint` as a public property on `CSSClient`, instantiated in the constructor like other endpoints.

### Phase 2: `useMergeResolution` Hook

Location: `packages/puck-css/src/hooks/useMergeResolution.ts`

#### State shape

```typescript
export type DocumentResolutionStrategy = 'accept-draft' | 'accept-live' | 'cherry-pick' | 'crdt-preview' | 'unresolved';

export interface DocumentResolution {
  documentId: string;
  documentPath: string;
  strategy: DocumentResolutionStrategy;
  // Cherry-pick selections (componentId:propName → 'source' | 'target')
  cherryPickSelections: Record<string, 'source' | 'target'>;
  // The computed merged snapshot for cherry-pick mode
  mergedSnapshot: PuckData | null;
  // CRDT preview result (fetched on demand)
  crdtPreviewSnapshot: PuckData | null;
  crdtPreviewLoading: boolean;
  crdtPreviewError: string | null;
  // Source and target snapshots
  sourceSnapshot: PuckData | null;
  targetSnapshot: PuckData | null;
  // Conflict type from backend
  conflictType: DocumentConflictType;
  // Classified fields (for cherry-pick UI)
  classifiedFields: PuckFieldClassification[] | null;
}

export interface UseMergeResolutionOptions {
  client: CSSClient;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  sourceBranchName: string;
  targetBranchName: string;
}

export interface UseMergeResolutionReturn {
  // Data
  documents: DocumentResolution[];
  currentIndex: number;
  currentDocument: DocumentResolution | null;
  totalCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  allResolved: boolean;

  // Loading states
  previewLoading: boolean;
  previewError: string | null;
  mergeExecuting: boolean;
  mergeError: string | null;
  mergeSuccess: boolean;

  // Navigation
  goToDocument: (index: number) => void;
  goToNext: () => void;
  goToPrevious: () => void;
  goToNextUnresolved: () => void;

  // Strategy selection
  setStrategy: (documentId: string, strategy: DocumentResolutionStrategy) => void;
  setAllStrategy: (strategy: 'accept-draft' | 'accept-live') => void;
  setRemainingStrategy: (strategy: 'accept-draft' | 'accept-live') => void;

  // Cherry-pick (individual prop or whole component)
  setCherryPickSelection: (documentId: string, componentId: string, propName: string, choice: 'source' | 'target') => void;
  // Sets all classified fields for the given component to 'source' or 'target' at once
  acceptAllComponentProps: (documentId: string, componentId: string, choice: 'source' | 'target') => void;

  // CRDT preview
  fetchCrdtPreview: (documentId: string) => Promise<void>;

  // Execution
  executeMerge: (message?: string) => Promise<void>;

  // Lifecycle
  loadPreview: () => Promise<void>;
}
```

#### Key behaviors

- **On mount / `loadPreview()`**: Calls `client.merge.preview(siteId, sourceBranchId, targetBranchId, { includeContent: true })`. Populates `documents` array with one `DocumentResolution` per document in `documentDiffs`. Documents without conflicts (source-only or target-only changes) are pre-resolved as `accept-draft` or `accept-live` respectively.
- **Strategy changes**: When strategy changes to `cherry-pick`, the hook runs `classifyPuckFields(sourceSnapshot, targetSnapshot, null)` to populate `classifiedFields`. When all cherry-pick selections are made, it runs `buildMergedSnapshot` (imported from `utils/puckFieldClassifier`) to compute `mergedSnapshot`. Cherry-pick and CRDT Preview strategies are disallowed for `deleted-in-source` / `deleted-in-target` conflicts (only Accept Draft or Accept Live make sense when one side has no document).
- **CRDT preview**: When strategy changes to `crdt-preview`, the hook calls `client.merge.crdtPreview(...)` for the document and stores the result. If the CRDT preview fails (e.g., no CRDT state), falls back to showing an error message.
- **Merge execution**: Maps each document's resolution to the backend format:
  - `accept-draft` → `{ strategy: 'take-source' }`
  - `accept-live` → `{ strategy: 'take-target' }`
  - `cherry-pick` → `{ strategy: 'manual', resolvedSnapshot: mergedSnapshot }`
  - `crdt-preview` → `{ strategy: 'merge-crdt' }`
  Then calls `client.merge.execute(siteId, { sourceBranchId, targetBranchId, message, conflictResolutions })`.

### Phase 3: UI Components

#### 3.1 `MergeResolutionPage`

Top-level layout:
```
┌──────────────────────────────────────────────────────────────┐
│ MergeResolutionToolbar                                       │
│ [← Back] [Draft → Live] [3/12 resolved] [Shift+D] [Shift+L] │
│                                    [Execute Merge ✓]         │
├──────────────────┬───────────────────────────────────────────┤
│ DocumentList     │ DocumentDetail                            │
│ ─────────────    │                                           │
│ ● /home   [Draft]│ Strategy: [Draft] [Live] [Pick] [CRDT]   │
│   /about  [ ? ] │                                           │
│   /contact [Live]│ [Visual comparison]                       │
│   /blog   [ ? ] │ or [Cherry-pick fields]                   │
│   ...           │ or [CRDT preview]                         │
│                  │                                           │
│ ↑↓ Navigate     │                                           │
│ 1234 Strategy   │                                           │
└──────────────────┴───────────────────────────────────────────┘
```

Props:
```typescript
export interface MergeResolutionPageProps {
  client: CSSClient;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  sourceBranchName: string;
  targetBranchName: string;
  config: unknown; // Puck config for rendering previews
  onClose: () => void;
  onMergeComplete?: () => void;
}
```

#### 3.2 `DocumentResolutionList`

Left panel. Renders a scrollable list of documents. Each row shows:
- Document path
- Strategy badge (color-coded: green=Draft, blue=Live, purple=Cherry-pick, orange=CRDT, gray=Unresolved)
- Conflict type indicator for conflicted documents
- Active/selected highlighting

Keyboard handling:
- `ArrowUp`/`K` = previous document
- `ArrowDown`/`J` = next document
- `N` = next unresolved document
- `1` = Accept Draft, `2` = Accept Live, `3` = Cherry-pick, `4` = CRDT Preview
- `Shift+D` = accept all remaining as Draft
- `Shift+L` = accept all remaining as Live
- `Enter` = toggle detail view expansion

Auto-scrolls the selected item into view.

#### 3.3 `DocumentResolutionDetail`

Right panel. Shows the expanded view for the currently selected document:

- **Strategy picker** (4 buttons with labels)
- **When strategy is `accept-draft` or `accept-live`**: Shows the existing `MergePreviewRenderer` (from `packages/puck-css/src/components/merge-preview/`) in side-by-side mode with the chosen side highlighted. This retains the existing per-document visual comparison as a read-only confirmation of the user's choice.
- **When strategy is `cherry-pick`**: Shows `ComponentConflictGroup` components for each component with conflicts. Uses existing radio-button UI from the conflict-resolution components. Shows auto-merged field count. Shows "Apply" that computes the merged snapshot and displays a rendered preview using `Render` from Puck.
- **When strategy is `crdt-preview`**: Shows `CrdtPreviewPanel` with a loading state, the merged snapshot rendered via Puck's `Render`, and a side-by-side comparison with the source/target.
- **When conflict type is `deleted-in-source` or `deleted-in-target`**: Shows only Accept Draft / Accept Live buttons (Cherry-pick and CRDT Preview are disabled). Displays an explanatory message: "This document was deleted in Draft" or "This document was deleted in Live". Shows the surviving version's snapshot as a read-only preview.

#### 3.4 `ResolutionStrategyPicker`

Four-button toggle group. Visual states:
- Unselected: outlined/subtle
- Selected: filled with strategy color
- Disabled: grayed out (e.g., CRDT Preview when document lacks CRDT state)

Labels: "Accept Draft", "Accept Live", "Cherry-pick", "CRDT merge"

#### 3.5 `CrdtPreviewPanel`

Fetches and displays the CRDT auto-merge result:
- Loading spinner while fetching
- Error state if CRDT merge fails (with message like "CRDT state not available for this document")
- On success: renders the merged snapshot using Puck's `Render`, with a toggle to show side-by-side comparison of Draft vs CRDT Result vs Live

#### 3.6 `MergeResolutionToolbar`

Top bar containing:
- Back button (calls `onClose`)
- Branch labels: "Draft (branch-name) → Live"
- Progress: "X of Y resolved" with progress bar
- Bulk action buttons: "Accept all as Draft" / "Accept all as Live"
- Keyboard shortcut hints (collapsible)
- "Execute merge" button (enabled only when `allResolved` is true). Clicking shows an inline confirmation prompt (not a separate component — a simple `window.confirm()` or inline "Are you sure?" toggle within the toolbar) summarizing the resolution choices before proceeding

### Phase 4: Integration and Exports

- Update `packages/puck-css/src/index.ts` to export all new components, the hook, and types
- Update barrel exports in component directories

---

## Implementation Phases (executed sequentially as per CLAUDE.md)

### Phase 1: CSS Client Merge Types and Endpoint
**Files:** `packages/css-client/src/types.ts`, `packages/css-client/src/endpoints/merge.ts`, `packages/css-client/src/endpoints/index.ts`, `packages/css-client/src/client.ts`, `packages/css-client/src/index.ts`, `packages/css-client/tests/merge.spec.ts`

Tests cover:
- Each endpoint method constructs the correct HTTP request
- Response parsing returns typed results
- Error handling for 4xx/5xx responses

### Phase 2: `useMergeResolution` Hook
**Prerequisite refactor:** Extract `buildMergedSnapshot` from `PuckFieldResolutionPanel.tsx` to `packages/puck-css/src/utils/puckFieldClassifier.ts` and update the import in `PuckFieldResolutionPanel.tsx`. This is a zero-behavior-change refactor — existing tests must continue to pass.

**Files:** `packages/puck-css/src/utils/puckFieldClassifier.ts` (modify), `packages/puck-css/src/components/conflict-resolution/PuckFieldResolutionPanel.tsx` (modify), `packages/puck-css/src/hooks/useMergeResolution.ts`, `packages/puck-css/src/__tests__/useMergeResolution.test.ts`

Tests cover:
- Initial load calls preview API and populates document list
- Strategy changes update document resolution state
- Cherry-pick selection computes merged snapshot correctly
- CRDT preview fetches and stores result
- `setAllStrategy` and `setRemainingStrategy` bulk operations
- Navigation (next, previous, next-unresolved)
- `executeMerge` maps strategies to backend format and calls execute API
- Delete-type conflicts restrict available strategies to accept-draft/accept-live only
- Error states (preview load failure, merge execution failure)

### Phase 3: UI Components
**Files:** All components in `packages/puck-css/src/components/merge-resolution/`

Tests cover:
- `MergeResolutionPage` renders toolbar, list, and detail
- `DocumentResolutionList` renders documents with badges
- Keyboard navigation fires correct callbacks
- Strategy picker updates on click
- Cherry-pick view shows conflict groups
- CRDT preview panel shows loading, error, and success states
- Delete-type conflicts disable Cherry-pick and CRDT Preview buttons
- Execute merge button disabled when not all resolved

### Phase 4: Exports and Integration
**Files:** `packages/puck-css/src/index.ts`, `packages/puck-css/src/components/merge-resolution/index.ts`

Ensures all new components, hooks, and types are properly exported.

---

## Testing Strategy

**Level:** Medium (as approved by user)

- **Unit tests** for `MergeEndpoint` (mock HTTP, verify request/response mapping)
- **Unit tests** for `useMergeResolution` (mock client, test state transitions with `renderHook`)
- **Component tests** for key UI components (render tests with `@testing-library/react`)
- **Keyboard navigation tests** (fire keyboard events, verify callback invocations)
- **No E2E tests** in this phase (the UX is a placeholder that may move to another system)

Framework: Vitest + @testing-library/react (per Pantheon standards)

---

## Non-Goals (explicitly out of scope)

- **Manual text editing** of merged content. User confirmed: "If manual changes are necessary, that should happen on the Draft version and the merge process restarted."
- **Merge request workflow** (approval, comments). The merge request CRUD endpoints are included in the client for completeness but the UI does not implement approval flows.
- **Real-time collaboration during merge**. Merge resolution is a single-user workflow.
- **Modifying existing comparison components** (`VisualBranchCompare`, `BranchMergeCompare`, `DocumentDiffList`). These are composed, not changed.
