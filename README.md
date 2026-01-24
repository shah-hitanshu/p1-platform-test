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
