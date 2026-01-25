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

## Test Summary

| Package | Tests | Status |
|---------|-------|--------|
| @pantheon/css-client | 18 | ✅ Passing |
| @pantheon/puck-css | 124 | ✅ Passing |
| **Total** | **142** | ✅ **All Passing** |

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

### Phase 6: Error Notification Component
- Toast-style error notifications
- Auto-dismiss with retry option

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
