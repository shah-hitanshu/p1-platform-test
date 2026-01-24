# Collaborative JSON State Versioning System

## Architecture Specification

**Version:** 2.2  
**Status:** Scope-Focused Architecture

> **v2.2 Changes**: Reduced scope to core mission. Removed agent lifecycle management, audit logging, and notification preferences (delegate to platform services). Authentication simplified to local mock for development with production delegation to Pantheon Identity Service. Branch-level authorization remains in this service.

> **v2.1 Changes**: Finalized permission model with Organization entity, four actor types (User, Agent, Guest, Approver), Pantheon-based role derivation, branch grants for elevation, DocuSign-style approvals, and configurable main branch protection.

> **v2.0 Changes**: Removed "Change Set" concept. Branches now exist directly under Sites. The `main` branch represents the published state.

---

## Executive Summary

This document specifies the architecture for a **focused system** that stores JSON state objects (representing UI components, configurations, and content) with git-like branching and merging capabilities, while supporting real-time collaborative editing within documents.

### Core Mission

The Collaborative State System provides:

1. **Document storage** with path-based organization within sites
2. **Git-like branching** with explicit create/merge operations
3. **Real-time collaboration** via CRDT within documents
4. **Conflict detection and resolution** for merge operations
5. **Branch-level authorization** for access control

### Delegated Responsibilities

This system **consumes** rather than **implements** the following platform capabilities:

| Capability | Delegated To | Interface |
|------------|--------------|-----------|
| User authentication | Pantheon Identity Service | `AuthenticatedPrincipal` |
| Agent identity & lifecycle | Pantheon AI Agent Service | `AgentIdentity` |
| Audit logging | Pantheon Audit Service | Event emission |
| Notifications | Platform Notification Service | Event emission |
| Organization hierarchy | Pantheon (existing) | Site-to-org mapping |

### Local Development

For local prototyping and testing, a **mock identity provider** supplies test principals without external dependencies. Production deployments integrate with Pantheon platform services.

---

## Service Dependencies

### Pantheon Identity Service (Production)

The Collaborative State System receives pre-validated identity from Pantheon:

```typescript
interface AuthenticatedPrincipal {
  id: string;
  type: 'user' | 'agent' | 'service';
  email?: string;
  
  // Pantheon context
  organizationId?: string;
  pantheonSiteRoles: Map<string, PantheonRole>;
  
  // Token metadata
  tokenExpiry: Date;
  scopes?: string[];
}

type PantheonRole = 'owner' | 'admin' | 'developer' | 'team_member';
```

**Integration Pattern:**
- API gateway or middleware validates tokens via Pantheon Identity
- This service receives `AuthenticatedPrincipal` in request context
- No token validation logic in this service (production)

### Pantheon AI Agent Service (Production)

Agents are defined and managed externally. This service validates agent identity and receives task assignments:

```typescript
interface AgentIdentity {
  id: string;
  organizationId: string;
  name: string;
  capabilities: string[];
  
  // Access grants (managed by Agent Service)
  siteAccess: Map<string, AgentSiteRole>;
}

type AgentSiteRole = 'viewer' | 'editor' | 'admin';

interface AgentService {
  // Validate agent token/API key
  validateAgent(token: string): Promise<AgentIdentity | null>;
  
  // Report usage for billing/metering
  reportUsage(agentId: string, usage: UsageRecord): Promise<void>;
}
```

**Integration Pattern:**
- Agent tokens validated via Agent Service API
- This service receives `AgentIdentity` similar to user principals
- Task orchestration handled by Agent Service; this service executes tasks

### Pantheon Audit Service (Production)

This service emits audit events rather than storing them:

```typescript
interface AuditEvent {
  service: 'collaborative-state';
  action: string;
  actor: { id: string; type: 'user' | 'agent' | 'guest' | 'system' };
  resource: { type: string; id: string; siteId: string };
  context: Record<string, unknown>;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}

interface AuditService {
  emit(event: AuditEvent): Promise<void>;
}
```

**Integration Pattern:**
- Emit events asynchronously (fire-and-forget with retry)
- No local audit storage in production
- Audit Service handles retention, compliance, querying

### Mock Identity Provider (Local Development)

For local testing without external dependencies:

```typescript
interface MockIdentityConfig {
  users: MockUser[];
  agents: MockAgent[];
  defaultSiteRoles: Map<string, PantheonRole>;
}

interface MockUser {
  id: string;
  email: string;
  name: string;
  siteRoles: Map<string, PantheonRole>;
}

interface MockAgent {
  id: string;
  name: string;
  apiKey: string;  // Unhashed for local testing
  siteRoles: Map<string, AgentSiteRole>;
}
```

**Local Auth Flow:**
```
┌─────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   Client    │───▶│  Mock Identity      │───▶│  Collaborative      │
│             │    │  Provider           │    │  State System       │
│             │    │  • JWT issuer       │    │  • Receives         │
│             │    │  • Test users       │    │    principal        │
│             │    │  • Test agents      │    │  • Branch authz     │
└─────────────┘    └─────────────────────┘    └─────────────────────┘
```

---

## Core Concepts

### Site

A Site corresponds to a Pantheon website. Each site contains documents (content) and branches (lines of work). The site references Pantheon's site identifier and organization—this service does not own organizational hierarchy.

Users gain baseline access through Pantheon's existing site role system. This service applies **branch-level authorization** on top of that baseline.

### Branch

A branch represents a **named line of work** that one or more people collaborate on. Each site has a `main` branch that represents the published state—merging to `main` deploys changes to the live Pantheon site.

Branches contain modifications to content, component usage, component prop configuration, templates, or media. Examples:

- `q4-holiday-campaign` — marketing team updating multiple pages
- `fix-about-typo` — single contributor, single document
- `replace-legacy-button` — design system team, many documents

Branches align with Git semantics and map to GitHub Pull Requests when integrated with Pantheon's Git-based workflow.

### Document

A document is a single JSON object representing a page, component definition, form configuration, or other discrete unit of content. Documents are identified by a path within the site (e.g., `pages/home`, `components/header`). Documents exist at the site level and are versioned per-branch.

### Main Branch and Publishing

The `main` branch is special: it represents the currently published state of the site. When changes are merged to `main`, they are deployed to the live Pantheon site. This aligns with Git-based deployment workflows.

### Checkpoint

A checkpoint is a named snapshot of branch state at a point in time. Checkpoints serve as:

- Semantic markers ("Ready for review", "Client approved")
- Rollback points
- Merge bases for conflict detection

Checkpoints are optional—the system auto-saves continuously, and checkpoints mark meaningful moments.

### Live State

The current working state of documents on a branch, maintained via CRDT (Conflict-free Replicated Data Type) for real-time collaboration. Live state is always persisted; there is no "unsaved work."

### Entity Relationships

The following diagram illustrates how Sites, Documents, Branches, and Checkpoints relate to each other:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                   SITE                                      │
│                        (corresponds to Pantheon website)                    │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                           │
          │ has many                                  │ has many
          ▼                                           ▼
┌─────────────────────┐                    ┌─────────────────────────────────┐
│      DOCUMENT       │                    │            BRANCH               │
│  (identified by     │                    │  (line of work, e.g., main,    │
│   path within site) │                    │   feature-branch)              │
└─────────────────────┘                    └─────────────────────────────────┘
          │                                    │              │
          │                                    │              │ has many
          │                                    │              ▼
          │                                    │    ┌─────────────────────┐
          │                                    │    │     CHECKPOINT      │
          │                                    │    │  (named snapshot    │
          │                                    │    │   of branch state)  │
          │                                    │    └─────────────────────┘
          │                                    │              │
          │                                    │              │ captures
          │                                    │              ▼
          │         ┌──────────────────────────┴──────────────────────────┐
          │         │                                                      │
          └────────►│              DOCUMENT VERSION                        │
                    │  (snapshot of document content on a specific branch) │
                    │  - version_number                                    │
                    │  - snapshot (JSON)                                   │
                    │  - crdt_state (for merge support)                    │
                    └──────────────────────────────────────────────────────┘

Key Relationships:
─────────────────
• Site 1:N Documents      - A site contains many documents
• Site 1:N Branches       - A site has many branches (exactly one is 'main')
• Branch 1:N Checkpoints  - A branch accumulates checkpoints over time
• Document + Branch → Document Versions - Each document can have versions on multiple branches
• Checkpoint → Document Versions - A checkpoint captures specific versions of documents

Branch Lineage:
───────────────
• Branches can be created from other branches (source_branch_id)
• The starting point is a specific checkpoint (source_checkpoint_id)
• This creates a tree structure for tracking merge bases

┌──────────────┐     created from      ┌──────────────┐
│    main      │◄─────────────────────│  feature-1   │
│   branch     │    (at checkpoint X)  │   branch     │
└──────────────┘                       └──────────────┘
       ▲
       │ created from
       │ (at checkpoint Y)
┌──────────────┐
│  feature-2   │
│   branch     │
└──────────────┘
```

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

**Rationale:** CRDTs guarantee convergence"”two users editing the same document will always arrive at the same state. This eliminates intra-document merge conflicts entirely.

**Tradeoff:** CRDT merge results may occasionally be semantically nonsensical (e.g., two users rewriting the same paragraph differently). The automatic merge preserves both contributions but may require human review. This is preferable to blocking collaboration with conflict markers.

### Decision 5: Document-Level Conflict Detection for Branch Merges

**Choice:** When merging branches, conflicts are detected at the document level. If both branches modified the same document, the user must choose a resolution strategy.

**Rationale:** While CRDTs can technically merge any concurrent changes, cross-branch merges represent deliberate divergent work. Humans should decide how to reconcile "holiday campaign version of homepage" with "bug fix version of homepage."

**Tradeoff:** Merges require more human oversight than pure CRDT systems. This is intentional"”branches represent intentional divergence that should be reconciled thoughtfully.

### Decision 6: Agents as First-Class Collaborators

**Choice:** AI agents interact with the system through the same mechanisms as human users"”joining branches, making edits via CRDT, creating checkpoints, and proposing merges.

**Rationale:** This simplifies the architecture (one collaboration model, not two) and enables natural human-agent collaboration. Agents appear in presence indicators, their edits stream in real-time, and humans can observe or intervene.

**Tradeoff:** Agents must be "polite—”pausing when humans are actively editing, rate-limiting their changes to not overwhelm the UI. This requires agent-side courtesy logic.

### Decision 7: PostgreSQL for Version Control, Durable Objects for Real-Time

**Choice:** PostgreSQL (CloudSQL) stores site metadata, branches, checkpoints, and document snapshots. Cloudflare Durable Objects host live CRDT sessions.

**Rationale:** PostgreSQL provides transactional guarantees, relational queries, and recursive CTEs for graph traversal (merge-base calculation). Durable Objects provide WebSocket termination, in-memory CRDT state, and automatic persistence"”ideal for real-time collaboration.

**Tradeoff:** Two storage systems to maintain. The clear separation of concerns (version control vs. real-time) justifies this.

### Decision 8: Site Structures with Branch-Versioned Metadata Schemas

**Choice:** Documents are organized into site structures (hierarchical collections). Each structure defines a metadata schema that documents should conform to. Both the structure hierarchy and the schema are versioned per-branch.

**Rationale:** Websites need organizational hierarchy beyond flat document lists"”for navigation, URL paths, and content discovery. Metadata requirements vary by content type (blog posts need authors and publish dates; documentation pages need version numbers). Making schemas modifiable and branch-versioned allows teams to evolve requirements without breaking existing content.

**Tradeoff:** Added complexity in merge conflict detection (structure changes can conflict). Schema enforcement must balance strictness with usability"”we offer configurable enforcement modes (strict, warn, none).

### Decision 9: Separation of Document Content and Structure Metadata

**Choice:** Document content (the JSON state of components) is stored separately from structure metadata (title, description, author, tags). A document can exist in multiple structures with different metadata in each.

**Rationale:** The same content might serve different purposes in different contexts. A case study might appear in both "Resources" and "Customer Stories" with different featured images or descriptions. Separating content from metadata enables this flexibility.

**Tradeoff:** More tables to manage and join. Metadata must be explicitly managed per-structure rather than being intrinsic to the document.

---

## Data Model

### PostgreSQL Schema

```sql
-- Sites (corresponds to Pantheon websites)
-- Organization ownership is managed by Pantheon, not this service
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pantheon_site_id TEXT UNIQUE NOT NULL,  -- Reference to Pantheon's site identifier
    name TEXT NOT NULL,
    
    -- Workflow settings for merge approval
    workflow_settings JSONB NOT NULL DEFAULT '{
        "mergeApprovalMode": "optional",
        "minApprovers": 1,
        "allowSelfApproval": true,
        "approverMode": "both",
        "approverMinRole": "EDITOR"
    }',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents within a site
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id),
    path TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(site_id, path)
);

CREATE INDEX idx_documents_site ON documents(site_id);

-- Branches represent lines of work
-- Each site has a 'main' branch representing the published state
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    -- Valid statuses: 'active', 'review', 'merged', 'archived'
    
    -- Is this the main (published) branch?
    is_main BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Lineage
    source_branch_id UUID REFERENCES branches(id),
    source_checkpoint_id UUID,  -- References checkpoints(id), added after table creation
    
    -- Ownership
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,  -- 'user', 'agent'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(site_id, name)
);

CREATE INDEX idx_branches_site ON branches(site_id);
CREATE INDEX idx_branches_status ON branches(site_id, status);

-- Ensure only one main branch per site
CREATE UNIQUE INDEX idx_branches_main ON branches(site_id) WHERE is_main = TRUE;

-- Document versions (snapshots of document state on a branch)
CREATE TABLE document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    
    -- Version metadata
    version_number INTEGER NOT NULL,
    
    -- Content snapshot
    snapshot JSONB NOT NULL,
    
    -- CRDT state for merge support
    crdt_state BYTEA,
    
    -- What created this version
    source TEXT NOT NULL DEFAULT 'edit',
    -- Valid sources: 'edit', 'merge', 'revert', 'checkpoint'
    
    -- Authorship
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,  -- 'user', 'agent', 'system'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(document_id, branch_id, version_number)
);

CREATE INDEX idx_versions_doc_branch ON document_versions(document_id, branch_id);
CREATE INDEX idx_versions_branch ON document_versions(branch_id);

-- Checkpoints (named snapshots of branch state)
CREATE TABLE checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    
    -- Checkpoint metadata
    name TEXT,
    message TEXT,
    
    -- Type of checkpoint
    checkpoint_type TEXT NOT NULL DEFAULT 'manual',
    -- Valid types: 'manual', 'auto', 'pre_merge', 'post_merge'
    
    -- Authorship
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,  -- 'user', 'agent', 'system'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_checkpoints_branch ON checkpoints(branch_id, created_at DESC);

-- Checkpoint document snapshots (which versions are in this checkpoint)
CREATE TABLE checkpoint_documents (
    checkpoint_id UUID NOT NULL REFERENCES checkpoints(id),
    document_id UUID NOT NULL REFERENCES documents(id),
    document_version_id UUID NOT NULL REFERENCES document_versions(id),
    
    PRIMARY KEY (checkpoint_id, document_id)
);

-- Merge requests
CREATE TABLE merge_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id),
    
    -- Source and target branches
    source_branch_id UUID NOT NULL REFERENCES branches(id),
    target_branch_id UUID NOT NULL REFERENCES branches(id),
    
    -- Merge base (checkpoint on target when merge was proposed)
    base_checkpoint_id UUID REFERENCES checkpoints(id),
    
    -- Request metadata
    title TEXT NOT NULL,
    description TEXT,
    
    -- State
    status TEXT NOT NULL DEFAULT 'open',
    -- Valid statuses: 'open', 'approved', 'merged', 'closed', 'conflicted'
    
    -- Conflict tracking
    has_conflicts BOOLEAN DEFAULT FALSE,
    conflict_details JSONB,
    
    -- Authorship
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Resolution
    merged_at TIMESTAMPTZ,
    merged_by_id UUID,
    merged_by_type TEXT,
    closed_at TIMESTAMPTZ,
    closed_by_id UUID,
    closed_by_type TEXT
);

CREATE INDEX idx_merge_requests_site ON merge_requests(site_id);
CREATE INDEX idx_merge_requests_source ON merge_requests(source_branch_id);
CREATE INDEX idx_merge_requests_target ON merge_requests(target_branch_id);
CREATE INDEX idx_merge_requests_status ON merge_requests(site_id, status);

-- Branch grants (role elevation for actors on specific branches)
-- This is the primary authorization table owned by this service
CREATE TABLE branch_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    
    -- Actor identity (from Pantheon Identity or Agent Service)
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,  -- 'user', 'agent'
    
    -- Elevated role for this branch
    role TEXT NOT NULL,  -- 'VIEWER', 'EDITOR', 'ADMIN'
    
    -- Grant metadata
    granted_by_id UUID NOT NULL,
    granted_by_type TEXT NOT NULL,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT,
    
    UNIQUE(branch_id, actor_id)
);

CREATE INDEX idx_branch_grants_branch ON branch_grants(branch_id);
CREATE INDEX idx_branch_grants_actor ON branch_grants(actor_id);

-- Guest links (view-only, branch-scoped)
-- NOTE: Candidate for extraction to shared approval/access service
CREATE TABLE guest_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    
    -- Recipient
    email TEXT NOT NULL,
    name TEXT,
    
    -- Auth
    token_hash TEXT NOT NULL UNIQUE,
    
    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'active',
    -- Valid: 'active', 'revoked', 'expired'
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- Metadata
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    message TEXT,
    
    -- Usage tracking
    access_count INTEGER DEFAULT 0,
    last_access_at TIMESTAMPTZ
);

CREATE INDEX idx_guest_links_token ON guest_links(token_hash);
CREATE INDEX idx_guest_links_branch ON guest_links(branch_id);
CREATE INDEX idx_guest_links_status ON guest_links(status, expires_at);

-- Approval requests (for merge request approvals)
-- NOTE: Candidate for extraction to shared approval service
CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merge_request_id UUID NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
    
    -- Approver identity (may not have Pantheon account)
    approver_email TEXT NOT NULL,
    approver_name TEXT,
    
    -- Auth (for external approvers without Pantheon accounts)
    token_hash TEXT UNIQUE,
    
    -- State
    status TEXT NOT NULL DEFAULT 'pending',
    -- Valid: 'pending', 'approved', 'rejected', 'expired'
    
    -- Lifecycle
    expires_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    comment TEXT,
    
    -- Audit trail
    ip_address TEXT,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(merge_request_id, approver_email)
);

CREATE INDEX idx_approval_requests_mr ON approval_requests(merge_request_id);
CREATE INDEX idx_approval_requests_token ON approval_requests(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX idx_approval_requests_status ON approval_requests(status);
```

### Firestore Schema (Real-Time Layer)

Firestore handles real-time collaboration state. This is complementary to PostgreSQL, not a replacement.

```
/sites/{siteId}/
  /branches/{branchId}/
    /documents/{documentId}/
      - crdtState: bytes        # Yjs encoded state
      - lastModified: timestamp
      - activeEditors: map      # userId -> cursor position
      
    /presence/
      /{odId}/                 # Durable Object ID
        - connectedUsers: []
        - lastHeartbeat: timestamp
```

### TypeScript Types

```typescript
// Core entities
interface Site {
  id: string;
  pantheonSiteId: string;
  name: string;
  workflowSettings: WorkflowSettings;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkflowSettings {
  mergeApprovalMode: 'none' | 'optional' | 'required';
  minApprovers: number;
  allowSelfApproval: boolean;
  approverMode: 'role_based' | 'explicit' | 'both';
  approverMinRole?: 'EDITOR' | 'ADMIN';
}

interface Branch {
  id: string;
  siteId: string;
  name: string;
  description?: string;
  status: 'active' | 'review' | 'merged' | 'archived';
  isMain: boolean;
  sourceBranchId?: string;
  sourceCheckpointId?: string;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: Date;
  updatedAt: Date;
}

interface Document {
  id: string;
  siteId: string;
  path: string;
  createdAt: Date;
}

interface DocumentVersion {
  id: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  crdtState?: Uint8Array;
  source: 'edit' | 'merge' | 'revert' | 'checkpoint';
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdAt: Date;
}

interface Checkpoint {
  id: string;
  branchId: string;
  name?: string;
  message?: string;
  checkpointType: 'manual' | 'auto' | 'pre_merge' | 'post_merge';
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdAt: Date;
}

interface MergeRequest {
  id: string;
  siteId: string;
  sourceBranchId: string;
  targetBranchId: string;
  baseCheckpointId?: string;
  title: string;
  description?: string;
  status: 'open' | 'approved' | 'merged' | 'closed' | 'conflicted';
  hasConflicts: boolean;
  conflictDetails?: ConflictDetails;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: Date;
  updatedAt: Date;
  mergedAt?: Date;
  mergedById?: string;
  mergedByType?: string;
}

// Authorization (owned by this service)
interface BranchGrant {
  id: string;
  branchId: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: 'VIEWER' | 'EDITOR' | 'ADMIN';
  grantedById: string;
  grantedByType: 'user' | 'agent';
  grantedAt: Date;
  reason?: string;
}

// Guest access (candidate for extraction)
interface GuestLink {
  id: string;
  branchId: string;
  email: string;
  name?: string;
  tokenHash: string;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: Date;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: Date;
  message?: string;
  accessCount: number;
  lastAccessAt?: Date;
}

// Approval requests (candidate for extraction)
interface ApprovalRequest {
  id: string;
  mergeRequestId: string;
  approverEmail: string;
  approverName?: string;
  tokenHash?: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt?: Date;
  respondedAt?: Date;
  comment?: string;
  createdAt: Date;
}
```

---
## Real-Time Collaboration Layer

### Durable Object: Document Session

Each document on each branch has a dedicated Durable Object that maintains the CRDT state and manages WebSocket connections.

**Session Identifier:** `{siteId}:{documentId}:{branchId}`

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
        const [siteId, documentId, branchId] = sessionId.split(':');
        
        // Fetch initial state from PostgreSQL via API
        const response = await fetch(
            `${this.env.API_URL}/internal/document-initial-state`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId, documentId, branchId })
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
    siteId: string,
    documentId: string,
    branchId: string
): Promise<DurableObjectStub> {
    const sessionId = `${siteId}:${documentId}:${branchId}`;
    const id = env.DOCUMENT_SESSIONS.idFromName(sessionId);
    return env.DOCUMENT_SESSIONS.get(id);
}
```

---

## API Specification

### Branch Operations

#### Create Branch

```
POST /api/sites/{siteId}/branches

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
GET /api/sites/{siteId}/branches?status=active

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
GET /api/sites/{siteId}/branches/{branchId}

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
GET /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}

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
POST /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/edits

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
WebSocket /api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/connect

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
POST /api/sites/{siteId}/branches/{branchId}/checkpoints

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
GET /api/sites/{siteId}/branches/{branchId}/checkpoints

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
GET /api/sites/{siteId}/checkpoints/{checkpointId}/documents/{documentPath}

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
POST /api/sites/{siteId}/merge/check

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
POST /api/sites/{siteId}/merge/execute

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

### Actor Branch Grants

Branch grants elevate an actor's permissions on specific branches. This applies to both users and agents.

#### List Branch Grants

```
GET /api/sites/{siteId}/branches/{branchId}/grants

Response:
{
    "grants": [
        {
            "id": "grant-uuid",
            "branchId": "branch-uuid",
            "actorId": "user-uuid",
            "actorType": "user",
            "role": "EDITOR",
            "grantedById": "admin-uuid",
            "grantedByType": "user",
            "grantedAt": "2024-01-15T10:30:00Z",
            "reason": "Needs edit access for Q4 campaign"
        }
    ]
}
```

#### Create Branch Grant

```
POST /api/sites/{siteId}/branches/{branchId}/grants

Request:
{
    "actorId": "user-or-agent-uuid",
    "actorType": "user",  // or "agent"
    "role": "EDITOR",     // "VIEWER", "EDITOR", or "ADMIN"
    "reason": "Optional reason for the grant"
}

Response:
{
    "id": "grant-uuid",
    "branchId": "branch-uuid",
    "actorId": "user-or-agent-uuid",
    "actorType": "user",
    "role": "EDITOR",
    "grantedById": "admin-uuid",
    "grantedByType": "user",
    "grantedAt": "2024-01-15T10:30:00Z",
    "reason": "Optional reason for the grant"
}
```

#### Delete Branch Grant

```
DELETE /api/sites/{siteId}/branches/{branchId}/grants/{grantId}

Response: 204 No Content
```

> **Note:** Agent definitions and API keys are managed by the Pantheon AI Agent Service. This service only manages branch-level grants that elevate agent permissions on specific branches.

---

## Infrastructure Components

### Required Services

| Component | Technology | Purpose |
|-----------|------------|---------|
| API Server | Cloudflare Workers or Node.js | HTTP API, orchestration |
| Real-time Sessions | Cloudflare Durable Objects | CRDT state, WebSocket connections |
| Primary Database | PostgreSQL (CloudSQL) | Version control metadata, snapshots |
| Presence Sync | Firestore (optional) | Real-time presence coordination across DOs |

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
    siteId: string,
    branchId: string,
    targetCheckpointId: string
): Promise<Checkpoint> {
    // Get state at target checkpoint
    const targetState = await getDocumentsAtCheckpoint(targetCheckpointId);
    
    // Update live CRDT sessions to match
    for (const doc of targetState) {
        const session = await getDocumentSession(siteId, doc.documentId, branchId);
        await session.replaceState(doc.snapshot);
    }
    
    // Create checkpoint documenting the revert
    return await createCheckpoint(siteId, branchId, {
        message: `Reverted to checkpoint: ${targetCheckpointId}`,
        isAuto: false
    });
}
```

---

## Security & Authorization

### Authentication Strategy

This service uses a **dual-mode authentication strategy**:

| Environment | Authentication Provider | Notes |
|-------------|------------------------|-------|
| Local Development | Mock Identity Provider | Self-contained, no external deps |
| Production | Pantheon Identity Service | Pre-validated principals |

The service **never validates external tokens directly** in production. It receives pre-validated `AuthenticatedPrincipal` objects from the authentication layer.

### Mock Identity Provider (Local Development)

For local testing, a mock provider issues JWTs and validates them:

```typescript
// Configuration file: mock-identity.config.json
{
  "jwtSecret": "local-dev-secret-do-not-use-in-production",
  "tokenExpiry": "24h",
  "users": [
    {
      "id": "user-alice",
      "email": "alice@example.com",
      "name": "Alice Developer",
      "siteRoles": {
        "site-123": "admin",
        "site-456": "developer"
      }
    },
    {
      "id": "user-bob",
      "email": "bob@example.com",
      "name": "Bob Reviewer",
      "siteRoles": {
        "site-123": "team_member"
      }
    }
  ],
  "agents": [
    {
      "id": "agent-zappy",
      "name": "Zappy AI Assistant",
      "apiKey": "test-agent-key-zappy",
      "siteRoles": {
        "site-123": "editor"
      }
    }
  ]
}
```

```typescript
// Mock provider implementation
class MockIdentityProvider {
  private config: MockIdentityConfig;
  
  async issueToken(userId: string): Promise<string> {
    const user = this.config.users.find(u => u.id === userId);
    if (!user) throw new Error('User not found');
    
    return jwt.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
      type: 'user',
      siteRoles: user.siteRoles,
    }, this.config.jwtSecret, { expiresIn: this.config.tokenExpiry });
  }
  
  async validateToken(token: string): Promise<AuthenticatedPrincipal | null> {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret);
      return {
        id: payload.sub,
        type: payload.type,
        email: payload.email,
        pantheonSiteRoles: new Map(Object.entries(payload.siteRoles)),
        tokenExpiry: new Date(payload.exp * 1000),
      };
    } catch {
      return null;
    }
  }
  
  async validateAgentKey(apiKey: string): Promise<AuthenticatedPrincipal | null> {
    const agent = this.config.agents.find(a => a.apiKey === apiKey);
    if (!agent) return null;
    
    return {
      id: agent.id,
      type: 'agent',
      pantheonSiteRoles: new Map(Object.entries(agent.siteRoles)),
      tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
}
```

### Production Authentication Flow

In production, authentication is handled upstream:

```
┌─────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   Client    │───▶│  API Gateway /      │───▶│  Collaborative      │
│             │    │  Pantheon Identity  │    │  State System       │
│  (Bearer    │    │                     │    │                     │
│   token)    │    │  • Validates token  │    │  • Receives         │
│             │    │  • Fetches roles    │    │    principal in     │
│             │    │  • Attaches to req  │    │    request context  │
└─────────────┘    └─────────────────────┘    └─────────────────────┘
```

```typescript
// Production middleware receives pre-validated principal
interface RequestWithPrincipal extends Request {
  principal: AuthenticatedPrincipal;
}

function requireAuth() {
  return (req: RequestWithPrincipal, res: Response, next: NextFunction) => {
    // In production, principal is attached by upstream middleware
    if (!req.principal) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  };
}
```

### Role System

Roles determine what actions an actor can perform:

```typescript
const ROLES = {
  NO_ACCESS: {
    canView: false,
    canEdit: false,
    canCreateBranch: false,
    canEditDocuments: false,
    canCreateCheckpoint: false,
    canProposeMerge: false,
    canMerge: false,
    canMergeToMain: false,
    canManageGrants: false,
  },
  
  VIEWER: {
    canView: true,
    canEdit: false,
    canCreateBranch: false,
    canEditDocuments: false,
    canCreateCheckpoint: false,
    canProposeMerge: false,
    canMerge: false,
    canMergeToMain: false,
    canManageGrants: false,
  },
  
  EDITOR: {
    canView: true,
    canEdit: true,
    canCreateBranch: true,
    canEditDocuments: true,
    canCreateCheckpoint: true,
    canProposeMerge: true,
    canMerge: true,           // Non-main branches
    canMergeToMain: false,    // Requires approval or ADMIN
    canManageGrants: false,
  },
  
  ADMIN: {
    canView: true,
    canEdit: true,
    canCreateBranch: true,
    canEditDocuments: true,
    canCreateCheckpoint: true,
    canProposeMerge: true,
    canMerge: true,
    canMergeToMain: true,
    canManageGrants: true,
  },
} as const;

type RoleName = keyof typeof ROLES;
type Role = typeof ROLES[RoleName];
```

### Pantheon Role Mapping

Pantheon site roles map to system roles:

| Pantheon Role | System Role | Notes |
|---------------|-------------|-------|
| `owner` | ADMIN | Full access |
| `admin` | ADMIN | Full access |
| `developer` | EDITOR | Can edit, needs approval for main |
| `team_member` | EDITOR | Can edit, needs approval for main |
| (no role) | NO_ACCESS | Must be granted via branch_grants |

```typescript
function mapPantheonRole(pantheonRole: PantheonRole | undefined): RoleName {
  switch (pantheonRole) {
    case 'owner':
    case 'admin':
      return 'ADMIN';
    case 'developer':
    case 'team_member':
      return 'EDITOR';
    default:
      return 'NO_ACCESS';
  }
}
```

### Branch-Level Authorization

This is the **core authorization logic owned by this service**. The effective role is calculated as:

```
Effective Role = max(Pantheon Site Role, Branch Grant)
```

Branch grants can **elevate** access but never **restrict** it.

```typescript
async function getEffectiveRole(
  principal: AuthenticatedPrincipal,
  siteId: string,
  branchId: string
): Promise<{ role: Role; roleName: RoleName }> {
  // Step 1: Get Pantheon baseline role for this site
  const pantheonRole = principal.pantheonSiteRoles.get(siteId);
  const baselineRoleName = mapPantheonRole(pantheonRole);
  
  // Step 2: Check for branch-level elevation
  const branchGrant = await db.query(`
    SELECT role FROM branch_grants
    WHERE branch_id = $1 AND actor_id = $2
  `, [branchId, principal.id]);
  
  const grantRoleName = branchGrant.rows[0]?.role as RoleName | undefined;
  
  // Step 3: Effective role is the higher of the two
  const effectiveRoleName = maxRole(baselineRoleName, grantRoleName);
  
  return {
    role: ROLES[effectiveRoleName],
    roleName: effectiveRoleName,
  };
}

function maxRole(a: RoleName, b: RoleName | undefined): RoleName {
  if (!b) return a;
  const order: RoleName[] = ['NO_ACCESS', 'VIEWER', 'EDITOR', 'ADMIN'];
  return order.indexOf(a) > order.indexOf(b) ? a : b;
}
```

### Permission Middleware

```typescript
function requirePermission(permission: keyof Role) {
  return async (req: RequestWithPrincipal, res: Response, next: NextFunction) => {
    const { siteId, branchId } = req.params;
    
    // Special case: guests have fixed VIEWER role
    if (req.principal.type === 'guest') {
      if (permission !== 'canView') {
        return res.status(403).json({ error: 'Guests can only view' });
      }
      next();
      return;
    }
    
    const { role, roleName } = await getEffectiveRole(
      req.principal,
      siteId,
      branchId
    );
    
    if (!role[permission]) {
      return res.status(403).json({
        error: `Missing permission: ${permission}`,
        required: permission,
        yourRole: roleName,
      });
    }
    
    req.effectiveRole = role;
    req.effectiveRoleName = roleName;
    next();
  };
}

// Usage
router.get('/sites/:siteId/branches/:branchId',
  requireAuth(),
  requirePermission('canView'),
  getBranchHandler
);

router.post('/sites/:siteId/branches',
  requireAuth(),
  requirePermission('canCreateBranch'),
  createBranchHandler
);

router.post('/merge-requests/:id/merge',
  requireAuth(),
  requirePermission('canMerge'),
  executeMergeHandler  // Additional check for canMergeToMain if target is main
);
```

### Guest Access

Guests access specific branches via magic links. They receive a fixed VIEWER role:

```typescript
async function validateGuestToken(token: string): Promise<GuestPrincipal | null> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  const result = await db.query(`
    SELECT * FROM guest_links
    WHERE token_hash = $1 
      AND status = 'active'
      AND expires_at > NOW()
  `, [tokenHash]);
  
  if (result.rows.length === 0) return null;
  
  const link = result.rows[0];
  
  // Update access tracking
  await db.query(`
    UPDATE guest_links
    SET access_count = access_count + 1, last_access_at = NOW()
    WHERE id = $1
  `, [link.id]);
  
  return {
    id: `guest:${link.id}`,
    type: 'guest',
    email: link.email,
    branchId: link.branch_id,  // Guests are scoped to a single branch
    tokenExpiry: link.expires_at,
  };
}
```

### Approval Workflow

Merge request approvals can come from:

1. **Role-based approvers**: Users with sufficient Pantheon role on the site
2. **Explicit approvers**: People invited by email (may not have Pantheon account)

```typescript
async function canApprove(
  principal: AuthenticatedPrincipal,
  mergeRequestId: string
): Promise<boolean> {
  const mr = await getMergeRequest(mergeRequestId);
  const site = await getSite(mr.siteId);
  const settings = site.workflowSettings;
  
  // Check explicit approval request
  if (settings.approverMode !== 'role_based') {
    const explicitRequest = await db.query(`
      SELECT * FROM approval_requests
      WHERE merge_request_id = $1 AND approver_email = $2 AND status = 'pending'
    `, [mergeRequestId, principal.email]);
    
    if (explicitRequest.rows.length > 0) return true;
  }
  
  // Check role-based approval
  if (settings.approverMode !== 'explicit') {
    const { roleName } = await getEffectiveRole(principal, mr.siteId, mr.sourceBranchId);
    const minRole = settings.approverMinRole ?? 'EDITOR';
    
    if (roleAtLeast(roleName, minRole)) return true;
  }
  
  return false;
}

function roleAtLeast(role: RoleName, minRole: 'EDITOR' | 'ADMIN'): boolean {
  const order: RoleName[] = ['NO_ACCESS', 'VIEWER', 'EDITOR', 'ADMIN'];
  return order.indexOf(role) >= order.indexOf(minRole);
}
```

### Main Branch Protection

Merging to main has additional checks:

```typescript
async function canMergeToMain(
  principal: AuthenticatedPrincipal,
  mergeRequest: MergeRequest
): Promise<{ allowed: boolean; reason?: string }> {
  const site = await getSite(mergeRequest.siteId);
  const settings = site.workflowSettings;
  
  // Check if target is main
  const targetBranch = await getBranch(mergeRequest.targetBranchId);
  if (!targetBranch.isMain) {
    // Not merging to main, use regular canMerge permission
    return { allowed: true };
  }
  
  // Get actor's role
  const { role, roleName } = await getEffectiveRole(
    principal,
    mergeRequest.siteId,
    mergeRequest.sourceBranchId
  );
  
  // If approval mode is 'none', ADMIN can merge directly
  if (settings.mergeApprovalMode === 'none') {
    if (role.canMergeToMain) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'ADMIN role required for direct merge to main' };
  }
  
  // Check approval count
  const approvals = await getApprovalCount(mergeRequest.id);
  if (approvals < settings.minApprovers) {
    return {
      allowed: false,
      reason: `Requires ${settings.minApprovers} approval(s), has ${approvals}`,
    };
  }
  
  // Self-approval check
  if (!settings.allowSelfApproval) {
    const selfApproved = await hasSelfApproval(mergeRequest.id, principal.id);
    if (selfApproved && approvals === 1) {
      return { allowed: false, reason: 'Self-approval not allowed' };
    }
  }
  
  // Approved merge can be executed by EDITOR+
  if (role.canMerge) {
    return { allowed: true };
  }
  
  return { allowed: false, reason: 'Insufficient permissions' };
}
```

### Audit Event Emission

Rather than storing audit logs locally, emit events to the platform audit service:

```typescript
interface AuditEmitter {
  emit(event: AuditEvent): Promise<void>;
}

// Local development: console logging
class LocalAuditEmitter implements AuditEmitter {
  async emit(event: AuditEvent): Promise<void> {
    console.log('[AUDIT]', JSON.stringify(event));
  }
}

// Production: emit to Pantheon Audit Service
class PantheonAuditEmitter implements AuditEmitter {
  private client: AuditServiceClient;
  
  async emit(event: AuditEvent): Promise<void> {
    await this.client.emit({
      ...event,
      service: 'collaborative-state',
    });
  }
}

// Usage in handlers
async function createBranchHandler(req: RequestWithPrincipal, res: Response) {
  const branch = await createBranch(req.body);
  
  await auditEmitter.emit({
    action: 'branch.created',
    actor: { id: req.principal.id, type: req.principal.type },
    resource: { type: 'branch', id: branch.id, siteId: branch.siteId },
    context: { branchName: branch.name, sourceBranchId: branch.sourceBranchId },
    timestamp: new Date(),
    success: true,
  });
  
  res.status(201).json(branch);
}
```

---
## Site Structure

Websites are more than collections of documents"”they have hierarchical organization, navigation, and shared metadata requirements. The site structure layer provides this organizational capability.

### Core Concepts

**Site Structure**: A named organizational container within a site. A site can have multiple structures (e.g., "Main Navigation", "Blog", "Documentation", "Press Releases"). Each structure defines how documents are organized and what metadata they require.

**Structure Node**: An entry in the hierarchy that can represent a section (grouping), a document reference, or an external link. Nodes form a tree that defines navigation and URL paths.

**Metadata Schema**: A JSON Schema definition that documents within a structure must conform to. Schemas are versioned with branches, allowing schema evolution to be developed and merged like any other change.

### Site Structure Schema

```sql
-- Site structures define organizational containers
CREATE TABLE site_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,           -- URL-safe identifier
    description TEXT,
    
    structure_type TEXT NOT NULL DEFAULT 'hierarchy',
    -- Types: 'collection' (flat list), 'hierarchy' (nested tree)
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(site_id, slug)
);

CREATE INDEX idx_site_structures_site ON site_structures(site_id);

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
    siteId: string;
    name: string;
    slug: string;
    structureType: 'collection' | 'hierarchy';
    initialSchema?: JSONSchema;
  }): Promise<SiteStructure>;
  
  getStructure(
    siteId: string,
    branchId: string,
    structureId: string
  ): Promise<SiteStructure>;
  
  listStructures(
    siteId: string,
    branchId: string
  ): Promise<SiteStructure[]>;
  
  // Node management
  addNode(params: {
    siteId: string;
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
    siteId: string;
    branchId: string;
    nodeId: string;
    updates: {
      name?: string;
      slug?: string;
      isVisible?: boolean;
    };
  }): Promise<StructureNode>;
  
  moveNode(params: {
    siteId: string;
    branchId: string;
    nodeId: string;
    newParentId?: string;
    newPosition: number;
  }): Promise<StructureNode>;
  
  removeNode(params: {
    siteId: string;
    branchId: string;
    nodeId: string;
    strategy: 'remove-children' | 'promote-children';
  }): Promise<void>;
  
  reorderNodes(params: {
    siteId: string;
    branchId: string;
    parentNodeId: string | null;
    nodeOrder: string[];  // Array of node IDs in desired order
  }): Promise<void>;
  
  // Schema management
  updateMetadataSchema(params: {
    siteId: string;
    branchId: string;
    structureId: string;
    schema: JSONSchema;
    enforcement?: 'strict' | 'warn' | 'none';
  }): Promise<SchemaValidationResult>;
  
  validateStructureDocuments(params: {
    siteId: string;
    branchId: string;
    structureId: string;
  }): Promise<SchemaValidationResult>;
  
  // Document metadata
  getDocumentMetadata(params: {
    siteId: string;
    branchId: string;
    structureId: string;
    documentId: string;
  }): Promise<DocumentMetadata>;
  
  updateDocumentMetadata(params: {
    siteId: string;
    branchId: string;
    structureId: string;
    documentId: string;
    metadata: Record<string, any>;
  }): Promise<DocumentMetadata>;
  
  // Navigation queries
  getNavigation(params: {
    siteId: string;
    branchId: string;
    structureId: string;
    depth?: number;           // How deep to traverse
    visibleOnly?: boolean;    // Filter to visible nodes only
  }): Promise<NavigationTree>;
  
  getDocumentByPath(params: {
    siteId: string;
    branchId: string;
    structureId: string;
    path: string;
  }): Promise<{ node: StructureNode; document: Document; metadata: DocumentMetadata } | null>;
}
```

### Document-Structure Relationship

Key design decisions:

1. **Documents exist independently of structures** "” A document can exist without being in any structure, and can be added to multiple structures.

2. **Metadata is per-structure** "” The same document in different structures can have different metadata (e.g., different featured images for blog vs. homepage feature).

3. **Structure changes are branch-scoped** "” Reorganizing navigation on a feature branch doesn't affect main until merged.

4. **Documents can be removed from structure without deletion** "” Removing a node with `nodeType: 'document'` doesn't delete the underlying document.

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

## Extracted Responsibilities

The following capabilities were intentionally **excluded** from this service's scope. They should be implemented as platform-wide services consumed by this and other Pantheon products.

### Pantheon AI Agent Service (External)

**What was extracted:**
- Agent definitions (model, system prompt, configuration)
- Agent API key management
- Agent lifecycle (create, update, activate/deactivate)
- Agent task queue and orchestration
- Agent usage metering for billing

**Interface consumed:**
```typescript
interface AgentService {
  validateAgent(token: string): Promise<AgentIdentity | null>;
  reportUsage(agentId: string, usage: UsageRecord): Promise<void>;
}
```

**What this service still owns:**
- Branch grants for agents (elevation on specific branches)
- Receiving and executing tasks assigned by Agent Service
- Recording agent actions in audit events

### Pantheon Audit Service (External)

**What was extracted:**
- Audit log storage
- Retention policies
- Compliance reporting
- Audit log querying

**Interface consumed:**
```typescript
interface AuditService {
  emit(event: AuditEvent): Promise<void>;
}
```

**What this service still owns:**
- Emitting audit events for all significant actions
- Ensuring events include proper context (actor, resource, site)

### Platform Notification Service (External)

**What was extracted:**
- Notification preferences storage
- Delivery channel management (email, in-app, etc.)
- Quiet hours and scheduling
- Notification templating

**Interface consumed:**
```typescript
interface NotificationService {
  notify(event: NotificationEvent): Promise<void>;
}

interface NotificationEvent {
  type: string;
  recipients: { actorId: string; actorType: string }[];
  context: Record<string, unknown>;
}
```

**What this service still owns:**
- Emitting notification events when relevant actions occur
- Determining who should be notified based on branch assignments

### Approval Service (Candidate for Future Extraction)

The following tables remain in this service but are flagged as candidates for extraction to a shared approval service:

- `guest_links` — View-only access tokens
- `approval_requests` — Merge request approvals

**Rationale for keeping (for now):**
- Tightly coupled to merge request workflow
- No other Pantheon products currently need similar functionality
- Extraction would add latency to approval checks

**Extraction criteria:**
- If other products need DocuSign-style approvals, extract
- If guest access patterns emerge in other products, extract

---
## Appendix: Glossary

| Term | Definition |
|------|------------|
| **site** | Scoped collection of modifications to content, components, templates, or media; typically scoped to a single site |
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
4. **Configure branch grants** for any actors needing elevated access

---

## Appendix: Future Considerations

Not included in v1 but worth considering:

### Core System Enhancements
- **Multi-site branches**: Support branches that span multiple sites within a portfolio, enabling coordinated updates across many sites simultaneously. This would require cross-site conflict detection, portfolio-level permissions, and atomic multi-site publishing.
- **Partial document checkout**: For very large documents, only load visible components
- **Document references**: Components that reference other documents, with cascade handling
- **Conflict prediction**: Warn when starting work on a document another branch has modified

### Integration Points (Delegated Services)
- **Approval service extraction**: If other Pantheon products need DocuSign-style approvals, extract `guest_links` and `approval_requests` to a shared service
- **Enhanced audit analytics**: Consume Pantheon Audit Service aggregations for site activity dashboards
- **Notification preferences**: Integrate with Platform Notification Service when available

### Platform Dependencies
- **Organization hierarchy**: When Pantheon fully supports organization-level access control, integrate for cross-site permissions
- **Agent task orchestration**: When Pantheon AI Agent Service supports task scheduling, integrate for recurring workflows

---

*This document is intended as the authoritative reference for implementing the Collaborative JSON State Versioning System. Implementation teams should refer to this document and raise questions or change requests through the standard review process.*
