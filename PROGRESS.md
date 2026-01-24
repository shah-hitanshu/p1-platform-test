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

## Test Summary

| Package | Tests | Status |
|---------|-------|--------|
| @pantheon/css-client | 18 | ✅ Passing |
| @pantheon/puck-css | 14 | ✅ Passing |
| **Total** | **32** | ✅ **All Passing** |

## Key Decisions

1. **Data Storage**: Puck Data stored directly as document version snapshots
2. **Auto-Save**: 3-second debounce before creating new document versions
3. **Publish**: Creates checkpoints (named snapshots of all documents)
4. **Authentication**: Supports both API key and custom auth providers
5. **Branch Handling**: Branch selector UI with unsaved changes warning
6. **Error Handling**: Exponential backoff retry with configurable attempts

## Remaining Work

### Phase 5: Version Comparison UI
- Side-by-side version viewer with highlights
- Visual diff of component changes
- Version history panel

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
VITE_CSS_BRANCH_ID=your-branch-id
VITE_CSS_USER_ID=demo-user-id
```
