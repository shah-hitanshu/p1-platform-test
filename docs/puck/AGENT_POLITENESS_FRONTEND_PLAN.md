# Agent Politeness Frontend Implementation Plan

## Overview

This plan outlines the integration of the Collaborative State System's Agent Politeness APIs into the puck-css-integration front-end. The goal is to enable respectful human-agent collaboration within the Puck Editor, providing visibility into who is editing, what agents are doing, and graceful conflict resolution.

---

## Prerequisites

### Backend APIs Required (from collaborative-state-system)

| API Category | Endpoints | Status |
|--------------|-----------|--------|
| Agent Registry | `GET/POST/PATCH/DELETE /api/organizations/{orgId}/agents` | Complete |
| Presence (Site) | `GET /api/sites/{siteId}/presence` | Complete |
| Presence (Branch) | `GET /api/sites/{siteId}/branches/{branchId}/presence` | Complete |
| Presence (Agent) | `GET /api/organizations/{orgId}/agents/{agentId}/presence` | Complete |
| Agent Edit Check | `POST .../documents/{path}/can-agent-edit` | Complete |
| Agent Edit Start | `POST .../documents/{path}/agent-edit-start` | Complete |
| Agent Edit Complete | `POST .../documents/{path}/agent-edit-complete` | Complete |
| Agent Edit Abort | `POST .../documents/{path}/agent-edit-abort` | Complete |

---

## Architecture Overview

```
puck-css-integration (frontend)
├── @pantheon/css-client
│   ├── PresenceEndpoint (NEW)
│   ├── AgentRegistryEndpoint (NEW)
│   └── AgentEditEndpoint (NEW)
│
└── @pantheon/puck-css
    ├── usePresence hook (NEW)
    ├── useAgentEdit hook (NEW)
    ├── PresenceIndicator component (NEW)
    ├── CollaboratorAvatars component (NEW)
    ├── AgentActivityBanner component (NEW)
    └── Enhanced CSSPuckProvider (MODIFIED)
```

---

## Phase 1: API Client Extensions ✅ COMPLETE

**Goal:** Add API client endpoints for presence and agent operations.

**Status:** Complete (2026-01-27)
**Commits:** `b73444e` (tests), `1b01e8d` (implementation)

### 1.1 Presence Endpoint

Create `packages/css-client/src/endpoints/presence.ts`:

```typescript
export interface ActorPresence {
  id: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: 'human' | 'agent';
  name: string;
  avatar?: string;
  state: 'active' | 'idle' | 'editing';
  intent?: string;
  focusRegions?: string[];
  lastActivityAt: string;
  joinedAt: string;
}

export interface DocumentPresenceSummary {
  documentId: string;
  documentPath: string;
  actorCount: number;
  hasHumans: boolean;
  hasAgents: boolean;
}

export interface BranchPresence {
  branchId: string;
  branchName: string;
  siteId: string;
  summary: {
    totalActors: number;
    humanCount: number;
    agentCount: number;
    editingCount: number;
  };
  actors: ActorPresence[];
  documentSummary: DocumentPresenceSummary[];
}

export interface SitePresence {
  siteId: string;
  siteName: string;
  summary: {
    totalActors: number;
    humanCount: number;
    agentCount: number;
    activeBranches: number;
  };
  branches: BranchPresenceSummary[];
}

export class PresenceEndpoint extends BaseEndpoint {
  async getSitePresence(siteId: string): Promise<SitePresence>;
  async getBranchPresence(siteId: string, branchId: string): Promise<BranchPresence>;
  async getDocumentPresence(siteId: string, branchId: string, documentPath: string): Promise<ActorPresence[]>;
}
```

### 1.2 Agent Registry Endpoint

Create `packages/css-client/src/endpoints/agent-registry.ts`:

```typescript
export interface RegisteredAgent {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  capabilities: string[];
  status: 'active' | 'suspended' | 'disabled';
  settings: AgentSettings;
  createdAt: string;
  updatedAt: string;
}

export class AgentRegistryEndpoint extends BaseEndpoint {
  async list(orgId: string, filters?: { status?: string }): Promise<{ agents: RegisteredAgent[] }>;
  async get(orgId: string, agentId: string): Promise<RegisteredAgent>;
  async create(orgId: string, data: CreateAgentParams): Promise<RegisteredAgent>;
  async update(orgId: string, agentId: string, data: UpdateAgentParams): Promise<RegisteredAgent>;
  async updateStatus(orgId: string, agentId: string, status: AgentStatus): Promise<RegisteredAgent>;
  async delete(orgId: string, agentId: string): Promise<void>;
}
```

### 1.3 Agent Edit Endpoint

Create `packages/css-client/src/endpoints/agent-edit.ts`:

```typescript
export interface AgentEditContext {
  agentId: string;
  trigger: 'human_requested' | 'autonomous';
  requestedById?: string;
  intent: string;
  targetRegions: string[];
  operationType?: string;
}

export interface AgentEditPermission {
  allowed: boolean;
  reason?: 'human_active' | 'region_conflict' | 'agent_suspended';
  retryAfterMs?: number;
  conflictingRegions?: string[];
}

export interface AgentEditSession {
  sessionId: string;
  checkpointId?: string;
}

export class AgentEditEndpoint extends BaseEndpoint {
  async canEdit(
    siteId: string,
    branchId: string,
    documentPath: string,
    context: AgentEditContext
  ): Promise<AgentEditPermission>;

  async startEdit(
    siteId: string,
    branchId: string,
    documentPath: string,
    context: AgentEditContext
  ): Promise<AgentEditSession>;

  async completeEdit(
    siteId: string,
    branchId: string,
    documentPath: string,
    agentId: string
  ): Promise<{ success: boolean; checkpointId?: string }>;

  async abortEdit(
    siteId: string,
    branchId: string,
    documentPath: string,
    agentId: string,
    checkpointId: string
  ): Promise<{ success: boolean }>;
}
```

### 1.4 CSSClient Extension

Update `packages/css-client/src/client.ts`:

```typescript
export class CSSClient {
  // Existing
  sites: SitesEndpoint;
  branches: BranchesEndpoint;
  documents: DocumentsEndpoint;
  versions: VersionsEndpoint;
  checkpoints: CheckpointsEndpoint;
  realtime: RealtimeClient;

  // New
  presence: PresenceEndpoint;      // Phase 1.1
  agentRegistry: AgentRegistryEndpoint;  // Phase 1.2
  agentEdit: AgentEditEndpoint;    // Phase 1.3
}
```

**Deliverables:**
- [ ] `presence.ts` endpoint with types
- [ ] `agent-registry.ts` endpoint with types
- [ ] `agent-edit.ts` endpoint with types
- [ ] Updated CSSClient with new endpoints
- [ ] Unit tests for all endpoints
- [ ] Export types from package index

---

## Phase 2: Presence Hooks ✅ COMPLETE

**Goal:** Create React hooks for consuming presence data.

**Status:** Complete (2026-01-27)
**Commits:** `049b79d` (tests), `6b595e9` (implementation)

### 2.1 usePresence Hook

Create `packages/puck-css/src/hooks/usePresence.ts`:

```typescript
export interface UsePresenceOptions {
  /** Polling interval in ms (default: 5000) */
  pollingInterval?: number;
  /** Include self in presence list (default: true) */
  includeSelf?: boolean;
}

export interface UsePresenceReturn {
  /** All actors present in the document */
  actors: ActorPresence[];
  /** Actors currently editing */
  editingActors: ActorPresence[];
  /** Human actors only */
  humans: ActorPresence[];
  /** Agent actors only */
  agents: ActorPresence[];
  /** Whether any human is actively editing */
  hasActiveHumans: boolean;
  /** Whether any agent is actively editing */
  hasActiveAgents: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Force refresh presence data */
  refresh: () => Promise<void>;
}

export function usePresence(options?: UsePresenceOptions): UsePresenceReturn;
```

Implementation notes:
- Uses polling by default (WebSocket presence via Yjs awareness is separate)
- Merges API presence with WebSocket awareness for complete picture
- Deduplicates actors by actorId
- Filters out self by default (configurable)

### 2.2 useBranchPresence Hook

Create `packages/puck-css/src/hooks/useBranchPresence.ts`:

```typescript
export interface UseBranchPresenceReturn {
  /** Branch presence summary */
  presence: BranchPresence | null;
  /** Documents with active collaborators */
  activeDocuments: DocumentPresenceSummary[];
  /** Total collaborators across branch */
  totalActors: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refresh presence data */
  refresh: () => Promise<void>;
}

export function useBranchPresence(options?: { pollingInterval?: number }): UseBranchPresenceReturn;
```

### 2.3 Enhanced Yjs Awareness Integration

Update `packages/puck-css/src/hooks/useRealtime.ts`:

```typescript
// Add awareness-related returns
export interface UseRealtimeReturn {
  // Existing
  connected: boolean;
  applyLocalChange: (data: PuckData) => void;
  getSnapshot: () => PuckData | null;
  error: Error | null;

  // New - Presence via Yjs Awareness
  awareness: {
    localActor: ActorPresence | null;
    remoteActors: ActorPresence[];
    updateState: (state: 'active' | 'idle' | 'editing') => void;
    updateIntent: (intent: string) => void;
    updateFocusRegions: (regions: string[]) => void;
  };
}
```

**Deliverables:**
- [x] `usePresence.ts` hook with polling
- [x] `useBranchPresence.ts` hook
- [x] `useSitePresence.ts` hook (added)
- [x] `PresenceContext.tsx` for context-based dependency injection
- [ ] Enhanced `useRealtime.ts` with awareness (deferred to Phase 3)
- [x] Integration tests for presence hooks (27 tests)
- [x] Export hooks from package index

---

## Phase 3: Presence UI Components ✅ COMPLETE

**Goal:** Create visual components for displaying presence information.

**Status:** Complete (2026-01-27)
**Commits:** `0db97a5` (tests), `85ab8ae` (implementation)

### 3.1 CollaboratorAvatars Component

Create `packages/puck-css/src/components/CollaboratorAvatars.tsx`:

```typescript
export interface CollaboratorAvatarsProps {
  /** Maximum avatars to show before "+N" */
  maxVisible?: number;
  /** Show agents separately from humans */
  separateAgents?: boolean;
  /** Click handler for avatar */
  onAvatarClick?: (actor: ActorPresence) => void;
  /** Custom className */
  className?: string;
}

/**
 * Displays stacked avatars of collaborators with tooltips showing names/intents.
 * Automatically updates based on usePresence hook.
 */
export function CollaboratorAvatars(props: CollaboratorAvatarsProps): JSX.Element;
```

Visual design:
- Circular avatars with initials/images
- Agent avatars have a distinct icon/badge (robot indicator)
- Tooltip shows: name, role, state, intent (if agent)
- "Editing" indicator (pulsing border or badge)
- "+3 more" overflow indicator

### 3.2 PresenceIndicator Component

Create `packages/puck-css/src/components/PresenceIndicator.tsx`:

```typescript
export interface PresenceIndicatorProps {
  /** Show detailed presence panel on click */
  expandable?: boolean;
  /** Position of expanded panel */
  panelPosition?: 'top' | 'bottom';
  /** Custom className */
  className?: string;
}

/**
 * Compact indicator showing presence count with expandable details panel.
 * Shows: "3 collaborators" with breakdown on expand.
 */
export function PresenceIndicator(props: PresenceIndicatorProps): JSX.Element;
```

Expanded panel shows:
- List of all collaborators
- State badges (active/idle/editing)
- Focus regions for each actor
- "Kick" button for agents (admin only)

### 3.3 AgentActivityBanner Component

Create `packages/puck-css/src/components/AgentActivityBanner.tsx`:

```typescript
export interface AgentActivityBannerProps {
  /** Show even when agent is idle */
  showIdle?: boolean;
  /** Allow dismissing the banner */
  dismissible?: boolean;
  /** Custom className */
  className?: string;
}

/**
 * Banner shown when an agent is actively editing the document.
 * Displays agent name, intent, and affected regions.
 */
export function AgentActivityBanner(props: AgentActivityBannerProps): JSX.Element;
```

Banner content:
- Agent avatar and name
- Current intent (e.g., "Optimizing layout for mobile")
- Affected regions highlighted
- "Stop Agent" button (calls kick API)

### 3.4 FocusRegionHighlight Component

Create `packages/puck-css/src/components/FocusRegionHighlight.tsx`:

```typescript
export interface FocusRegionHighlightProps {
  /** Actor whose regions to highlight */
  actor: ActorPresence;
  /** Color for highlight (auto-assigned if not provided) */
  color?: string;
}

/**
 * Overlays visual highlights on Puck components that match actor's focusRegions.
 * Integrates with Puck's component tree.
 */
export function FocusRegionHighlight(props: FocusRegionHighlightProps): JSX.Element;
```

Implementation notes:
- Maps JSON paths (e.g., `/content/0`) to Puck component IDs
- Renders colored borders/overlays on affected components
- Different colors per actor for multi-collaborator scenarios
- Subtle animation for "editing" state

**Deliverables:**
- [x] `CollaboratorAvatars.tsx` component
- [x] `PresenceIndicator.tsx` component
- [x] `AgentActivityBanner.tsx` component
- [x] `FocusRegionHighlight.tsx` component
- [ ] Styles in `presence.css` (deferred - inline styles used)
- [ ] Storybook stories for all components (deferred)
- [x] Unit tests for components (42 tests)

---

## Phase 4: Agent Edit Workflow Hooks ✅ COMPLETE

**Goal:** Create hooks for managing agent edit operations from the UI.

**Status:** Complete (2026-01-27)
**Commits:** `adaca01` (tests), `e546e2e` (implementation)

### 4.1 useAgentEdit Hook

Create `packages/puck-css/src/hooks/useAgentEdit.ts`:

```typescript
export interface UseAgentEditOptions {
  /** Agent ID to use for operations */
  agentId: string;
  /** Callback when edit permission is denied */
  onDenied?: (reason: string, conflictingRegions?: string[]) => void;
  /** Callback when edit completes successfully */
  onComplete?: (checkpointId: string) => void;
  /** Callback when edit is aborted */
  onAborted?: () => void;
}

export interface UseAgentEditReturn {
  /** Check if agent can edit specified regions */
  canEdit: (params: {
    trigger: 'human_requested' | 'autonomous';
    intent: string;
    targetRegions: string[];
    requestedById?: string;
  }) => Promise<AgentEditPermission>;

  /** Start an edit session */
  startEdit: (params: {
    trigger: 'human_requested' | 'autonomous';
    intent: string;
    targetRegions: string[];
    requestedById?: string;
  }) => Promise<AgentEditSession>;

  /** Complete the current edit session */
  completeEdit: () => Promise<void>;

  /** Abort the current edit session */
  abortEdit: () => Promise<void>;

  /** Current session info */
  session: AgentEditSession | null;

  /** Whether an edit session is active */
  isEditing: boolean;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: Error | null;
}

export function useAgentEdit(options: UseAgentEditOptions): UseAgentEditReturn;
```

### 4.2 useAgentTrigger Hook

Create `packages/puck-css/src/hooks/useAgentTrigger.ts`:

```typescript
export interface UseAgentTriggerOptions {
  /** List of available agents */
  agents: RegisteredAgent[];
}

export interface AgentAction {
  agentId: string;
  intent: string;
  targetRegions: string[];
  operationType?: string;
}

export interface UseAgentTriggerReturn {
  /** Trigger a human-requested agent action */
  triggerAgent: (action: AgentAction) => Promise<{
    success: boolean;
    checkpointId?: string;
    error?: string;
  }>;

  /** Currently running agent action */
  activeAction: AgentAction | null;

  /** Progress/status of current action */
  status: 'idle' | 'checking' | 'starting' | 'editing' | 'completing' | 'error';

  /** Cancel the current agent action */
  cancelAction: () => Promise<void>;
}

export function useAgentTrigger(options: UseAgentTriggerOptions): UseAgentTriggerReturn;
```

This hook wraps the full agent edit workflow for human-initiated actions:
1. Calls `canEdit` with `trigger: 'human_requested'`
2. Calls `startEdit` to reserve the session
3. Monitors for completion signal from agent
4. Calls `completeEdit` when done

**Deliverables:**
- [x] `useAgentEdit.ts` hook
- [x] `useAgentTrigger.ts` hook
- [x] Integration tests (19 tests)
- [x] Export hooks from package index

---

## Phase 5: Agent Action UI Components ✅ COMPLETE

**Goal:** Create UI for triggering and managing agent actions.

**Status:** Complete (2026-01-27)
**Commits:** `4b1dc53` (tests), `c82c0da` (implementation)

### 5.1 AgentActionButton Component

Create `packages/puck-css/src/components/AgentActionButton.tsx`:

```typescript
export interface AgentActionButtonProps {
  /** Agent to trigger */
  agent: RegisteredAgent;
  /** Action to perform */
  action: {
    intent: string;
    targetRegions: string[];
    operationType?: string;
  };
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Children (button content) */
  children: React.ReactNode;
  /** Custom className */
  className?: string;
}

/**
 * Button that triggers a human-requested agent action.
 * Shows loading state and handles errors.
 */
export function AgentActionButton(props: AgentActionButtonProps): JSX.Element;
```

### 5.2 AgentActionModal Component

Create `packages/puck-css/src/components/AgentActionModal.tsx`:

```typescript
export interface AgentActionModalProps {
  /** Whether modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Available agents */
  agents: RegisteredAgent[];
  /** Pre-selected target regions */
  targetRegions?: string[];
}

/**
 * Modal for selecting an agent and configuring an action.
 * Shows agent list, intent input, region selection.
 */
export function AgentActionModal(props: AgentActionModalProps): JSX.Element;
```

### 5.3 AgentStatusPanel Component

Create `packages/puck-css/src/components/AgentStatusPanel.tsx`:

```typescript
export interface AgentStatusPanelProps {
  /** Agent to display status for */
  agent: RegisteredAgent;
  /** Current action if any */
  activeAction?: AgentAction;
  /** Show in compact mode */
  compact?: boolean;
}

/**
 * Panel showing an agent's current status and activity.
 * Includes progress indicator, intent, and cancel button.
 */
export function AgentStatusPanel(props: AgentStatusPanelProps): JSX.Element;
```

**Deliverables:**
- [x] `AgentActionButton.tsx` component
- [x] `AgentActionModal.tsx` component
- [x] `AgentStatusPanel.tsx` component
- [ ] Styles in `agent-actions.css` (deferred - inline styles used)
- [ ] Storybook stories (deferred)
- [x] Unit tests (33 tests)

---

## Phase 6: Enhanced Version History ✅ COMPLETE

**Goal:** Show agent attribution in version history and checkpoints.

**Status:** Complete (2026-01-27)
**Commits:** `9bff025` (tests), `32ffa1a` (implementation)

### 6.1 Enhanced Checkpoint Types

Update checkpoint types in `packages/css-client/src/types.ts`:

```typescript
export interface Checkpoint {
  // Existing fields
  id: string;
  branchId: string;
  name?: string;
  message?: string;
  createdAt: string;

  // New agent politeness fields
  description?: string;
  trigger?: 'manual' | 'human_requested' | 'autonomous';
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdByName?: string;  // Populated from join
  requestedById?: string;
  requestedByName?: string;  // Populated from join
  operationType?: string;
  affectedRegions?: string[];
  status?: 'completed' | 'rolled_back' | 'partial';
  rolledBackById?: string;
  rolledBackAt?: string;
}
```

### 6.2 Enhanced Version Item Component

Update `packages/puck-css/src/components/VersionItem.tsx`:

```typescript
export interface VersionItemProps {
  version: DocumentVersion;
  checkpoint?: Checkpoint;
  /** Show agent-specific info */
  showAgentInfo?: boolean;
  // ... existing props
}

/**
 * Enhanced to show:
 * - Agent icon/badge for agent-created versions
 * - Trigger type badge (human_requested vs autonomous)
 * - Requested by info for human_requested
 * - Rollback status indicator
 */
```

### 6.3 AgentCheckpointBadge Component

Create `packages/puck-css/src/components/AgentCheckpointBadge.tsx`:

```typescript
export interface AgentCheckpointBadgeProps {
  checkpoint: Checkpoint;
  /** Show detailed tooltip */
  showTooltip?: boolean;
}

/**
 * Badge indicating a checkpoint was created by an agent.
 * Tooltip shows: agent name, trigger type, operation type, affected regions.
 */
export function AgentCheckpointBadge(props: AgentCheckpointBadgeProps): JSX.Element;
```

**Deliverables:**
- [x] Updated checkpoint types (added agent politeness fields, CheckpointStatus type)
- [x] Enhanced `VersionItem.tsx` component
- [x] `AgentCheckpointBadge.tsx` component
- [x] Updated version history UI (version-history barrel export)
- [x] Unit tests (24 tests)

---

## Phase 7: Conflict Notification System ✅ COMPLETE

**Goal:** Real-time notifications for collaboration conflicts.

**Status:** Complete (2026-01-27)
**Commits:** `9fdb678` (tests), `ccf11e2` (implementation)

### 7.1 useConflictNotifications Hook

Create `packages/puck-css/src/hooks/useConflictNotifications.ts`:

```typescript
export interface ConflictNotification {
  id: string;
  type: 'agent_editing' | 'human_conflict' | 'agent_checkpoint' | 'agent_kicked';
  agentId?: string;
  agentName?: string;
  conflictingRegions?: string[];
  message: string;
  timestamp: string;
}

export interface UseConflictNotificationsReturn {
  /** Active conflict notifications */
  notifications: ConflictNotification[];
  /** Dismiss a notification */
  dismiss: (id: string) => void;
  /** Dismiss all notifications */
  dismissAll: () => void;
}

export function useConflictNotifications(): UseConflictNotificationsReturn;
```

Listens to:
- WebSocket messages of type `conflict`, `agent_checkpoint`, `agent_kicked`
- Presence changes indicating new editors in regions

### 7.2 ConflictNotificationToast Component

Create `packages/puck-css/src/components/ConflictNotificationToast.tsx`:

```typescript
export interface ConflictNotificationToastProps {
  notification: ConflictNotification;
  onDismiss: () => void;
  onAction?: () => void;
  actionLabel?: string;
}

/**
 * Toast notification for collaboration conflicts.
 * Shows conflict details with action buttons.
 */
export function ConflictNotificationToast(props: ConflictNotificationToastProps): JSX.Element;
```

**Deliverables:**
- [x] `useConflictNotifications.ts` hook (subscribes to WebSocket events)
- [x] `ConflictNotificationToast.tsx` component
- [x] WebSocket message handling for conflicts (conflict, agent_checkpoint, agent_kicked)
- [x] Unit tests (28 tests)

---

## Phase 8: Plugin Integration

**Goal:** Integrate presence and agent features into the Puck plugin.

### 8.1 Enhanced createCSSPlugin

Update `packages/puck-css/src/plugin/createCSSPlugin.ts`:

```typescript
export interface CSSPluginOptions {
  // Existing
  showBranchSelector?: boolean;
  showDocumentList?: boolean;
  showVersionHistory?: boolean;

  // New presence options
  showPresenceIndicator?: boolean;
  showAgentActivity?: boolean;
  showFocusRegions?: boolean;

  // New agent options
  availableAgents?: RegisteredAgent[];
  showAgentActions?: boolean;
  onAgentAction?: (action: AgentAction) => void;
}
```

Plugin rail additions:
- Presence section showing collaborators
- Agent activity section (when agents are active)
- "Trigger Agent" button (when agents available)

### 8.2 Enhanced createCSSOverrides

Update `packages/puck-css/src/plugin/createCSSOverrides.ts`:

```typescript
export interface CSSOverridesOptions {
  // Existing
  showSaveIndicator?: boolean;
  showPublishButton?: boolean;

  // New
  showCollaboratorAvatars?: boolean;
  showAgentActivityBanner?: boolean;
}
```

Header additions:
- Collaborator avatars (right side of header)
- Agent activity banner (below header when active)

**Deliverables:**
- [ ] Enhanced `createCSSPlugin.ts`
- [ ] Enhanced `createCSSOverrides.ts`
- [ ] Plugin section components
- [ ] Updated demo app with new features
- [ ] Integration tests

---

## Phase 9: Provider Enhancement

**Goal:** Extend CSSPuckProvider to support presence and agent features.

### 9.1 Enhanced CSSPuckProvider Props

Update `packages/puck-css/src/providers/CSSPuckProvider.tsx`:

```typescript
export interface CSSPuckProviderProps {
  // Existing props
  client: CSSClient;
  siteId: string;
  branchId?: string;
  userId: string;
  userName?: string;
  userAvatar?: string;
  // ... other existing props

  // New presence props
  presenceEnabled?: boolean;
  presencePollingInterval?: number;

  // New agent props
  agentModeEnabled?: boolean;
  agentId?: string;  // When this client IS an agent
  agentTrigger?: 'human_requested' | 'autonomous';

  // Callbacks
  onPresenceChange?: (actors: ActorPresence[]) => void;
  onAgentConflict?: (conflict: ConflictNotification) => void;
}
```

### 9.2 Enhanced Context Value

```typescript
export interface CSSPuckContextValue {
  // Existing
  client: CSSClient;
  siteId: string;
  // ... other existing values

  // New presence values
  presence: {
    actors: ActorPresence[];
    humans: ActorPresence[];
    agents: ActorPresence[];
    hasActiveHumans: boolean;
    hasActiveAgents: boolean;
    refresh: () => Promise<void>;
  };

  // New agent values
  agentEdit: UseAgentEditReturn | null;
  triggerAgent: UseAgentTriggerReturn['triggerAgent'] | null;

  // Conflict notifications
  conflicts: ConflictNotification[];
  dismissConflict: (id: string) => void;
}
```

**Deliverables:**
- [ ] Enhanced `CSSPuckProvider.tsx`
- [ ] Enhanced `CSSPuckContext.tsx`
- [ ] Updated `useCSSPuck()` hook
- [ ] Integration tests
- [ ] Updated documentation

---

## Implementation Order

```
Phase 1: API Client Extensions
    ↓
Phase 2: Presence Hooks ←─────────────┐
    ↓                                  │
Phase 3: Presence UI Components ───────┤ (can parallelize)
    ↓                                  │
Phase 4: Agent Edit Workflow Hooks ────┘
    ↓
Phase 5: Agent Action UI Components
    ↓
Phase 6: Enhanced Version History
    ↓
Phase 7: Conflict Notification System
    ↓
Phase 8: Plugin Integration
    ↓
Phase 9: Provider Enhancement
```

Phases 2-4 have interdependencies but can be developed in parallel with careful interface definition.

---

## Testing Strategy

### Unit Tests
- All new endpoint classes
- All new hooks (with mocked clients)
- All new components (with React Testing Library)

### Integration Tests
- Presence polling and WebSocket merge
- Agent edit workflow (full lifecycle)
- Conflict notification flow
- Version history with agent attribution

### E2E Tests (Playwright)
- Multi-user presence scenario
- Agent action trigger and completion
- Conflict detection and resolution
- Version rollback UI

---

## Accessibility Considerations

- Collaborator avatars: Proper alt text and ARIA labels
- Presence panel: Keyboard navigable, screen reader friendly
- Conflict toasts: Auto-announce with ARIA live regions
- Focus region highlights: Sufficient color contrast
- Agent status: Clear textual status for screen readers

---

## Performance Considerations

- Presence polling: Default 5s, configurable
- Debounce presence updates: 100ms
- Lazy load agent components when needed
- Use getter pattern for frequently-updated values
- Memo expensive computations (region overlap detection)

---

## Estimated Scope

| Phase | New Files | Modified Files | Complexity |
|-------|-----------|----------------|------------|
| 1. API Client | 3 | 2 | Medium |
| 2. Presence Hooks | 3 | 1 | Medium |
| 3. Presence UI | 4 | 1 | Medium |
| 4. Agent Hooks | 2 | 0 | High |
| 5. Agent UI | 3 | 0 | Medium |
| 6. Version History | 1 | 2 | Low |
| 7. Conflicts | 2 | 1 | Medium |
| 8. Plugin | 0 | 3 | Medium |
| 9. Provider | 0 | 3 | Medium |

**Total:** ~18 new files, ~13 modified files across 9 phases.

---

## Design Decisions

The following decisions were made during planning:

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | **Presence mechanism** | Hybrid (WebSocket + REST polling) | Agents often operate via REST; graceful fallback when WebSocket disconnects |
| 2 | **Agent color assignment** | Hash-based (derive from agent ID) | Consistent across sessions/clients; no backend changes needed |
| 3 | **Focus region granularity** | Hierarchical JSON paths with prefix matching | Backend stays Puck-agnostic; intuitive parent-child highlighting |
| 4 | **Kill switch permissions** | Branch permission-based (EDITOR/ADMIN) | Aligns with existing RBAC; EDITORs control content and agents |
| 5 | **Offline handling** | Grace period (60 seconds) | Handles network blips; clears stale presence reasonably quickly |
| 6 | **Agent list source** | Fetched from API | Always current status; organization ID derived from site |

### Implementation Notes from Decisions

**1. Hybrid Presence:**
- Primary: Yjs Awareness via WebSocket for real-time updates
- Fallback: REST polling at configurable interval (default 5s)
- Merge both sources, deduplicate by actorId

**2. Hash-based Colors:**
- Use HSL color space for even distribution
- Hash agent ID to hue (0-360), fixed saturation/lightness
- Add collision detection to shift hue if two agents are too similar

**3. Hierarchical Path Matching:**
```typescript
// Example: Agent declares ["/content/0"]
// Highlights: /content/0, /content/0/props, /content/0/props/title, etc.
function pathMatches(declared: string, component: string): boolean {
  return component.startsWith(declared) || declared.startsWith(component);
}
```

**4. Permission Check for Kick:**
```typescript
// In kick handler
if (effectiveRole !== 'EDITOR' && effectiveRole !== 'ADMIN') {
  throw new AuthorizationError('Insufficient permissions to kick agent');
}
```

**5. Grace Period Implementation:**
- On WebSocket disconnect, start 60-second timer
- If reconnect within 60s, cancel timer and preserve presence
- After 60s, remove presence from document session

**6. Agent List Fetching:**
- Fetch on provider mount: `GET /api/organizations/{orgId}/agents?status=active`
- Derive orgId from site: `site.organizationId`
- Refresh on focus or configurable interval
