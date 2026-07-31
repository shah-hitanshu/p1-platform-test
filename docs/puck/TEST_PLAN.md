# Merge Conflict Resolution - Test Plan

Fidelity level: **Medium** (~60 tests across 6-8 test files)

Framework: Vitest + @testing-library/react (per Pantheon standards)

---

## Test File 1: `packages/css-client/tests/merge.spec.ts`

**What it tests:** `MergeEndpoint` class - HTTP request construction, response parsing, and error handling for all merge API methods.

**Mocking pattern:** Global `fetch` mock (`vi.fn()` assigned to `global.fetch`), same pattern as `client.spec.ts` and `content.spec.ts`.

**Setup:** Create `CSSClient` instance with `baseUrl` and `apiKey`. Reset `mockFetch` in `beforeEach`.

### Test cases (16 tests)

| # | Test name | What it asserts |
|---|-----------|-----------------|
| 1 | `checkMergeability sends POST to /api/sites/{siteId}/merge/check with branch IDs` | Correct URL, method, and request body containing `sourceBranchId` and `targetBranchId` |
| 2 | `checkMergeability returns typed MergeabilityResult` | Response is parsed and returned with correct shape (`canMerge`, `conflicts`, `mergeBase`, `changes`) |
| 3 | `preview sends POST to /api/sites/{siteId}/merge/preview` | Correct URL, method, body with branch IDs and optional `includeContent` flag |
| 4 | `preview returns typed MergePreview with documentDiffs` | Response includes `canMerge`, `hasConflicts`, `conflicts`, `sourceChanges`, `targetChanges`, `documentDiffs` |
| 5 | `crdtPreview sends POST to /api/sites/{siteId}/merge/crdt-preview` | Correct URL and body with `documentId`, `sourceBranchId`, `targetBranchId` |
| 6 | `crdtPreview returns typed CrdtPreviewResult` | Returns `{ success, snapshot }` |
| 7 | `execute sends POST to /api/sites/{siteId}/merge/execute with conflict resolutions` | Body includes `sourceBranchId`, `targetBranchId`, `message`, `conflictResolutions` array |
| 8 | `execute returns MergeExecuteResult` | Returns `{ success, checkpointId, documentsUpdated }` |
| 9 | `createRequest sends POST to /api/sites/{siteId}/merge-requests` | Correct URL and body with title, description, branch IDs |
| 10 | `getRequest sends GET to /api/sites/{siteId}/merge-requests/{requestId}` | Correct URL and method |
| 11 | `listRequests sends GET to /api/sites/{siteId}/merge-requests` | Correct URL; supports optional query params (status filter) |
| 12 | `updateRequest sends PATCH to /api/sites/{siteId}/merge-requests/{requestId}` | Correct URL, method, body |
| 13 | `deleteRequest sends DELETE to /api/sites/{siteId}/merge-requests/{requestId}` | Correct URL and method |
| 14 | `executeRequest sends POST to /api/sites/{siteId}/merge-requests/{requestId}/execute` | Correct URL and optional `resolutions` in body |
| 15 | `throws CSSApiError on 4xx response` | Error includes status code and message from response body |
| 16 | `throws CSSApiError on 5xx response` | Error includes status code for server errors |

---

## Test File 2: `packages/puck-css/tests/puckFieldClassifier-buildMergedSnapshot.spec.ts`

**What it tests:** The `buildMergedSnapshot` function after extraction from `PuckFieldResolutionPanel.tsx` to `utils/puckFieldClassifier.ts`. Verifies the extraction is behavior-preserving.

**Mocking pattern:** None (pure utility function).

**Setup:** Import `buildMergedSnapshot` from `../src/utils/puckFieldClassifier.js`. Define shared `PuckData` fixtures for source, target, and base snapshots.

### Test cases (6 tests)

| # | Test name | What it asserts |
|---|-----------|-----------------|
| 1 | `builds snapshot selecting all props from source` | When all selections are 'source', output matches source snapshot |
| 2 | `builds snapshot selecting all props from target` | When all selections are 'target', output matches target snapshot |
| 3 | `builds snapshot with mixed per-prop selections` | Individual props correctly taken from source or target per selection map |
| 4 | `preserves auto-merged (non-conflicting) fields in output` | Source-only and target-only fields appear in result without needing explicit selection |
| 5 | `handles root props in selections` | Root-level prop selections are applied correctly |
| 6 | `returns valid PuckData structure` | Output has `content` array and `root` with `props` |

---

## Test File 3: `packages/puck-css/src/__tests__/useMergeResolution.test.ts`

**What it tests:** The `useMergeResolution` hook - state machine transitions, API interactions, navigation, bulk operations, and merge execution.

**Mocking pattern:** Mock `CSSClient` with `vi.fn()` methods on `client.merge.*`. Use `renderHook` from `@testing-library/react` with `act()` for state updates. Mock `classifyPuckFields` and `buildMergedSnapshot` via `vi.mock()`.

**Setup:** Factory function `createMockClient()` that returns a mock client with merge endpoint methods. Factory function `createMergePreview()` to build test `MergePreview` responses.

### Test cases (20 tests)

| # | Test name | What it asserts |
|---|-----------|-----------------|
| 1 | `loadPreview calls client.merge.preview with correct params` | Preview API called with siteId, sourceBranchId, targetBranchId, `{ includeContent: true }` |
| 2 | `loadPreview populates documents array from documentDiffs` | `documents` length matches diffs; each has correct documentId, documentPath, snapshots |
| 3 | `loadPreview sets source-only changes to accept-draft` | Documents in `sourceChanges` but not in conflicts are pre-resolved as `accept-draft` |
| 4 | `loadPreview sets target-only changes to accept-live` | Documents in `targetChanges` but not in conflicts are pre-resolved as `accept-live` |
| 5 | `loadPreview sets conflicting documents to unresolved` | Documents with conflicts start as `unresolved` |
| 6 | `loadPreview sets previewError on API failure` | When preview rejects, `previewError` is set and `documents` is empty |
| 7 | `setStrategy updates a single document strategy` | Calling `setStrategy(docId, 'accept-draft')` updates that document's strategy |
| 8 | `setStrategy to cherry-pick populates classifiedFields` | When set to `cherry-pick`, `classifyPuckFields` is called and result stored |
| 9 | `setStrategy disallows cherry-pick for deleted-in-source conflicts` | Strategy remains unchanged when trying to set cherry-pick on a delete conflict |
| 10 | `setStrategy disallows crdt-preview for deleted-in-target conflicts` | Strategy remains unchanged when trying to set crdt-preview on a delete conflict |
| 11 | `setAllStrategy sets all documents to the given strategy` | All documents change to `accept-draft` or `accept-live` |
| 12 | `setRemainingStrategy only changes unresolved documents` | Already-resolved documents keep their strategy; only unresolved ones change |
| 13 | `goToNext increments currentIndex` | Index moves from 0 to 1 |
| 14 | `goToPrevious decrements currentIndex` | Index moves from 1 to 0; does not go below 0 |
| 15 | `goToNextUnresolved skips resolved documents` | Index jumps to next document with `unresolved` strategy |
| 16 | `goToNextUnresolved wraps around` | When at last unresolved, wraps to first unresolved |
| 17 | `resolvedCount and unresolvedCount track strategy changes` | Counts update as strategies are set |
| 18 | `allResolved is true only when no documents are unresolved` | Boolean reflects zero unresolved count |
| 19 | `fetchCrdtPreview calls client.merge.crdtPreview and stores result` | API called; result stored in document's `crdtPreviewSnapshot` |
| 20 | `fetchCrdtPreview sets error on failure` | On rejection, `crdtPreviewError` is set |

---

## Test File 4: `packages/puck-css/src/__tests__/useMergeResolution-execute.test.ts`

**What it tests:** The `executeMerge` method of the `useMergeResolution` hook - strategy-to-backend mapping and execution flow.

**Mocking pattern:** Same as Test File 3.

**Setup:** Pre-populate hook state with resolved documents (various strategies) via `loadPreview` + `setStrategy` calls.

### Test cases (6 tests)

| # | Test name | What it asserts |
|---|-----------|-----------------|
| 1 | `executeMerge maps accept-draft to take-source` | Resolution entry has `strategy: 'take-source'` |
| 2 | `executeMerge maps accept-live to take-target` | Resolution entry has `strategy: 'take-target'` |
| 3 | `executeMerge maps cherry-pick to manual with resolvedSnapshot` | Resolution entry has `strategy: 'manual'` and includes the `mergedSnapshot` |
| 4 | `executeMerge maps crdt-preview to merge-crdt` | Resolution entry has `strategy: 'merge-crdt'` |
| 5 | `executeMerge sets mergeSuccess on success` | `mergeSuccess` becomes `true`, `mergeExecuting` returns to `false` |
| 6 | `executeMerge sets mergeError on failure` | On rejection, `mergeError` is set and `mergeSuccess` is `false` |

---

## Test File 5: `packages/puck-css/src/__tests__/MergeResolutionPage.test.tsx`

**What it tests:** Integration tests for the `MergeResolutionPage` component - layout rendering, child component composition, and top-level behavior.

**Mocking pattern:** Mock `useMergeResolution` hook via `vi.mock()` to return controlled state. Use `render` and `screen` from `@testing-library/react`.

**Setup:** Factory function returning default mock hook return value. Override specific fields per test.

### Test cases (6 tests)

| # | Test name | What it asserts |
|---|-----------|-----------------|
| 1 | `renders toolbar, document list, and detail panel` | All three sections present in DOM |
| 2 | `passes branch names to toolbar` | Toolbar shows source and target branch names |
| 3 | `shows loading state while preview is loading` | Loading indicator visible when `previewLoading` is true |
| 4 | `shows error state when preview fails` | Error message displayed when `previewError` is set |
| 5 | `calls onClose when back button clicked` | `onClose` callback invoked |
| 6 | `calls onMergeComplete after successful merge` | Callback invoked when `mergeSuccess` transitions to true |

---

## Test File 6: `packages/puck-css/src/__tests__/DocumentResolutionList.test.tsx`

**What it tests:** The document list component - rendering, selection, strategy badges, and keyboard navigation.

**Mocking pattern:** Render component with mock data and callback props. Use `fireEvent.keyDown` for keyboard tests.

**Setup:** Array of `DocumentResolution` mock objects with various strategies and conflict types.

### Test cases (10 tests)

| # | Test name | What it asserts |
|---|-----------|-----------------|
| 1 | `renders document paths for all documents` | Each document path visible in DOM |
| 2 | `shows strategy badge for each document` | Badge text matches strategy (e.g., "Draft", "Live", "Unresolved") |
| 3 | `highlights currently selected document` | Active document has selected styling/aria attribute |
| 4 | `ArrowDown/J moves selection to next document` | `goToNext` called on keydown |
| 5 | `ArrowUp/K moves selection to previous document` | `goToPrevious` called on keydown |
| 6 | `N key jumps to next unresolved` | `goToNextUnresolved` called |
| 7 | `1/2/3/4 keys set strategy on current document` | `setStrategy` called with correct strategy for each key |
| 8 | `Shift+D calls setRemainingStrategy with accept-draft` | Bulk action triggered |
| 9 | `Shift+L calls setRemainingStrategy with accept-live` | Bulk action triggered |
| 10 | `keyboard shortcuts do not fire when input is focused` | No callbacks called when event target is an input element |

---

## Test File 7: `packages/puck-css/src/__tests__/ResolutionStrategyPicker.test.tsx`

**What it tests:** The strategy picker button group - rendering, click handling, and disabled states.

**Mocking pattern:** Render with props, use `fireEvent.click`.

**Setup:** Mock `onSelect` callback. Provide `conflictType` and `currentStrategy` props.

### Test cases (5 tests)

| # | Test name | What it asserts |
|---|-----------|-----------------|
| 1 | `renders four strategy buttons` | Four buttons present: Accept Draft, Accept Live, Cherry-pick, CRDT merge |
| 2 | `highlights selected strategy` | Active button has selected visual state (aria-pressed or CSS class) |
| 3 | `calls onSelect with strategy on click` | Callback invoked with correct strategy value |
| 4 | `disables Cherry-pick and CRDT merge for deleted-in-source` | Those two buttons are disabled; clicking them does not invoke `onSelect` |
| 5 | `disables Cherry-pick and CRDT merge for deleted-in-target` | Same as above for the other delete conflict type |

---

## Test File 8: `packages/puck-css/src/__tests__/MergeResolutionToolbar.test.tsx`

**What it tests:** The toolbar component - progress display, bulk actions, and execute merge button state.

**Mocking pattern:** Render with props, use `fireEvent.click`.

**Setup:** Props including `resolvedCount`, `totalCount`, `allResolved`, and callback functions.

### Test cases (5 tests)

| # | Test name | What it asserts |
|---|-----------|-----------------|
| 1 | `shows progress as X of Y resolved` | Text like "3 of 12 resolved" visible |
| 2 | `shows branch direction label` | Text like "Draft (branch-name) -> Live" visible |
| 3 | `Execute Merge button disabled when not all resolved` | Button has `disabled` attribute when `allResolved` is false |
| 4 | `Execute Merge button enabled when all resolved` | Button is clickable when `allResolved` is true |
| 5 | `bulk action buttons call setAllStrategy` | "Accept all as Draft" calls `setAllStrategy('accept-draft')` |

---

## Summary

| Test file | Package | Tests |
|-----------|---------|-------|
| `merge.spec.ts` | css-client | 16 |
| `puckFieldClassifier-buildMergedSnapshot.spec.ts` | puck-css | 6 |
| `useMergeResolution.test.ts` | puck-css | 20 |
| `useMergeResolution-execute.test.ts` | puck-css | 6 |
| `MergeResolutionPage.test.tsx` | puck-css | 6 |
| `DocumentResolutionList.test.tsx` | puck-css | 10 |
| `ResolutionStrategyPicker.test.tsx` | puck-css | 5 |
| `MergeResolutionToolbar.test.tsx` | puck-css | 5 |
| **Total** | | **74** |

---

## Phase-to-test-file mapping

| Implementation phase | Test files written first (TDD) |
|---------------------|-------------------------------|
| Phase 1: CSS Client Merge Endpoint | `merge.spec.ts` |
| Phase 2: useMergeResolution Hook | `puckFieldClassifier-buildMergedSnapshot.spec.ts`, `useMergeResolution.test.ts`, `useMergeResolution-execute.test.ts` |
| Phase 3: UI Components | `MergeResolutionPage.test.tsx`, `DocumentResolutionList.test.tsx`, `ResolutionStrategyPicker.test.tsx`, `MergeResolutionToolbar.test.tsx` |
| Phase 4: Exports and Integration | No dedicated test file (covered by import tests in existing files) |

---

## Conventions followed

- **css-client tests** use `.spec.ts` extension and live in `packages/css-client/tests/`
- **puck-css utility tests** use `.spec.ts` extension and live in `packages/puck-css/tests/`
- **puck-css component/hook tests** use `.test.tsx` or `.test.ts` extension and live in `packages/puck-css/src/__tests__/`
- All tests import from compiled paths using `.js` extensions (TypeScript path convention)
- Mock client follows the `createMockClient()` factory pattern from `useCSSPlugin.spec.tsx`
- Global fetch mocking follows the pattern from `client.spec.ts`
- Component tests use `render`, `screen`, `fireEvent` from `@testing-library/react`
- Hook tests use `renderHook` and `act` from `@testing-library/react`
