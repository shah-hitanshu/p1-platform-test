# Puck CSS Integration Progress

## Overview

This repository provides the integration between [Puck Editor](https://puckeditor.com) and the Collaborative State System (CSS).

## Repository Structure

```
puck-css-integration/
├── packages/
│   ├── css-client/      # @pantheon/css-client - TypeScript API client for CSS
│   └── puck-css/        # @pantheon/puck-css - Puck editor integration
├── apps/
│   └── demo/            # Demo application
└── pnpm-workspace.yaml
```

## Completed Work

### Phase 1: Repository Setup ✅
- Created monorepo with pnpm workspaces
- Set up TypeScript, ESLint, Vitest for all packages

### Phase 2: CSS Client Package (`@pantheon/css-client`) ✅
- Full API client implementation with endpoint classes:
  - `SitesEndpoint` - Site CRUD operations
  - `BranchesEndpoint` - Branch management
  - `DocumentsEndpoint` - Document CRUD
  - `VersionsEndpoint` - Document version management
  - `CheckpointsEndpoint` - Checkpoint (publish) operations
- Authentication support (API key and custom providers)
- Principal-based request attribution via `withPrincipal()`
- Error classes for different API error types
- 18 tests passing

### Phase 3: Puck CSS Package (`@pantheon/puck-css`) ✅
- React hooks for CSS integration:
  - `useAutoSave` - Debounced auto-save with retry logic
  - `useDocuments` - Document list management
  - `useBranches` - Branch list and switching
  - `useCheckpoints` - Checkpoint creation
  - `useVersions` - Version history
- React components:
  - `CSSPuckProvider` - Context provider for CSS integration
  - `SaveIndicator` - Visual save status indicator
  - `PublishButton` - Checkpoint creation with name prompt
  - `BranchSelector` - Branch switching dropdown
- Utility functions:
  - `debounce` - Debounce function for auto-save
  - `withRetry` - Exponential backoff retry logic
  - `diffPuckData` - Component-level diffing for version comparison
- 14 tests passing

### Phase 4: Demo Application ✅
- Complete demo app showcasing all features
- Sample Puck components (Heading, Text, Image, Button, Spacer, Card, Columns)
- Full UI with:
  - Header with branch selector
  - Sidebar with document list (create/delete pages)
  - Editor area with Puck integration
  - Save indicator and publish button
- Environment configuration via .env file
- TypeScript strict mode, ESLint configured
- Production build working

### Phase 4.1: Puck 0.21 Migration ✅
- Migrated from `@measured/puck` to `@puckeditor/core` 0.21.1
- Integrated with Puck's native Plugin API and Overrides system:
  - `createCSSPlugin()` - Creates plugin for left rail (branch selector + document list)
  - `createCSSOverrides()` - Creates header overrides (save indicator + publish button)
- Document management moved into Puck's plugin rail (removed separate sidebar)
- Full-width editor layout using Puck's native chrome

### Phase 4.2: Dynamic Branch Selection ✅
- Made `branchId` optional in configuration
- App defaults to main branch when branchId not specified:
  - Queries backend for branch list on startup
  - Automatically selects the branch marked as `isMain`
- Fixed infinite loop in `refreshBranches` callback
- Branch switching now works correctly:
  - Documents reload when switching branches
  - Proper state management with functional setState
  - Uses `initializedRef` to prevent re-initialization

### Phase 4.3: Auto-save Pause During Checkpoint Entry ✅
- Added pause/resume functionality to debounce utility
- Prevents auto-save refresh from interfering with checkpoint name typing
- New context methods: `pauseAutoSave`, `resumeAutoSave`, `autoSavePaused`
- Auto-resumes on next edit (when `saveData()` is called)
- `PublishButton` now calls `onPromptShow` when prompt is displayed
- `createCSSOverrides` accepts `onPauseAutoSave` callback
- 8 new tests for pause/resume functionality

### Phase 5: Version Comparison UI ✅
- Extended diff utilities with position tracking:
  - `diffPuckDataWithPositions()` - Component diffing with before/after indices
  - `diffProps()` - Prop-level diffing for detailed change detection
  - `getReorderedComponents()` - Detects moved components
- New types:
  - `ComponentDiffWithPosition` - Extended diff type with position info
  - `PropDiff` - Prop-level diff type (added/removed/modified)
- React components for version comparison:
  - `PropValueDisplay` - Smart prop value renderer with color swatches, type formatting
  - `PropDiffRow` - Single prop diff display with before/after values
  - `PropDiffPanel` - Container for all prop diffs with summary counts
  - `ComponentNode` - Component in tree with diff styling (+/−/~/↕ icons)
  - `ComponentTree` - Side-by-side tree filtering by before/after
  - `DiffHeader` - Version header with change summary (+3, -1, ~2)
  - `VersionComparePage` - Full-page comparison view with:
    - Side-by-side component trees (Before/After)
    - Prop diff panel for selected component
    - Empty state for no changes
- Comprehensive CSS styles for all components
- Barrel export at `src/components/version-compare/index.ts`
- 70 new tests for version comparison components

### Phase 5b: Version Comparison Integration ✅
- Extended CSSPlugin with version history section:
  - Version list with version numbers and timestamps
  - Current version badge
  - Click to select version for comparison
  - Compare with current button
- Updated demo App.tsx with full version integration:
  - Uses useVersions hook to fetch version history
  - Version selection and comparison handlers
  - Full-page VersionComparePage overlay when comparing
- Added version list styles to demo app
- 12 new tests for version plugin section

### Phase 5c: Visual Version Comparison Redesign ✅
- Replaced structural tree-based comparison with rendered page comparison
- New `VisualVersionCompare` component:
  - Uses Puck's `<Render>` component to display actual rendered pages
  - Side-by-side Before/After panels with scrollable content
  - Visual highlighting of changed components:
    - Added: Green outline with + badge
    - Removed: Red outline with − badge
    - Modified: Yellow/orange outline with ~ badge
  - Legend explaining diff colors
  - Header with version numbers and change summary
- Config wrapping technique:
  - `createHighlightedConfig()` wraps component render functions
  - Adds highlight styling around changed components based on diff data
- Demo app updated to use `VisualVersionCompare`:
  - Passes full `beforeData` and `afterData` PuckData objects
  - Passes `puckConfig` for component rendering
  - Imports puck-css styles for visual highlighting
- 13 new tests for VisualVersionCompare component
- CSS styles for visual diff highlighting added to package

### Phase 5d: Backend - GET Version by ID Endpoint ✅
- Added endpoint to CSS backend for fetching individual versions by ID
- Endpoint: `GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/{versionId}`
- Enables efficient fetching of historical version snapshots without loading all versions
- Implementation details (in collaborative-state-system repo):
  - Route pattern uses UUID regex to avoid matching 'latest'
  - Handler validates version belongs to specified document and branch
  - Returns 404 if version not found or mismatched
- 6 new backend tests covering success and error scenarios
- Required for viewing historical versions in the Puck editor

### Phase 5e: Sidebar State Preservation ✅
- Fixed issue where CSS sidebar closed when switching documents or versions
- New `PuckDataSynchronizer` component:
  - Uses Puck's `usePuck().dispatch` to update internal data without remounting
  - Syncs external data to Puck when `syncKey` changes
  - Renders nothing (returns null), used purely for side effects
  - Rendered in headerActions override to access Puck context
- Updated `createCSSOverrides`:
  - Added `syncData` and `dataSyncKey` props
  - Integrates PuckDataSynchronizer into header actions
- Demo app updated:
  - Removed `key` prop from Puck (no longer needed)
  - Added `dataSyncKey` that changes when document or version changes
  - Passes `currentData` as `syncData` to overrides
- Added ResizeObserver polyfill to test setup for @puckeditor/core compatibility
- 5 new tests for PuckDataSynchronizer component

### Phase 5f: React 19 Compatibility Fix ✅
- Fixed `usePuck must be used inside <Puck>` error in React 19 environments
- **Problem**: React 19 is stricter about context errors than React 18. The demo app (React 18) showed warnings but continued working, while apps using React 19 crashed.
- **Root Cause**: `PuckDataSynchronizer` was rendered in `headerActions` override, which executes outside Puck's context provider during the initial render phase.
- **Solution**: Moved `PuckDataSynchronizer` from `createCSSOverrides` to `createCSSPlugin`:
  - Plugin's `render()` function is guaranteed to execute inside Puck's component tree
  - Added error boundary (`PuckContextErrorBoundary`) to catch and suppress context errors gracefully
  - Added deferred rendering with `setTimeout(0)` to ensure Puck's context is fully initialized
- Updated `PuckDataSynchronizer` component:
  - Split into inner component (`PuckDataSynchronizerInner`) that uses `usePuck()`
  - Wrapper component with `useState` defers rendering until after first tick
  - Error boundary wraps inner component to catch React 19 strict mode errors
  - Error boundary resets when `syncKey` changes, allowing retry on version switches
- API changes:
  - `createCSSPlugin()`: Added `syncData` and `dataSyncKey` props (new location)
  - `createCSSOverrides()`: Deprecated `syncData` and `dataSyncKey` props (ignored, kept for compatibility)
- Demo app updated to pass sync props to `createCSSPlugin` instead of `createCSSOverrides`
- Verified working in both React 18 (demo) and React 19 (my-app) environments

### Phase 6b: Save Flicker Fix ✅
- Fixed iframe reload/flicker issue triggered by auto-save operations
- **Problem**: When editing components, the save operation caused the Puck iframe to reload, breaking the user's editing flow and causing visible flicker.
- **Root Cause**: State changes after saves (`saveStatus`, `lastSaved`, `currentData`) were included in useMemo dependency arrays, causing `cssPlugin` and `cssOverrides` to be recreated on every save, which triggered Puck to remount.
- **Solution**: Implemented getter-based pattern to decouple state updates from object recreation:
  1. **CSSPuckProvider.tsx**: Removed `setCurrentData(dataToSave)` after saves - data is already in Puck's internal state
  2. **App.tsx (demo)**: Added refs for volatile state (`saveStatusRef`, `lastSavedRef`, `saveErrorRef`, `currentDataRef`) and stable getter functions
  3. **CSSPlugin.tsx**: Updated to accept `getHasUnsavedChanges` getter function instead of boolean
  4. **SaveIndicator.tsx**: Made backwards-compatible with both getter functions (new API) and direct props (legacy API). Uses 100ms polling interval to update UI while keeping parent stable
  5. **createCSSOverrides.tsx**: Made backwards-compatible with both `getSaveStatus`/`getLastSaved`/`getSaveError` getters (new API) and `saveStatus`/`lastSaved`/`saveError` direct props (legacy API)
- **API Changes**:
  - `createCSSOverrides()`: Added optional getter props (`getSaveStatus`, `getLastSaved`, `getSaveError`). Legacy direct props still work but cause flicker.
  - `SaveIndicator`: Added optional getter props (`getStatus`, `getLastSaved`, `getError`). Legacy direct props still work but cause flicker.
  - `CSSPluginOptions`: Changed `hasUnsavedChanges` to `getHasUnsavedChanges` getter function
- Verified fix with Playwright: iframe ref remains stable across multiple edits and saves

### Phase 6: Error Notification Component ✅
- Implemented toast-style notification system for errors and other messages
- New types in `types.ts`:
  - `NotificationSeverity` - 'error' | 'warning' | 'info' | 'success'
  - `NotificationAction` - Action buttons with label and onClick
  - `Notification` - Full notification object with id, message, severity, title, actions, autoDismissMs
  - `AddNotificationOptions` - Options for adding notifications
  - `NotificationContextValue` - Context value with notification methods
- New React context (`NotificationContext.tsx`):
  - `NotificationProvider` - Wraps app to provide notification state
  - `useNotifications` - Hook to access notification methods
  - Convenience methods: `addError`, `addSuccess`, `addWarning`, `addInfo`
  - Auto-dismiss timers (5s for success/info, manual dismiss for errors/warnings)
  - Max notifications limit (default 5)
- New components:
  - `Toast` - Single notification with icon, message, actions, dismiss button, progress bar
  - `NotificationContainer` - Fixed-position container for all notifications
    - 6 position options: top-right, top-left, top-center, bottom-right, bottom-left, bottom-center
    - Proper stacking and animations per position
- CSS styles added to `styles.css`:
  - Toast styling with severity-based colors and icons
  - Enter/exit animations with position-aware slide directions
  - Progress bar for auto-dismiss countdown
  - Accessibility-friendly with proper ARIA attributes
- Integration with `CSSPuckProvider`:
  - Now wraps children with `NotificationProvider`
  - Automatically shows error notifications on save failures with retry action
  - Exposes `notifications` object in context for manual notification control
  - Optional `showErrorNotifications` prop (default true)
- 38 new tests covering:
  - NotificationContext (13 tests) - adding, removing, auto-dismiss behavior
  - Toast component (16 tests) - rendering, actions, accessibility
  - NotificationContainer (9 tests) - positioning, multiple notifications

## Test Summary

| Package | Tests | Status |
|---------|-------|--------|
| @pantheon/css-client | 18 | ✅ Passing |
| @pantheon/puck-css | 179 | ✅ Passing |
| **Total** | **197** | ✅ **All Passing** |

## Key Decisions

1. **Data Storage**: Puck Data stored directly as document version snapshots
2. **Auto-Save**: 3-second debounce before creating new document versions
3. **Publish**: Creates checkpoints (named snapshots of all documents)
4. **Authentication**: Supports both API key and custom auth providers
5. **Branch Handling**: Branch selector UI with unsaved changes warning; defaults to main branch
6. **Error Handling**: Exponential backoff retry with configurable attempts
7. **Puck Integration**: Uses Puck 0.21's Plugin API for left rail and Overrides for header actions
8. **Optional Configuration**: Only baseUrl, apiKey, siteId, and userId are required; branchId is optional

## Remaining Work

### Phase 7: E2E Tests
- Playwright tests for full user flows
- Test auto-save behavior
- Test publish workflow
- Test branch switching

## How to Run

```bash
# Install dependencies
pnpm install

# Run tests
pnpm --filter @pantheon/css-client test
pnpm --filter @pantheon/puck-css test

# Build all packages
pnpm build

# Run demo app (development mode)
cd apps/demo
cp .env.example .env
# Edit .env with your CSS API credentials
pnpm dev
```

## Configuration

The demo app requires the following environment variables:

```env
VITE_CSS_BASE_URL=http://localhost:8787
VITE_CSS_API_KEY=your-api-key-here
VITE_CSS_SITE_ID=your-site-id
VITE_CSS_USER_ID=demo-user-id

# Optional - defaults to main branch if not set:
# VITE_CSS_BRANCH_ID=your-branch-id
```
