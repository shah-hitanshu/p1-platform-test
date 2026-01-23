# Collaborative JSON State Versioning System

## Architecture Specification

**Version:** 1.0  
**Status:** Design Complete, Ready for Implementation

---

## Executive Summary

This document specifies the architecture for a system that stores JSON state objects (representing UI components, configurations, and content) with git-like branching and merging capabilities, while supporting real-time collaborative editing within documents.

The system serves content management use cases where teams collaborate on initiatives spanning multiple documentsâ€”such as website campaigns, component migrations, or content updatesâ€”with the ability to branch work, collaborate in real-time, and merge changes back to a main branch.

---

## Core Concepts

### Change Set

A Change Set is a scoped collection of modifications to content, component usage, component prop configuration, templates, or media. Change Sets are typically scoped to a single site and contain related documents and branches that represent the work being done. A Change Set provides the container for tracking, reviewing, and merging changes back to the live/published state.

### Document

A document is a single JSON object representing a page, component definition, form configuration, or other discrete unit of content. Documents are identified by a path within the change_set (e.g., `pages/home`, `components/header`).

### Branch

A branch represents a **named initiative or changeset** that one or more people collaborate on. Unlike git branches (which are personal change_sets), branches in this system are shared contexts for specific work:

- "Q4 Holiday Campaign" â€” marketing team updating multiple pages
- "Fix typo on About page" â€” single contributor, single document
- "Replace legacy Button component" â€” design system team, many documents

Branches are created and merged explicitly by users or AI agents, not through arbitrary editing actions.

### Checkpoint

A checkpoint is a named snapshot of branch state at a point in time. Checkpoints serve as:

- Semantic markers ("Ready for review", "Client approved")
- Rollback points
- Merge bases for conflict detection

Checkpoints are optionalâ€”the system auto-saves continuously, and checkpoints mark meaningful moments rather than enabling persistence.

### Live State

The current working state of documents on a branch, maintained via CRDT (Conflict-free Replicated Data Type) for real-time collaboration. Live state is always persisted; there is no "unsaved work."

---

## Key Design Decisions

### Decision 1: Two-Tier Synchronization Model

**Choice:** Real-time CRDT sync within documents, asynchronous git-style versioning across documents.

**Rationale:** Different scopes have different collaboration patterns. Within a document, users expect Google Docs-style real-time collaboration. Across documents, teams need isolated branches for parallel initiatives that merge explicitly.

**Tradeoff:** Increased system complexity. The benefit is that each tier uses the approach optimized for its use case.

### Decision 2: Branch-Scoped Document Sessions

**Choice:** Each branch maintains its own CRDT session for each document. Users on the same branch collaborate in real-time; users on different branches see independent document states.

**Rationale:** Branches represent isolated initiatives. If Alice is working on the holiday campaign and Bob is fixing a typo on main, they should not see each other's in-progress changes until merge.

**Tradeoff:** Memory and storage overhead for multiple CRDT sessions per document. Mitigated by lazy session creation.

### Decision 3: Auto-Save with Explicit Checkpoints

**Choice:** All edits are immediately persisted via CRDT. Checkpoints are explicit, optional markers.

**Rationale:** Modern users expect auto-save. Requiring explicit saves creates risk of lost work and friction in collaboration. Checkpoints provide version history benefits without save-button UX.

**Tradeoff:** Cannot discard uncommitted changes by "not saving." Users must explicitly revert to a checkpoint. This matches user expectations from tools like Figma and Google Docs.

### Decision 4: CRDT-Based Conflict Resolution Within Documents

**Choice:** Use Yjs CRDTs for document state. Concurrent edits within a document are automatically merged without conflicts.

**Rationale:** CRDTs guarantee convergenceâ€”two users editing the same document will always arrive at the same state. This eliminates intra-document merge conflicts entirely.

**Tradeoff:** CRDT merge results may occasionally be semantically nonsensical (e.g., two users rewriting the same paragraph differently). The automatic merge preserves both contributions but may require human review. This is preferable to blocking collaboration with conflict markers.

### Decision 5: Document-Level Conflict Detection for Branch Merges

**Choice:** When merging branches, conflicts are detected at the document level. If both branches modified the same document, the user must choose a resolution strategy.

**Rationale:** While CRDTs can technically merge any concurrent changes, cross-branch merges represent deliberate divergent work. Humans should decide how to reconcile "holiday campaign version of homepage" with "bug fix version of homepage."

**Tradeoff:** Merges require more human oversight than pure CRDT systems. This is intentionalâ€”branches represent intentional divergence that should be reconciled thoughtfully.

### Decision 6: Agents as First-Class Collaborators

**Choice:** AI agents interact with the system through the same mechanisms as human usersâ€”joining branches, making edits via CRDT, creating checkpoints, and proposing merges.

**Rationale:** This simplifies the architecture (one collaboration model, not two) and enables natural human-agent collaboration. Agents appear in presence indicators, their edits stream in real-time, and humans can observe or intervene.

**Tradeoff:** Agents must be "polite"â€”pausing when humans are actively editing, rate-limiting their changes to not overwhelm the UI. This requires agent-side courtesy logic.

### Decision 7: PostgreSQL for Version Control, Durable Objects for Real-Time

**Choice:** PostgreSQL (CloudSQL) stores change_set metadata, branches, checkpoints, and document snapshots. Cloudflare Durable Objects host live CRDT sessions.

**Rationale:** PostgreSQL provides transactional guarantees, relational queries, and recursive CTEs for graph traversal (merge-base calculation). Durable Objects provide WebSocket termination, in-memory CRDT state, and automatic persistenceâ€”ideal for real-time collaboration.

**Tradeoff:** Two storage systems to maintain. The clear separation of concerns (version control vs. real-time) justifies this.

### Decision 8: Site Structures with Branch-Versioned Metadata Schemas

**Choice:** Documents are organized into site structures (hierarchical collections). Each structure defines a metadata schema that documents should conform to. Both the structure hierarchy and the schema are versioned per-branch.

**Rationale:** Websites need organizational hierarchy beyond flat document listsâ€”for navigation, URL paths, and content discovery. Metadata requirements vary by content type (blog posts need authors and publish dates; documentation pages need version numbers). Making schemas modifiable and branch-versioned allows teams to evolve requirements without breaking existing content.

**Tradeoff:** Added complexity in merge conflict detection (structure changes can conflict). Schema enforcement must balance strictness with usabilityâ€”we offer configurable enforcement modes (strict, warn, none).

### Decision 9: Separation of Document Content and Structure Metadata

**Choice:** Document content (the JSON state of components) is stored separately from structure metadata (title, description, author, tags). A document can exist in multiple structures with different metadata in each.

**Rationale:** The same content might serve different purposes in different contexts. A case study might appear in both "Resources" and "Customer Stories" with different featured images or descriptions. Separating content from metadata enables this flexibility.

**Tradeoff:** More tables to manage and join. Metadata must be explicitly managed per-structure rather than being intrinsic to the document.

---

## Data Model

### PostgreSQL Schema

```sql
-- Change Sets contain documents and branches
CREATE TABLE change_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents within a change_set
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES change_sets(id),
    path TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(change_set_id, path)
);

CREATE INDEX idx_documents_change_set ON documents(change_set_id);

-- Branches represent initiatives/changesets
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES change_sets(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    -- Valid statuses: 'active', 'review', 'merged', 'archived'
    
    -- Lineage
    source_branch_id UUID REFERENCES branches(id),
    created_from_checkpoint UUID REFERENCES checkpoints(id),
    head_checkpoint_id UUID REFERENCES checkpoints(id),
    
    -- Ownership
    created_by UUID NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(change_set_id, name)
);

CREATE INDEX idx_branches_change_set ON branches(change_set_id);
CREATE INDEX idx_branches_status ON branches(change_set_id, status);

-- Checkpoints are named snapshots within a branch
CREATE TABLE checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    parent_checkpoint_id UUID REFERENCES checkpoints(id),
    
    message TEXT,
    author_id UUID NOT NULL,
    author_type TEXT NOT NULL DEFAULT 'user',
    -- Valid author_types: 'user', 'agent', 'system'
    
    -- For merge checkpoints
    is_merge BOOLEAN DEFAULT FALSE,
    merged_branch_id UUID REFERENCES branches(id),
    
    -- Auto-checkpoints are system-generated (e.g., before merge)
    is_auto BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_checkpoints_branch ON checkpoints(branch_id, created_at DESC);

-- Document snapshots at each checkpoint
CREATE TABLE checkpoint_documents (
    checkpoint_id UUID NOT NULL REFERENCES checkpoints(id),
    document_id UUID NOT NULL REFERENCES documents(id),
    
    -- The JSON state at this checkpoint
    snapshot JSONB NOT NULL,
    
    -- CRDT state vector for CRDT-native merging (optional optimization)
    crdt_state_vector BYTEA,
    
    PRIMARY KEY (checkpoint_id, document_id)
);

-- Tracks which documents have uncommitted changes on each branch
CREATE TABLE branch_document_state (
    branch_id UUID NOT NULL REFERENCES branches(id),
    document_id UUID NOT NULL REFERENCES documents(id),
    
    has_changes_since_checkpoint BOOLEAN DEFAULT FALSE,
    last_modified_at TIMESTAMPTZ,
    last_modified_by UUID,
    last_modified_by_type TEXT,
    -- Valid types: 'user', 'agent'
    
    PRIMARY KEY (branch_id, document_id)
);

-- Branch assignments (users and agents working on a branch)
CREATE TABLE branch_assignments (
    branch_id UUID NOT NULL REFERENCES branches(id),
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,
    -- Valid types: 'user', 'agent'
    
    role TEXT NOT NULL DEFAULT 'collaborator',
    -- Valid roles: 'owner', 'collaborator', 'reviewer'
    
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (branch_id, actor_id)
);

-- AI Agents
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES change_sets(id),
    name TEXT NOT NULL,
    description TEXT,
    
    -- Agent capabilities
    permissions JSONB NOT NULL DEFAULT '{
        "can_create_branches": true,
        "can_edit_documents": true,
        "can_create_checkpoints": true,
        "can_propose_merge": true,
        "can_merge": false,
        "can_merge_to_main": false
    }',
    
    -- Agent configuration
    model TEXT,
    system_prompt TEXT,
    webhook_url TEXT,           -- Optional webhook for task notifications
    webhook_secret TEXT,        -- Secret for webhook authentication
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_change_set ON agents(change_set_id);

-- Audit Log (append-only)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES change_sets(id),
    
    -- What happened
    action TEXT NOT NULL,
    
    -- Who did it
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,  -- 'user', 'agent', 'system'
    
    -- Context
    resource_type TEXT,        -- 'branch', 'document', 'checkpoint', 'agent'
    resource_id UUID,
    branch_id UUID,
    
    -- Details (flexible JSON for action-specific data)
    details JSONB,
    
    -- Outcome
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_change_set_time ON audit_log(change_set_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_action ON audit_log(change_set_id, action);

-- Notification Preferences
CREATE TABLE notification_preferences (
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,  -- 'user', 'agent'
    change_set_id UUID REFERENCES change_sets(id),  -- NULL for global defaults
    
    -- Per-type settings
    preferences JSONB NOT NULL DEFAULT '{
        "branch_assigned": {"enabled": true, "email": true},
        "merge_proposed": {"enabled": true, "email": true},
        "merge_completed": {"enabled": true, "email": false},
        "checkpoint_created": {"enabled": true, "email": false},
        "document_edited": {"enabled": false, "email": false},
        "agent_completed": {"enabled": true, "email": false},
        "agent_needs_help": {"enabled": true, "email": true}
    }',
    
    -- Quiet hours (no notifications)
    quiet_hours_start TIME,    -- e.g., '22:00'
    quiet_hours_end TIME,      -- e.g., '08:00'
    quiet_hours_timezone TEXT DEFAULT 'UTC',
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (actor_id, COALESCE(change_set_id, '00000000-0000-0000-0000-000000000000'))
);

-- Agent Task Queue
CREATE TABLE agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES change_sets(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    
    -- Task definition
    task_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    
    -- Scheduling
    priority INTEGER DEFAULT 0,       -- Higher = more urgent
    scheduled_for TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,           -- Task becomes invalid after this time
    
    -- State
    status TEXT DEFAULT 'pending',
    -- Valid statuses: 'pending', 'processing', 'completed', 'failed', 'expired', 'cancelled'
    
    -- Execution tracking
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    
    -- Results
    result JSONB,
    error_message TEXT,
    
    -- Metadata
    created_by UUID,
    created_by_type TEXT,             -- 'user', 'agent', 'system'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_tasks_pending ON agent_tasks(agent_id, status, priority DESC, scheduled_for)
    WHERE status = 'pending';
CREATE INDEX idx_agent_tasks_change_set ON agent_tasks(change_set_id, created_at DESC);
CREATE INDEX idx_agent_tasks_status ON agent_tasks(change_set_id, status);
```

### Merge Base Calculation

Finding the common ancestor of two branches for merge operations:

```sql
-- Find merge base between two checkpoints
WITH RECURSIVE ancestors AS (
    -- Start from first checkpoint
    SELECT 
        id, 
        parent_checkpoint_id,
        ARRAY[id] as path,
        0 as depth
    FROM checkpoints 
    WHERE id = $1  -- first checkpoint
    
    UNION ALL
    
    SELECT 
        c.id, 
        c.parent_checkpoint_id,
        a.path || c.id,
        a.depth + 1
    FROM checkpoints c
    JOIN ancestors a ON c.id = a.parent_checkpoint_id
    WHERE NOT c.id = ANY(a.path)  -- prevent cycles
      AND a.depth < 1000          -- safety limit
),
first_ancestors AS (
    SELECT id FROM ancestors
),
second_ancestors AS (
    -- Same traversal for second checkpoint
    WITH RECURSIVE anc AS (
        SELECT 
            id, 
            parent_checkpoint_id,
            ARRAY[id] as path,
            0 as depth
        FROM checkpoints 
        WHERE id = $2  -- second checkpoint
        
        UNION ALL
        
        SELECT 
            c.id, 
            c.parent_checkpoint_id,
            a.path || c.id,
            a.depth + 1
        FROM checkpoints c
        JOIN anc a ON c.id = a.parent_checkpoint_id
        WHERE NOT c.id = ANY(a.path)
          AND a.depth < 1000
    )
    SELECT id, depth FROM anc
)
SELECT sa.id 
FROM second_ancestors sa
WHERE sa.id IN (SELECT id FROM first_ancestors)
ORDER BY sa.depth ASC
LIMIT 1;
```

---

## Real-Time Collaboration Layer

### Durable Object: Document Session

Each document on each branch has a dedicated Durable Object that maintains the CRDT state and manages WebSocket connections.

**Session Identifier:** `{change_setId}:{documentId}:{branchId}`

```typescript
// Durable Object implementation
export class DocumentSession {
    private state: DurableObjectState;
    private env: Env;
    private ydoc: Y.Doc;
    private connections: Map<WebSocket, ConnectionMeta>;
    
    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
        this.ydoc = new Y.Doc();
        this.connections = new Map();
    }
    
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        
        switch (url.pathname) {
            case '/connect':
                return this.handleWebSocket(request);
            case '/snapshot':
                return this.handleSnapshot();
            case '/apply':
                return this.handleApplyOperations(request);
            default:
                return new Response('Not found', { status: 404 });
        }
    }
    
    private async handleWebSocket(request: Request): Promise<Response> {
        const [client, server] = Object.values(new WebSocketPair());
        
        await this.initializeIfNeeded();
        
        server.accept();
        
        const meta: ConnectionMeta = {
            actorId: request.headers.get('X-Actor-Id'),
            actorType: request.headers.get('X-Actor-Type') as 'user' | 'agent',
        };
        this.connections.set(server, meta);
        
        // Send current state to new client
        const stateUpdate = Y.encodeStateAsUpdate(this.ydoc);
        server.send(stateUpdate);
        
        // Handle incoming updates
        server.addEventListener('message', async (event) => {
            const update = new Uint8Array(event.data as ArrayBuffer);
            
            // Apply to local doc
            Y.applyUpdate(this.ydoc, update);
            
            // Broadcast to other clients
            for (const [conn, _] of this.connections) {
                if (conn !== server && conn.readyState === WebSocket.OPEN) {
                    conn.send(update);
                }
            }
            
            // Persist to durable storage
            await this.persist();
        });
        
        server.addEventListener('close', () => {
            this.connections.delete(server);
        });
        
        return new Response(null, { status: 101, webSocket: client });
    }
    
    private async handleSnapshot(): Promise<Response> {
        await this.initializeIfNeeded();
        
        const root = this.ydoc.getMap('root');
        const snapshot = root.toJSON();
        const stateVector = Y.encodeStateVector(this.ydoc);
        
        return Response.json({
            snapshot,
            stateVector: Array.from(stateVector),
            connectedActors: Array.from(this.connections.values())
        });
    }
    
    private async handleApplyOperations(request: Request): Promise<Response> {
        await this.initializeIfNeeded();
        
        const { operations, actorId } = await request.json();
        
        // Apply operations to CRDT
        this.ydoc.transact(() => {
            for (const op of operations) {
                this.applyOperation(op);
            }
        }, actorId);
        
        // Broadcast update to connected clients
        const update = Y.encodeStateAsUpdate(this.ydoc);
        for (const [conn, _] of this.connections) {
            if (conn.readyState === WebSocket.OPEN) {
                conn.send(update);
            }
        }
        
        await this.persist();
        
        return Response.json({ 
            success: true,
            snapshot: this.ydoc.getMap('root').toJSON()
        });
    }
    
    private applyOperation(op: EditOperation): void {
        const root = this.ydoc.getMap('root');
        
        switch (op.type) {
            case 'set':
                this.setNestedValue(root, op.path, op.value);
                break;
            case 'delete':
                this.deleteNestedValue(root, op.path);
                break;
            case 'insert':
                this.insertIntoArray(root, op.path, op.index, op.value);
                break;
            case 'move':
                this.moveInArray(root, op.path, op.fromIndex, op.toIndex);
                break;
            case 'replace':
                this.setNestedValue(root, op.path, op.content);
                break;
        }
    }
    
    private async initializeIfNeeded(): Promise<void> {
        const stored = await this.state.storage.get('ydoc');
        
        if (stored) {
            Y.applyUpdate(this.ydoc, new Uint8Array(stored as ArrayBuffer));
        } else {
            // First access - initialize from checkpoint
            await this.initializeFromCheckpoint();
        }
    }
    
    private async initializeFromCheckpoint(): Promise<void> {
        // Parse session ID to get branch info
        const sessionId = this.state.id.toString();
        const [change_setId, documentId, branchId] = sessionId.split(':');
        
        // Fetch initial state from PostgreSQL via API
        const response = await fetch(
            `${this.env.API_URL}/internal/document-initial-state`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ change_setId, documentId, branchId })
            }
        );
        
        const { snapshot } = await response.json();
        
        // Initialize CRDT with snapshot
        const root = this.ydoc.getMap('root');
        this.populateFromSnapshot(root, snapshot);
        
        await this.persist();
    }
    
    private async persist(): Promise<void> {
        const update = Y.encodeStateAsUpdate(this.ydoc);
        await this.state.storage.put('ydoc', update);
    }
    
    // Helper methods for nested operations omitted for brevity
}

interface ConnectionMeta {
    actorId: string;
    actorType: 'user' | 'agent';
}

interface EditOperation {
    type: 'set' | 'delete' | 'insert' | 'move' | 'replace';
    path: string;
    value?: any;
    content?: any;
    index?: number;
    fromIndex?: number;
    toIndex?: number;
}
```

### Lazy Session Creation

Document sessions are created on first access, not when branches are created:

```typescript
async function getOrCreateDocumentSession(
    env: Env,
    change_setId: string,
    documentId: string,
    branchId: string
): Promise<DurableObjectStub> {
    const sessionId = `${change_setId}:${documentId}:${branchId}`;
    const id = env.DOCUMENT_SESSIONS.idFromName(sessionId);
    return env.DOCUMENT_SESSIONS.get(id);
}
```

---

## API Specification

### Branch Operations

#### Create Branch

```
POST /api/change_sets/{change_setId}/branches

Request:
{
    "name": "holiday-campaign-2024",
    "description": "Q4 holiday promotional updates",
    "sourceBranch": "main"  // or source branch ID
}

Response:
{
    "id": "branch-uuid",
    "name": "holiday-campaign-2024",
    "description": "Q4 holiday promotional updates",
    "status": "active",
    "sourceBranchId": "main-branch-uuid",
    "createdFromCheckpoint": "checkpoint-uuid",
    "createdBy": "user-uuid",
    "createdAt": "2024-01-15T10:30:00Z"
}
```

#### List Branches

```
GET /api/change_sets/{change_setId}/branches?status=active

Response:
{
    "branches": [
        {
            "id": "branch-uuid",
            "name": "holiday-campaign-2024",
            "description": "Q4 holiday promotional updates",
            "status": "active",
            "assignedActors": [
                { "id": "user-1", "type": "user", "role": "owner" },
                { "id": "agent-1", "type": "agent", "role": "collaborator" }
            ],
            "documentsModified": 3,
            "hasUncheckpointedChanges": true,
            "lastActivityAt": "2024-01-15T14:22:00Z"
        }
    ]
}
```

#### Get Branch Details

```
GET /api/change_sets/{change_setId}/branches/{branchId}

Response:
{
    "id": "branch-uuid",
    "name": "holiday-campaign-2024",
    "description": "Q4 holiday promotional updates",
    "status": "active",
    "sourceBranchId": "main-branch-uuid",
    "createdFromCheckpoint": "checkpoint-uuid",
    "headCheckpointId": "checkpoint-uuid",
    "createdBy": "user-uuid",
    "createdAt": "2024-01-15T10:30:00Z",
    "modifiedDocuments": [
        {
            "documentId": "doc-uuid",
            "path": "pages/home",
            "hasUncheckpointedChanges": true,
            "lastModifiedAt": "2024-01-15T14:22:00Z",
            "lastModifiedBy": "user-uuid"
        }
    ],
    "checkpoints": [
        {
            "id": "checkpoint-uuid",
            "message": "Initial branch state",
            "createdAt": "2024-01-15T10:30:00Z"
        }
    ]
}
```

### Document Operations

#### Get Document State

```
GET /api/change_sets/{change_setId}/branches/{branchId}/documents/{documentPath}

Response:
{
    "documentId": "doc-uuid",
    "path": "pages/home",
    "branchId": "branch-uuid",
    "state": {
        // Current JSON state from CRDT
        "components": [...],
        "metadata": {...}
    },
    "connectedActors": [
        { "id": "user-1", "type": "user", "name": "Alice" }
    ],
    "hasUncheckpointedChanges": true,
    "lastCheckpointId": "checkpoint-uuid"
}
```

#### Apply Edits (for agents or programmatic access)

```
POST /api/change_sets/{change_setId}/branches/{branchId}/documents/{documentPath}/edits

Request:
{
    "operations": [
        {
            "type": "set",
            "path": "components.0.props.title",
            "value": "Welcome to Our Holiday Sale"
        },
        {
            "type": "insert",
            "path": "components",
            "index": 1,
            "value": {
                "type": "Banner",
                "props": { "text": "50% Off Everything" }
            }
        }
    ]
}

Response:
{
    "success": true,
    "operationsApplied": 2,
    "state": {
        // Updated JSON state
    }
}
```

#### Connect WebSocket (for real-time collaboration)

```
WebSocket /api/change_sets/{change_setId}/branches/{branchId}/documents/{documentPath}/connect

Headers:
- X-Actor-Id: user or agent ID
- X-Actor-Type: "user" or "agent"

Messages:
- Binary Yjs updates in both directions
- Awareness updates for presence/cursors
```

### Checkpoint Operations

#### Create Checkpoint

```
POST /api/change_sets/{change_setId}/branches/{branchId}/checkpoints

Request:
{
    "message": "Homepage hero banner complete"
}

Response:
{
    "id": "checkpoint-uuid",
    "branchId": "branch-uuid",
    "parentCheckpointId": "previous-checkpoint-uuid",
    "message": "Homepage hero banner complete",
    "authorId": "user-uuid",
    "authorType": "user",
    "documentsIncluded": [
        {
            "documentId": "doc-uuid",
            "path": "pages/home"
        }
    ],
    "createdAt": "2024-01-15T15:00:00Z"
}
```

#### List Checkpoints

```
GET /api/change_sets/{change_setId}/branches/{branchId}/checkpoints

Response:
{
    "checkpoints": [
        {
            "id": "checkpoint-uuid",
            "message": "Homepage hero banner complete",
            "authorId": "user-uuid",
            "authorType": "user",
            "isMerge": false,
            "isAuto": false,
            "createdAt": "2024-01-15T15:00:00Z"
        }
    ]
}
```

#### Get Document at Checkpoint

```
GET /api/change_sets/{change_setId}/checkpoints/{checkpointId}/documents/{documentPath}

Response:
{
    "documentId": "doc-uuid",
    "path": "pages/home",
    "checkpointId": "checkpoint-uuid",
    "state": {
        // JSON state at this checkpoint
    }
}
```

### Merge Operations

#### Check Mergeability

```
POST /api/change_sets/{change_setId}/merge/check

Request:
{
    "sourceBranchId": "feature-branch-uuid",
    "targetBranchId": "main-branch-uuid"
}

Response (no conflicts):
{
    "canMerge": true,
    "conflicts": [],
    "mergeBase": {
        "checkpointId": "checkpoint-uuid",
        "createdAt": "2024-01-10T10:00:00Z"
    },
    "changes": {
        "documentsModifiedInSource": ["pages/home", "pages/about"],
        "documentsModifiedInTarget": ["pages/contact"]
    }
}

Response (with conflicts):
{
    "canMerge": false,
    "conflicts": [
        {
            "documentId": "doc-uuid",
            "path": "pages/home",
            "sourceVersion": { /* JSON state */ },
            "targetVersion": { /* JSON state */ },
            "baseVersion": { /* JSON state */ }
        }
    ],
    "mergeBase": {
        "checkpointId": "checkpoint-uuid",
        "createdAt": "2024-01-10T10:00:00Z"
    }
}
```

#### Execute Merge

```
POST /api/change_sets/{change_setId}/merge/execute

Request:
{
    "sourceBranchId": "feature-branch-uuid",
    "targetBranchId": "main-branch-uuid",
    "message": "Merge holiday campaign into main",
    "conflictResolutions": [
        {
            "documentId": "doc-uuid",
            "strategy": "take-source"
            // Options: "take-source", "take-target", "merge-crdt", "manual"
        }
    ]
}

Response:
{
    "success": true,
    "mergeCheckpointId": "checkpoint-uuid",
    "documentsUpdated": ["pages/home", "pages/about"],
    "sourceBranchStatus": "merged"  // Branch marked as merged
}
```

### Agent Operations

#### List Agents

```
GET /api/change_sets/{change_setId}/agents

Response:
{
    "agents": [
        {
            "id": "agent-uuid",
            "name": "Content Writer",
            "description": "Generates and edits marketing copy",
            "model": "claude-sonnet-4-20250514",
            "permissions": {
                "can_create_branches": true,
                "can_edit_documents": true,
                "can_create_checkpoints": true,
                "can_propose_merge": true,
                "can_merge": false,
                "can_merge_to_main": false
            },
            "isActive": true
        }
    ]
}
```

#### Assign Agent to Branch

```
POST /api/change_sets/{change_setId}/branches/{branchId}/assignments

Request:
{
    "actorId": "agent-uuid",
    "actorType": "agent",
    "role": "collaborator"
}

Response:
{
    "branchId": "branch-uuid",
    "actorId": "agent-uuid",
    "actorType": "agent",
    "role": "collaborator",
    "assignedAt": "2024-01-15T10:30:00Z"
}
```

---

## Agent Integration

### Agent API Surface

Agents interact with the system through the same APIs as humans, with additional conveniences:

```typescript
interface AgentAPI {
    // Branch operations
    createBranch(params: {
        change_setId: string;
        name: string;
        description: string;
        sourceBranch: string;
    }): Promise<Branch>;
    
    getBranch(change_setId: string, branchId: string): Promise<Branch>;
    listBranches(change_setId: string, filter?: { status?: string }): Promise<Branch[]>;
    
    // Document operations
    getDocument(change_setId: string, branchId: string, documentPath: string): Promise<DocumentState>;
    listDocuments(change_setId: string, branchId: string): Promise<DocumentSummary[]>;
    
    // Editing operations (applies via CRDT)
    applyEdits(
        change_setId: string,
        branchId: string,
        edits: DocumentEdit[]
    ): Promise<EditResult>;
    
    // Checkpoint operations
    createCheckpoint(
        change_setId: string,
        branchId: string,
        message: string
    ): Promise<Checkpoint>;
    
    // Merge operations
    checkMergeability(
        change_setId: string,
        sourceBranch: string,
        targetBranch: string
    ): Promise<MergeCheck>;
    
    proposeMerge(
        change_setId: string,
        sourceBranch: string,
        targetBranch: string,
        message: string
    ): Promise<MergeProposal>;
}

interface DocumentEdit {
    documentPath: string;
    operations: EditOperation[];
}

interface EditOperation {
    type: 'set' | 'delete' | 'insert' | 'move' | 'replace';
    path: string;
    value?: any;
    content?: any;
    index?: number;
    fromIndex?: number;
    toIndex?: number;
}
```

### Agent Courtesy Behaviors

Well-behaved agents should implement these patterns:

```typescript
class PoliteAgent {
    // Check for active human editors before making changes
    async beforeEditing(
        change_setId: string,
        branchId: string,
        documentPath: string
    ): Promise<boolean> {
        const doc = await this.api.getDocument(change_setId, branchId, documentPath);
        
        const humansEditing = doc.connectedActors.filter(
            a => a.type === 'user'
        );
        
        if (humansEditing.length > 0) {
            // Option 1: Wait for quiet period
            await this.waitForQuietPeriod(change_setId, branchId, documentPath);
            
            // Option 2: Notify and proceed
            // await this.notifyHumans("I'm about to make automated edits");
            
            // Option 3: Skip this document for now
            // return false;
        }
        
        return true;
    }
    
    // Rate-limit edits to avoid overwhelming the UI
    async applyEditsGradually(
        change_setId: string,
        branchId: string,
        edits: DocumentEdit[],
        delayMs: number = 500
    ): Promise<void> {
        for (const edit of edits) {
            await this.api.applyEdits(change_setId, branchId, [edit]);
            await this.sleep(delayMs);
        }
    }
    
    // Set presence to indicate agent activity
    async setPresence(
        change_setId: string,
        branchId: string,
        documentPath: string,
        status: 'idle' | 'analyzing' | 'editing'
    ): Promise<void> {
        // Implemented via awareness protocol
    }
}
```

### Example Agent Workflow: Component Replacement

```typescript
async function replaceComponentAcrossChange Set(
    agent: AgentAPI,
    change_setId: string,
    task: {
        componentToReplace: string;
        replacementComponent: string;
        propertyMapping: Record<string, string>;
    }
) {
    // Step 1: Create branch for this work
    const branch = await agent.createBranch({
        change_setId,
        name: `replace-${task.componentToReplace.toLowerCase()}`,
        description: `Automated replacement of ${task.componentToReplace} with ${task.replacementComponent}`,
        sourceBranch: 'main'
    });
    
    // Step 2: Analyze all documents
    const documents = await agent.listDocuments(change_setId, branch.id);
    const analysisResults: Array<{
        documentPath: string;
        instances: Array<{ path: string; props: any }>;
    }> = [];
    
    for (const doc of documents) {
        const content = await agent.getDocument(change_setId, branch.id, doc.path);
        const instances = findComponentInstances(content.state, task.componentToReplace);
        
        if (instances.length > 0) {
            analysisResults.push({
                documentPath: doc.path,
                instances
            });
        }
    }
    
    // Step 3: Apply edits to each document
    for (const result of analysisResults) {
        const edits: DocumentEdit = {
            documentPath: result.documentPath,
            operations: result.instances.map(instance => ({
                type: 'replace' as const,
                path: instance.path,
                content: {
                    type: task.replacementComponent,
                    props: mapProperties(instance.props, task.propertyMapping)
                }
            }))
        };
        
        await agent.applyEdits(change_setId, branch.id, [edits]);
    }
    
    // Step 4: Create checkpoint documenting the work
    const totalInstances = analysisResults.reduce(
        (sum, r) => sum + r.instances.length, 0
    );
    
    await agent.createCheckpoint(
        change_setId,
        branch.id,
        `Replaced ${totalInstances} instances of ${task.componentToReplace} with ${task.replacementComponent}\n\n` +
        `Documents modified:\n` +
        analysisResults.map(r => `- ${r.documentPath}: ${r.instances.length} instances`).join('\n')
    );
    
    // Step 5: Check mergeability and propose merge
    const mergeCheck = await agent.checkMergeability(change_setId, branch.id, 'main');
    
    if (mergeCheck.canMerge) {
        await agent.proposeMerge(
            change_setId,
            branch.id,
            'main',
            `Merge component replacement: ${task.componentToReplace} â†’ ${task.replacementComponent}`
        );
    } else {
        // Flag for human review
        console.log('Merge conflicts detected, flagging for review:', mergeCheck.conflicts);
    }
}
```

---

## Infrastructure Components

### Required Services

| Component | Technology | Purpose |
|-----------|------------|---------|
| API Server | Cloudflare Workers or Node.js | HTTP API, orchestration |
| Real-time Sessions | Cloudflare Durable Objects | CRDT state, WebSocket connections |
| Primary Database | PostgreSQL (CloudSQL) | Version control metadata, snapshots |
| Notifications | Firestore (optional) | Real-time presence updates across sessions |

### Cloudflare Workers Configuration

```toml
# wrangler.toml
name = "collab-state-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "DOCUMENT_SESSIONS"
class_name = "DocumentSession"

[[migrations]]
tag = "v1"
new_classes = ["DocumentSession"]

[vars]
DATABASE_URL = "postgresql://..."

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id"
```

### Database Connection via Hyperdrive

```typescript
import { Pool } from 'pg';

export function getDb(env: Env): Pool {
    return new Pool({
        connectionString: env.HYPERDRIVE.connectionString
    });
}
```

---

## Libraries and Dependencies

### Node.js / Cloudflare Workers

| Library | Purpose | Version |
|---------|---------|---------|
| `yjs` | CRDT implementation | ^13.6.0 |
| `pg` | PostgreSQL client | ^8.11.0 |
| `fast-json-patch` | JSON diff/patch (RFC 6902) | ^3.1.0 |
| `object-hash` | Content-addressed hashing | ^3.0.0 |

### Go (alternative implementation)

| Library | Purpose |
|---------|---------|
| `github.com/jackc/pgx/v5` | PostgreSQL client |
| `github.com/wI2L/jsondiff` | JSON diff |
| `github.com/evanphx/json-patch` | JSON patch |

---

## Conflict Resolution

### Document-Level Conflict Strategies

When merging branches that both modified the same document:

| Strategy | Behavior | When to Use |
|----------|----------|-------------|
| `take-source` | Use source branch version | Source work supersedes target |
| `take-target` | Keep target branch version | Target work takes priority |
| `merge-crdt` | Apply CRDT merge | Changes are additive/compatible |
| `manual` | User provides resolved state | Complex semantic conflicts |

### CRDT Merge Behavior

When `merge-crdt` is selected, the system:

1. Gets CRDT state vectors from both versions
2. Computes missing updates from each side
3. Applies both update sets to produce merged state
4. CRDTs guarantee convergence without conflicts

**Limitations:** CRDT merge produces syntactically valid results but may be semantically unexpected. Example: if both branches rewrote a headline differently, CRDT merge might interleave the text. Use for additive changes; prefer explicit resolution for rewrites.

---

## Undo/Redo Behavior

### Document-Level Undo (Real-Time)

Within a document session, Yjs provides per-user undo:

```typescript
import { UndoManager } from 'yjs';

const undoManager = new UndoManager(ydoc.getMap('root'), {
    trackedOrigins: new Set([userId])  // Only track this user's changes
});

// Undo last local change (doesn't affect other users' changes)
undoManager.undo();

// Redo
undoManager.redo();
```

### Branch-Level Revert

To revert a checkpoint, create a new checkpoint that restores previous state:

```typescript
async function revertToCheckpoint(
    change_setId: string,
    branchId: string,
    targetCheckpointId: string
): Promise<Checkpoint> {
    // Get state at target checkpoint
    const targetState = await getDocumentsAtCheckpoint(targetCheckpointId);
    
    // Update live CRDT sessions to match
    for (const doc of targetState) {
        const session = await getDocumentSession(change_setId, doc.documentId, branchId);
        await session.replaceState(doc.snapshot);
    }
    
    // Create checkpoint documenting the revert
    return await createCheckpoint(change_setId, branchId, {
        message: `Reverted to checkpoint: ${targetCheckpointId}`,
        isAuto: false
    });
}
```

---

## Security Considerations

### Actor Authentication

All API requests must include authenticated actor identity:

- Users: JWT or session token from authentication provider
- Agents: API key scoped to change_set with explicit permissions

### Permission Model

```typescript
interface ActorPermissions {
    can_create_branches: boolean;
    can_edit_documents: boolean;
    can_create_checkpoints: boolean;
    can_propose_merge: boolean;
    can_merge: boolean;           // Merge non-main branches
    can_merge_to_main: boolean;   // Merge into main branch
}
```

### Branch-Level Access Control

Actors can only edit documents on branches they're assigned to. Assignment roles:

- **owner**: Full control, can assign others
- **collaborator**: Can edit and checkpoint
- **reviewer**: Read-only, can approve merges

---

## Audit Log

All significant actions are recorded in an append-only audit log for compliance, debugging, and analytics.

### Audit Log Schema

```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES change_sets(id),
    
    -- What happened
    action TEXT NOT NULL,
    
    -- Who did it
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,  -- 'user', 'agent', 'system'
    
    -- Context
    resource_type TEXT,  -- 'branch', 'document', 'checkpoint', 'agent'
    resource_id UUID,
    branch_id UUID,
    
    -- Details (flexible JSON for action-specific data)
    details JSONB,
    
    -- Outcome
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_change_set_time ON audit_log(change_set_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_action ON audit_log(change_set_id, action);
```

### Audited Actions

| Action | Resource Type | Details Captured |
|--------|---------------|------------------|
| `branch.created` | branch | source_branch_id, name |
| `branch.status_changed` | branch | old_status, new_status |
| `branch.assigned` | branch | assignee_id, assignee_type, role |
| `document.viewed` | document | branch_id |
| `document.edited` | document | branch_id, operation_count |
| `checkpoint.created` | checkpoint | branch_id, message, documents_included |
| `merge.proposed` | branch | source_branch_id, target_branch_id |
| `merge.approved` | branch | merge_proposal_id, approver_id |
| `merge.executed` | branch | source_branch_id, target_branch_id, conflict_resolutions |
| `merge.failed` | branch | source_branch_id, target_branch_id, reason |
| `agent.created` | agent | name, permissions |
| `agent.permissions_changed` | agent | old_permissions, new_permissions |
| `agent.task_assigned` | agent | task_type, branch_id |
| `permission.changed` | branch/change_set | actor_id, old_role, new_role |

### Audit Log Write Pattern

Audit writes should be asynchronous to avoid impacting main transaction performance:

```typescript
// Fire-and-forget audit logging
async function auditLog(entry: AuditEntry): Promise<void> {
    // Option 1: Direct async insert (simple)
    db.query(`
        INSERT INTO audit_log (change_set_id, action, actor_id, actor_type, 
                               resource_type, resource_id, branch_id, details, success, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
        entry.change_setId,
        entry.action,
        entry.actorId,
        entry.actorType,
        entry.resourceType,
        entry.resourceId,
        entry.branchId,
        entry.details,
        entry.success ?? true,
        entry.errorMessage
    ]).catch(err => console.error('Audit log write failed:', err));
    
    // Option 2: Queue for batch insert (higher throughput)
    // await auditQueue.push(entry);
}

// Usage in API handlers
async function createBranch(req: Request): Promise<Response> {
    const branch = await db.transaction(async (tx) => {
        // ... create branch logic
    });
    
    // Audit after successful transaction (non-blocking)
    auditLog({
        change_setId: branch.change_setId,
        action: 'branch.created',
        actorId: req.actorId,
        actorType: req.actorType,
        resourceType: 'branch',
        resourceId: branch.id,
        details: {
            name: branch.name,
            sourceBranchId: branch.sourceBranchId
        }
    });
    
    return Response.json(branch);
}
```

### Retention Policy

Audit logs should be retained based on compliance requirements:

- **Default**: 90 days in primary table
- **Archive**: Move older records to cold storage (e.g., Cloud Storage as JSON lines)
- **Compliance mode**: Configurable per-change_set for longer retention

```sql
-- Partition by month for efficient archival
CREATE TABLE audit_log (
    -- ... columns as above ...
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_log_y2024m01 PARTITION OF audit_log
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

---

## Notifications

Notifications inform human users and AI agents of workflow events requiring attention.

### Human Notifications via Firestore

Firestore provides real-time delivery to connected clients:

```typescript
// Firestore collection structure
// /change_sets/{change_setId}/notifications/{notificationId}

interface Notification {
    id: string;
    change_setId: string;
    type: NotificationType;
    
    // Targeting
    recipients: string[];      // Specific actor IDs
    recipientRoles?: string[]; // Or by role: 'branch_owner', 'reviewer'
    branchId?: string;         // All actors assigned to this branch
    
    // Content
    title: string;
    message: string;
    actionUrl?: string;
    
    // Source
    triggeredBy: string;
    triggeredByType: 'user' | 'agent' | 'system';
    
    // Related resources
    relatedBranchId?: string;
    relatedDocumentPath?: string;
    relatedCheckpointId?: string;
    
    // State
    createdAt: Timestamp;
    readBy: string[];          // Actor IDs who have read it
    dismissedBy: string[];     // Actor IDs who dismissed it
}

type NotificationType = 
    | 'branch_assigned'        // You've been assigned to a branch
    | 'branch_unassigned'      // You've been removed from a branch
    | 'checkpoint_created'     // Someone created a checkpoint on your branch
    | 'merge_proposed'         // A merge has been proposed for review
    | 'merge_approved'         // Your merge proposal was approved
    | 'merge_rejected'         // Your merge proposal was rejected
    | 'merge_conflict'         // Merge cannot proceed due to conflicts
    | 'merge_completed'        // A merge affecting your branch completed
    | 'review_requested'       // Your review is requested
    | 'agent_completed'        // An agent finished its assigned task
    | 'agent_needs_help'       // An agent encountered an issue needing human input
    | 'document_edited'        // Someone edited a document you're watching
    | 'mention';               // You were mentioned in a checkpoint message
```

### Creating Notifications

```typescript
async function createNotification(
    firestore: Firestore,
    notification: Omit<Notification, 'id' | 'createdAt' | 'readBy' | 'dismissedBy'>
): Promise<string> {
    const docRef = await firestore
        .collection('change_sets')
        .doc(notification.change_setId)
        .collection('notifications')
        .add({
            ...notification,
            createdAt: FieldValue.serverTimestamp(),
            readBy: [],
            dismissedBy: []
        });
    
    return docRef.id;
}

// Example: Notify branch owners of merge proposal
async function notifyMergeProposed(
    firestore: Firestore,
    change_setId: string,
    sourceBranch: Branch,
    targetBranch: Branch,
    proposedBy: Actor
): Promise<void> {
    // Get target branch owners and reviewers
    const assignments = await getBranchAssignments(targetBranch.id, ['owner', 'reviewer']);
    const recipientIds = assignments.map(a => a.actorId);
    
    await createNotification(firestore, {
        change_setId,
        type: 'merge_proposed',
        recipients: recipientIds,
        title: `Merge proposed: ${sourceBranch.name} â†’ ${targetBranch.name}`,
        message: `${proposedBy.name} proposed merging "${sourceBranch.name}" into "${targetBranch.name}"`,
        actionUrl: `/change_sets/${change_setId}/merges/${sourceBranch.id}`,
        triggeredBy: proposedBy.id,
        triggeredByType: proposedBy.type,
        relatedBranchId: sourceBranch.id
    });
}
```

### Client Subscription

```typescript
// React hook for notification subscription
function useNotifications(change_setId: string, userId: string) {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    
    useEffect(() => {
        const unsubscribe = firestore
            .collection('change_sets')
            .doc(change_setId)
            .collection('notifications')
            .where('recipients', 'array-contains', userId)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .onSnapshot(snapshot => {
                const notifs = snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() } as Notification))
                    .filter(n => !n.dismissedBy.includes(userId));
                setNotifications(notifs);
            });
        
        return unsubscribe;
    }, [change_setId, userId]);
    
    const markAsRead = async (notificationId: string) => {
        await firestore
            .collection('change_sets')
            .doc(change_setId)
            .collection('notifications')
            .doc(notificationId)
            .update({
                readBy: FieldValue.arrayUnion(userId)
            });
    };
    
    const dismiss = async (notificationId: string) => {
        await firestore
            .collection('change_sets')
            .doc(change_setId)
            .collection('notifications')
            .doc(notificationId)
            .update({
                dismissedBy: FieldValue.arrayUnion(userId)
            });
    };
    
    return { notifications, markAsRead, dismiss };
}
```

### Notification Preferences

Store user preferences in PostgreSQL:

```sql
CREATE TABLE notification_preferences (
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,
    change_set_id UUID REFERENCES change_sets(id),  -- NULL for global defaults
    
    -- Per-type settings
    preferences JSONB NOT NULL DEFAULT '{
        "branch_assigned": {"enabled": true, "email": true},
        "merge_proposed": {"enabled": true, "email": true},
        "merge_completed": {"enabled": true, "email": false},
        "checkpoint_created": {"enabled": true, "email": false},
        "document_edited": {"enabled": false, "email": false}
    }',
    
    -- Quiet hours (no notifications)
    quiet_hours_start TIME,  -- e.g., '22:00'
    quiet_hours_end TIME,    -- e.g., '08:00'
    quiet_hours_timezone TEXT DEFAULT 'UTC',
    
    PRIMARY KEY (actor_id, COALESCE(change_set_id, '00000000-0000-0000-0000-000000000000'))
);
```

```typescript
async function shouldNotify(
    actorId: string,
    change_setId: string,
    notificationType: NotificationType
): Promise<{ inApp: boolean; email: boolean }> {
    const prefs = await getNotificationPreferences(actorId, change_setId);
    const typePref = prefs.preferences[notificationType];
    
    if (!typePref?.enabled) {
        return { inApp: false, email: false };
    }
    
    // Check quiet hours
    if (isInQuietHours(prefs)) {
        return { inApp: true, email: false };  // Queue for later or skip email
    }
    
    return { inApp: true, email: typePref.email ?? false };
}
```

---

## Agent Task Queue

Agents are invoked on-demand rather than maintaining persistent connections. A task queue manages work assignment.

### Task Queue Schema

```sql
CREATE TABLE agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES change_sets(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    
    -- Task definition
    task_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    
    -- Scheduling
    priority INTEGER DEFAULT 0,  -- Higher = more urgent
    scheduled_for TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,      -- Task becomes invalid after this time
    
    -- State
    status TEXT DEFAULT 'pending',
    -- Valid statuses: 'pending', 'processing', 'completed', 'failed', 'expired', 'cancelled'
    
    -- Execution tracking
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    
    -- Results
    result JSONB,
    error_message TEXT,
    
    -- Metadata
    created_by UUID,
    created_by_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_tasks_pending ON agent_tasks(agent_id, status, priority DESC, scheduled_for)
    WHERE status = 'pending';
CREATE INDEX idx_agent_tasks_change_set ON agent_tasks(change_set_id, created_at DESC);
```

### Task Types

| Task Type | Payload | Description |
|-----------|---------|-------------|
| `branch_assigned` | `{ branchId, instructions? }` | Agent assigned to work on a branch |
| `review_requested` | `{ branchId, checkpointId }` | Agent should review changes |
| `component_replacement` | `{ componentToReplace, replacement, scope }` | Replace components across documents |
| `content_generation` | `{ branchId, documentPath, prompt }` | Generate content for a document |
| `merge_conflict_analysis` | `{ sourceBranch, targetBranch, conflicts }` | Analyze and suggest conflict resolution |
| `scheduled_check` | `{ branchId, checkType }` | Periodic check (e.g., stale branch detection) |

### Task Processing

```typescript
// Agent task processor
async function processAgentTasks(
    db: Pool,
    agentId: string,
    agentApi: AgentAPI
): Promise<TaskResult | null> {
    // Claim a task atomically
    const result = await db.query(`
        UPDATE agent_tasks 
        SET 
            status = 'processing', 
            started_at = NOW(),
            attempts = attempts + 1
        WHERE id = (
            SELECT id FROM agent_tasks
            WHERE agent_id = $1 
              AND status = 'pending'
              AND scheduled_for <= NOW()
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY priority DESC, scheduled_for ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    `, [agentId]);
    
    if (result.rows.length === 0) {
        return null;  // No tasks available
    }
    
    const task = result.rows[0];
    
    try {
        // Execute task based on type
        const taskResult = await executeTask(agentApi, task);
        
        // Mark completed
        await db.query(`
            UPDATE agent_tasks 
            SET 
                status = 'completed', 
                completed_at = NOW(), 
                result = $2
            WHERE id = $1
        `, [task.id, taskResult]);
        
        // Log success
        await auditLog({
            change_setId: task.change_set_id,
            action: 'agent.task_completed',
            actorId: agentId,
            actorType: 'agent',
            resourceType: 'agent_task',
            resourceId: task.id,
            details: { taskType: task.task_type, resultSummary: taskResult.summary }
        });
        
        return { success: true, task, result: taskResult };
        
    } catch (error) {
        const shouldRetry = task.attempts < task.max_attempts;
        
        await db.query(`
            UPDATE agent_tasks 
            SET 
                status = $2,
                completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END,
                error_message = $3,
                scheduled_for = CASE WHEN $2 = 'pending' THEN NOW() + INTERVAL '1 minute' * $4 ELSE scheduled_for END
            WHERE id = $1
        `, [
            task.id,
            shouldRetry ? 'pending' : 'failed',
            error.message,
            task.attempts  // Exponential backoff: 1min, 2min, 3min
        ]);
        
        // Log failure
        await auditLog({
            change_setId: task.change_set_id,
            action: 'agent.task_failed',
            actorId: agentId,
            actorType: 'agent',
            resourceType: 'agent_task',
            resourceId: task.id,
            success: false,
            errorMessage: error.message,
            details: { taskType: task.task_type, attempts: task.attempts, willRetry: shouldRetry }
        });
        
        // Notify humans if final failure
        if (!shouldRetry) {
            await createNotification(firestore, {
                change_setId: task.change_set_id,
                type: 'agent_needs_help',
                recipients: await getChange SetAdmins(task.change_set_id),
                title: `Agent task failed: ${task.task_type}`,
                message: `Agent "${await getAgentName(agentId)}" failed to complete task after ${task.attempts} attempts: ${error.message}`,
                triggeredBy: agentId,
                triggeredByType: 'agent',
                relatedBranchId: task.payload.branchId
            });
        }
        
        return { success: false, task, error: error.message };
    }
}

async function executeTask(agentApi: AgentAPI, task: AgentTask): Promise<any> {
    switch (task.task_type) {
        case 'branch_assigned':
            return await handleBranchAssignment(agentApi, task.payload);
        
        case 'component_replacement':
            return await handleComponentReplacement(agentApi, task.payload);
        
        case 'content_generation':
            return await handleContentGeneration(agentApi, task.payload);
        
        case 'merge_conflict_analysis':
            return await handleMergeConflictAnalysis(agentApi, task.payload);
        
        default:
            throw new Error(`Unknown task type: ${task.task_type}`);
    }
}
```

### Task Creation

```typescript
async function assignAgentToBranch(
    db: Pool,
    change_setId: string,
    branchId: string,
    agentId: string,
    instructions?: string
): Promise<void> {
    // Create assignment record
    await db.query(`
        INSERT INTO branch_assignments (branch_id, actor_id, actor_type, role)
        VALUES ($1, $2, 'agent', 'collaborator')
        ON CONFLICT (branch_id, actor_id) DO NOTHING
    `, [branchId, agentId]);
    
    // Create task for agent
    await db.query(`
        INSERT INTO agent_tasks (change_set_id, agent_id, task_type, payload, created_by, created_by_type)
        VALUES ($1, $2, 'branch_assigned', $3, $4, $5)
    `, [
        change_setId,
        agentId,
        { branchId, instructions },
        currentUser.id,
        'user'
    ]);
    
    // Audit log
    await auditLog({
        change_setId,
        action: 'agent.task_assigned',
        actorId: currentUser.id,
        actorType: 'user',
        resourceType: 'agent',
        resourceId: agentId,
        branchId,
        details: { taskType: 'branch_assigned', instructions }
    });
}
```

### Agent Invocation Patterns

**Pattern 1: Polling (simple, works everywhere)**

```typescript
// Agent runner polls periodically
async function agentPollingLoop(agentId: string) {
    while (true) {
        const result = await processAgentTasks(db, agentId, agentApi);
        
        if (result === null) {
            // No tasks, wait before polling again
            await sleep(10_000);  // 10 seconds
        }
        // If task was processed, immediately check for more
    }
}
```

**Pattern 2: Webhook (lower latency)**

```typescript
// When task is created, trigger webhook
async function createAgentTask(task: NewAgentTask): Promise<AgentTask> {
    const created = await db.query(`INSERT INTO agent_tasks ... RETURNING *`);
    
    // Trigger agent webhook (fire-and-forget)
    const agent = await getAgent(task.agentId);
    if (agent.webhookUrl) {
        fetch(agent.webhookUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Webhook-Secret': agent.webhookSecret
            },
            body: JSON.stringify({ 
                event: 'task_available',
                taskId: created.rows[0].id,
                taskType: task.taskType
            })
        }).catch(err => console.error('Webhook failed:', err));
    }
    
    return created.rows[0];
}
```

**Pattern 3: Cloudflare Queue (managed, reliable)**

```typescript
// Using Cloudflare Queues for task delivery
export default {
    async queue(batch: MessageBatch<AgentTaskMessage>, env: Env) {
        for (const message of batch.messages) {
            const { agentId, taskId } = message.body;
            
            try {
                await processSpecificTask(env.DB, agentId, taskId);
                message.ack();
            } catch (error) {
                message.retry();
            }
        }
    }
};
```

---

## Site Structure

Websites are more than collections of documentsâ€”they have hierarchical organization, navigation, and shared metadata requirements. The site structure layer provides this organizational capability.

### Core Concepts

**Site Structure**: A named organizational container within a change_set. A change_set can have multiple structures (e.g., "Main Navigation", "Blog", "Documentation", "Press Releases"). Each structure defines how documents are organized and what metadata they require.

**Structure Node**: An entry in the hierarchy that can represent a section (grouping), a document reference, or an external link. Nodes form a tree that defines navigation and URL paths.

**Metadata Schema**: A JSON Schema definition that documents within a structure must conform to. Schemas are versioned with branches, allowing schema evolution to be developed and merged like any other change.

### Site Structure Schema

```sql
-- Site structures define organizational containers
CREATE TABLE site_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id UUID NOT NULL REFERENCES change_sets(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,           -- URL-safe identifier
    description TEXT,
    
    structure_type TEXT NOT NULL DEFAULT 'hierarchy',
    -- Types: 'collection' (flat list), 'hierarchy' (nested tree)
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(change_set_id, slug)
);

CREATE INDEX idx_site_structures_change_set ON site_structures(change_set_id);

-- Structure nodes define the hierarchy
CREATE TABLE structure_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    structure_id UUID NOT NULL REFERENCES site_structures(id),
    
    -- Hierarchy
    parent_node_id UUID REFERENCES structure_nodes(id),
    position INTEGER NOT NULL DEFAULT 0,  -- Order among siblings
    
    -- Node identity
    name TEXT NOT NULL,
    slug TEXT NOT NULL,           -- URL segment for this node
    
    -- What this node represents
    node_type TEXT NOT NULL DEFAULT 'section',
    -- Types: 'section' (grouping only), 'document' (links to document), 'external' (external URL)
    
    -- For document nodes
    document_id UUID REFERENCES documents(id),
    
    -- For external nodes
    external_url TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(structure_id, parent_node_id, slug)
);

CREATE INDEX idx_structure_nodes_parent ON structure_nodes(parent_node_id, position);
CREATE INDEX idx_structure_nodes_structure ON structure_nodes(structure_id);
CREATE INDEX idx_structure_nodes_document ON structure_nodes(document_id);

-- Branch-specific structure state
CREATE TABLE branch_structure_state (
    branch_id UUID NOT NULL REFERENCES branches(id),
    structure_id UUID NOT NULL REFERENCES site_structures(id),
    
    -- Denormalized tree for efficient reads (computed from structure_nodes)
    structure_tree JSONB NOT NULL DEFAULT '[]',
    
    -- Metadata schema (JSON Schema format) - versioned per branch
    metadata_schema JSONB NOT NULL DEFAULT '{
        "type": "object",
        "properties": {
            "title": {"type": "string", "maxLength": 100},
            "description": {"type": "string", "maxLength": 300}
        },
        "required": ["title"]
    }',
    
    -- Schema enforcement mode
    schema_enforcement TEXT NOT NULL DEFAULT 'warn',
    -- 'strict': reject non-conforming documents on save
    -- 'warn': allow but flag non-conforming documents
    -- 'none': no enforcement
    
    has_changes_since_checkpoint BOOLEAN DEFAULT FALSE,
    last_modified_at TIMESTAMPTZ,
    last_modified_by UUID,
    
    PRIMARY KEY (branch_id, structure_id)
);

-- Document metadata within a structure (separate from document content)
CREATE TABLE branch_document_metadata (
    branch_id UUID NOT NULL REFERENCES branches(id),
    structure_id UUID NOT NULL REFERENCES site_structures(id),
    document_id UUID NOT NULL REFERENCES documents(id),
    
    -- Metadata conforming to the structure's schema
    metadata JSONB NOT NULL DEFAULT '{}',
    
    -- Validation state (cached, updated on schema or metadata change)
    conforms_to_schema BOOLEAN DEFAULT TRUE,
    validation_errors JSONB DEFAULT '[]',
    
    last_modified_at TIMESTAMPTZ,
    last_modified_by UUID,
    
    PRIMARY KEY (branch_id, structure_id, document_id)
);

CREATE INDEX idx_branch_doc_metadata_document ON branch_document_metadata(document_id);
CREATE INDEX idx_branch_doc_metadata_conformance ON branch_document_metadata(branch_id, structure_id, conforms_to_schema);

-- Structure snapshots at checkpoints
CREATE TABLE checkpoint_structures (
    checkpoint_id UUID NOT NULL REFERENCES checkpoints(id),
    structure_id UUID NOT NULL REFERENCES site_structures(id),
    
    structure_tree JSONB NOT NULL,
    metadata_schema JSONB NOT NULL,
    schema_enforcement TEXT NOT NULL,
    
    PRIMARY KEY (checkpoint_id, structure_id)
);

-- Document metadata snapshots at checkpoints
CREATE TABLE checkpoint_document_metadata (
    checkpoint_id UUID NOT NULL REFERENCES checkpoints(id),
    structure_id UUID NOT NULL REFERENCES site_structures(id),
    document_id UUID NOT NULL REFERENCES documents(id),
    
    metadata JSONB NOT NULL,
    
    PRIMARY KEY (checkpoint_id, structure_id, document_id)
);
```

### Structure Tree Format

The `structure_tree` JSONB field stores a denormalized tree for efficient reading:

```json
[
  {
    "id": "node-uuid-1",
    "name": "Getting Started",
    "slug": "getting-started",
    "path": "/getting-started",
    "nodeType": "section",
    "isVisible": true,
    "children": [
      {
        "id": "node-uuid-2",
        "name": "Installation",
        "slug": "installation",
        "path": "/getting-started/installation",
        "nodeType": "document",
        "documentId": "doc-uuid-1",
        "isVisible": true,
        "children": []
      },
      {
        "id": "node-uuid-3",
        "name": "Quick Start",
        "slug": "quick-start",
        "path": "/getting-started/quick-start",
        "nodeType": "document",
        "documentId": "doc-uuid-2",
        "isVisible": true,
        "children": []
      }
    ]
  },
  {
    "id": "node-uuid-4",
    "name": "External Resources",
    "slug": "resources",
    "path": "/resources",
    "nodeType": "external",
    "externalUrl": "https://example.com/resources",
    "isVisible": true,
    "children": []
  }
]
```

### Metadata Schema Example

A typical blog collection might have this schema:

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "maxLength": 100,
      "description": "Page title for SEO and display"
    },
    "description": {
      "type": "string",
      "maxLength": 300,
      "description": "Meta description for search results"
    },
    "publishDate": {
      "type": "string",
      "format": "date-time",
      "description": "When this content should be/was published"
    },
    "author": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "email": { "type": "string", "format": "email" }
      },
      "required": ["name"]
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 10
    },
    "featuredImage": {
      "type": "object",
      "properties": {
        "url": { "type": "string", "format": "uri" },
        "alt": { "type": "string" }
      },
      "required": ["url", "alt"]
    },
    "visibility": {
      "type": "string",
      "enum": ["public", "private", "unlisted"],
      "default": "public"
    }
  },
  "required": ["title", "description"]
}
```

### Schema Evolution Workflow

When a metadata schema is modified on a branch:

1. **Validation runs** against all documents in the structure
2. **Non-conforming documents are flagged** but not blocked (unless enforcement is 'strict')
3. **Validation state is cached** in `branch_document_metadata.conforms_to_schema`
4. **Merge checks can require conformance** before merging to main

```typescript
interface SchemaValidationResult {
  structureId: string;
  totalDocuments: number;
  conformingDocuments: number;
  nonConformingDocuments: Array<{
    documentId: string;
    documentPath: string;
    errors: Array<{
      field: string;
      message: string;
      currentValue: any;
    }>;
  }>;
}
```

### Structure API

```typescript
interface StructureAPI {
  // Structure management
  createStructure(params: {
    change_setId: string;
    name: string;
    slug: string;
    structureType: 'collection' | 'hierarchy';
    initialSchema?: JSONSchema;
  }): Promise<SiteStructure>;
  
  getStructure(
    change_setId: string,
    branchId: string,
    structureId: string
  ): Promise<SiteStructure>;
  
  listStructures(
    change_setId: string,
    branchId: string
  ): Promise<SiteStructure[]>;
  
  // Node management
  addNode(params: {
    change_setId: string;
    branchId: string;
    structureId: string;
    parentNodeId?: string;  // null for root level
    node: {
      name: string;
      slug: string;
      nodeType: 'section' | 'document' | 'external';
      documentId?: string;
      externalUrl?: string;
      isVisible?: boolean;
    };
    position?: number;
  }): Promise<StructureNode>;
  
  updateNode(params: {
    change_setId: string;
    branchId: string;
    nodeId: string;
    updates: {
      name?: string;
      slug?: string;
      isVisible?: boolean;
    };
  }): Promise<StructureNode>;
  
  moveNode(params: {
    change_setId: string;
    branchId: string;
    nodeId: string;
    newParentId?: string;
    newPosition: number;
  }): Promise<StructureNode>;
  
  removeNode(params: {
    change_setId: string;
    branchId: string;
    nodeId: string;
    strategy: 'remove-children' | 'promote-children';
  }): Promise<void>;
  
  reorderNodes(params: {
    change_setId: string;
    branchId: string;
    parentNodeId: string | null;
    nodeOrder: string[];  // Array of node IDs in desired order
  }): Promise<void>;
  
  // Schema management
  updateMetadataSchema(params: {
    change_setId: string;
    branchId: string;
    structureId: string;
    schema: JSONSchema;
    enforcement?: 'strict' | 'warn' | 'none';
  }): Promise<SchemaValidationResult>;
  
  validateStructureDocuments(params: {
    change_setId: string;
    branchId: string;
    structureId: string;
  }): Promise<SchemaValidationResult>;
  
  // Document metadata
  getDocumentMetadata(params: {
    change_setId: string;
    branchId: string;
    structureId: string;
    documentId: string;
  }): Promise<DocumentMetadata>;
  
  updateDocumentMetadata(params: {
    change_setId: string;
    branchId: string;
    structureId: string;
    documentId: string;
    metadata: Record<string, any>;
  }): Promise<DocumentMetadata>;
  
  // Navigation queries
  getNavigation(params: {
    change_setId: string;
    branchId: string;
    structureId: string;
    depth?: number;           // How deep to traverse
    visibleOnly?: boolean;    // Filter to visible nodes only
  }): Promise<NavigationTree>;
  
  getDocumentByPath(params: {
    change_setId: string;
    branchId: string;
    structureId: string;
    path: string;
  }): Promise<{ node: StructureNode; document: Document; metadata: DocumentMetadata } | null>;
}
```

### Document-Structure Relationship

Key design decisions:

1. **Documents exist independently of structures** â€” A document can exist without being in any structure, and can be added to multiple structures.

2. **Metadata is per-structure** â€” The same document in different structures can have different metadata (e.g., different featured images for blog vs. homepage feature).

3. **Structure changes are branch-scoped** â€” Reorganizing navigation on a feature branch doesn't affect main until merged.

4. **Documents can be removed from structure without deletion** â€” Removing a node with `nodeType: 'document'` doesn't delete the underlying document.

### Merge Considerations for Structures

When merging branches with structure changes:

| Scenario | Behavior |
|----------|----------|
| Both branches added nodes | Merge both additions, may need position resolution |
| Both branches moved same node | Conflict requiring resolution |
| One branch deleted node, other modified it | Conflict requiring resolution |
| Schema changed in both branches | Conflict requiring resolution |
| Metadata changed for same document | Use standard JSON merge or conflict |

Structure conflicts are resolved at the structure level, not the node level:

```typescript
interface StructureMergeConflict {
  structureId: string;
  conflictType: 'node-move' | 'node-delete' | 'schema-change' | 'metadata-change';
  details: {
    nodeId?: string;
    documentId?: string;
    sourceValue: any;
    targetValue: any;
    baseValue: any;
  };
}
```

---

## Updated Infrastructure Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| API Server | Cloudflare Workers or Node.js | HTTP API, orchestration |
| Real-time Sessions | Cloudflare Durable Objects | CRDT state, WebSocket connections |
| Primary Database | PostgreSQL (CloudSQL) | Version control metadata, snapshots, audit log, agent tasks, site structures |
| Human Notifications | Firestore | Real-time notification delivery |
| Agent Task Queue | PostgreSQL (or Cloudflare Queues) | Agent work assignment |
| Notification Preferences | PostgreSQL | User/agent notification settings |
| Site Structure | PostgreSQL | Hierarchical organization, metadata schemas |

---

## Appendix: Glossary

| Term | Definition |
|------|------------|
| **Change Set** | Scoped collection of modifications to content, components, templates, or media; typically scoped to a single site |
| **Document** | Single JSON object identified by path; represents a page or content unit |
| **Branch** | Named initiative for collaborative work |
| **Checkpoint** | Named snapshot of branch state |
| **Live State** | Current CRDT state of documents on a branch |
| **CRDT** | Conflict-free Replicated Data Type; enables automatic merge |
| **Merge Base** | Common ancestor checkpoint of two branches |
| **Durable Object** | Cloudflare edge compute with persistent state |
| **Audit Log** | Append-only record of all system actions |
| **Notification** | Alert to human or agent about workflow event |
| **Agent Task** | Work item assigned to an AI agent for processing |
| **Site Structure** | Hierarchical organization of documents (e.g., navigation, collection) |
| **Structure Node** | Entry in a site structure representing a section, document, or external link |
| **Metadata Schema** | JSON Schema defining required metadata for documents in a structure |

---

## Appendix: Migration Path

For existing systems, migration involves:

1. **Import existing documents** as initial checkpoint on `main` branch
2. **Initialize CRDT sessions** from checkpoint snapshots
3. **Map existing users** to actor records with appropriate permissions
4. **Configure agents** if automated workflows are desired

---

## Appendix: Future Considerations

Not included in v1 but worth considering:

- **Multi-site Change Sets**: Support Change Sets that span multiple websites within a portfolio, enabling coordinated updates to copy, components, templates, and media across many sites simultaneously. This would require cross-site conflict detection, portfolio-level permissions, and atomic multi-site publishing.
- **Partial document checkout**: For very large documents, only load visible components
- **Document references**: Components that reference other documents, with cascade handling
- **Conflict prediction**: Warn when starting work on a document another branch has modified
- **Approval workflows**: Require multiple approvals before merge to main
- **Email notifications**: Digest emails for users who prefer asynchronous updates
- **Audit log analytics**: Dashboard for Change Set activity patterns and agent performance
- **Task scheduling**: Cron-like scheduling for recurring agent tasks

---

*This document is intended as the authoritative reference for implementing the Collaborative JSON State Versioning System. Implementation teams should refer to this document and raise questions or change requests through the standard review process.*
