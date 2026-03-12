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
  - `DocumentsEndpoint` - Document CRUD (including `restore()` for archived documents)
  - `VersionsEndpoint` - Document version management
  - `CheckpointsEndpoint` - Checkpoint (publish) operations
- Authentication support (API key and custom providers)
- Principal-based request attribution via `withPrincipal()`
- Error classes for different API error types
- 18 tests passing

### Phase 2b: Document Restore Method (2026-01-25) ✅
- Added `documents.restore(siteId, documentId)` method to restore archived documents
- Used when creating pages from Content Publisher articles that were previously archived
- Calls `POST /api/sites/{siteId}/documents/{documentId}/restore` endpoint

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

### Phase 6c: Real-time Collaboration (Yjs CRDT Integration) ✅
- Implemented WebSocket-based real-time collaborative editing using Yjs CRDT
- **Frontend Components**:
  - `RealtimeClient` class (`@pantheon/css-client`) - WebSocket client managing Yjs Y.Doc sync
  - `useRealtime` hook (`@pantheon/puck-css`) - React hook for connection lifecycle management
  - `puckYjsBinding` utility - Bidirectional sync between Puck data and Yjs structures
- **Integration with CSSPuckProvider**:
  - New props: `enableRealtime`, `wsBaseUrl`, `realtimeApiKey`
  - Added `remoteSyncKey` to context for triggering Puck UI updates on remote changes
  - Added `realtimeEnabled` and `realtimeConnected` to context value
- **Bounce-back Loop Prevention**:
  - Problem: Remote updates triggered Puck's onChange → saveData → applyLocalChange → infinite loop
  - Solution: Track when processing remote updates with `isProcessingRemoteUpdateRef` flag
  - Skip `applyLocalChange` when flag is set; clear after 100ms timeout
- **Data Sync Fix**:
  - Problem: Puck UI not updating despite receiving remote data
  - Solution: Use `currentData` directly in cssPlugin useMemo instead of stale ref
  - `remoteSyncKey` changes on remote updates to trigger PuckDataSynchronizer
- Demo app updated:
  - Configurable via `VITE_CSS_ENABLE_REALTIME` and `VITE_CSS_WS_BASE_URL`
  - Bidirectional sync verified between multiple browser tabs

### Phase 6d: Version History Isolation Fix ✅
- Fixed bug where viewing historical versions would broadcast historical data to other users
- **Problem**: When User A loads a historical version from version history, the historical data was being broadcast to ALL other users via WebSocket, disrupting their editing sessions.
- **Root Cause**: In `saveData()`, when viewing a historical version and Puck fires `onChange`, the historical data was sent via `realtime.applyLocalChange(data)` because there was no check to block outgoing sync when viewing history.
- **Second Issue**: When returning to latest, `returnToLatest()` used `latestVersionData` which was captured when the document initially loaded. If other users made changes while User A was viewing history, those changes were lost.
- **Solution**:
  1. **Block outgoing sync when viewing history**: In `saveData()`, check `viewingVersionRef.current !== null` and skip `realtime.applyLocalChange()` to prevent historical data from being broadcast
  2. **Sync to current Yjs state on return**: In `returnToLatest()`, get current state from Yjs via `getSnapshot()` to capture any changes made by other users while viewing history
  3. **Added `getSnapshot()` to useRealtime hook**: Returns current Yjs document state as PuckData, or null when not connected
- **Files Modified**:
  - `packages/puck-css/src/hooks/useRealtime.ts` - Added `getSnapshot()` method
  - `packages/puck-css/src/CSSPuckProvider.tsx` - Updated `saveData()` and `returnToLatest()`
- **Tests Added**:
  - Unit tests: 4 new tests for `getSnapshot()` in `useRealtime.spec.tsx`
  - E2E tests: 2 new tests in `version-history.spec.ts` for version history isolation

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

---

## Agent Politeness Integration

Integration with the Collaborative State System's Agent Politeness APIs to enable respectful human-agent collaboration within the Puck Editor.

**Branch:** `feature/agent-politeness-integration`
**Plan Document:** `docs/AGENT_POLITENESS_FRONTEND_PLAN.md`

### Design Decisions (2026-01-27)

| # | Question | Decision |
|---|----------|----------|
| 1 | Presence mechanism | Hybrid (WebSocket + REST polling fallback) |
| 2 | Agent color assignment | Hash-based (derive from agent ID) |
| 3 | Focus region granularity | Hierarchical JSON paths with prefix matching |
| 4 | Kill switch permissions | Branch permission-based (EDITOR/ADMIN can kick) |
| 5 | Offline handling | 60-second grace period before presence removal |
| 6 | Agent list source | Fetched from API (organization agents endpoint) |

### Phase 1: API Client Extensions ✅

**Commits:** `b73444e` (TDD tests), `1b01e8d` (implementation)

New endpoints added to `@pantheon/css-client`:

- **PresenceEndpoint** (`src/endpoints/presence.ts`)
  - `getSitePresence(siteId)` - Site-level presence rollup
  - `getBranchPresence(siteId, branchId)` - Branch-level presence with actors
  - `getAgentPresence(orgId, agentId)` - Agent's global presence across org

- **AgentRegistryEndpoint** (`src/endpoints/agent-registry.ts`)
  - `list(orgId, options?)` - List agents with optional status filter
  - `get(orgId, agentId)` - Get agent by ID
  - `create(orgId, params)` - Create new agent
  - `update(orgId, agentId, params)` - Update agent properties
  - `updateStatus(orgId, agentId, status)` - Change agent status
  - `delete(orgId, agentId)` - Delete agent

- **AgentEditEndpoint** (`src/endpoints/agent-edit.ts`)
  - `canEdit(siteId, branchId, path, context)` - Check if agent can edit
  - `startEdit(siteId, branchId, path, context)` - Start edit session
  - `completeEdit(siteId, branchId, path, agentId)` - Complete edit
  - `abortEdit(siteId, branchId, path, agentId, checkpointId)` - Abort and rollback

New types added (20+):
- Presence: `ActorState`, `ActorRole`, `ActorPresence`, `BranchPresence`, `SitePresence`, `AgentGlobalPresence`
- Agent Registry: `AgentStatus`, `RegisteredAgent`, `CreateAgentParams`, `UpdateAgentParams`
- Agent Edit: `AgentTrigger`, `AgentEditContext`, `AgentEditPermission`, `AgentEditSession`

**Test Coverage:** 25 new tests, 100% coverage on new endpoints

### Phase 2: Presence Hooks ✅

**Commits:** TDD tests, implementation

New hooks added to `@pantheon/puck-css`:

- **usePresence** - Document-level presence with polling
  - Returns actors, editingActors, humans, agents
  - hasActiveHumans, hasActiveAgents flags
  - Self-filtering (exclude current user)
  - Configurable polling interval

- **useBranchPresence** - Branch-level presence summary
  - Returns presence rollup with document summary
  - Active document counts

- **useSitePresence** - Site-level presence rollup
  - Returns presence across all branches
  - Active branch summary

**Test Coverage:** 22 tests for presence hooks

### Phase 3: Presence UI Components ✅

New components for presence visualization:

- **CollaboratorAvatars** - Avatar stack showing present users
- **PresenceIndicator** - Compact presence badge/pill
- **AgentActivityBanner** - Banner showing agent editing status
- **FocusRegionHighlight** - Overlay for agent focus regions

### Phase 4: Agent Edit Workflow Hooks ✅

- **useAgentEdit** - Agent edit session management
  - canEdit, startEdit, completeEdit, abortEdit methods
  - Session tracking with isEditing flag

- **useAgentTrigger** - Human-triggered agent actions
  - triggerAgent function for starting agent workflows
  - Status tracking: idle, checking, starting, editing, completing, error

### Phase 5: Agent Action UI Components ✅

- **AgentActionButton** - Trigger agent actions
- **AgentActionModal** - Modal for agent action configuration
- **AgentStatusPanel** - Panel showing agent activity status

### Phase 6: Enhanced Version History ✅

- **VersionItem** - Version list item with agent attribution
- **AgentCheckpointBadge** - Badge for agent-created checkpoints

### Phase 7: Conflict Notification System ✅

- **useConflictNotifications** - Hook for conflict events
  - Tracks agent_editing, human_conflict, agent_checkpoint, agent_kicked events
  - Auto-dismiss for checkpoint notifications

- **ConflictNotificationToast** - Toast component for conflicts
  - Shows conflict type, affected regions, agent info

### Phase 8: Plugin Integration ✅

- Integrated presence and agent features into CSS Plugin
- Plugin shows presence indicators and agent activity
- Added authorization checks to presence API endpoints

### Phase 9: Provider Enhancement ✅

**Commits:** `0d4d9db` (TDD tests), `4703951` (implementation)

Enhanced `CSSPuckProvider` with presence and agent mode support:

**New Props (CSSPuckConfig):**
- `presenceEnabled` - Enable presence tracking (default: false)
- `presencePollingInterval` - Polling interval in ms (default: 5000)
- `userName`, `userAvatar` - Display info for presence
- `agentModeEnabled` - Enable agent mode features (default: false)
- `agentId` - When client IS an agent
- `agentTrigger` - Agent trigger type
- `onPresenceChange` - Callback when actors change
- `onAgentConflict` - Callback on conflict events

**New Context Values (CSSPuckContextValue):**
- `presence: PresenceState | null` - actors, humans, agents, hasActiveHumans, hasActiveAgents, refresh
- `agentEdit: UseAgentEditReturn | null` - Agent edit capabilities (when agentId set)
- `triggerAgent` - Function to trigger agent actions (when human user)
- `conflicts` - Active conflict notifications
- `dismissConflict` - Dismiss conflict by ID

**New Types:**
- `PresenceState` - Presence data structure with actors and derived values

**Test Coverage:** 24 tests for provider enhancement

**Demo App Update:** (commit `e7994e5`)
- Added `enablePresence` and `userName` to config
- Extract `presence` from `useCSSPuck()` hook
- Pass presence props to `createCSSOverrides`:
  - `showCollaboratorAvatars` - Shows avatars when presence enabled
  - `presence` - Array of actors for avatar display
  - `showAgentActivityBanner` - Shows banner when agents are active
  - `activeAgents` - Agent actors for banner
  - `isAgentEditing` - Flag for agent editing state
- Added `presenceEnabled` and `userName` props to `CSSPuckProvider`

### Agent Politeness Integration Summary

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | API Client Extensions | ✅ Complete |
| 2 | Presence Hooks | ✅ Complete |
| 3 | Presence UI Components | ✅ Complete |
| 4 | Agent Edit Workflow Hooks | ✅ Complete |
| 5 | Agent Action UI Components | ✅ Complete |
| 6 | Enhanced Version History | ✅ Complete |
| 7 | Conflict Notification System | ✅ Complete |
| 8 | Plugin Integration | ✅ Complete |
| 9 | Provider Enhancement | ✅ Complete |

### Proactive Focus Region Reporting (2026-01-29) ✅

**Feature Overview:** Enables humans to report which components they have selected in the editor, even before making edits. This allows agents to avoid editing regions where a human has focus, preventing conflicts proactively.

**Phase 2: CSS Client (commits `d07a703`, `615a470`)**
- Added `UpdateFocusRegionsResponse` type to types.ts
- Added `updateFocusRegions()` method to PresenceEndpoint
- POST to `/api/sites/{siteId}/branches/{branchId}/documents/{path}/focus-regions`
- URL-encodes document path, includes `X-Actor-Type: user` header
- 9 new tests for presence endpoint

**Phase 3: Puck CSS (commits `676755b`, `5fc19fa`, `3566e6c`)**

*useFocusRegionReporting hook:*
- Manages debounced reporting of focus regions to backend (default: 300ms)
- Heartbeat interval (default: 15s) to keep focus alive
- Automatic cleanup on unmount (sends empty array)
- Deduplication to avoid redundant API calls
- Error handling (silent failures - focus is not critical)

*PuckSelectionTracker component:*
- Renders inside Puck context (via plugin) to access usePuck hook
- Converts Puck's itemSelector to JSON path format
- Handles content zone (`/content/N`) and nested zones (`/zones/X/Y/N`)
- Calls onSelectionChange when selection changes

*CSSPlugin Integration:*
- Added `PuckSelectionTracker` to CSSPlugin render function
- Added `onSelectionChange` callback prop to `CSSPluginOptions`
- Selection tracking runs inside Puck context (via plugin)

**Test Coverage:** 19 new tests for focus region reporting

**Demo App Integration (commit `6513c2a`):**
- Wired up focus region reporting in demo app
- Added `useFocusRegionReporting` hook to `AppContent` component
- Created `handleSelectionChange` callback that reports selection to backend
- Passed `onSelectionChange` to `createCSSPlugin` when presence is enabled
- Exported `useFocusRegionReporting` and types from puck-css package index
- Fixed TypeScript errors for null documentPath and undefined zone/index

**Usage:**
```tsx
// In your Puck configuration
const { setFocusRegions, clearFocus } = useFocusRegionReporting();

const plugin = createCSSPlugin({
  // ... other options
  onSelectionChange: (path, itemId) => {
    if (path) {
      setFocusRegions([path]);
    } else {
      clearFocus();
    }
  },
});
```

### Realtime Sync Architecture Fix (2026-01-29) ✅

**Issue:** Remote updates received via WebSocket were syncing to Puck's internal Yjs document but not updating the React UI. PuckDataSynchronizer was receiving `syncKey: null` due to a race condition in the demo app.

**Root Cause:** The demo app's `AppContent` component was computing `dataSyncKey` from `remoteSyncKey`, but React's state update timing caused the key to become null before PuckDataSynchronizer could dispatch to Puck. This was a fundamental architectural issue - sync logic was in the wrong layer.

**Solution (commit `9f598f7`):**
- Created `ContextSyncBridge` component in `CSSPlugin.tsx` that reads sync state directly from `CSSPuckContext`
- Moved all sync logic from demo app to the puck-css integration layer
- Added `useContextSync` option (default: true) to createCSSPlugin
- ContextSyncBridge computes dataSyncKey and renders PuckDataSynchronizer internally

**Files Changed:**
- `packages/puck-css/src/plugin/CSSPlugin.tsx` - Added ContextSyncBridge component (+65 lines)
- `packages/puck-css/src/CSSPuckProvider.tsx` - Minor cleanup
- `apps/demo/src/App.tsx` - Removed sync-related props and computation (-30 lines)
- `e2e/version-history.spec.ts` - Added console log filters for debugging

**Key Design Principle:** Reliable sync logic belongs in the integration layer (puck-css), not in consuming applications. This ensures consistent behavior across all apps using the integration.

### Realtime Sync React Safety Fix (2026-01-29) ✅

**Issue:** The previous fix (commit `9f598f7`) introduced a new bug where realtime sync between browsers stopped working. The fix tracked `lastSyncedKey` as a side effect during render in `ContextSyncBridge`, which is unsafe with React's concurrent features and strict mode.

**Root Cause:** When React re-renders components (strict mode double-render, concurrent features), the render-phase side effect would set `lastSyncedKey` before the actual dispatch happened. On subsequent renders, the key was already "synced" but the dispatch never occurred, causing remote updates to be silently dropped.

**Solution (commit `7a17673`):**
- Moved module-level tracking (`lastSyncedKeyModule`) from `CSSPlugin.tsx` to `PuckDataSynchronizer.tsx`
- Track sync state inside `useEffect` instead of during render (React-safe)
- `ContextSyncBridge` now passes through sync key without any side effects
- Added `_resetSyncTracking()` function for test isolation

**Files Changed:**
- `packages/puck-css/src/components/PuckDataSynchronizer.tsx` - Added module-level tracking in useEffect (+23 lines)
- `packages/puck-css/src/plugin/CSSPlugin.tsx` - Removed render-phase side effects (-15 lines)
- `packages/puck-css/tests/PuckDataSynchronizer.spec.tsx` - Added test isolation via reset function

**Key Lesson:** Never update module-level state during render in React. Side effects belong in `useEffect` to work correctly with concurrent features and strict mode.

### Server-Side Bot Edit Authorization & Focus Region Highlighting (2026-01-29) ✅

Two related features to improve collaborative editing security and visibility.

#### Feature 1: Server-Side Bot Edit Authorization

**Problem:** The Agent Politeness Protocol exists (`canEdit` → `startEdit` → `completeEdit`) but was advisory only. Agents could bypass it and send WebSocket/REST updates directly without authorization.

**Solution:** Added `sessionId` credential passing from client to server, enabling server-side enforcement.

**Phase 1A: RealtimeClient Session Authorization (commits `eb7ed90`, `7ddb4fb`)**
- Added `sessionId?: string` to `ConnectionParams` interface
- Pass `sessionId` as query param in `connect()` for agent connections
- Added `onAuthorizationError?: (error: Error) => void` callback to config
- Handle WebSocket close codes 4401/4403 as authorization failures
- 10 new tests for session handling

**Phase 1B: Client-Level Session Authorization (commits `59b9b18`, `1ba439e`)**
- Added `withSessionId(sessionId: string): CSSClient` method to `CSSClient`
- Creates new client instance with `X-Agent-Session-Id` header attached
- Follows existing `withPrincipal()` immutable pattern
- Added `sessionId` tracking to `BaseEndpoint` class
- 4 new tests for session header handling

**Phase 2: useAgentEdit Session Tracking (commits `7d9b789`, `9faf942`)**
- Added `sessionId: string | null` property to `UseAgentEditReturn` interface
- Tracks sessionId from `startEdit()` response, clears on `completeEdit()` or `abortEdit()`
- Added `sessionId?: string` to `UseRealtimeParams` for passing to WebSocket
- 7 new tests for session integration

#### Feature 2: Focus Region Visual Highlighting

**Problem:** `FocusRegionHighlight` component existed but rendered empty divs - no actual visual highlighting of what other users are editing.

**Solution:** Follow the existing `createHighlightedConfig()` pattern - wrap component render functions to add highlight overlays.

**Phase 3A: focusRegionMap Utilities (commits `072d037`, `4cffa45`, `559e0c8`)**
- New file: `packages/puck-css/src/utils/focusRegionMap.ts`
- `pathToComponentId(data, path)` - Converts focus region path to component ID
  - Supports `/content/N` for root content array
  - Supports `/root/default-zone/N` for Puck's internal root zone format (added `559e0c8`)
  - Supports `/zones/ZoneName/N` for nested zones (e.g., `/zones/Header:left/0`)
- `createFocusRegionMap(data, actors)` - Creates Map<componentId, FocusHighlight> from actor presence
- `generateActorColor(actorId)` - Generates consistent hex color from actor ID using djb2 hash (matches avatar colors in CollaboratorAvatars)
- `FocusHighlight` type with actorId, actorName, color, isEditing
- 29 new tests for mapping utilities

**Phase 3B: focusHighlightConfig Wrapper (commits `afb6cb2`, `cba8fa5`)**
- New file: `packages/puck-css/src/utils/focusHighlightConfig.ts`
- `createFocusHighlightConfig(config, focusMap)` - Wraps Puck component render functions
- Adds highlight wrapper div with:
  - CSS class `focus-region-highlight` (or `focus-region-highlight--editing`)
  - CSS variable `--focus-color` with actor's color
  - Data attribute `data-actor-id` for identification
  - Badge element showing actor's initial
- Preserves all other component config properties (fields, defaultProps, etc.)
- 15 new tests for config wrapping

**Phase 4: CSS Styles, Exports, Demo Integration (commit `31967a0`)**
- Added focus region CSS to `packages/puck-css/src/styles.css`:
  - `.focus-region-highlight` - Colored outline with CSS variable
  - `.focus-region-highlight--editing` - Thicker outline with pulsing animation
  - `.focus-region-highlight__badge` - Circular badge showing actor initial
- Exported utilities from `packages/puck-css/src/index.ts`:
  - `pathToComponentId`, `createFocusRegionMap`, `generateActorColor`
  - `FocusHighlight` type
  - `createFocusHighlightConfig`
- Integrated into demo app (`apps/demo/src/App.tsx`):
  - Uses `usePresenceContext()` to get current user ID
  - Creates `focusMap` from other actors' focus regions
  - Wraps config with `createFocusHighlightConfig()` when focusMap has entries
  - Focus highlighting chains with historical version highlighting

**Files Summary:**

| File | Changes |
|------|---------|
| `packages/css-client/src/realtime.ts` | sessionId in ConnectionParams, onAuthorizationError callback |
| `packages/css-client/src/endpoints/base.ts` | sessionId tracking, withSessionId method |
| `packages/css-client/src/client.ts` | withSessionId method |
| `packages/puck-css/src/hooks/useAgentEdit.ts` | sessionId property |
| `packages/puck-css/src/hooks/useRealtime.ts` | sessionId parameter |
| `packages/puck-css/src/utils/focusRegionMap.ts` | NEW - Path-to-ID mapping, focus map creation |
| `packages/puck-css/src/utils/focusHighlightConfig.ts` | NEW - Config wrapper for highlighting |
| `packages/puck-css/src/styles.css` | Focus highlight CSS styles |
| `packages/puck-css/src/index.ts` | New exports |
| `apps/demo/src/App.tsx` | Focus highlighting integration |

**Test Files:**
- `packages/css-client/tests/realtime-session.spec.ts` - 10 tests
- `packages/css-client/tests/versions-session.spec.ts` - 4 tests
- `packages/puck-css/tests/agent-session-integration.spec.ts` - 7 tests
- `packages/puck-css/tests/focusRegionMap.spec.ts` - 32 tests (29 + 3 for root zone format)
- `packages/puck-css/tests/focusHighlightConfig.spec.ts` - 15 tests

**Verified Working (2026-01-30):**
- **Focus Region Visual Highlighting** is fully operational:
  - Backend correctly stores focus regions via POST `/documents/{path}/focus-regions`
  - Backend correctly returns `focusRegions` arrays in the branch-level presence response
  - Frontend displays colored highlight borders and avatar badges on components where other users have focus
  - Path formats supported: `/content/N`, `/root/default-zone/N` (Puck internal), `/zones/ZoneName/N`
  - Tested with two separate browser tabs: Alice's focus on Heading component visible to Bob as colored highlight with "A" badge
  - Focus highlight colors now match avatar colors (commit `f358940`) - uses same djb2 hash algorithm as CollaboratorAvatars

### WebSocket-Based Presence (2026-01-30) - In Progress

Moving presence updates from HTTP polling to WebSocket messaging for real-time presence with near-zero HTTP overhead.

**Impact:**
- Presence HTTP requests: ~24 req/min → ~0 req/min (when WS connected)
- Focus region HTTP POSTs: ~8 req/min → ~0 req/min (when WS connected)
- Latency: 144ms polling delay → instant push updates
- HTTP fallback maintained for when WebSocket disconnects

**Phase 1: Add WebSocket message types (css-client) ✅**
- Added `WsFocusRegionUpdateMessage`, `WsPresenceHeartbeatMessage` (client→server)
- Added `WsPresenceUpdateMessage`, `WsFocusRegionBroadcastMessage`, `WsFocusRegionAckMessage`, `WsPresenceErrorMessage` (server→client)
- Union types: `WsClientMessage`, `WsServerMessage`

**Phase 2: Extend RealtimeClient (css-client) ✅**
- Added text vs binary message detection in handler
- Added `handleTextMessage()` for JSON presence messages
- Added `sendFocusRegions(focusRegions: string[]): boolean` method
- Added `sendHeartbeat(state?: ActorState): void` method
- Added `presenceViaWebSocket` getter property
- Added `onPresenceUpdate` and `onFocusRegionBroadcast` callbacks to config
- 11 new tests for WebSocket presence

**Phase 3: Extend useRealtime Hook (puck-css) ✅**
- Added `onPresenceUpdate` and `onFocusRegionBroadcast` to UseRealtimeParams
- Added `sendFocusRegions`, `sendHeartbeat`, `presenceViaWebSocket` to UseRealtimeReturn
- Callback refs pattern to avoid recreating callbacks
- 12 new tests for hook presence features

**Phase 4: Update CSSPuckProvider (puck-css) ✅** (commit `6951601`)
- Added WebSocket presence state (`wsPresenceActors`, `wsPresenceActiveRef`)
- Wired up `onPresenceUpdate` and `onFocusRegionBroadcast` callbacks to useRealtime
- Prefer WebSocket presence over HTTP polling when connected
- HTTP polling continues as fallback when WebSocket disconnects
- Added `sendFocusRegions` to CSSPuckContext for components to use
- Added `actors` property to PresenceContextValue for consistency
- Stability fix for presence hooks: use refs to avoid restarting polling intervals
- 4 tests for provider WebSocket presence integration

**Phase 5: Update useFocusRegionReporting (puck-css) ✅** (commits `7e5729b` tests, `c05d156` impl)
- Added `sendViaWebSocket` option to UseFocusRegionReportingOptions interface
- Try WebSocket first in reportFocusRegions, fall back to HTTP when WebSocket returns false
- Try WebSocket first on unmount cleanup, fall back to HTTP
- Use ref pattern for sendViaWebSocket to avoid callback recreation
- Heartbeat, clearFocus, and normal reporting all use WebSocket-first approach
- 8 new tests for WebSocket-first focus region reporting

**Phase 6-7: DocumentSession WebSocket Presence (server) ✅** (commits in collaborative-state-system)
- Added WebSocket message types: `WsFocusRegionUpdateMessage`, `WsPresenceHeartbeatMessage`, `WsPresenceUpdateMessage`, `WsFocusRegionBroadcastMessage`, `WsFocusRegionAckMessage`, `WsPresenceErrorMessage`
- Added type guards: `isWsClientMessage`, `isWsFocusRegionUpdate`, `isWsPresenceHeartbeat`
- DocumentSession text message handling: `handlePresenceMessage` routes based on message type
- `handleWsFocusRegionUpdate` with validation, ACK, and broadcast to other clients
- `handleWsPresenceHeartbeat` for keep-alive and optional state update
- `broadcastPresenceUpdate` on connect/disconnect for full presence sync
- 18 message type tests + 29 DO presence tests
- 1711 total server tests passing

**WebSocket Presence Implementation: COMPLETE ✅**

All phases completed across both repositories:
- Client (puck-css-integration): Phases 1-5 ✅
- Server (collaborative-state-system): Phases 6-7 ✅

**Bug Fixes (2026-01-30):**

1. **WebSocket Focus Region Wiring** (commit `4669ce8`)
   - Demo app wasn't passing `sendFocusRegions` from context to `useFocusRegionReporting`
   - Fixed by wiring `sendFocusRegionsViaWs` from `useCSSPuck()` to the hook's `sendViaWebSocket` option
   - HTTP polling for focus regions now properly bypassed when WebSocket is connected

2. **Edit Flicker Fix** (commit `c424064`)
   - Typing in editor caused flickering on all browsers
   - Root cause: `focusMap` recalculated on every keystroke because it depended on `currentData`
   - Config recreation triggered Puck full re-render
   - Fixed by caching data for focus mapping in a ref, only updating when presence changes

3. **Focus Region Highlight Flicker Fix** (commit `2f9ee49`)
   - Selecting components caused flickering of focus highlights AND Puck's native UI (selection controls, tabs)
   - Root cause: `createFocusHighlightConfig` created new config with new render wrappers on every focusMap change
   - Puck detected config change via referential equality → full re-render
   - **Solution: Context-based focus highlighting**
     - Created `FocusHighlightContext` to provide focusMap dynamically
     - Updated `createFocusHighlightConfig` to create stable wrappers that read from context
     - Wrapped Puck with `FocusHighlightProvider` that receives focusMap
     - Config is now stable; only context updates on focus change → no Puck re-render

4. **Echo Overwrite Bug Fix** (2026-01-30)
   - **Problem**: When typing in the editor, text would be overwritten/truncated (e.g., typing "BEEP BOOP" resulted in "BEEP BOO")
   - **Root cause analysis**:
     - Initially suspected server was echoing updates back to sender
     - Server actually uses `conn !== server` check - it does NOT echo back to sender
     - Real issue: When Page2 received a remote update, it would trigger Puck onChange events
     - If multiple onChange events fired (from data prop change AND setData dispatch), the counter-based skip logic would only catch the first
     - Second onChange would call `applyLocalChange`, sending update back to server
     - Server broadcast this to Page1, overwriting the editor's current state
   - **Solution**: Dual-layer protection in `CSSPuckProvider`:
     - Added `isApplyingRemoteSyncRef` flag set before `setCurrentData` and cleared after 100ms
     - `saveData` checks flag first (catches all onChange during sync period)
     - Counter still used as backup for edge cases (returnToLatest, etc.)
     - Added `isApplyingLocalChange` flag in `puckYjsBinding` as additional safeguard
   - **Files modified**:
     - `packages/puck-css/src/CSSPuckProvider.tsx` - Flag-based remote sync protection
     - `packages/puck-css/src/utils/puckYjsBinding.ts` - Local change flag in observer
   - **Tests added**:
     - "editor should not have text echoed back during typing" - Verifies editor doesn't lose characters
     - "passive viewer should receive complete text without truncation" - Verifies full sync to viewer
   - All 507 unit tests + 15 E2E tests passing

5. **Agent Activity Banner Not Displaying** (2026-01-30)
   - **Problem**: The AgentActivityBanner was not displaying when agents made edits
   - **Root cause**: Server-side bug in `collaborative-state-system`
     - When agents called `/agent-edit-start`, they were registered with `state: 'active'` instead of `state: 'editing'`
     - Client filters for `hasActiveAgents` using `state === 'active' || state === 'editing'`
     - Client only shows banner when `isAgentEditing` is true (agents in 'editing' state)
     - Additionally, no `presence_update` was broadcast to WebSocket clients when agents started editing
   - **Solution** (commit `11d1dab` in collaborative-state-system):
     - Added optional `state` parameter to `PresenceManager.register()` in `presence-service.ts`
     - Updated `handleAgentEditStart` to pass `state: 'editing'` and `intent` when registering agents
     - Added `broadcastPresenceUpdate()` calls after agent-edit-start, complete, abort, and kick operations
     - All WebSocket clients now receive instant presence updates when agents start/stop editing
   - **Files modified (server)**:
     - `workers/src/services/presence-service.ts` - Added state parameter to register
     - `workers/src/durable-objects/document-session.ts` - Set editing state and broadcast updates
   - **Tests**: All 42 presence service tests + 35 agent politeness tests + 18 WS presence tests passing

### Agent Activity Region Highlighting Verification (2026-01-30) ✅

**Feature:** Show visual highlights on document regions where agents are actively editing, using the same highlighting system as human focus regions.

**Verification Summary:**

The feature was already fully implemented. Verification confirmed the complete flow:

**MCP → Server Flow:**
1. ✅ MCP tool `start_edit_session` receives `target_regions` from Claude
2. ✅ API client sends `X-Agent-Target-Regions` header (`api-client.ts:238`)
3. ✅ Server parses header into `targetRegions`
4. ✅ Server calls `presenceManager.register({ focusRegions: targetRegions })` (`document-session.ts:2367`)
5. ✅ Server broadcasts `presence_update` to WebSocket clients (`document-session.ts:2372`)

**Client Display Flow:**
1. ✅ Client receives `presence_update` with agent's `focusRegions`
2. ✅ Demo app creates `focusMap` from all actors including agents (`App.tsx:286-287`)
3. ✅ `createFocusHighlightConfig` wraps Puck components with highlights
4. ✅ Agent's focused regions highlighted with consistent hash-based color

**Test Coverage:**
- 30 focusRegionMap tests (including agent actor `agent-optimizer`)
- 12 focusHighlightConfig tests
- All 618 unit tests passing

**Design Decision:** Agents use the same hash-based color scheme as humans (no visual differentiation) per user preference.

**E2E Tests Added (commit `TBD`):**
- Created `e2e/agent-highlighting.spec.ts` with 8 comprehensive tests:
  1. Agent presence should be registered when starting edit session
  2. Agent highlight should appear in human user browser
  3. Agent highlight should disappear when agent completes editing
  4. Multiple region highlights should appear for multi-region agent edit
  5. Agent highlight should have consistent hash-based color
  6. Debug: verify human and agent highlights work the same
  7. Debug: check presence API response
  8. Debug: check WebSocket presence broadcast
- Uses two test agents to avoid session conflicts:
  - Primary: `a0000000-0000-0000-0000-000000000001` (Zappy AI Assistant)
  - Secondary: `a0000000-0000-0000-0000-000000000002` (Helper Bot)
- Tests verify:
  - Agent starts edit session via `/agent-edit-start` API
  - Agent appears in branch presence with correct `focusRegions` and `state: 'editing'`
  - Focus highlight appears inside Puck iframe with `data-actor-id` attribute
  - `AgentActivityBanner` appears in main page
  - Highlight uses hash-based color matching avatar system

---

### Presence User Name Resolution (2026-02-03) ✅

**Problem:** Presence indicators (avatars, activity banners) showed the first character of user UUIDs instead of user names, since the backend only stores and returns actor UUIDs.

**Solution:** Added `userNameResolver` prop to allow frontend-side name resolution.

**Implementation:**

1. **Types** (`types.ts`):
   - Added `userNameResolver?: (actorId: string) => string | undefined` to `CSSPuckConfig`
   - Called with actor's UUID, returns display name or undefined to use default

2. **Provider** (`CSSPuckProvider.tsx`):
   - Added `enrichActorsWithNames` helper function
   - Applied to both WebSocket presence updates and HTTP polling responses
   - Enriched actors have `name` property set from resolver

3. **Demo App** (`App.tsx`):
   - Added resolver that looks up names from `DEMO_USERS` array:
     ```typescript
     userNameResolver={(id) => DEMO_USERS.find(u => u.id === id)?.name}
     ```

**Design Decision:** Keep UUID-only transport at the API level; name resolution is a UI concern handled at the integration layer.

---

### Stop Agent Feature (2026-02-04) ✅

**Feature:** Allow human users to stop an agent's current edit session, rolling back any changes the agent made since starting the session.

**Status:** Complete (frontend + backend)

**Implementation:**

1. **css-client** (commits `4662ef7` tests, `38b829b` impl):
   - Added `AgentStopResult` type: `{ success: boolean, rolledBack: boolean, message?: string }`
   - Added `stopAgent(siteId, branchId, documentPath, agentId)` method to `AgentEditEndpoint`
   - Calls `POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/agent-stop`

2. **puck-css** (commits `ad44268` tests, `8b82ae0` impl):
   - Added `onStopAgent?: (agent: ActorPresence) => void` to `CSSOverridesOptions`
   - Wired callback through to `AgentActivityBanner` component
   - Button already existed in component; now receives the callback

3. **demo app** (commit `13bcd8e`):
   - Added `handleStopAgent` callback in `AppContent`
   - Calls `client.agentEdit.stopAgent()` when user clicks "Stop Agent" button
   - Logs result to console

4. **Backend** (collaborative-state-system):
   - **DocumentSession DO** (`document-session.ts`):
     - Added `/agent-stop` route handler
     - Added `handleAgentStop()` method that finds session by agentId and rolls back
   - **Worker Router** (`index.ts`):
     - Added `agent-stop` to `realtimeActions` regex pattern
   - **Realtime API Routes** (`realtime-api.ts`) - Bug fix 2026-02-04:
     - Added `agent-stop` to `actionPattern` string (was missing, causing 405 errors)
     - Added `agent-stop` to `RouteParams.action` type
     - Added `validateAgentStopBody()` validation function
     - Added handler for `params.action === 'agent-stop'`

**Endpoint:**

```
POST /api/sites/{siteId}/branches/{branchId}/documents/{path}/agent-stop
Body: { agentId: string, reason?: string }
Response: { success: boolean, rolledBack: boolean, message?: string }
```

Server logic:
1. Look up agent's active session by `agentId`
2. If no session: return `{ success: true, rolledBack: false, message: "No active session" }`
3. If session exists:
   - Retrieve stored `checkpointId`
   - Roll back document to checkpoint
   - Clear agent's session and presence
   - Broadcast presence update
   - Return `{ success: true, rolledBack: true }`

**Tests:**
- 5 new tests in `agent-politeness.spec.ts` for `stopAgent` method (all passing)
- 1 new test in `plugin-integration.spec.tsx` for `onStopAgent` option
- 5 new E2E tests in `e2e/agent-highlighting.spec.ts` - "Stop Agent Feature" describe block:
  - `Stop Agent button appears when agent is editing`
  - `clicking Stop Agent button removes agent banner and stops session`
  - `Stop Agent API returns success with rolledBack=true for active session`
  - `Stop Agent API returns success with rolledBack=false when no active session`
  - `agent highlight disappears after Stop Agent`

---

## Test Summary

| Package | Tests | Status |
|---------|-------|--------|
| @pantheon/css-client | 111 | ✅ Passing |
| @pantheon/puck-css | 507 | ✅ Passing |
| E2E (Playwright) | 23 | ✅ Passing |
| **Total** | **641** | ✅ **All Passing** |

*E2E test breakdown: 15 existing + 8 agent-highlighting tests*

### Test Coverage (2026-01-25)

#### @pantheon/css-client (72.53% lines)
| Metric | Coverage |
|--------|----------|
| Statements | 72.53% |
| Branches | 64.00% |
| Functions | 67.79% |
| Lines | 72.53% |

#### @pantheon/puck-css (69.29% lines)
| Metric | Coverage |
|--------|----------|
| Statements | 69.29% |
| Branches | 88.09% |
| Functions | 72.89% |
| Lines | 69.29% |

### Test Coverage Gaps

#### High Priority (0% coverage - need tests)

**css-client:**
- `src/auth.ts` - Authentication utilities (0%)
- `src/index.ts` - Entry point/exports (0%)

**puck-css:**
- `src/hooks/useAutoSave.ts` - Auto-save hook (0%)
- `src/hooks/useBranches.ts` - Branch management hook (0%)
- `src/hooks/useCheckpoints.ts` - Checkpoint management hook (0%)
- `src/hooks/useVersions.ts` - Version history hook (0%)
- `src/components/BranchSelector.tsx` - Branch switching UI (0%)

#### Medium Priority (partial coverage)

**css-client:**
- `src/endpoints/checkpoints.ts` - 53.21% (methods: `list`, `getById`)
- `src/endpoints/documents.ts` - 62.93% (methods: `update`, `archive`, `restore`)
- `src/endpoints/versions.ts` - 60.81% (methods: `list`, `getById`, `getLatest`)

**puck-css:**
- `src/components/PublishButton.tsx` - 42.69% (publish flow, loading states)
- `src/components/SavingIndicator.tsx` - 37.08% (status display states)
- `src/components/PuckDataSynchronizer.tsx` - 50.64% (all tests now passing)
- `src/CSSPuckProvider.tsx` - 64.61% (error handling, branch switching)

#### Previously Failing Tests (now fixed)

- `tests/PuckDataSynchronizer.spec.tsx` - All 7 tests passing ✅
  - Fixed via module-level sync tracking with `_resetSyncTracking()` for test isolation

## Key Decisions

1. **Data Storage**: Puck Data stored directly as document version snapshots
2. **Auto-Save**: 3-second debounce before creating new document versions
3. **Publish**: Creates checkpoints (named snapshots of all documents)
4. **Authentication**: Supports both API key and custom auth providers
5. **Branch Handling**: Branch selector UI with unsaved changes warning; defaults to main branch
6. **Error Handling**: Exponential backoff retry with configurable attempts
7. **Puck Integration**: Uses Puck 0.21's Plugin API for left rail and Overrides for header actions
8. **Optional Configuration**: Only baseUrl, apiKey, siteId, and userId are required; branchId is optional

### v0.1.1 Patch Release (2026-02-23) ✅

**Release:** [v0.1.1](https://github.com/pantheon-systems/puck-css-integration/releases/tag/v0.1.1)

**Changes:**
- Removed stale `@ts-expect-error` on Auth0 dynamic import in `@pantheon/css-client` (types now resolve correctly)
- Made `puckYjsBinding.destroy()` idempotent in `@pantheon/puck-css` to prevent errors during React strict mode double-unmount

**Distribution:**
- Switched from checked-in tarballs to GitHub Releases for distribution
- Tarballs attached to the GitHub release as downloadable assets
- `.gitignore` continues to exclude `*.tgz` from version control

---

### Client-Side Optimizations for Wave 2 Backend (2026-03-02)

Corresponding client-side updates for the collaborative-state-system Wave 2 scaling optimizations (backend PR #23).

#### Item 4: Remove Debug Console.log Statements ✅

**Commit:** `799ae41`

Removed 14 debug `console.log` statements from production code:
- `packages/css-client/src/realtime.ts` — 9 statements removed
- `packages/puck-css/src/hooks/useFocusRegionReporting.ts` — 5 statements removed
- Kept `console.warn` for unknown message types and `console.error` for genuine errors
- Zero behavioral change, no test modifications needed

#### Item 3: Increase Presence Polling Intervals ✅

**Commits:** `9fd5080` (tests), `882a723` (implementation)

Increased default polling interval from 5000ms to 10000ms for all three presence hooks:
- `usePresence` — `packages/puck-css/src/hooks/usePresence.ts`
- `useBranchPresence` — `packages/puck-css/src/hooks/useBranchPresence.ts`
- `useSitePresence` — `packages/puck-css/src/hooks/useSitePresence.ts`

Impact: 50% reduction in presence REST API calls. WebSocket-based presence remains the primary real-time channel. `pollingInterval` prop override still works.

**Tests:** 6 new tests in `presence-polling-defaults.spec.ts` (697 total passing)

#### Item 1: Delta Encoding on WebSocket Reconnect ✅

**Commits:** `394ebf1` (tests), `61f5af9` (implementation)

Changed `connect()` in RealtimeClient to pass a URL provider function to PartySocket instead of a static URL string. On initial connect, returns the base URL without state vector. On reconnect (`hasConnectedOnce === true`), appends `stateVector` query parameter with base64-encoded `Y.encodeStateVector()` so the server responds with only the delta.

- Existing reconnect behavior (sending local state back to server) preserved
- Impact: reconnect payload reduced from full CRDT history to only changes since disconnect
- Significant for large documents (2,000+ components) and tab-backgrounding scenarios

**Tests:** 5 new tests in `realtime-delta-encoding.spec.ts` (136 css-client tests total)

#### Item 2: Client-Side Message Rate Awareness ✅

**Commits:** `4b3345b` (tests), `8ab8bd7` (implementation)

Added sliding-window rate limiter to `RealtimeClient`:
- Threshold at 40 msgs/sec (server limit is 50); normal editing sends immediately with zero latency
- Excess updates buffered and coalesced via `Y.mergeUpdates()`, flushed after 1s window resets
- Both `ydoc.on('update')` listener and `applyLocalUpdate()` use rate-aware sending
- `RATE_LIMITED` server error handled gracefully via `onRateLimited` callback without disconnect
- Rate state cleaned up on `disconnect()`

**Tests:** 8 new tests in `realtime-rate-awareness.spec.ts` (144 css-client tests total)

---

### Known Issue: Demo App Missing Focus Region Highlight Wiring

The demo app (`apps/demo`) does not render focus region overlay badges for collaborators. The infrastructure exists in `@pantheon/puck-css` (exported utilities `createFocusHighlightConfig`, `createFocusRegionMap`, and `FocusHighlightProvider`), and the WebSocket connection correctly receives focus region data via `onFocusRegionBroadcast`. However, the demo app does not wire these rendering components into the Puck editor — unlike the reference implementation in `my-app` which uses all three. This is a pre-existing gap, not a regression from the client optimization work.

To enable focus highlighting in the demo, the following would need to be added:
1. Call `createFocusHighlightConfig(puckConfig)` to wrap component renders
2. Call `createFocusRegionMap(currentData, otherActors)` to map focus paths to component IDs
3. Wrap `<Puck>` with `<FocusHighlightProvider focusMap={focusMap}>`
4. Use `useFocusRegionReporting()` to report local selection changes
5. Wire a selection change handler into the CSS plugin

---

### Content Delivery: CSSContentClient + Subpath Exports (2026-03-07) ✅

#### CSSContentClient (`@pantheon/css-client/content`)
- Server-side content delivery client for reading published content
- Uses `X-API-Key` header with `sat_` tokens (service principal auth)
- `getPage(path, branch?)` — fetch a single document's content by path
- `getPagePaths(branch?)` — list all page paths on a branch
- 404 → `null`, errors → `CSSApiError`
- Zero browser dependencies — works in Node 18+, Deno, Bun, Workers
- 11 tests in `packages/css-client/tests/content.spec.ts`

#### Subpath Exports
- `@pantheon/css-client/content` — server-only CSSContentClient import (avoids pulling in browser OAuth deps)
- `@pantheon/puck-css/config` — `createCSSConfig` for server-side imports (avoids Turbopack RSC resolution failure through Puck barrel)
- `@pantheon/puck-css/utils/path` — `toCSSPath` for server-side imports
- `typesVersions` added to both packages for `moduleResolution: "node"` compatibility

#### Downstream Integration (my-app)
- Render path: server-side `getContentClient().getPage()` replaces client-side `CSSRenderProvider`
- Edit path: `EditorWithCSSApp.tsx` (~170 lines) replaces `EditorWithCSS.tsx` (~2100 lines) using `CSSApp` + `useCSSEditor`
- Google OAuth verified working end-to-end

### Bug Fixes: Focus Region Highlighting & Editor Regressions (2026-03-09) ✅

#### False "Saved just now" on Initial Load
- `PuckDataSynchronizer` dispatches `setData` to sync loaded data into Puck, which triggers Puck's `onChange` callback, creating a false save echo
- Fix: Added `suppressNextSaveRef` in `CSSPuckProvider.saveData` — set in `loadDocument` before `setCurrentData`, checked and cleared in `saveData` to skip the first onChange echo
- Added `puckKey` to `useCSSEditor` return value (separate from `puckProps` due to React key spread limitation) to force clean Puck remount on document switch

#### Focus Region Highlighting Not Working
- Three layers of fixes required:
  1. **PresenceFocusBridge** in `CSSApp.tsx` — replaced empty `focusMap` with real computation from presence actor data using `createFocusRegionMap`
  2. **WebSocket reporting** — switched `useCSSEditor` focus region reporting from HTTP API (`client.presence.updateFocusRegions`) to WebSocket (`css.sendFocusRegions`) for instant broadcast to other clients
  3. **Config wrapping** — initially used `createFocusHighlightConfig` to wrap Puck component renders with `FocusHighlightWrapper`, later replaced with DOM-based approach

#### Scroll Jump Prevention
- Root cause: `presenceState` was a dependency of the main `contextValue` useMemo in `CSSPuckProvider`. Every focus region broadcast recreated the context → triggered re-renders of `ContextSyncBridge` → `PuckDataSynchronizer` → cascaded through entire Puck plugin tree
- Additionally, DOM element insertion (badge div) inside Puck's preview iframe triggered browser auto-scroll before user interaction
- Fixes:
  1. **Decoupled presence from main context** — `presenceState` uses a ref-based getter (`get presence() { return presenceStateRef.current; }`) so focus region broadcasts don't trigger context recreation
  2. **DOM-based highlighting** — applies CSS classes/attributes directly to existing `[data-puck-component]` elements instead of React render wrapping
  3. **CSS `::after` badge** — uses pseudo-element (`content: attr(data-focus-initial)`) instead of DOM insertion to avoid browser auto-scroll
  4. **PresenceFocusBridge** reads from dedicated `PresenceContext` (which still updates reactively) instead of main `CSSPuckContext`

#### Key Architecture Decision
- Presence state updates (focus regions, actor lists) are high-frequency and should NOT cascade through the data synchronization pipeline
- Main `CSSPuckContext` stays stable during presence changes; presence-specific UI reads from the separate `PresenceContext` or the ref-based getter

### Default Merge Compare Link in Plugin Panel (2026-03-09) ✅

- `useCSSEditor` now provides a default `onMergeCompare` handler that navigates to `/merge`
- The "Compare with main" button appears automatically in the CSS plugin panel when on a non-main branch
- Consumers can override via `pluginOptions.onMergeCompare`; lower-level `useCSSPlugin`/`createCSSPlugin` users must provide their own handler
- No query parameters needed — the merge page reads the current branch from `CSSPuckProvider` context
- Fixed pre-existing `ResizeObserver` polyfill gap in test setup that blocked `useCSSEditor` and `useCSSPlugin` hook tests
- README updated with "Branch Merge Comparison" section documenting default behavior and customization

### PDS Button Styles (2026-03-09) ✅
- Added PDS button CSS (design tokens + base styles + all variants) to `styles.css`
- Loaded Poppins font via `@import` at the top of the stylesheet (required by CSS spec)
- Updated 13 puck-css components to use `pds-button` classes instead of ad-hoc inline styles/custom CSS
- Removed old button CSS rules (`.css-plugin-btn*`, `.historical-version-banner__button`, toast/banner button styles)
- PDS variants used: primary (action buttons), secondary (back/cancel), subtle (dismiss/utility), critical-secondary (stop agent), brand (Auth0 login)
- 19 new tests validating PDS class application across all button components

### v0.2.0 Release (2026-03-09) ✅

**Release:** [v0.2.0](https://github.com/pantheon-systems/puck-css-integration/releases/tag/v0.2.0)

**Highlights:**
- Next.js helpers and README rewrite
- PDS button styles across all button components
- Publish confirmation step on PublishButton
- Single-document publish endpoint
- Focus region highlighting and editor regression fixes
- Content delivery client (`CSSContentClient`) with subpath exports
- Client-side optimizations for Wave 2 backend (delta encoding, rate awareness, polling intervals)

**Distribution:**
- Tarballs attached to GitHub release: `pantheon-puck-css-0.2.0.tgz`, `pantheon-css-client-0.2.0.tgz`
- Tarballs attached to GitHub release for downstream consumption

### Published Status Indicators (2026-03-10) ✅

**Branch:** `feature/published-status-indicators` | **PR:** [#13](https://github.com/pantheon-systems/puck-css-integration/pull/13)

Added published status indicators to the Puck editor UI:

**Header badge** — Shows document publish state between SaveIndicator and PublishButton:
- "Published" (green dot) — current version matches latest published
- "Unpublished changes" (yellow dot) — document was published but has newer edits
- "Draft" (no dot) — never published

**Version list badges** — "Published" indicator badge next to published versions using `DocumentVersion.isPublished` from the backend.

**Document list branch state** — Inherited (COW) documents shown with dimmed styling and "main only" label on feature branches, using `Document.inherited` from the backend.

**Key decisions:**
- Published status derived from server-side `DocumentVersion.isPublished` field — zero additional API calls. An earlier iteration used N+1 checkpoint API calls which caused ~20 requests per page load; this was refactored after filing [collaborative-state-system#31](https://github.com/pantheon-systems/collaborative-state-system/issues/31) and backend [PR#32](https://github.com/pantheon-systems/collaborative-state-system/pull/32).
- Document branch state uses server-side `Document.inherited` field from `listDocumentsOnBranch` — eliminated a separate API call to fetch main branch documents.
- Deleted `usePublishedStatus` hook and `mainOnlyDocumentIds` computation (-745 lines).
- Uses PDS `pds-status-badge` and `pds-indicator-badge` CSS patterns.

**New components:** `PublishedStatusBadge`, `VersionPublishedBadge`
**Client type additions:** `Document.isPublished`, `Document.publishedVersionId`, `Document.publishedAt`, `Document.inherited`, `DocumentVersion.isPublished`
**Test coverage:** 29 tests across 3 test files

### Publish Race Condition Fix (2026-03-11) ✅

Fixed a race condition where publishing a document could publish a stale version instead of the latest edit. The root cause: the Durable Object syncs CRDT state to Postgres asynchronously via a queue with a 5-second idle timeout, but the publish endpoint reads the latest version from Postgres. Edits made within that sync window would be missed.

**Root cause analysis:**
- DO sync to Postgres: 5-second idle timeout via async queue (`SYNC_IDLE_TIMEOUT_MS`)
- Frontend workaround: 1-second `setTimeout` before calling publish (insufficient)
- Publish endpoint: reads latest version from Postgres (`ORDER BY version_number DESC LIMIT 1`)
- Race window: 4-9 seconds where the latest edit exists only in the DO's memory

**Solution: WebSocket-driven publish (Option A)**

Moved the entire publish orchestration to the backend. The client sends a single `publish_request` message via WebSocket, and the Durable Object handles flush + publish internally. TCP ordering guarantees all preceding CRDT binary updates are processed before the publish request.

**Backend changes** (collaborative-state-system, branch `fix/flush-before-publish`):
- Phase 1: Added `publish_request`/`publish_result` WebSocket message types and type guards
- Phase 2: Added `POST /internal/publish` route with auth and validation
- Phase 3: Added `handleWsPublishRequest` to DocumentSession DO — flushes CRDT to Postgres, calls `/internal/publish`, sends result back to client
- Phase 6: Removed pre-publish flush from `index.ts` (now handled internally), removed diagnostic logging
- Fixed unique constraint race in `createDocumentVersion` when async queue and flush compete

**Frontend changes** (puck-css-integration, branch `fix/flush-before-publish`):
- Phase 4: Added `requestPublish()` to `RealtimeClient` — sends `publish_request` via WS, returns `Promise<PublishResult>` with 30s timeout
- Phase 5: Wired `requestPublish` through `useRealtime` hook; simplified `publishDocument` in CSSPuckProvider to use WS publish when connected, HTTP fallback when not

**Test coverage:** 48 new tests across 5 test files (16 message types, 13 API route, 6 DO handler, 9 RealtimeClient, 4 integration)

**Decision:** `createCheckpoint` still uses `waitForDelivery()` + HTTP — it's a separate code path creating branch-level checkpoints, not document-level publishes. Could be migrated to a similar WebSocket pattern in the future.

### UX Terminology Update: Live/Draft (2026-03-12, PR #15) ✅

Updated all user-facing strings to use non-technical language for content editors:

**Terminology changes:**
- "branch" → "Draft" / "Drafts" in all UI labels, dialogs, and empty states
- "main" → "Live" in dropdowns, buttons, and status indicators
- Main branch displays as "Live" (not the internal name "main") in selectors
- "Compare with main" → "Compare with Live"
- "main only" status indicator → "Live only"

**Published status badge fix:**
- Renamed "Draft" badge label to "Unpublished" to avoid conflict with Draft = branch terminology
- Fixed inherited documents from Live showing "Unpublished" instead of "Published"
  - Root cause: `currentDocument` came from site-level `getByPath` endpoint which lacks `inherited`/`isPublished` fields
  - Fix: look up document from `css.documents` (branch-level listing) which includes those fields

**Demo app (MergeReviewPage) changes:**
- "Source branch" → "Draft", "Target branch" → static "Live" label
- Removed target branch dropdown (merge target is always Live)
- Filtered main out of source Draft selector

**Files changed:** 10 source files, 800/800 tests passing, 0 lint errors

## Remaining Work

### Future
- Apply render/edit split pattern to airbus site
- Update MIGRATION-GUIDE.md with render/edit split and content delivery patterns

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

# Real-time collaboration (optional):
VITE_CSS_ENABLE_REALTIME=true
VITE_CSS_WS_BASE_URL=ws://localhost:8787
```
