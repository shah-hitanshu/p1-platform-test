# Agent Politeness System - Implementation Plan

## Overview

This plan implements an "Agent Politeness" system that enables AI agents to collaborate respectfully with human users on documents within the Collaborative State System. The system ensures agents wait for appropriate moments, communicate their intent, and provide clear audit trails.

## Design Decisions Summary

| Area | Decision |
|------|----------|
| Activity detection | Hybrid: user-requested immediate, autonomous waits for idle (org-configurable timeout) |
| Agent identity | Individual agent accounts, registered at org level |
| Audit trail | Agent is actor of record; trigger captured (human_requested / autonomous) with requesting user |
| Presence scope | Document-level, with branch and site rollups |
| Region indicators | Advisory locking on JSON paths; front-end interprets semantics |
| Checkpoint granularity | User-requested: single checkpoint per request; Autonomous: agent-declared batches |
| Checkpoint metadata | Full: description, created_by, trigger, requested_by, operation_type, affected_regions, status, rolled_back_by |
| Intent communication | Presence intent field + checkpoint notifications to collaborators |
| Priority model | Binary for now; design for future tiers at org level |
| Conflict resolution | Region-aware: agent yields on overlap, otherwise Y.js merges |
| Rate limiting | None (trust agents) |
| Kill switch | Document-level kick by any collaborator |
| Organization model | Minimal: ID + config container; sites reference org_id |
| Presence infrastructure | Hybrid: Y.js awareness or API-based, merged for clients |

---

## Phase 1: Organization Foundation

**Goal:** Establish the minimal organization layer that will contain agent configuration and site groupings.

### 1.1 Organization Schema

Create database migration for organizations:

```sql
-- app.organizations table
CREATE TABLE app.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Organization settings schema (in JSONB):
-- {
--   "agentIdleTimeoutMs": 5000,        -- default 5 seconds
--   "agentPriorityTiers": {}           -- future: tier configurations
-- }

-- Add organization_id to sites
ALTER TABLE app.sites
ADD COLUMN organization_id UUID REFERENCES app.organizations(id);

CREATE INDEX idx_sites_organization ON app.sites(organization_id);
```

### 1.2 Organization Types

Add TypeScript types:

```typescript
export interface Organization {
  id: string;
  name: string;
  settings: OrganizationSettings;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSettings {
  agentIdleTimeoutMs: number;  // default: 5000
  agentPriorityTiers?: Record<string, AgentPriorityTier>;  // future
}

export interface AgentPriorityTier {
  name: string;
  idleTimeoutMultiplier: number;
  canInterruptAutonomous: boolean;
}
```

### 1.3 Organization Service

Create `organization-service.ts`:
- `createOrganization(name, settings?)`
- `getOrganization(id)`
- `updateOrganization(id, updates)`
- `getOrganizationSettings(id)`

### 1.4 Organization API Routes

Create `/api/organizations` endpoints:
- `POST /api/organizations` - Create organization
- `GET /api/organizations/:id` - Get organization
- `PATCH /api/organizations/:id` - Update organization
- `GET /api/organizations/:id/sites` - List sites in organization

### 1.5 Update Site Model

- Add `organizationId` to Site interface
- Update site service to require organization on creation
- Update site API to include organization context

**Deliverables:**
- [ ] Migration `006_organizations.sql`
- [ ] Organization types in `types.ts`
- [ ] `organization-service.ts`
- [ ] `organization-api.ts` routes
- [ ] Updated site service and types
- [ ] Tests for all components

---

## Phase 2: Agent Registry

**Goal:** Establish organization-level agent registration and identity management.

### 2.1 Agent Registry Schema

```sql
CREATE TABLE app.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES app.organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE INDEX idx_agents_organization ON app.agents(organization_id);
CREATE INDEX idx_agents_status ON app.agents(status);

-- Agent settings schema:
-- {
--   "priorityTier": "default",         -- future: tier reference
--   "allowedOperationTypes": ["*"],    -- future: operation restrictions
--   "maxConcurrentDocuments": 10       -- future: concurrency limits
-- }
```

### 2.2 Agent Registry Types

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

export interface AgentSettings {
  priorityTier?: string;
  allowedOperationTypes?: string[];
  maxConcurrentDocuments?: number;
}
```

### 2.3 Agent Registry Service

Create `agent-registry-service.ts`:
- `registerAgent(organizationId, name, description?, capabilities?)`
- `getAgent(id)`
- `getAgentByName(organizationId, name)`
- `listAgents(organizationId, filters?)`
- `updateAgent(id, updates)`
- `suspendAgent(id)`
- `activateAgent(id)`
- `disableAgent(id)`

### 2.4 Agent Registry API

Create `/api/organizations/:orgId/agents` endpoints:
- `POST` - Register new agent
- `GET` - List agents
- `GET /:agentId` - Get agent details
- `PATCH /:agentId` - Update agent
- `POST /:agentId/suspend` - Suspend agent
- `POST /:agentId/activate` - Activate agent

**Deliverables:**
- [ ] Migration `007_agent_registry.sql`
- [ ] Agent registry types in `types.ts`
- [ ] `agent-registry-service.ts`
- [ ] `agent-registry-api.ts` routes
- [ ] Tests for all components

---

## Phase 3: Extended Checkpoint Model

**Goal:** Enhance checkpoints with full metadata for agent auditability.

### 3.1 Checkpoint Schema Extension

```sql
-- Add new columns to checkpoints
ALTER TABLE app.checkpoints
ADD COLUMN description TEXT,
ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'
  CHECK (trigger IN ('manual', 'human_requested', 'autonomous')),
ADD COLUMN requested_by_id UUID,
ADD COLUMN operation_type TEXT,
ADD COLUMN affected_regions JSONB DEFAULT '[]',
ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('completed', 'rolled_back', 'partial')),
ADD COLUMN rolled_back_by_id UUID,
ADD COLUMN rolled_back_at TIMESTAMPTZ;

CREATE INDEX idx_checkpoints_trigger ON app.checkpoints(trigger);
CREATE INDEX idx_checkpoints_status ON app.checkpoints(status);
CREATE INDEX idx_checkpoints_operation_type ON app.checkpoints(operation_type);
```

### 3.2 Extended Checkpoint Types

```typescript
export type CheckpointTrigger = 'manual' | 'human_requested' | 'autonomous';
export type CheckpointStatus = 'completed' | 'rolled_back' | 'partial';

export interface Checkpoint {
  id: string;
  branchId: string;
  name?: string;
  message?: string;
  description?: string;  // NEW: detailed reason for checkpoint
  checkpointType: CheckpointType;
  trigger: CheckpointTrigger;  // NEW: what initiated the checkpoint
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  requestedById?: string;  // NEW: user who requested (if human_requested)
  operationType?: string;  // NEW: category of operation (layout_optimization, etc.)
  affectedRegions: string[];  // NEW: JSON paths affected
  status: CheckpointStatus;  // NEW: current status
  rolledBackById?: string;  // NEW: who rolled back (if applicable)
  rolledBackAt?: string;  // NEW: when rolled back
  createdAt: string;
}

export interface CreateCheckpointParams {
  branchId: string;
  name?: string;
  message?: string;
  description?: string;
  checkpointType?: CheckpointType;
  trigger: CheckpointTrigger;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  requestedById?: string;
  operationType?: string;
  affectedRegions?: string[];
}
```

### 3.3 Update Checkpoint Service

Extend `checkpoint-service.ts`:
- Update `createCheckpoint()` to accept new fields
- Add `updateCheckpointStatus(id, status, rolledBackById?)`
- Add `listCheckpointsByAgent(agentId, filters?)`
- Add `listCheckpointsByOperationType(branchId, operationType)`

### 3.4 Rollback Enhancement

- When `revertToCheckpoint()` is called, update the checkpoint's status to 'rolled_back'
- Record who performed the rollback and when

**Deliverables:**
- [ ] Migration `008_checkpoint_extensions.sql`
- [ ] Updated checkpoint types in `types.ts`
- [ ] Updated `checkpoint-service.ts`
- [ ] Tests for new checkpoint functionality

---

## Phase 4: Presence System

**Goal:** Implement document-level presence with support for both Y.js awareness and API-based presence.

### 4.1 Presence Types

```typescript
export type ActorState = 'active' | 'idle' | 'editing';
export type ActorRole = 'human' | 'agent';

export interface ActorPresence {
  id: string;
  actorId: string;
  actorType: ActorType;  // existing: 'user' | 'agent' | 'guest' | 'service' | 'system'
  role: ActorRole;  // simplified: 'human' | 'agent'
  name: string;
  avatar?: string;
  state: ActorState;
  intent?: string;  // what the actor is currently doing
  focusRegions?: string[];  // JSON paths the actor is working on (advisory locks)
  lastActivityAt: string;
  joinedAt: string;
}

export interface PresenceUpdate {
  state?: ActorState;
  intent?: string;
  focusRegions?: string[];
}

export interface DocumentPresence {
  documentId: string;
  branchId: string;
  siteId: string;
  actors: ActorPresence[];
  lastUpdatedAt: string;
}
```

### 4.2 Presence in Document Session DO

Extend `document-session.ts`:

```typescript
// Add to state
private presence: Map<string, ActorPresence> = new Map();
private apiPresence: Map<string, ActorPresence> = new Map();  // API-registered presence

// New endpoints
POST /presence - Register/update presence via API
DELETE /presence/:actorId - Remove presence
GET /presence - Get all presence data
POST /presence/:actorId/kick - Kick an actor (agents only)

// Merge WebSocket presence with API presence for clients
private getMergedPresence(): ActorPresence[]
```

### 4.3 Y.js Awareness Integration

For WebSocket-connected clients:
- Initialize Y.js Awareness alongside the Y.Doc
- Broadcast presence changes through awareness protocol
- Merge awareness state with API-based presence

```typescript
import { Awareness } from 'y-protocols/awareness';

// In DocumentSession
private awareness: Awareness;

// On WebSocket connection
this.awareness.setLocalStateField('presence', actorPresence);

// Sync awareness to all connected clients
this.awareness.on('change', () => this.broadcastPresence());
```

### 4.4 Presence Service

Create `presence-service.ts` for aggregation queries:
- `getDocumentPresence(siteId, branchId, documentPath)`
- `getBranchPresence(siteId, branchId)` - rollup of all documents
- `getSitePresence(siteId)` - rollup of all branches
- `getAgentPresence(agentId)` - where is this agent active

### 4.5 Presence API Routes

Add to realtime API:
- `POST /api/.../documents/:path/presence` - Register presence
- `PATCH /api/.../documents/:path/presence` - Update presence
- `DELETE /api/.../documents/:path/presence` - Leave document
- `GET /api/.../documents/:path/presence` - Get presence
- `POST /api/.../documents/:path/presence/:actorId/kick` - Kick actor

Add rollup endpoints:
- `GET /api/sites/:siteId/branches/:branchId/presence` - Branch presence
- `GET /api/sites/:siteId/presence` - Site presence

**Deliverables:**
- [ ] Presence types in `types.ts`
- [ ] Updated `document-session.ts` with presence management
- [ ] Y.js Awareness integration
- [ ] `presence-service.ts`
- [ ] Presence API routes
- [ ] Tests for presence system

---

## Phase 5: Activity Detection

**Goal:** Implement idle detection to determine when agents can safely make autonomous changes.

### 5.1 Activity Tracking in Document Session

Extend `document-session.ts`:

```typescript
// Track last human edit
private lastHumanEditAt: number = 0;
private humanEditingRegions: Set<string> = new Set();

// On any edit from a human actor
private recordHumanActivity(actorId: string, regions: string[]) {
  this.lastHumanEditAt = Date.now();
  regions.forEach(r => this.humanEditingRegions.add(r));
  // Clear regions after idle timeout
  this.scheduleRegionClear();
}
```

### 5.2 Agent Edit Gating

```typescript
export interface AgentEditContext {
  agentId: string;
  trigger: 'human_requested' | 'autonomous';
  requestedById?: string;
  intent: string;
  targetRegions: string[];
  operationType?: string;
}

// New endpoint
POST /can-agent-edit - Check if agent can proceed
// Returns: { allowed: boolean, reason?: string, conflictingRegions?: string[] }

POST /agent-edit-start - Agent declares intent to edit
// Creates checkpoint if autonomous, registers focus regions

POST /agent-edit-complete - Agent finished editing
// Clears focus regions, updates checkpoint status
```

### 5.3 Idle Timeout Logic

```typescript
async canAgentEdit(context: AgentEditContext): Promise<AgentEditPermission> {
  // User-requested work always allowed
  if (context.trigger === 'human_requested') {
    return { allowed: true };
  }

  // Get organization settings for idle timeout
  const org = await this.getOrganization();
  const idleTimeoutMs = org.settings.agentIdleTimeoutMs;

  // Check if humans are idle
  const timeSinceHumanEdit = Date.now() - this.lastHumanEditAt;
  if (timeSinceHumanEdit < idleTimeoutMs) {
    return {
      allowed: false,
      reason: 'human_active',
      retryAfterMs: idleTimeoutMs - timeSinceHumanEdit
    };
  }

  // Check for region conflicts
  const conflictingRegions = context.targetRegions.filter(
    r => this.isRegionConflicting(r)
  );
  if (conflictingRegions.length > 0) {
    return {
      allowed: false,
      reason: 'region_conflict',
      conflictingRegions
    };
  }

  return { allowed: true };
}
```

### 5.4 Region Conflict Detection

```typescript
// Check if a region overlaps with human activity
private isRegionConflicting(region: string): boolean {
  for (const humanRegion of this.humanEditingRegions) {
    if (this.regionsOverlap(region, humanRegion)) {
      return true;
    }
  }
  return false;
}

// JSON path overlap detection
private regionsOverlap(a: string, b: string): boolean {
  // /content/0 overlaps with /content/0/props
  // /content/0 does not overlap with /content/1
  return a.startsWith(b) || b.startsWith(a);
}
```

**Deliverables:**
- [ ] Activity tracking in `document-session.ts`
- [ ] Agent edit gating logic
- [ ] Region conflict detection
- [ ] API endpoints for agent coordination
- [ ] Tests for activity detection

---

## Phase 6: Agent Edit Workflow

**Goal:** Implement the full agent edit lifecycle with checkpoints and notifications.

### 6.1 Agent Edit Lifecycle

```
1. Agent calls POST /can-agent-edit
   - If not allowed, agent waits and retries

2. Agent calls POST /agent-edit-start
   - System creates checkpoint (if autonomous)
   - System registers agent's focus regions
   - System updates agent's presence with intent

3. Agent makes edits via POST /apply
   - Normal edit flow
   - If human starts editing overlapping region:
     a. Agent receives conflict notification via WebSocket/polling
     b. Agent should stop and call /agent-edit-abort

4. Agent calls POST /agent-edit-complete
   - System clears agent's focus regions
   - System updates checkpoint status if needed
   - System updates agent's presence
```

### 6.2 Conflict Notification

For WebSocket-connected agents:
```typescript
// Broadcast to agent when conflict detected
{
  type: 'conflict',
  conflictingRegions: ['/content/0'],
  humanActorId: '...',
  message: 'Human started editing in your region'
}
```

For API-based agents:
```typescript
// GET /agent-edit-status returns current conflict state
{
  hasConflict: boolean,
  conflictingRegions?: string[],
  shouldAbort: boolean
}
```

### 6.3 Agent Edit Abort

```typescript
POST /agent-edit-abort
// Rolls back to the checkpoint created at edit-start
// Clears agent's focus regions
// Updates checkpoint status to 'rolled_back'
```

### 6.4 Checkpoint Notifications to Collaborators

When an agent creates a checkpoint:
```typescript
// Broadcast to all connected clients
{
  type: 'agent_checkpoint',
  agentId: '...',
  agentName: 'ContentOptimizer',
  checkpointId: '...',
  description: 'Optimizing hero section layout',
  operationType: 'layout_optimization',
  affectedRegions: ['/content/hero']
}
```

**Deliverables:**
- [ ] Agent edit lifecycle endpoints
- [ ] Conflict notification system
- [ ] Abort and rollback logic
- [ ] Checkpoint notification broadcasts
- [ ] Tests for agent edit workflow

---

## Phase 7: API Integration

**Goal:** Expose agent politeness features through the REST API.

### 7.1 Agent Context Headers

Agents must provide context in API requests:

```
X-Agent-Id: <agent-uuid>
X-Agent-Trigger: human_requested | autonomous
X-Agent-Requested-By: <user-uuid>  (when human_requested)
X-Agent-Intent: <description of what agent is doing>
X-Agent-Operation-Type: <category>
X-Agent-Target-Regions: <comma-separated JSON paths>
```

### 7.2 Enhanced Edit Endpoint

Update `POST /api/.../documents/:path/edits`:
- Validate agent context headers
- Check agent status (not suspended)
- For autonomous: validate edit permission
- Create checkpoint if needed
- Apply edits
- Record audit trail

### 7.3 Agent-Specific Endpoints

```
POST /api/.../documents/:path/agent/can-edit
POST /api/.../documents/:path/agent/start
POST /api/.../documents/:path/agent/complete
POST /api/.../documents/:path/agent/abort
GET  /api/.../documents/:path/agent/status
```

**Deliverables:**
- [ ] Agent context header validation middleware
- [ ] Enhanced edit endpoint
- [ ] Agent-specific API endpoints
- [ ] API documentation
- [ ] Tests for API integration

---

## Phase 8: Presence Rollups and Queries

**Goal:** Implement branch and site-level presence aggregation.

### 8.1 Branch Presence Rollup

```typescript
interface BranchPresence {
  branchId: string;
  siteId: string;
  summary: {
    totalActors: number;
    humanCount: number;
    agentCount: number;
    editingCount: number;
  };
  actors: ActorPresence[];  // aggregated from all documents
  documentSummary: Array<{
    documentPath: string;
    actorCount: number;
    hasHumans: boolean;
    hasAgents: boolean;
  }>;
}
```

### 8.2 Site Presence Rollup

```typescript
interface SitePresence {
  siteId: string;
  summary: {
    totalActors: number;
    humanCount: number;
    agentCount: number;
    activeBranches: number;
  };
  branches: Array<{
    branchId: string;
    branchName: string;
    actorCount: number;
    hasHumans: boolean;
    hasAgents: boolean;
  }>;
}
```

### 8.3 Presence Query API

```
GET /api/sites/:siteId/presence
GET /api/sites/:siteId/branches/:branchId/presence
GET /api/organizations/:orgId/agents/:agentId/presence
```

**Deliverables:**
- [ ] Branch presence aggregation
- [ ] Site presence aggregation
- [ ] Agent presence queries
- [ ] Presence API endpoints
- [ ] Tests for presence rollups

---

## Implementation Order and Dependencies

```
Phase 1: Organization Foundation
    ↓
Phase 2: Agent Registry
    ↓
Phase 3: Extended Checkpoint Model
    ↓
Phase 4: Presence System ←──────────────┐
    ↓                                    │
Phase 5: Activity Detection ─────────────┤ (parallel possible)
    ↓                                    │
Phase 6: Agent Edit Workflow ────────────┘
    ↓
Phase 7: API Integration
    ↓
Phase 8: Presence Rollups
```

Phases 4, 5, and 6 have interdependencies but can be developed in parallel with careful interface definition.

---

## Testing Strategy

Each phase includes:
1. Unit tests for services
2. Integration tests for API endpoints
3. Durable Object tests for DO behavior

Key test scenarios:
- Agent waits for human idle before autonomous edit
- Agent proceeds immediately for user-requested edit
- Agent yields when human enters its region
- Checkpoint created with full metadata
- Rollback updates checkpoint status
- Presence merges WebSocket and API sources
- Kick removes agent from document
- Branch/site presence correctly aggregates

---

## Future Considerations (Out of Scope)

These items are noted for future development:

1. **Priority Tiers**: Configurable priority levels for autonomous agents
2. **Rate Limiting**: Per-agent operation limits
3. **Organization Membership**: User-to-organization mapping
4. **Agent Permissions**: Fine-grained operation type restrictions
5. **Presence Visualization**: UI components for puck-css-integration
6. **Checkpoint Visualization**: Version list with agent attribution in UI
7. **Agent Analytics**: Usage and conflict metrics

---

## Migration Path

For existing deployments:
1. Run organization migration - creates table, adds nullable FK to sites
2. Create default organization for existing sites
3. Update sites to reference default organization
4. Make organization_id NOT NULL
5. Run remaining migrations in order
6. Deploy updated workers
7. Register existing agents in new registry

---

## Estimated Scope

| Phase | New Files | Modified Files | Complexity |
|-------|-----------|----------------|------------|
| 1. Organization | 4 | 3 | Medium |
| 2. Agent Registry | 3 | 2 | Medium |
| 3. Checkpoint Extension | 1 | 2 | Low |
| 4. Presence System | 3 | 2 | High |
| 5. Activity Detection | 0 | 2 | High |
| 6. Agent Edit Workflow | 1 | 2 | High |
| 7. API Integration | 1 | 3 | Medium |
| 8. Presence Rollups | 1 | 2 | Medium |

Total: ~14 new files, ~12 modified files across 8 phases.
