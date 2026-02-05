# Puck CSS Integration

Integration between [Puck Editor](https://puckeditor.com) and the Collaborative State System (CSS) for building visual page editors with version control, branching, and publishing workflows.

## Features

- **Auto-save** - Automatic saving with configurable debounce (default 3 seconds)
- **Version History** - Every save creates a new document version
- **Branching** - Work on different branches with easy switching
- **Publishing** - Create checkpoints (named snapshots) for releases
- **Conflict Detection** - Detect and resolve merge conflicts between branches
- **User Attribution** - Track who made each change
- **Real-time Collaboration** - Multiple users can edit simultaneously with Yjs CRDT sync
- **Presence Awareness** - See who's viewing/editing documents in real-time
- **Agent Politeness** - AI agents can edit documents while respecting human presence

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

## Real-time Collaboration

The puck-css integration supports real-time collaborative editing using Yjs CRDT over WebSockets. Multiple users can edit the same document simultaneously and see each other's changes in real-time.

### Enabling Real-time Collaboration

#### 1. Configure the Provider

Add the realtime props to `CSSPuckProvider`:

```tsx
import { CSSPuckProvider } from '@pantheon/puck-css';
import { CSSClient } from '@pantheon/css-client';

const client = new CSSClient({
  baseUrl: 'https://your-css-api.example.com',
  apiKey: 'your-api-key',
});

function App() {
  return (
    <CSSPuckProvider
      client={client}
      siteId="your-site-id"
      userId="current-user-id"
      enableRealtime={true}
      wsBaseUrl="wss://your-css-api.example.com"
      realtimeApiKey="your-api-key"  // Optional, defaults to HTTP API key
    >
      <YourEditor />
    </CSSPuckProvider>
  );
}
```

#### 2. Environment Variables (Next.js example)

```env
# CSS API Configuration
NEXT_PUBLIC_CSS_BASE_URL=http://<SERVER>:<PORT>
NEXT_PUBLIC_CSS_API_KEY=your-api-key
NEXT_PUBLIC_CSS_SITE_ID=your-site-id
NEXT_PUBLIC_CSS_USER_ID=demo-user

# Real-time Collaboration
NEXT_PUBLIC_CSS_ENABLE_REALTIME=true
NEXT_PUBLIC_CSS_WS_BASE_URL=ws://<SERVER>:<PORT>
```

### How Real-time Works

1. When `enableRealtime` is true and a document is loaded, a WebSocket connection is established
2. Local edits are broadcast to all connected clients via Yjs CRDT updates
3. Remote changes are merged automatically without conflicts using CRDT
4. The `realtimeConnected` context value indicates connection status

### Context Values for Real-time

```typescript
const {
  realtimeEnabled,    // boolean - Whether realtime is configured
  realtimeConnected,  // boolean - Current WebSocket connection status
  remoteSyncKey,      // string | null - Changes when remote updates arrive
} = useCSSPuck();
```

### Syncing Remote Updates to Puck

To make Puck update its UI when remote changes arrive, you must include `remoteSyncKey` in your sync key calculation. This triggers `PuckDataSynchronizer` to dispatch `setData` to Puck:

```tsx
const {
  currentData,
  currentDocument,
  viewingVersion,
  remoteSyncKey,  // Include this!
} = useCSSPuck();

// Compute sync key: prioritize remote updates, then version viewing, then document loading
const targetSyncKey = remoteSyncKey
  ? remoteSyncKey
  : viewingVersion
    ? `version-${viewingVersion.id}`
    : currentDocument
      ? `doc-${currentDocument.id}-latest`
      : null;

const dataSyncKey = targetSyncKey !== lastSyncedKeyRef.current ? targetSyncKey : null;
```

#### Recommended: Getter-based API (Reduces Flickering)

To minimize UI flickering during real-time collaboration, use refs and getter functions instead of passing sync data directly. This prevents the plugin from being recreated on every remote update:

```tsx
// Use refs to store sync data
const syncDataRef = useRef<Data | undefined>(undefined);
const dataSyncKeyRef = useRef<string | undefined>(undefined);
const lastSyncedKeyRef = useRef<string | null>(null);

// Update refs when sync data changes
useEffect(() => {
  if (dataSyncKey !== null) {
    syncDataRef.current = currentData as Data | undefined;
    dataSyncKeyRef.current = dataSyncKey;
    lastSyncedKeyRef.current = dataSyncKey;
  }
}, [dataSyncKey, currentData]);

// Create stable getter functions
const getSyncData = useCallback(() => syncDataRef.current, []);
const getDataSyncKey = useCallback(() => dataSyncKeyRef.current, []);

// Pass getters to the plugin (plugin stays stable, no flickering)
const cssPlugin = useMemo(
  () => createCSSPlugin({
    // ... other props
    getSyncData,      // Getter function
    getDataSyncKey,   // Getter function
  }),
  [getSyncData, getDataSyncKey, /* other non-sync deps */]
);
```

#### Legacy: Direct Props API

For simpler setups where flickering isn't a concern, you can pass sync data directly:

```tsx
const cssPlugin = useMemo(
  () => createCSSPlugin({
    // ... other props
    syncData: currentData,
    dataSyncKey: targetSyncKey,
  }),
  [currentData, targetSyncKey, /* other deps */]
);
```

Note: This approach recreates the plugin on every sync, which may cause flickering during rapid real-time updates.

### Backend Requirements

The CSS backend must support WebSocket connections at:
```
ws://<host>/api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/connect
```

Query parameters for authentication:
- `actorId` - User or agent ID
- `actorType` - Either "user" or "agent"
- `apiKey` - API key for authentication (WebSocket can't send custom headers)

## Presence and Agent Politeness

The puck-css integration includes presence awareness and agent politeness features that enable:
- Real-time visibility of who's viewing or editing documents
- AI agents that can edit documents while respecting human presence
- Visual indicators showing agent activity with the ability to stop agents

### Enabling Presence

Add the presence props to `CSSPuckProvider`:

```tsx
import { CSSPuckProvider } from '@pantheon/puck-css';

function App() {
  return (
    <CSSPuckProvider
      client={client}
      siteId="your-site-id"
      userId="current-user-id"
      userName="John Doe"           // Display name for presence
      userAvatar="https://..."      // Optional avatar URL
      enableRealtime={true}
      wsBaseUrl="wss://your-css-api.example.com"
      presenceEnabled={true}        // Enable presence features
    >
      <YourEditor />
    </CSSPuckProvider>
  );
}
```

### Context Values for Presence

```typescript
const {
  // Presence data
  presence,  // PresenceState | null
} = useCSSPuck();

// PresenceState shape:
interface PresenceState {
  actors: ActorPresence[];      // All actors (humans + agents)
  humans: ActorPresence[];      // Only human users
  agents: ActorPresence[];      // Only AI agents
  hasActiveAgents: boolean;     // True if any agent is editing
  isAgentEditing: boolean;      // True if an agent is in 'editing' state
}

// ActorPresence shape:
interface ActorPresence {
  id: string;                   // Presence record ID
  actorId: string;              // User or agent ID
  actorType: 'user' | 'agent';
  role: 'human' | 'agent';
  name: string;
  avatar?: string;
  state: 'active' | 'idle' | 'inactive' | 'editing';
  intent?: string;              // Agent's current intent
  focusRegions?: string[];      // Regions being edited
  lastActivityAt: string;
  joinedAt: string;
}
```

### Displaying Collaborator Avatars

Use the `CollaboratorAvatars` component to show who's online:

```tsx
import { CollaboratorAvatars } from '@pantheon/puck-css';

function Header() {
  const { presence } = useCSSPuck();

  return (
    <header>
      <CollaboratorAvatars
        actors={presence?.actors ?? []}
        maxVisible={5}
        separateAgents={true}  // Show agents with a separator
        onAvatarClick={(actor) => console.log('Clicked:', actor.name)}
      />
    </header>
  );
}
```

**Props:**
- `actors` - Array of `ActorPresence` objects to display
- `maxVisible` - Maximum avatars before "+N" overflow (default: 5)
- `separateAgents` - Show agents separately from humans with a divider
- `onAvatarClick` - Click handler for avatars
- `className` - Additional CSS class

**Features:**
- Hash-based consistent colors for each user (same user = same color)
- Tooltips showing name, state, and agent intent
- Pulsing ring for users in "editing" state
- Lightning bolt badge for AI agents
- Stacked layout with overflow indicator

### Agent Activity Banner

When an agent is actively editing, show the `AgentActivityBanner`:

```tsx
import { AgentActivityBanner } from '@pantheon/puck-css';

function Editor() {
  const { presence } = useCSSPuck();

  // Get the first active agent
  const activeAgent = presence?.agents.find(a => a.state === 'editing');

  return (
    <div>
      {activeAgent && (
        <AgentActivityBanner
          agent={activeAgent}
          onStopAgent={(agent) => {
            // Handle stopping the agent
            console.log('Stop agent:', agent.actorId);
          }}
        />
      )}
      {/* Rest of editor */}
    </div>
  );
}
```

**Props:**
- `agent` - The `ActorPresence` object for the agent
- `showIdle` - Show banner even when agent is idle (default: false)
- `dismissible` - Allow dismissing the banner (default: false)
- `onStopAgent` - Callback when "Stop Agent" button is clicked
- `className` - Additional CSS class

**Features:**
- Colored avatar with hash-based color (consistent with CollaboratorAvatars)
- Agent name and current intent display
- List of regions being edited
- "Stop Agent" button for human intervention

### Using with createCSSOverrides

The `createCSSOverrides` function can automatically add presence UI to Puck's header:

```tsx
import { createCSSOverrides } from '@pantheon/puck-css';

const cssOverrides = useMemo(() => createCSSOverrides({
  // ... other props

  // Presence features
  showCollaboratorAvatars: !!presence,
  presence: presence?.actors ?? [],

  // Agent activity banner
  showAgentActivityBanner: !!presence?.hasActiveAgents,
  activeAgents: presence?.agents ?? [],
  isAgentEditing: presence?.hasActiveAgents ?? false,
}), [presence, /* other deps */]);

// Use with Puck
<Puck
  config={config}
  data={data}
  overrides={cssOverrides}
/>
```

### Styling

Import the puck-css styles to get the presence component styling:

```tsx
import '@pantheon/puck-css/styles.css';
```

This includes:
- `CollaboratorAvatars` - Stacked avatars with tooltips
- `AgentActivityBanner` - Agent editing notification banner
- CSS variables for customization

**CSS Variables for customization:**

```css
:root {
  --puck-css-avatar-agent: #6366f1;     /* Agent badge color */
  --puck-css-avatar-fallback: #9ca3af;  /* Fallback avatar color */
  --puck-css-border: #e5e7eb;
  --puck-css-bg: #ffffff;
  --puck-css-bg-secondary: #f9fafb;
  --puck-css-text: #111827;
  --puck-css-text-secondary: #6b7280;
}
```

### Agent Politeness Protocol

When integrating AI agents that can edit documents, follow the politeness protocol:

1. **Check Permission First**: Before editing, call `can-agent-edit` to check if the agent can proceed
2. **Start Edit Session**: Call `agent-edit-start` to reserve regions and create a rollback checkpoint
3. **Apply Edits**: Make changes via the edits API
4. **Complete or Abort**: Call `agent-edit-complete` on success or `agent-edit-abort` on failure

The backend enforces these rules:
- Agents cannot edit regions where humans are actively present
- Agents must request permission before editing
- Human-triggered edits (via UI) take precedence over autonomous agents
- Edit sessions have expiration times to prevent stale locks

### MCP Server Integration

For Claude Desktop or other MCP-compatible AI assistants, use the MCP server in `examples/collaborative-state-mcp`:

```json
{
  "mcpServers": {
    "collaborative-state": {
      "command": "node",
      "args": ["/path/to/collaborative-state-mcp/dist/index.js"],
      "env": {
        "CSS_API_URL": "http://localhost:8787",
        "CSS_AGENT_ID": "agent-zappy",
        "CSS_AGENT_API_KEY": "your-agent-api-key"
      }
    }
  }
}
```

Available MCP tools:
- `list_sites`, `list_branches`, `list_documents` - Discovery
- `get_document` - Read document content
- `check_edit_permission` - Check if agent can edit
- `start_edit_session` - Begin polite editing
- `apply_document_edits` - Make changes
- `complete_edit_session`, `abort_edit_session` - Finish editing
- `get_branch_presence`, `get_document_presence` - Check who's online

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

React context provider that manages CSS state, auto-save, and real-time collaboration.

```tsx
<CSSPuckProvider
  client={CSSClient}        // Required: CSS client instance
  siteId={string}           // Required: Site ID
  branchId={string}         // Optional: Initial branch ID (defaults to main branch)
  userId={string}           // Required: Current user ID
  userName={string}         // Optional: Display name for presence
  userAvatar={string}       // Optional: Avatar URL for presence
  autoSaveDelay={number}    // Optional: Debounce delay in ms (default: 3000)
  maxRetries={number}       // Optional: Max retry attempts (default: 3)
  showErrorNotifications={boolean}  // Optional: Show error toasts (default: true)
  enableRealtime={boolean}  // Optional: Enable real-time collaboration (default: false)
  wsBaseUrl={string}        // Optional: WebSocket server URL (required if enableRealtime is true)
  realtimeApiKey={string}   // Optional: API key for WebSocket auth (defaults to HTTP API key)
  presenceEnabled={boolean} // Optional: Enable presence awareness (default: false)
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

  // Version viewing
  viewingVersion,              // DocumentVersion | null - Currently viewing historical version
  isViewingHistoricalVersion,  // boolean - True when viewing a past version
  loadVersion,                 // (version: DocumentVersion) => Promise<void>
  returnToLatest,              // () => Promise<void>

  // Real-time collaboration
  realtimeEnabled,     // boolean - Whether realtime is configured
  realtimeConnected,   // boolean - Current WebSocket connection status
  remoteSyncKey,       // string | null - Changes when remote updates arrive

  // Presence awareness
  presence,            // PresenceState | null - Current presence data
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

**CollaboratorAvatars** - Display stacked user/agent avatars

```tsx
<CollaboratorAvatars
  actors={ActorPresence[]}         // Required: Array of presence objects
  maxVisible={number}              // Optional: Max avatars before "+N" (default: 5)
  separateAgents={boolean}         // Optional: Show agents separately (default: false)
  onAvatarClick={(actor) => void}  // Optional: Click handler
  className={string}               // Optional: Additional CSS class
/>
```

**AgentActivityBanner** - Banner showing active agent editing

```tsx
<AgentActivityBanner
  agent={ActorPresence}            // Required: The agent presence object
  showIdle={boolean}               // Optional: Show when idle (default: false)
  dismissible={boolean}            // Optional: Allow dismiss (default: false)
  onStopAgent={(agent) => void}    // Optional: Stop button callback
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
# Required
VITE_CSS_BASE_URL=http://<SERVER>:<PORT>
VITE_CSS_API_KEY=your-api-key-here
VITE_CSS_SITE_ID=your-site-id
VITE_CSS_USER_ID=demo-user-id

# Optional - defaults to main branch if not set
VITE_CSS_BRANCH_ID=your-branch-id

# Real-time collaboration (optional)
VITE_CSS_ENABLE_REALTIME=true
VITE_CSS_WS_BASE_URL=ws://<SERVER>:<PORT>
```

### Backend Site Roles Configuration

When using JWT authentication with presence features, the CSS backend must have your site ID configured in the mock identity provider's `siteRoles`. Without this, presence and other authorization-protected endpoints will return 403 Forbidden.

To configure:

1. Edit `collaborative-state-system/workers/src/index.ts`
2. Add your site ID to `DEFAULT_MOCK_CONFIG.users[].siteRoles` and `DEFAULT_MOCK_CONFIG.agents[].siteRoles`:
   ```typescript
   siteRoles: {
     'your-site-uuid-here': 'admin',
   }
   ```
3. Restart the CSS backend: `cd workers && pnpm dev`
4. Log out and log back in to refresh your JWT token

See the CSS backend README for more details on mock identity configuration.

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
- **Real-time sync**: Yjs CRDT over WebSocket for conflict-free collaborative editing

## Troubleshooting

### Real-time Collaboration Issues

#### Understanding the Connection Lifecycle

The WebSocket connection is only established when ALL of these conditions are met:
1. `enableRealtime` is `true`
2. `wsBaseUrl` is provided and non-empty
3. A document is loaded (`currentDocument` exists with a valid path)
4. `siteId` and `branchId` are set

**Important**: The connection won't happen immediately on page load. It only connects after the document is fully loaded from the CSS backend. This means you'll see the editor before real-time is active.

#### Debugging Connection Issues

Add this to your editor component to monitor connection status:

```tsx
const { realtimeConnected } = useCSSPuck();

useEffect(() => {
  console.log('[Realtime] Connected:', realtimeConnected);
}, [realtimeConnected]);
```

**WebSocket connection not established**
- Check that your document has loaded (wait for `currentDocument` to be non-null)
- Verify environment variables are correctly set (use `console.log` to confirm values)
- For Next.js: ensure variables are prefixed with `NEXT_PUBLIC_` for client-side access
- Confirm `enableRealtime` evaluates to `true` (not the string `"true"`)

**WebSocket connection fails**
- Verify the CSS backend is running and supports WebSocket connections
- Check that `wsBaseUrl` uses `ws://` for HTTP or `wss://` for HTTPS
- Ensure CORS is configured on the backend to allow WebSocket upgrades
- Check browser console for WebSocket errors
- Test the WebSocket endpoint directly using browser DevTools or a WebSocket client

**Changes not syncing between users**
- Verify both users are connected (`realtimeConnected === true`)
- Check browser console for WebSocket errors
- Ensure both users are on the same branch and document path
- Verify the document path matches exactly between clients
- **Important**: Your editor must use `remoteSyncKey` from `useCSSPuck()` to trigger Puck data sync when remote updates arrive. Include it in your sync key calculation (see example below)

**Edits causing infinite loops or bounce-back**
- The provider includes bounce-back prevention via `isProcessingRemoteUpdate` flag
- If you see duplicate edits, check that you're using the latest version of the package
- Ensure `saveData` is only called from Puck's `onChange`, not from other effects

#### Differences Between Bundlers

If you're integrating into an existing app, be aware of bundler-specific considerations:

| Bundler | Environment Variable Prefix | Notes |
|---------|----------------------------|-------|
| Vite | `VITE_` | Access via `import.meta.env.VITE_*` |
| Next.js (Webpack) | `NEXT_PUBLIC_` | Access via `process.env.NEXT_PUBLIC_*` |
| Create React App | `REACT_APP_` | Access via `process.env.REACT_APP_*` |

For symlinked packages (monorepo setups), ensure:
- Dependencies like `yjs` and `react` are properly hoisted or deduplicated
- The same React instance is used across all packages (check with React DevTools)

### General Issues

**Document not loading**
- Check that `siteId` and `branchId` are correct
- Verify the document exists on the specified branch
- Check the browser network tab for API errors

**Auto-save not working**
- Verify `autoSaveDelay` is set (default: 3000ms)
- Check that `saveData` is being called from Puck's `onChange`
- Look for errors in the browser console

**Version history not showing**
- Ensure `useVersions` hook is provided with valid `documentId`
- Check that versions exist for the document (first save creates version 1)

## License

MIT
