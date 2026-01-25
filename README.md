# Puck CSS Integration

Integration between [Puck Editor](https://puckeditor.com) and the Collaborative State System (CSS) for building visual page editors with version control, branching, and publishing workflows.

## Features

- **Auto-save** - Automatic saving with configurable debounce (default 3 seconds)
- **Version History** - Every save creates a new document version
- **Branching** - Work on different branches with easy switching
- **Publishing** - Create checkpoints (named snapshots) for releases
- **Conflict Detection** - Detect and resolve merge conflicts between branches
- **User Attribution** - Track who made each change

## Packages

| Package | Description |
|---------|-------------|
| `@pantheon/css-client` | TypeScript API client for the Collaborative State System |
| `@pantheon/puck-css` | React hooks and components for Puck editor integration |

## Installation

```bash
# Using pnpm
pnpm add @pantheon/css-client @pantheon/puck-css

# Using npm
npm install @pantheon/css-client @pantheon/puck-css

# Using yarn
yarn add @pantheon/css-client @pantheon/puck-css
```

## Quick Start

### 1. Create a CSS Client

```typescript
import { CSSClient } from '@pantheon/css-client';

const client = new CSSClient({
  baseUrl: 'https://your-css-api.example.com',
  apiKey: 'your-api-key',
});
```

### 2. Wrap Your App with the Provider

```tsx
import { CSSPuckProvider } from '@pantheon/puck-css';

function App() {
  return (
    <CSSPuckProvider
      client={client}
      siteId="your-site-id"
      branchId="your-branch-id"
      userId="current-user-id"
      autoSaveDelay={3000}
    >
      <YourEditor />
    </CSSPuckProvider>
  );
}
```

### 3. Use the Context in Your Editor

```tsx
import { Puck } from '@measured/puck';
import { useCSSPuck, SaveIndicator, PublishButton } from '@pantheon/puck-css';

function YourEditor() {
  const {
    currentData,
    loadDocument,
    saveData,
    saveStatus,
    lastSaved,
    createCheckpoint,
  } = useCSSPuck();

  // Load document on mount
  useEffect(() => {
    loadDocument('/home');
  }, [loadDocument]);

  if (!currentData) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <header>
        <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
        <PublishButton onPublish={createCheckpoint}>
          Publish
        </PublishButton>
      </header>

      <Puck
        config={puckConfig}
        data={currentData}
        onChange={saveData}
      />
    </div>
  );
}
```

## Version Comparison Integration

To enable visual version comparison in your editor, you need to:

1. Use the `useVersions` hook to manage version state
2. Pass version props to `createCSSPlugin` for the sidebar UI
3. Render `VisualVersionCompare` when comparison is active

### Complete Example

```tsx
import { useState, useCallback, useMemo } from 'react';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import {
  CSSPuckProvider,
  useCSSPuck,
  useDocuments,
  useVersions,
  createCSSPlugin,
  VisualVersionCompare,
} from '@pantheon/puck-css';
import config from './puck.config'; // Your Puck component config

function EditorWithVersionComparison({ documentPath }: { documentPath: string }) {
  const {
    client,
    siteId,
    branchId,
    currentDocument,
    currentData,
    saveData,
    branches,
    currentBranch,
    switchBranch,
    saveStatus,
  } = useCSSPuck();

  // Document management
  const { documents, loading: documentsLoading } = useDocuments({
    client,
    siteId,
    branchId,
  });

  // Version management
  const {
    versions,
    loading: versionsLoading,
    selectedVersion,
    setSelectedVersion,
    compareVersions,
    comparisonDiffs,
  } = useVersions({
    client,
    siteId,
    branchId,
    documentId: currentDocument?.id ?? null,
  });

  // Comparison state
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonVersions, setComparisonVersions] = useState<{
    before: number;
    after: number;
  } | null>(null);
  const [comparisonData, setComparisonData] = useState<{
    beforeData: Data;
    afterData: Data;
  } | null>(null);

  // Handle version selection in sidebar
  const handleVersionSelect = useCallback(
    (version: { id: string; versionNumber: number; createdAt: string }) => {
      const found = versions.find((v) => v.id === version.id);
      setSelectedVersion(found ?? null);
    },
    [versions, setSelectedVersion]
  );

  // Handle compare button click
  const handleCompare = useCallback(
    async (beforeVersionId: string, afterVersionId: string) => {
      const beforeVersion = versions.find((v) => v.id === beforeVersionId);
      const afterVersion = versions.find((v) => v.id === afterVersionId);

      if (beforeVersion && afterVersion) {
        await compareVersions(beforeVersionId, afterVersionId);
        setComparisonVersions({
          before: beforeVersion.versionNumber,
          after: afterVersion.versionNumber,
        });
        setComparisonData({
          beforeData: beforeVersion.snapshot as unknown as Data,
          afterData: afterVersion.snapshot as unknown as Data,
        });
        setShowComparison(true);
      }
    },
    [versions, compareVersions]
  );

  // Handle closing comparison view
  const handleCloseComparison = useCallback(() => {
    setShowComparison(false);
    setComparisonVersions(null);
    setComparisonData(null);
    setSelectedVersion(null);
  }, [setSelectedVersion]);

  // Create CSS plugin with version props
  const cssPlugin = useMemo(
    () =>
      createCSSPlugin({
        branches,
        currentBranch,
        onBranchSwitch: switchBranch,
        hasUnsavedChanges: saveStatus === 'saving',
        documents,
        selectedDocumentPath: documentPath,
        documentsLoading,
        // Version comparison props
        versions,
        versionsLoading,
        selectedVersionId: selectedVersion?.id,
        onVersionSelect: handleVersionSelect,
        onCompare: handleCompare,
      }),
    [
      branches, currentBranch, switchBranch, saveStatus,
      documents, documentPath, documentsLoading,
      versions, versionsLoading, selectedVersion,
      handleVersionSelect, handleCompare,
    ]
  );

  // Show comparison view when active
  if (showComparison && comparisonDiffs && comparisonVersions && comparisonData) {
    return (
      <VisualVersionCompare
        beforeVersion={comparisonVersions.before}
        afterVersion={comparisonVersions.after}
        beforeData={comparisonData.beforeData}
        afterData={comparisonData.afterData}
        config={config}
        diffs={comparisonDiffs}
        onClose={handleCloseComparison}
      />
    );
  }

  // Normal editor view
  return (
    <Puck
      config={config}
      data={currentData as Data}
      plugins={[cssPlugin]}
      onChange={saveData}
    />
  );
}
```

### How It Works

1. **Version List in Sidebar**: The CSS plugin sidebar shows a "Version History" section with all document versions
2. **Select a Version**: Click on an older version to select it for comparison
3. **Compare Button**: A "Compare with current" button appears when a non-current version is selected
4. **Visual Comparison**: Clicking compare shows a side-by-side view with:
   - Both versions rendered using your Puck config
   - Added components highlighted in green
   - Removed components highlighted in red
   - Modified components highlighted in yellow
5. **Close**: Click the close button to return to the normal editor

## API Reference

### CSS Client (`@pantheon/css-client`)

#### CSSClient

Main client class for interacting with the CSS API.

```typescript
const client = new CSSClient({
  baseUrl: string;           // CSS API base URL
  apiKey?: string;           // API key for authentication
  authProvider?: AuthProvider; // Custom auth provider
  principal?: Principal;     // Default principal for requests
});

// Create a client with a different user context
const userClient = client.withPrincipal({ id: 'user-123', type: 'user' });
```

#### Endpoints

```typescript
// Sites
client.sites.list(): Promise<Site[]>
client.sites.get(siteId): Promise<Site>
client.sites.create(params): Promise<Site>
client.sites.update(siteId, params): Promise<Site>
client.sites.delete(siteId): Promise<void>

// Branches
client.branches.list(siteId): Promise<Branch[]>
client.branches.get(siteId, branchId): Promise<Branch>
client.branches.create(siteId, params): Promise<Branch>
client.branches.delete(siteId, branchId): Promise<void>

// Documents
client.documents.list(siteId, branchId): Promise<Document[]>
client.documents.get(siteId, documentId): Promise<Document>
client.documents.getByPath(siteId, path): Promise<Document>
client.documents.create(params): Promise<Document>
client.documents.delete(siteId, branchId, documentId): Promise<void>

// Versions
client.versions.list(siteId, branchId, documentId): Promise<DocumentVersion[]>
client.versions.get(siteId, versionId): Promise<DocumentVersion>
client.versions.getLatest(siteId, branchId, documentId): Promise<DocumentVersion>
client.versions.create(siteId, params): Promise<DocumentVersion>

// Checkpoints
client.checkpoints.list(siteId, branchId): Promise<Checkpoint[]>
client.checkpoints.get(siteId, checkpointId): Promise<Checkpoint>
client.checkpoints.create(siteId, params): Promise<Checkpoint>
```

### Puck CSS (`@pantheon/puck-css`)

#### CSSPuckProvider

React context provider that manages CSS state and auto-save.

```tsx
<CSSPuckProvider
  client={CSSClient}        // Required: CSS client instance
  siteId={string}           // Required: Site ID
  branchId={string}         // Required: Initial branch ID
  userId={string}           // Required: Current user ID
  autoSaveDelay={number}    // Optional: Debounce delay in ms (default: 3000)
  maxRetries={number}       // Optional: Max retry attempts (default: 3)
>
  {children}
</CSSPuckProvider>
```

#### useCSSPuck Hook

Access CSS context values and methods.

```typescript
const {
  // State
  client,              // CSSClient instance
  siteId,              // Current site ID
  branchId,            // Current branch ID
  userId,              // Current user ID
  currentDocument,     // Currently loaded document
  currentData,         // Current Puck data
  saveStatus,          // 'idle' | 'saving' | 'saved' | 'error'
  lastSaved,           // Date of last successful save
  saveError,           // Last save error (if any)
  branches,            // Available branches
  currentBranch,       // Current branch object

  // Methods
  loadDocument,        // (path: string) => Promise<void>
  saveData,            // (data: PuckData) => void (debounced)
  saveNow,             // () => Promise<void> (immediate)
  createCheckpoint,    // (name?: string) => Promise<Checkpoint>
  switchBranch,        // (branchId: string) => Promise<void>
  refreshBranches,     // () => Promise<void>
} = useCSSPuck();
```

#### useDocuments Hook

Manage documents on a branch.

```typescript
const {
  documents,    // Document[]
  loading,      // boolean
  error,        // Error | null
  create,       // (path: string, initialData?: PuckData) => Promise<Document>
  remove,       // (documentId: string) => Promise<void>
  refresh,      // () => Promise<void>
  getByPath,    // (path: string) => Document | undefined
} = useDocuments({ client, siteId, branchId });
```

#### useVersions Hook

Manage document versions and comparisons.

```typescript
const {
  versions,          // DocumentVersion[]
  loading,           // boolean
  error,             // Error | null
  refresh,           // () => Promise<void>
  latestVersion,     // DocumentVersion | null
  compareVersions,   // (beforeId: string, afterId: string) => Promise<ComponentDiff[]>
  getVersion,        // (versionId: string) => DocumentVersion | undefined
  selectedVersion,   // DocumentVersion | null
  setSelectedVersion,// (version: DocumentVersion | null) => void
  comparisonDiffs,   // ComponentDiff[] | null
  isComparing,       // boolean
} = useVersions({ client, siteId, branchId, documentId });
```

#### Components

**SaveIndicator** - Displays current save status

```tsx
<SaveIndicator
  status={saveStatus}      // Required: 'idle' | 'saving' | 'saved' | 'error'
  lastSaved={lastSaved}    // Required: Date | null
  error={saveError}        // Optional: Error | null
  onRetry={saveNow}        // Optional: Retry callback
  className={string}       // Optional: Additional CSS class
/>
```

**PublishButton** - Button for creating checkpoints

```tsx
<PublishButton
  onPublish={createCheckpoint}  // Required: (name?: string) => Promise<Checkpoint>
  disabled={boolean}            // Optional: Disable the button
  showNamePrompt={boolean}      // Optional: Show name input (default: true)
  onSuccess={(cp) => void}      // Optional: Success callback
  onError={(err) => void}       // Optional: Error callback
  className={string}            // Optional: Additional CSS class
>
  Publish
</PublishButton>
```

**BranchSelector** - Dropdown for switching branches

```tsx
<BranchSelector
  branches={branches}              // Required: Branch[]
  currentBranch={currentBranch}    // Required: Branch | null
  onSwitch={switchBranch}          // Required: (branchId: string) => Promise<void>
  disabled={boolean}               // Optional: Disable the selector
  hasUnsavedChanges={boolean}      // Optional: Show warning before switching
  className={string}               // Optional: Additional CSS class
/>
```

**VisualVersionCompare** - Side-by-side visual comparison of two versions

```tsx
<VisualVersionCompare
  beforeVersion={number}           // Required: Before version number
  afterVersion={number}            // Required: After version number
  beforeData={PuckData}            // Required: Puck data from before version
  afterData={PuckData}             // Required: Puck data from after version
  config={PuckConfig}              // Required: Your Puck component config
  diffs={ComponentDiff[]}          // Required: Diff array from compareVersions
  onClose={() => void}             // Required: Close callback
  className={string}               // Optional: Additional CSS class
/>
```

#### Utilities

**debounce** - Create a debounced function

```typescript
import { debounce } from '@pantheon/puck-css';

const debouncedSave = debounce((data) => save(data), 3000);
debouncedSave(data);
debouncedSave.cancel(); // Cancel pending execution
```

**withRetry** - Execute with exponential backoff retry

```typescript
import { withRetry } from '@pantheon/puck-css';

const result = await withRetry(
  () => fetchData(),
  {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    shouldRetry: (error, attempt) => error.status >= 500,
    onRetry: (error, attempt, delay) => console.log(`Retrying in ${delay}ms`),
  }
);
```

**diffPuckData** - Compare two Puck data objects

```typescript
import { diffPuckData, countChanges } from '@pantheon/puck-css';

const diffs = diffPuckData(beforeData, afterData);
// Returns: ComponentDiff[]

const { added, removed, modified } = countChanges(diffs);
```

## Demo Application

A complete demo application is included in `apps/demo`. To run it:

```bash
# Clone the repository
git clone <repository-url>
cd puck-css-integration

# Install dependencies
pnpm install

# Configure environment
cd apps/demo
cp .env.example .env
# Edit .env with your CSS API credentials

# Run the demo
pnpm dev
```

### Environment Variables

```env
VITE_CSS_BASE_URL=http://localhost:8787
VITE_CSS_API_KEY=your-api-key-here
VITE_CSS_SITE_ID=your-site-id
VITE_CSS_BRANCH_ID=your-branch-id
VITE_CSS_USER_ID=demo-user-id
```

## Development

### Prerequisites

- Node.js 18+
- pnpm 9+

### Setup

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run linting
pnpm lint

# Build all packages
pnpm build
```

### Project Structure

```
puck-css-integration/
├── packages/
│   ├── css-client/      # @pantheon/css-client - TypeScript API client
│   └── puck-css/        # @pantheon/puck-css - React integration
├── apps/
│   └── demo/            # Demo application
└── pnpm-workspace.yaml
```

## Architecture

### Key Decisions

- **Data mapping**: Puck `Data` object stored as CSS document `snapshot`
- **Auto-save**: 3-second debounce creates document versions
- **Publish**: Manual action creates checkpoints
- **Version comparison**: Side-by-side render with change highlights
- **Authentication**: API key + user login with per-user attribution
- **Branch handling**: UI selector with future Change Set extensibility

## License

MIT
