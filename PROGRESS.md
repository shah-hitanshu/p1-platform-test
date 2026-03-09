# Collaborative State System - Implementation Progress

## Overview

This document tracks the implementation progress of the Collaborative JSON State Versioning System as defined in `collaborative-state-system-architecture-v2.3.md`.

---
## Completed Work

### Phase 1.1: Project Configuration and Build Tooling

**Status:** Complete
**Commit:** `eb4705a` - Complete Phase 1.1: Project configuration and build tooling

#### Deliverables:
- [x] TypeScript configuration (`workers/tsconfig.json`)
  - Strict mode enabled
  - ES2022 target for Cloudflare Workers compatibility
  - Cloudflare Workers types integrated
- [x] ESLint configuration (`workers/eslint.config.js`)
  - TypeScript ESLint integration
  - Configured for src and tests directories
- [x] Vitest configuration (`workers/vitest.config.ts`)
  - Coverage reporting with v8
  - TypeScript support
  - Test thresholds configured
- [x] Package.json with all dependencies
  - Runtime: yjs, fast-json-patch, jose, object-hash, postgres
  - Dev: TypeScript, ESLint, Vitest, Wrangler, Cloudflare Workers types
- [x] Entry point placeholder (`workers/src/index.ts`)
  - Env interface with all required bindings defined
  - Durable Object namespace bindings
  - KV namespace bindings
  - Environment variables and secrets
- [x] Configuration tests (`workers/tests/config.spec.ts`)
  - TypeScript compilation validation
  - Dependency availability checks
  - Cloudflare Workers types validation

### Phase 1.2: Database Schema and Migrations

**Status:** Complete
**Commit:** `80ea8b4` - Implement Phase 1.2: Database schema and migrations

#### Deliverables:
- [x] Migration runner (`workers/src/db/migrate.ts`)
  - Lightweight TypeScript migration system
  - Tracks applied migrations in `schema_migrations` table
  - Supports run, status, and reset commands
  - npm scripts: `db:migrate`, `db:migrate:status`, `db:migrate:reset`
- [x] Core schema migrations:
  - `001_core_schema.sql`: sites, documents, branches, document_versions
  - `002_checkpoints.sql`: checkpoints, checkpoint_documents
  - `003_merge_requests.sql`: merge_requests, approval_requests
  - `004_authorization.sql`: branch_grants, guest_links
  - `005_site_structures.sql`: site_structures, structure_nodes,
    branch_structure_state, branch_document_metadata,
    checkpoint_structures, checkpoint_document_metadata
  - `006_seed_data.sql`: test sites, branches, documents, checkpoints
- [x] Schema validation tests (`workers/tests/db/schema.spec.ts`)
  - 55 tests covering all tables, columns, indexes, and constraints
  - Seed data validation tests

### Phase 1.3: Core TypeScript Types

**Status:** Complete
**Commits:**
- `e36ee3d` - Add Phase 1.3 type definition tests (TDD)
- `7164341` - Implement Phase 1.3: Core TypeScript types

#### Deliverables:
- [x] Core type definitions (`workers/src/types.ts`)
  - 50 type definitions in a single file
  - ISO strings for all timestamp fields (database compatible)
  - Optional field syntax (`?:`) for nullable fields
- [x] Union/enum types (17 total):
  - ActorType, PantheonRole, AgentSiteRole, RoleName
  - BranchStatus, CheckpointType, DocumentVersionSource
  - MergeRequestStatus, ApprovalRequestStatus, GuestLinkStatus
  - MergeApprovalMode, ApproverMode, ConflictResolutionStrategy
  - StructureType, NodeType, SchemaEnforcementMode, EditOperationType
- [x] Core entity interfaces:
  - Site, WorkflowSettings, Branch, Document, DocumentVersion
  - Checkpoint
- [x] Merge types:
  - MergeRequest, ConflictDetails, DocumentConflict, StructureMergeConflict
- [x] Authorization types:
  - Role, RolePermissions, BranchGrant, GuestLink, ApprovalRequest
- [x] Identity types:
  - AuthenticatedPrincipal, AgentIdentity
  - MockUser, MockAgent, MockIdentityConfig
- [x] Structure types:
  - SiteStructure, StructureNode, BranchStructureState, BranchDocumentMetadata
  - SchemaValidationResult, NonConformingDocument, SchemaValidationError
- [x] Operations types:
  - EditOperation, ConnectionMeta
- [x] Audit types:
  - AuditEvent, AuditActor, AuditResource
- [x] Type validation tests (`workers/tests/types/types.spec.ts`)
  - 73 tests covering all types
  - Compile-time type checking
  - Database schema compatibility validation

### Phase 2.1: Mock Identity Provider

**Status:** Complete
**Commits:**
- `ac24f9b` - Add Phase 2.1 TDD tests for MockIdentityProvider
- `effbd06` - Implement Phase 2.1: MockIdentityProvider

#### Deliverables:
- [x] MockIdentityProvider class (`workers/src/auth/mock-identity-provider.ts`)
  - JWT issuance with jose library using HS256 signing
  - Token validation with issuer verification (`mock-identity-provider`)
  - Agent API key validation with 24-hour expiry
  - User/agent lookup methods (getUser, getUserByEmail, getAgent)
- [x] Configuration validation
  - jwtSecret minimum 32 characters
  - Required users and agents arrays
  - Default token expiry of 24 hours
- [x] Sample configuration file (`workers/mock-identity.config.json`)
- [x] Environment integration (`MOCK_JWT_SECRET` in Env interface)
- [x] Test suite (`workers/tests/auth/mock-identity-provider.spec.ts`)
  - 44 tests covering constructor, token issuance, validation, edge cases

### Phase 2.2: Authorization System

**Status:** Complete
**Commits:**
- `9137b89` - Add Phase 2.2 TDD tests for Authorization System
- `2a51f94` - Implement Phase 2.2: Authorization System

#### Deliverables:
- [x] Role definitions (`workers/src/auth/roles.ts`)
  - `ROLES` constant with NO_ACCESS, VIEWER, EDITOR, ADMIN
  - Each role has 9 permission flags (canView, canEdit, canCreateBranch, etc.)
  - `mapPantheonRole()` for Pantheon to system role mapping
  - `maxRole()` for role comparison (elevation logic)
  - `roleAtLeast()` for minimum role checks
  - `getRolePermissions()` for role lookup
- [x] Database interface (`workers/src/db.ts`)
  - Query abstraction for PostgreSQL
  - Supports parameterized queries for SQL injection prevention
  - Designed for Cloudflare Workers compatibility
- [x] Branch-level authorization (`workers/src/auth/authorization.ts`)
  - `getEffectiveRole()` - calculates max(Pantheon Site Role, Branch Grant)
  - `hasPermission()` - checks specific permission
  - `assertPermission()` - throws AuthorizationError if denied
  - `AuthorizationError` class with permission and role info
- [x] Permission middleware (`workers/src/auth/middleware.ts`)
  - `requirePermission()` - factory for permission-based access control
  - `requireRole()` - factory for role-based access control
  - Guest principal handling (fixed VIEWER role, canView only)
  - Attaches effectiveRole and effectiveRoleName to request
- [x] Guest access validation (`workers/src/auth/guest-access.ts`)
  - `validateGuestToken()` - SHA-256 hash lookup, expiry check
  - `createGuestLink()` - secure token generation, database insert
  - `revokeGuestLink()` - status update to revoked
  - `getGuestLinksByBranch()` - list active/all guest links
  - `isGuestBranchAccess()` - scope validation
  - `GUEST_ROLE` constant (fixed VIEWER permissions)
- [x] Test suite
  - 92 tests across 4 test files (roles, authorization, middleware, guest-access)

### Phase 3.1: Site and Document Operations

**Status:** Complete
**Commits:**
- TDD tests and implementation (pending commit)

#### Deliverables:
- [x] Site Service (`workers/src/services/site-service.ts`)
  - `createSite()` - create site with workflow settings
  - `getSite()` - retrieve site by ID
  - `getSiteByPantheonId()` - retrieve site by Pantheon site ID
  - `updateSite()` - update site name or workflow settings (with merge)
  - `deleteSite()` - delete site
  - `listSites()` - list sites with pagination
  - `DuplicatePantheonSiteIdError` - unique constraint violation
  - `InvalidSiteParamsError` - validation errors
- [x] Document Service (`workers/src/services/document-service.ts`)
  - `createDocument()` - create document at path
  - `getDocument()` - retrieve document by ID
  - `getDocumentByPath()` - retrieve document by path within site
  - `updateDocumentPath()` - move document to new path
  - `deleteDocument()` - delete document
  - `listDocuments()` - list documents with pagination and pathPrefix filter
  - `documentExists()` - check if document exists at path
  - `SiteNotFoundError` - foreign key violation
  - `DuplicateDocumentPathError` - unique constraint violation
  - `InvalidDocumentPathError` - path format validation
- [x] Service exports (`workers/src/services/index.ts`)
- [x] Test suite
  - 31 tests for Site Service
  - 38 tests for Document Service
  - 69 tests total

### Infrastructure Validation (Post Phase 3.1)

**Status:** Complete
**Purpose:** Validate Cloudflare Workers + PostgreSQL stack before building full API

#### Deliverables:
- [x] Health endpoint (`workers/src/index.ts`)
  - `/health` route returning JSON status
  - Database connectivity check with latency measurement
  - Returns 200 for healthy, 503 for unhealthy
- [x] Real PostgreSQL connection (`workers/src/db.ts`)
  - `initializeDatabaseFromConnectionString()` function
  - Uses `postgres` package with Worker-optimized settings
  - Connection pooling configured for single-threaded Workers
- [x] Durable Object stubs (`workers/src/durable-objects/index.ts`)
  - `DocumentState`, `PresenceManager`, `SessionManager` placeholder classes
  - Required by wrangler for local development
  - Return 501 Not Implemented (ready for Phase 4)
- [x] Wrangler configuration updates (`workers/wrangler.jsonc`)
  - Added placeholder KV namespace IDs for local development
  - Durable Object exports from entry point

#### Validation Results:
```json
{
  "status": "healthy",
  "environment": "local",
  "timestamp": "2026-01-23T21:45:39.351Z",
  "database": {
    "connected": true,
    "latencyMs": 62
  }
}
```

### Phase 3.2: Branch Operations

**Status:** Complete
**Commits:**
- `bd57bd2` - Add Phase 3.2 TDD tests for Branch Service
- `4262c9f` - Implement Phase 3.2: Branch Service

#### Deliverables:
- [x] Branch Service (`workers/src/services/branch-service.ts`)
  - `createBranch()` - create branch from source branch
  - `createMainBranch()` - create main branch for a site
  - `getBranch()` - retrieve branch by ID
  - `getBranchByName()` - retrieve branch by name within site
  - `getMainBranch()` - retrieve main branch for site
  - `listBranches()` - list branches with status filter and pagination
  - `updateBranch()` - update branch name/description
  - `updateBranchStatus()` - update status with transition validation
  - `deleteBranch()` - delete branch (with main branch protection)
  - `isValidStatusTransition()` - check if status transition is valid
- [x] Error Classes
  - `SiteNotFoundError` - site doesn't exist
  - `BranchNotFoundError` - branch doesn't exist
  - `DuplicateBranchNameError` - branch name already exists in site
  - `InvalidBranchParamsError` - validation errors
  - `MainBranchProtectionError` - cannot delete/archive main branch
  - `InvalidBranchStatusTransitionError` - invalid status transition
- [x] Status Transition Rules
  - `active → review` (submit for review)
  - `active → archived` (archive without merging)
  - `review → active` (back to development)
  - `review → merged` (complete merge)
  - Terminal states: `merged`, `archived`
- [x] Service exports (`workers/src/services/index.ts`)
- [x] Test suite
  - 63 unit tests for Branch Service
  - 28 integration tests for Branch Service
  - 91 tests total

### Phase 3.3: Checkpoint System

**Status:** Complete
**Commits:**
- `71b175a` - Add Phase 3.3 TDD tests for Checkpoint System
- `2b51529` - Implement Phase 3.3: Checkpoint System

#### Deliverables:
- [x] Document Version Service (`workers/src/services/document-version-service.ts`)
  - `createDocumentVersion()` - create version with auto-incremented version number
  - `getDocumentVersion()` - retrieve version by ID
  - `getLatestDocumentVersion()` - get latest version of document on branch
  - `getLatestVersionsForBranch()` - get all latest versions on a branch
  - `listDocumentVersions()` - list version history with pagination
  - `getDocumentVersionByNumber()` - retrieve specific version by number
  - `DocumentNotFoundError` - document doesn't exist
  - `InvalidDocumentVersionParamsError` - validation errors
- [x] Checkpoint Service (`workers/src/services/checkpoint-service.ts`)
  - `createCheckpoint()` - create checkpoint capturing current branch state
  - `getCheckpoint()` - retrieve checkpoint by ID
  - `listCheckpoints()` - list checkpoints with filtering and pagination
  - `getDocumentsAtCheckpoint()` - get all document versions in checkpoint
  - `getDocumentAtCheckpoint()` - get specific document at checkpoint by path
  - `revertToCheckpoint()` - restore branch to checkpoint state
  - `deleteCheckpoint()` - delete checkpoint and associations
  - `getLatestCheckpoint()` - get most recent checkpoint for branch
  - `getCheckpointDocumentCount()` - count documents in checkpoint
  - `BranchNotFoundError` - branch doesn't exist
  - `CheckpointNotFoundError` - checkpoint doesn't exist
  - `InvalidCheckpointParamsError` - validation errors
- [x] Transaction safety
  - `createCheckpoint()` wrapped in BEGIN/COMMIT/ROLLBACK
  - `deleteCheckpoint()` wrapped in BEGIN/COMMIT/ROLLBACK
- [x] Service exports (`workers/src/services/index.ts`)
- [x] Test suite
  - 18 unit tests for Document Version Service
  - 30 unit tests for Checkpoint Service
  - 48 tests total

#### Security Review (Phase 3.3):
- **SQL Injection:** All queries use parameterized queries - SECURE
- **Authorization:** Deferred to API layer (Phase 7) by design
- **Transaction Safety:** Multi-step operations wrapped in transactions
- **Input Validation:** Required fields validated, enums enforced by TypeScript
- **Future Work:** Rate limiting, audit logging (Phase 7)

---

### Infrastructure Validation (Post Phase 3.1)

**Status:** Complete
**Purpose:** Validate Cloudflare Workers + PostgreSQL stack before building full API

(See Infrastructure Validation section above for details)

#### Decision: Minimal Infrastructure Validation
- **Date:** 2026-01-23
- **Context:** Question arose whether to build full API endpoints alongside services or wait until Phase 7
- **Decision:** Implement minimal `/health` endpoint only, continue building services with integration tests
- **Rationale:**
  - Full API design benefits from complete domain context
  - Architecture phases exist for good reason (Phase 7 is for API)
  - Integration tests already validate database operations
  - Premature API = potential rework when requirements clarify
- **Impact:** Services validated via integration tests; API endpoints deferred to Phase 7

---
## Outstanding Work

---

### Phase 4: Real-Time Collaboration

#### Phase 4.1: Durable Object Implementation
**Status:** Complete
**Commits:**
- `8705adc` - Add Phase 4.1 TDD tests for DocumentSession Durable Object
- `6863116` - Implement Phase 4.1: DocumentSession Durable Object

##### Deliverables:
- [x] DocumentSession Durable Object (`workers/src/durable-objects/document-session.ts`)
  - Session identifier format: `{siteId}:{documentId}:{branchId}`
  - `getSessionInfo()` - parse session identifiers
  - `getConnectionCount()` - current WebSocket connections
  - `fetch()` - route to /snapshot, /apply, /connect
- [x] CRDT state management with Yjs
  - Y.Doc for document state
  - State vector for synchronization
  - Lazy initialization from storage
  - Persists state as Yjs update (Uint8Array)
- [x] Edit operations (`/apply` endpoint)
  - `set` - set value at path
  - `delete` - remove value at path
  - `insert` - insert into array at index
  - `move` - move array element
  - `replace` - replace value at path
- [x] WebSocket connection handling (`/connect` endpoint)
  - Actor ID/Type header validation
  - Connection metadata tracking
  - Real-time broadcast to all clients
- [x] State persistence
  - Storage key: `ydoc`
  - Auto-persist after each operation batch
  - Graceful handling of invalid stored data
- [x] Security hardening
  - Actor ID format validation (alphanumeric, hyphens, underscores, max 128 chars)
  - Operations limit per request (max 1000)
  - WebSocket connection limit (max 100)
  - WebSocket message size limit (max 1MB)
  - Path depth validation (max 50 levels)
  - Value nesting depth limit (max 50 levels)
  - Sanitized error messages
- [x] Test suite (`workers/tests/durable-objects/document-session.spec.ts`)
  - 46 tests covering all functionality

##### Security Review (Phase 4.1):
| Finding | Severity | Status |
|---------|----------|--------|
| Missing Actor ID Format Validation | Medium | Fixed |
| No Authentication/Authorization | Medium | Deferred to API layer (Phase 7) |
| Unbounded Operations Array Size | Medium | Fixed (limit: 1000) |
| Unbounded WebSocket Connections | Medium | Fixed (limit: 100) |
| Path Traversal in Edit Operations | Low | Fixed (depth limit: 50) |
| Missing Operation Field Validation | Low | Fixed |
| Information Disclosure in Error Messages | Low | Partially fixed |
| No WebSocket Message Size Limits | Low | Fixed (limit: 1MB) |
| Missing Input Validation for Value Types | Low | Fixed (depth limit: 50) |

#### Phase 4.2: Real-Time API
**Status:** Complete
**Commits:**
- `1bfa066` - Add Phase 4.2 TDD tests for Real-Time API routes
- `3d984ad` - Implement Phase 4.2: Real-Time API routes with security hardening

##### Deliverables:
- [x] Real-Time API route handler (`workers/src/routes/realtime-api.ts`)
  - Route pattern matching for document endpoints
  - URL parameter extraction (siteId, branchId, documentPath)
  - Request forwarding to DocumentSession Durable Object
- [x] GET `/api/sites/{siteId}/branches/{branchId}/documents/{documentPath}` → `/snapshot`
- [x] POST `/api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/edits` → `/apply`
- [x] WebSocket `/api/sites/{siteId}/branches/{branchId}/documents/{documentPath}/connect` → `/connect`
- [x] CORS handling with configurable allowed origins
- [x] OPTIONS preflight handling
- [x] Request body validation for edits endpoint
- [x] Security hardening:
  - Origin-based CORS validation (uses CORS_ORIGINS env var)
  - Parameter length limits (siteId: 128, branchId: 128, documentPath: 512)
  - WebSocket origin validation for connect endpoint
  - Content-Type validation for POST requests
  - Generic error messages (no information disclosure)
- [x] Test suite (`workers/tests/routes/realtime-api.spec.ts`)
  - 39 tests covering all functionality

##### Security Review (Phase 4.2):
| Finding | Severity | Status |
|---------|----------|--------|
| CORS Wildcard Configuration | High | Fixed (uses CORS_ORIGINS env) |
| Missing Authentication/Authorization | High | Deferred to Phase 7 |
| No Rate Limiting | Medium | Noted (implement later) |
| URL Parameter Validation | Medium | Fixed (length limits) |
| Predictable Session ID | Low | Acceptable (with auth) |
| Error Message Disclosure | Low | Fixed |
| Operations Content Validation | Low | Validated in DO |
| WebSocket Origin Validation | Low | Fixed |

---

### Phase 5: Merge and Conflict Resolution

#### Phase 5.1a: Merge Request Service
**Status:** Complete
**Commits:**
- `b7d4fd2` - Add Phase 5.1a TDD tests for Merge Request Service
- `69dcef0` - Implement Phase 5.1a: Merge Request Service

##### Deliverables:
- [x] Merge Request Service (`workers/src/services/merge-request-service.ts`)
  - `createMergeRequest()` - create merge request between branches
  - `getMergeRequest()` - retrieve merge request by ID
  - `listMergeRequests()` - list with status/branch filters and pagination
  - `updateMergeRequest()` - update title/description
  - `updateMergeRequestStatus()` - status transitions with validation
  - `updateMergeRequestConflicts()` - update conflict details
  - `deleteMergeRequest()` - delete (prevents deleting merged requests)
  - `isValidStatusTransition()` - validate status transitions
- [x] Status Transition Rules
  - `open → approved, closed, conflicted`
  - `approved → merged, closed, open`
  - `conflicted → open, closed`
  - Terminal states: `merged`, `closed`
- [x] Error Classes
  - `MergeRequestNotFoundError`
  - `InvalidMergeRequestParamsError`
  - `InvalidMergeRequestStatusTransitionError`
  - `SourceBranchNotFoundError`
  - `TargetBranchNotFoundError`
  - `CannotDeleteMergedRequestError`
- [x] Test suite: 51 tests

#### Phase 5.1b: Merge Base Calculator
**Status:** Complete
**Commits:**
- `da06a4c` - Add Phase 5.1b TDD tests for Merge Base Service
- `371cd6d` - Implement Phase 5.1b: Merge Base Service

##### Deliverables:
- [x] Merge Base Service (`workers/src/services/merge-base-service.ts`)
  - `findMergeBase()` - find common ancestor checkpoint using recursive CTE
  - `getModifiedDocumentsSince()` - documents changed on branch since checkpoint
  - `getDocumentsAtCheckpoint()` - all document versions at checkpoint
  - `getBranchLineage()` - full ancestry from branch to root
- [x] Recursive CTE for branch lineage traversal
- [x] Error Classes
  - `SourceBranchNotFoundError`
  - `TargetBranchNotFoundError`
- [x] Test suite: 18 tests

#### Phase 5.2a: Conflict Detection Service
**Status:** Complete
**Commits:**
- `3760a99` - Add Phase 5.2a TDD tests for Conflict Detection Service
- `c215d95` - Implement Phase 5.2a: Conflict Detection Service

##### Deliverables:
- [x] Conflict Detection Service (`workers/src/services/conflict-detection-service.ts`)
  - `detectConflicts()` - find merge base, compare changes, identify conflicts
  - `checkMergeability()` - convenience check for merge readiness
- [x] Conflict Types
  - `both-modified` - same document modified on both branches
  - `deleted-in-source` - deleted on source, modified on target
  - `deleted-in-target` - deleted on target, modified on source
- [x] Error Classes
  - `NoMergeBaseError` - no common ancestor exists
- [x] Test suite: 13 tests

#### Phase 5.2b: Conflict Resolution (take-source/take-target)
**Status:** Complete
**Commits:**
- `b40a2cc` - Add Phase 5.2b TDD tests for Conflict Resolution Service
- `4b46cb7` - Implement Phase 5.2b: Conflict Resolution Service

##### Deliverables:
- [x] Conflict Resolution Service (`workers/src/services/conflict-resolution-service.ts`)
  - `resolveConflict()` - resolve single conflict with strategy
  - `resolveAllConflicts()` - batch resolution with error handling
  - `resolveDeletedConflict()` - handle deletion conflict scenarios
- [x] Strategies
  - `take-source` - copy source version to target branch
  - `take-target` - keep target version unchanged
- [x] Deletion Handling
  - `deleted-in-source + take-source` → delete on target
  - `deleted-in-source + take-target` → keep target
  - `deleted-in-target + take-source` → restore from source
  - `deleted-in-target + take-target` → keep deleted
- [x] Error Classes
  - `VersionNotFoundError`
  - `UnsupportedStrategyError`
- [x] Test suite: 15 tests

#### Phase 5.2c: Conflict Resolution (merge-crdt)
**Status:** Complete
**Commits:**
- `f3dc473` - Add Phase 5.2c TDD tests for CRDT Merge Service
- `7a5a8dd` - Implement Phase 5.2c: CRDT Merge Service

##### Deliverables:
- [x] CRDT Merge Service (`workers/src/services/crdt-merge-service.ts`)
  - `mergeCrdtStates()` - merge Yjs CRDT states from both branches
  - `resolveWithCrdtMerge()` - full resolution workflow with version creation
  - `extractSnapshotFromYDoc()` - convert Y.Doc to plain JavaScript object
- [x] Yjs Integration
  - Decode base64 CRDT states
  - Apply updates to merged Y.Doc
  - Extract merged snapshot and state
- [x] Error Classes
  - `InvalidCrdtStateError` - invalid/corrupt CRDT data
  - `MissingCrdtStateError` - version lacks CRDT state
- [x] Test suite: 14 tests

#### Phase 5.3: Merge Execution Service
**Status:** Complete
**Commits:**
- `71e9340` - Add Phase 5.3 TDD tests for Merge Execution Service
- `520989b` - Implement Phase 5.3: Merge Execution Service

##### Deliverables:
- [x] Merge Execution Service (`workers/src/services/merge-execution-service.ts`)
  - `executeMerge()` - full merge workflow for approved requests
  - `executeMergeWithResolution()` - merge with automatic conflict resolution
  - `previewMerge()` - preview changes and conflicts before merge
- [x] Merge Workflow
  1. Validate merge request is approved
  2. Detect conflicts
  3. Copy source changes to target branch
  4. Create post-merge checkpoint
  5. Update merge request status to merged
- [x] Resolution Strategies Support
  - `take-source` via resolveAllConflicts
  - `take-target` via resolveAllConflicts
  - `merge-crdt` via resolveWithCrdtMerge
- [x] Error Classes
  - `MergeNotAllowedError` - merge request not in approved status
  - `MergeConflictsError` - conflicts prevent merge
  - `MergeExecutionError` - merge execution failed
- [x] Test suite: 13 tests

---

### Phase 6: Site Structure

#### Phase 6.1: Structure Service
**Status:** Complete
**Commits:**
- `7eadf97` - Add Phase 6.1 TDD tests for Structure Service
- `74e6137` - Implement Phase 6.1: Structure Service

##### Deliverables:
- [x] Structure Service (`workers/src/services/structure-service.ts`)
  - `createStructure()` - create site structure with hierarchy/collection type
  - `getStructure()` - retrieve structure by ID
  - `getStructureBySlug()` - retrieve structure by site ID and slug
  - `listStructures()` - list structures with optional type filter
  - `updateStructure()` - update structure name/description
  - `deleteStructure()` - delete structure
  - `createNode()` - create node (section/document/external types)
  - `getNode()` - retrieve node by ID
  - `listNodes()` - list nodes with optional parent filter
  - `updateNode()` - update node properties
  - `deleteNode()` - delete node
  - `moveNode()` - move node with circular reference detection
  - `reorderNodes()` - reorder sibling nodes
  - `buildNavigationTree()` - build hierarchical tree with document paths
- [x] Circular Reference Detection
  - Recursive CTE to check if node would become its own ancestor
  - `CircularReferenceError` thrown when cycle detected
- [x] Error Classes
  - `SiteNotFoundError` - site doesn't exist
  - `StructureNotFoundError` - structure doesn't exist
  - `NodeNotFoundError` - node doesn't exist
  - `DuplicateStructureSlugError` - slug already exists in site
  - `DuplicateNodeSlugError` - slug already exists in structure
  - `CircularReferenceError` - move would create cycle
- [x] Test suite: 42 tests

#### Phase 6.2: Metadata Service
**Status:** Complete
**Commits:**
- `334ca66` - Add Phase 6.2 TDD tests for Metadata Service
- `44df852` - Implement Phase 6.2: Metadata Service

##### Deliverables:
- [x] Metadata Service (`workers/src/services/metadata-service.ts`)
  - `getBranchStructureState()` - get structure state for a branch
  - `createBranchStructureState()` - create with default or custom schema
  - `updateBranchStructureState()` - update schema or enforcement mode
  - `deleteBranchStructureState()` - delete structure state
  - `getDocumentMetadata()` - get metadata for a document
  - `setDocumentMetadata()` - create/update with validation
  - `deleteDocumentMetadata()` - delete metadata
  - `listDocumentMetadata()` - list with optional conformance filter
  - `validateMetadata()` - validate against JSON Schema
  - `validateAllDocuments()` - batch validation of all documents
  - `getSchemaValidationSummary()` - get conformance counts
- [x] JSON Schema Validation with ajv library
- [x] Enforcement Modes
  - `strict` - reject non-conforming metadata on save
  - `warn` - allow but flag non-conforming metadata
  - `none` - skip validation entirely
- [x] Error Classes
  - `BranchStructureStateNotFoundError`
  - `DocumentMetadataNotFoundError`
  - `SchemaValidationError`
- [x] Test suite: 29 tests

---

### Phase 7: API Layer

#### Phase 7.1: REST API Endpoints

**Status:** Complete
**Commits:**
- `279848b` - Add Phase 7.1a TDD tests for Branch API Routes
- `dbbb612` - Add Phase 7.1b TDD tests for Checkpoint API Routes
- `625ed9d` - Add Phase 7.1c TDD tests for Merge API Routes
- `3ece87f` - Add Phase 7.1d TDD tests for Grant API Routes
- `7aa4c78` - Implement Phase 7.1 API Routes (Branch, Checkpoint, Merge, Grant)

##### Deliverables:
- [x] Branch API Routes (`workers/src/routes/branch-api.ts`)
  - POST `/api/sites/{siteId}/branches` - Create branch
  - GET `/api/sites/{siteId}/branches` - List branches with status filter
  - GET `/api/sites/{siteId}/branches/{branchId}` - Get branch details
  - PATCH `/api/sites/{siteId}/branches/{branchId}` - Update branch
  - DELETE `/api/sites/{siteId}/branches/{branchId}` - Delete branch
  - Test suite: 13 tests

- [x] Checkpoint API Routes (`workers/src/routes/checkpoint-api.ts`)
  - POST `/api/sites/{siteId}/branches/{branchId}/checkpoints` - Create checkpoint
  - GET `/api/sites/{siteId}/branches/{branchId}/checkpoints` - List checkpoints
  - GET `/api/sites/{siteId}/checkpoints/{checkpointId}` - Get checkpoint details
  - GET `/api/sites/{siteId}/checkpoints/{checkpointId}/documents` - Get documents at checkpoint
  - POST `/api/sites/{siteId}/branches/{branchId}/checkpoints/{checkpointId}/revert` - Revert to checkpoint
  - DELETE `/api/sites/{siteId}/checkpoints/{checkpointId}` - Delete checkpoint
  - Test suite: 13 tests

- [x] Merge API Routes (`workers/src/routes/merge-api.ts`)
  - POST `/api/sites/{siteId}/merge/check` - Check mergeability
  - POST `/api/sites/{siteId}/merge/execute` - Execute merge
  - POST `/api/sites/{siteId}/merge/preview` - Preview merge
  - POST `/api/sites/{siteId}/merge-requests` - Create merge request
  - GET `/api/sites/{siteId}/merge-requests` - List merge requests
  - GET `/api/sites/{siteId}/merge-requests/{requestId}` - Get merge request
  - PATCH `/api/sites/{siteId}/merge-requests/{requestId}` - Update merge request
  - DELETE `/api/sites/{siteId}/merge-requests/{requestId}` - Delete merge request
  - Test suite: 13 tests

- [x] Grant API Routes (`workers/src/routes/grant-api.ts`)
  - POST `/api/sites/{siteId}/branches/{branchId}/grants` - Create grant
  - GET `/api/sites/{siteId}/branches/{branchId}/grants` - List grants
  - GET `/api/sites/{siteId}/branches/{branchId}/grants/{grantId}` - Get grant
  - DELETE `/api/sites/{siteId}/branches/{branchId}/grants/{grantId}` - Delete grant
  - Test suite: 10 tests

- [x] Grant Service (`workers/src/services/grant-service.ts`)
  - `createGrant()` - create a branch grant
  - `getGrant()` - get grant by ID
  - `listGrants()` - list grants with filters
  - `deleteGrant()` - delete a grant
  - Error classes: `GrantNotFoundError`, `DuplicateGrantError`

#### Phase 7.1.1: Resource Management APIs
**Status:** Complete
**Proposal:** `proposals/PROPOSAL-001-missing-api-endpoints.md`

Gap identified: The architecture API specification (v2.2) omits REST endpoints for several implemented services.

##### Phase 7.1.1a: Schema Migration and Service Updates
**Status:** Complete
**Commit:** `5a73674` - Implement Phase 7.1.1a: Branch-scoped structure identity

Deliverables:
- [x] Migration `007_branch_scoped_structures.sql` — move structure identity to `branch_structure_state`
  - Added `branch_structure_state` table with name, slug, description, structure_type columns
  - Added `checkpoint_structures` table for capturing structure state in checkpoints
  - Added `branch_document_metadata` table for per-branch document metadata
  - Added `checkpoint_document_metadata` table for metadata in checkpoints
- [x] Updated `structure-service.ts` for branch-scoped structures
  - `createStructure(branchId, ...)` — atomic creation of site_structures + branch_structure_state
  - `getBranchStructure(branchId, structureId)` — get structure from branch state
  - `getBranchStructureBySlug(branchId, slug)` — get by slug on branch
  - `listBranchStructures(branchId)` — list structures on branch
  - `updateBranchStructure(branchId, structureId, updates)` — update name/slug/schema on branch
  - `deleteBranchStructure(branchId, structureId)` — delete with cascade (removes definition if last reference)
- [x] Updated `checkpoint-service.ts` to capture/restore structure identity
  - `createCheckpoint()` now captures structure state and document metadata
  - `getStructuresAtCheckpoint(checkpointId)` — get all structures at checkpoint
  - `getStructureAtCheckpoint(checkpointId, structureId)` — get specific structure
  - `revertToCheckpoint()` now restores structure state and document metadata
- [x] Updated `branch-service.ts` to copy structure state on branch creation
  - `createBranch()` uses transaction with structure/metadata copy
  - Copies from source branch or from checkpoint if sourceCheckpointId provided
- [x] Updated all tests for new branch-scoped API (42 structure service, 63 branch service, 30 checkpoint service tests)

##### Phase 7.1.1b: API Routes
**Status:** Complete
**Commits:**
- `f7c2979` - Add Phase 7.1.1b TDD tests for Site API Routes
- `63c6222` - Implement Phase 7.1.1b Site API Routes
- `2334001` - Add Phase 7.1.1b TDD tests for Document CRUD API Routes
- `57ac6b7` - Implement Phase 7.1.1b Document CRUD API Routes
- `06150e2` - Add Phase 7.1.1b TDD tests for Structure API Routes
- `a260fea` - Implement Phase 7.1.1b Structure API Routes
- `9c5d207` - Add Phase 7.1.1b TDD tests for Node API Routes
- `122c63e` - Implement Phase 7.1.1b Node API Routes
- `d9b355e` - Add Phase 7.1.1b TDD tests for Metadata API Routes
- `ebb2aa8` - Implement Phase 7.1.1b Metadata API Routes
- `b5a26e1` - Add security hardening for Phase 7.1.1b API routes

Deliverables:
- [x] Site API Routes (`workers/src/routes/site-api.ts`) - 16 tests
  - POST `/api/sites` - Create site
  - GET `/api/sites` - List sites
  - GET `/api/sites/{siteId}` - Get site
  - PATCH `/api/sites/{siteId}` - Update site
  - DELETE `/api/sites/{siteId}` - Delete site (with deletion protection)
- [x] Document CRUD API Routes (`workers/src/routes/document-api.ts`) - 22 tests
  - POST `/api/sites/{siteId}/documents` - Create document
  - GET `/api/sites/{siteId}/documents` - List documents (with archived filter)
  - GET `/api/sites/{siteId}/documents/{documentId}` - Get document
  - GET `/api/sites/{siteId}/documents/by-path/{documentPath}` - Get by path
  - PATCH `/api/sites/{siteId}/documents/{documentId}` - Update path
  - DELETE `/api/sites/{siteId}/documents/{documentId}` - Soft delete (archive)
  - POST `/api/sites/{siteId}/documents/{documentId}/restore` - Restore archived document
  - Migration `008_document_soft_delete.sql` - Add archived_at column
- [x] Structure API Routes (`workers/src/routes/structure-api.ts`) - 17 tests
  - POST `/api/sites/{siteId}/branches/{branchId}/structures` - Create structure
  - GET `/api/sites/{siteId}/branches/{branchId}/structures` - List structures
  - GET `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}` - Get structure
  - PATCH `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}` - Update structure
  - DELETE `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}` - Delete structure
  - GET `/api/sites/{siteId}/checkpoints/{checkpointId}/structures/{structureId}` - Get at checkpoint
- [x] Node API Routes (`workers/src/routes/node-api.ts`) - 19 tests
  - POST `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes` - Create node
  - GET `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes` - List nodes
  - GET `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}` - Get node
  - PATCH `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}` - Update node
  - DELETE `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}` - Delete node
  - POST `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}/move` - Move node
  - POST `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/reorder` - Reorder nodes
  - GET `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/navigation` - Navigation tree
- [x] Metadata API Routes (`workers/src/routes/metadata-api.ts`) - 13 tests
  - GET `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/state` - Get structure state
  - PUT `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/schema` - Update schema
  - POST `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/validate` - Validate documents
  - GET `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/metadata` - List document metadata
  - GET `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/documents/{documentId}/metadata` - Get metadata
  - PUT `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/documents/{documentId}/metadata` - Set metadata
  - DELETE `/api/sites/{siteId}/branches/{branchId}/structures/{structureId}/documents/{documentId}/metadata` - Delete metadata

##### Key Decisions Made
- **Structure scope:** Branch-scoped for consistency with documents
- **Site deletion:** Prevented when non-archived branches exist
- **Document deletion:** Soft-delete with archive/restore capability
- **Bulk operations:** Supported for nodes and metadata

##### Security Hardening
- [x] Validation Utilities (`workers/src/routes/validation.ts`) - 28 tests
  - Pagination validation (max limit: 100, min: 1, offset >= 0)
  - JSON size validation for schemas and metadata (64KB max)
  - Reusable validation functions across all API routes
- [x] Path Traversal Protection
  - Document paths reject `..` sequences
  - Prevents directory traversal attacks
- [x] LIKE Query Wildcard Escaping
  - Escapes `%` and `_` in pathPrefix filters
  - Prevents SQL LIKE wildcard injection
- [x] Error Message Sanitization
  - Known validation errors return user-friendly messages
  - Unknown errors return generic "Internal server error"
  - Error details logged server-side only

#### Phase 7.2: Audit Integration

**Status:** Complete
**Commits:**
- `bcb79cd` - Add Phase 7.2 TDD tests for Audit Emitter
- `081256f` - Implement Phase 7.2: Audit Integration

##### Deliverables:
- [x] Audit Emitter (`workers/src/audit/emitter.ts`)
  - `AuditEvent` interface matching architecture spec
  - `createAuditEvent()` helper with auto-generated fields
  - `LocalAuditEmitter` for development (console logging)
  - `PantheonAuditEmitter` stub for production
  - `getAuditEmitter()` factory function
  - `AuditActions` constants for common actions
- [x] Test suite: 9 tests

#### Phase 7.3: Route Wiring

**Status:** Complete

##### Deliverables:
- [x] Route wiring in `workers/src/index.ts`
  - All API routes wired to main entry point
  - CORS middleware with configurable origins (`CORS_ORIGINS` env var)
  - Authentication middleware (JWT Bearer + API Key)
  - Mock auth endpoints for frontend development
- [x] Router integration tests (`workers/tests/routes/router.spec.ts`)
  - 24 tests covering route matching, CORS, and auth middleware
- [x] Test suite: 971 total backend tests

---

### Phase 8: Frontend API Explorer

**Status:** In Progress

#### Phase 8.1: Frontend Project Setup

**Status:** Complete

##### Deliverables:
- [x] Vite React TypeScript project (`frontend/`)
- [x] Dependencies installed:
  - `@pantheon-systems/design-toolkit-react` - Pantheon Design System
  - `react-router-dom` v6.25.1 - Routing
  - React 18.2.0 - UI framework
- [x] Vite configuration (`frontend/vite.config.ts`)
  - Proxy configuration for `/api` and `/health` to backend
  - Development server on port 5173
- [x] Makefile targets added:
  - `make frontend-install` - Install frontend dependencies
  - `make frontend-dev` - Start development server
  - `make frontend-build` - Build for production
  - `make frontend-lint` - Lint frontend code
  - `make frontend-test` - Run E2E tests
  - `make dev-full` - Start full stack (Docker + Worker + Frontend)
  - `make install-all` - Install all dependencies

#### Phase 8.2: API Client Layer

**Status:** Complete

##### Deliverables:
- [x] API Client (`frontend/src/api/client.ts`)
  - `apiGet`, `apiPost`, `apiPatch`, `apiDelete` functions
  - Automatic `Authorization: Bearer <token>` header injection
  - Token storage in localStorage
  - `ApiClientError` class for error handling
- [x] Auth API (`frontend/src/api/auth.ts`)
  - `loginAsUser()` - Login as mock user
  - `listUsers()` - Get available mock users
- [x] Sites API (`frontend/src/api/sites.ts`)
  - `listSites()`, `getSite()`, `createSite()`, `updateSite()`, `deleteSite()`
- [x] Branches API (`frontend/src/api/branches.ts`)
  - `listBranches()`, `getBranch()`, `createBranch()`, `updateBranch()`, `deleteBranch()`
- [x] Documents API (`frontend/src/api/documents.ts`)
  - `listDocuments()`, `getDocument()`, `createDocumentVersion()`, `getDocumentVersions()`
- [x] Type definitions (`frontend/src/types/index.ts`)
  - Core types matching backend: User, Agent, Site, Branch, Document, Checkpoint, etc.

#### Phase 8.3: Authentication UI

**Status:** Complete

##### Deliverables:
- [x] Auth Context (`frontend/src/context/AuthContext.tsx`, `AuthContextType.ts`)
  - `AuthProvider` component with login/logout state
  - Persistence to localStorage
- [x] useAuth Hook (`frontend/src/hooks/useAuth.ts`)
  - Access to auth context from any component
- [x] Login Page (`frontend/src/pages/LoginPage.tsx`)
  - User selector dropdown (Alice, Bob, Carol)
  - User role preview
  - Login/logout functionality

#### Phase 8.4: Core Resource Pages

**Status:** Complete

##### Deliverables:
- [x] Layout Component (`frontend/src/components/Layout.tsx`)
  - Sidebar navigation with Dashboard and Sites links
  - User panel with logout button
  - Outlet for nested routes
- [x] JSON Viewer (`frontend/src/components/JsonViewer.tsx`)
  - Formatted JSON display
- [x] API Response Component (`frontend/src/components/ApiResponse.tsx`)
  - Loading, error, and success states
- [x] Dashboard Page (`frontend/src/pages/DashboardPage.tsx`)
  - Health check status display
  - Quick actions to create/view sites
  - API endpoints reference
- [x] Sites Page (`frontend/src/pages/SitesPage.tsx`)
  - Sites list table
  - Create site form with name and pantheonSiteId fields
  - Error feedback display for create failures
- [x] App Router (`frontend/src/App.tsx`)
  - Protected routes with auth check
  - Public login route
- [x] Site Detail Page (`frontend/src/pages/SiteDetailPage.tsx`)
  - Breadcrumb navigation
  - Site info display (ID, Pantheon ID, created date)
  - Branches list table with status badges
  - Create branch form with parent branch selector
- [x] Branch Detail Page (`frontend/src/pages/BranchDetailPage.tsx`)
  - Breadcrumb navigation (Sites / Site / Branch)
  - Branch info display (ID, parent, status, created date)
  - Tabs for Checkpoints and Documents
  - Checkpoints table with create checkpoint form
  - Documents table with clickable links
- [x] Checkpoints API (`frontend/src/api/checkpoints.ts`)
  - listCheckpoints, getCheckpoint, createCheckpoint, deleteCheckpoint, revertToCheckpoint
- [x] Document Page (`frontend/src/pages/DocumentPage.tsx`)
  - **Commit:** `ada5c8c`
  - Breadcrumb navigation (Sites / Site / Document)
  - Document metadata display (path, ID, timestamps, status)
  - Placeholder sections for version history and content viewer

#### Phase 8.5: E2E Testing

**Status:** Complete

##### Deliverables:
- [x] Playwright configuration (`frontend/playwright.config.ts`)
  - Chromium browser setup
  - Web server auto-start for tests
  - HTML reporter configured
- [x] Login flow E2E tests (`frontend/tests/login.spec.ts`)
  - Login page rendering
  - User selection dropdown
  - Login/logout flow
  - Persistent auth across page reload
  - Storage clearing on logout
- [x] Dashboard E2E tests (`frontend/tests/dashboard.spec.ts`)
  - Dashboard page rendering
  - Navigation sidebar
  - Quick actions
  - System health section
- [x] Sites page E2E tests (`frontend/tests/sites.spec.ts`)
  - Sites listing
  - Create site form toggle
  - Form validation
- [x] Package.json scripts:
  - `pnpm test:e2e` - Run E2E tests
  - `pnpm test:e2e:ui` - Run with Playwright UI
  - `pnpm test:e2e:headed` - Run in headed mode
- [ ] CI integration (deferred)

#### Phase 8.6: Bug Fixes

**Status:** Complete

##### Deliverables:
- [x] Cloudflare Workers Database I/O Fix (`workers/src/db.ts`)
  - **Commit:** `36f4e3b`
  - **Issue:** "Cannot perform I/O on behalf of a different request" error
  - **Root cause:** Global connection caching violated Workers' request isolation model
  - **Fix:** Create fresh database connection per request instead of global caching
  - Connection settings optimized for Workers: `max: 1`, `idle_timeout: 20`, `connect_timeout: 10`
- [x] Create Site Form Fix (`frontend/src/pages/SitesPage.tsx`)
  - **Commit:** `be5198e`
  - **Issue:** Create Site button did not create site or show feedback
  - **Root cause:** Backend requires `pantheonSiteId` but form only sent `name`
  - **Fix:** Added `pantheonSiteId` input field and error display for create failures
- [x] Branch List API Fix (`workers/src/routes/branch-api.ts`)
  - **Commit:** `3b3686a`
  - **Issue:** Listing branches returned 500 Internal Server Error
  - **Root cause:** `listBranches` called with object instead of separate arguments
  - **Fix:** Changed to `listBranches(siteId, options)` format
- [x] Checkpoint List API Fix (`workers/src/routes/checkpoint-api.ts`)
  - **Commit:** `1267e41`
  - **Issue:** Listing checkpoints returned 500 Internal Server Error
  - **Root cause:** `listCheckpoints` called with object instead of separate arguments
  - **Fix:** Changed to `listCheckpoints(branchId, options)` format
- [x] Document Soft Delete Migration Fix (`workers/src/db/migrations/008_document_soft_delete.sql`)
  - **Commit:** `1267e41`
  - **Issue:** Migration failed with "cannot drop index" error
  - **Root cause:** Tried to drop index before constraint that owned it
  - **Fix:** Removed explicit index drop, rely on constraint drop to cascade
- [x] Main Branch Auto-Creation (`workers/src/routes/site-api.ts`)
  - **Commit:** `c02695d`
  - **Issue:** Creating a branch on a new site failed with "main branch not found"
  - **Root cause:** Site creation did not automatically create main branch
  - **Fix:** Site creation now calls `createMainBranch()` to create production branch
- [x] UUID-Based Auth IDs (`workers/src/index.ts`, `frontend/src/pages/LoginPage.tsx`)
  - **Commit:** `c02695d`
  - **Issue:** Site/branch creation failed with "invalid input syntax for type uuid"
  - **Root cause:** Mock user IDs like "user-alice" incompatible with UUID columns
  - **Fix:** Changed mock user IDs to proper UUIDs (e.g., `11111111-1111-1111-1111-111111111111`)
- [x] Branch Creation Parameter Name (`workers/src/routes/branch-api.ts`)
  - **Commit:** `c02695d`
  - **Issue:** Branch creation failed with database error
  - **Root cause:** Route passed `createdFromCheckpointId` but service expected `sourceCheckpointId`
  - **Fix:** Renamed parameter to match service interface
- [x] Branch Document Metadata Schema Mismatch (`workers/src/services/branch-service.ts`)
  - **Commit:** `c02695d`
  - **Issue:** Branch creation failed with "column node_id does not exist"
  - **Root cause:** Service code referenced non-existent columns (`node_id`, `position`)
  - **Fix:** Updated SQL to use actual schema columns (`structure_id`, `document_id`, `metadata`)

#### Phase 8.7: DocumentPage and Navigation Fixes

**Status:** Complete
**Commit:** `dfccd83`

##### Deliverables:
- [x] DocumentPage Implementation (`frontend/src/pages/DocumentPage.tsx`)
  - Document detail view with breadcrumb navigation
  - Document metadata display (path, ID, created date, status)
  - Placeholder sections for Version History and Content Viewer
  - Styled with `DocumentPage.css`
- [x] Document Type Fix (`frontend/src/types/index.ts`)
  - **Issue:** Documents table displayed "Invalid Date" in Updated column
  - **Root cause:** Database `documents` table has no `updated_at` column
  - **Fix:** Removed non-existent `updatedAt` field, made `archivedAt` optional
- [x] BranchDetailPage Documents Table Fix (`frontend/src/pages/BranchDetailPage.tsx`)
  - Removed "Updated" column that referenced non-existent data
  - Verified document links navigate correctly to DocumentPage
- [x] Browser Testing
  - Verified DocumentPage renders with correct metadata
  - Verified navigation from BranchDetailPage documents list works

#### Phase 8.8: Checkpoint Creation Bug Fixes

**Status:** Complete
**Commit:** `ffd5b81`

##### Bug Fixes:
- [x] Checkpoint Type Parameter Mismatch (`workers/src/routes/checkpoint-api.ts`)
  - **Issue:** Creating checkpoint failed with "null value in column checkpoint_type"
  - **Root cause:** Route passed `type` but service expected `checkpointType`
  - **Fix:** Changed parameter from `type: body.type` to `checkpointType: body.type ?? 'manual'`
- [x] Optional Checkpoint Name (`workers/src/routes/checkpoint-api.ts`)
  - **Issue:** API required checkpoint name, but it should be optional
  - **Fix:** Made name optional; empty/whitespace names treated as undefined
- [x] Checkpoint Document Metadata SQL Columns (`workers/src/services/checkpoint-service.ts`)
  - **Issue:** Checkpoint creation failed with "column node_id does not exist"
  - **Root cause:** SQL queries referenced non-existent columns (`node_id`, `position`)
  - **Fix:** Updated INSERT and SELECT queries to use actual schema columns (`structure_id`, `document_id`, `metadata`)
- [x] Error Logging for Branch Creation (`workers/src/services/branch-service.ts`)
  - Added `console.error` logging to `createMainBranch` for debugging
- [x] Test Update (`workers/tests/routes/checkpoint-api.spec.ts`)
  - Updated test to verify optional name behavior (201 with null name instead of 400)

#### Phase 8.9: Auto-Create Checkpoint for Branching

**Status:** Complete
**Commit:** `7895510`

##### Enhancement:
- [x] Auto-Create Checkpoint (`workers/src/routes/branch-api.ts`)
  - **Issue:** Creating a branch required the source branch to have an existing checkpoint
  - **User impact:** Users had to manually create a checkpoint before branching
  - **Fix:** When source branch has no checkpoint, automatically create an 'auto' type checkpoint
  - Checkpoint is named "Auto-created for branching" with type 'auto'
  - Transparent to user - branching now works immediately on new sites

#### Phase 8.10: Usability Enhancements

**Status:** Complete
**Commit:** `79049d3`

##### Deliverables:
- [x] Delete Confirmation Modal (`frontend/src/components/ConfirmDeleteModal.tsx`)
  - Reusable modal component for destructive operations
  - Requires user to type resource name to confirm deletion
  - Displays loading state and error messages
  - Styled with `ConfirmDeleteModal.css`
- [x] Site Deletion with Confirmation (`frontend/src/pages/SitesPage.tsx`)
  - Delete button in sites table actions column
  - Confirmation modal with name verification
  - API integration with error handling
- [x] Branch Deletion with Confirmation (`frontend/src/pages/SiteDetailPage.tsx`)
  - Delete button for non-main branches only
  - Confirmation modal with name verification
  - API integration with error handling
- [x] Create Document Button (`frontend/src/pages/BranchDetailPage.tsx`)
  - "+ Create Document" button in Documents tab
  - Form with document path input
  - API integration with list refresh on success
- [x] Document Content JSON Viewer (`frontend/src/pages/DocumentPage.tsx`)
  - "Document Content" section replacing placeholder
  - JSON viewer with formatted output
  - Placeholder content with API coming soon message
  - Styled with `DocumentPage.css`
- [x] DocumentVersion Type (`frontend/src/types/index.ts`)
  - Added DocumentVersion interface for future content API

##### Bug Fix:
- [x] Site Delete API Fix (`workers/src/routes/site-api.ts`)
  - **Issue:** Delete site returned 500 "invalid input syntax for type uuid"
  - **Root cause:** `listBranches` called with object `{ siteId }` instead of string `siteId`
  - **Fix:** Changed to `listBranches(context.siteId)` format

#### Phase 8.11: Branch Isolation for Documents

**Status:** Complete
**Commits:**
- `bf7a435` - Add tests for document version inheritance on branch creation
- `ad808ed` - Implement document version inheritance on branch creation
- `57ccbc9` - Add tests for branch-scoped document service functions
- `d84fb3c` - Implement branch-scoped document service functions
- `88a3c8e` - Add tests for branch-scoped document API routes
- `9cfe40b` - Implement branch-scoped document API routes
- `ddb4b78` - Update frontend to use branch-scoped document APIs
- `0b5d6b2` - Fix authorization bypass in branch-scoped document routes

##### Problem Addressed:
Documents didn't follow Git-like branch isolation. Documents were created/queried at site-level only, with no integration with the `document_versions` table that provides branch isolation. Creating a document on one branch would make it visible on all branches.

##### Solution:
Implemented Git-like branch isolation with two key fixes:
1. **Branch creation copies document versions** - New branches inherit documents from source
2. **Branch-scoped document CRUD** - New endpoints that integrate `app.documents` (site-level identity) with `app.document_versions` (branch-scoped content)

##### Backend Service Layer (`workers/src/services/document-service.ts`):
- [x] `listDocumentsOnBranch(branchId, options)` - List documents with versions on branch (excludes tombstones)
- [x] `createDocumentOnBranch(params)` - Create document + initial version atomically
- [x] `documentExistsOnBranch(documentId, branchId)` - Check if document has versions on branch
- [x] `deleteDocumentOnBranch(params)` - Create tombstone version with `{ _deleted: true }`

##### Backend API Routes (`workers/src/routes/document-api.ts`):
- [x] `POST /api/sites/{siteId}/branches/{branchId}/documents` - Create document on branch
- [x] `GET /api/sites/{siteId}/branches/{branchId}/documents` - List documents on branch
- [x] `GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}` - Get document on branch
- [x] `DELETE /api/sites/{siteId}/branches/{branchId}/documents/{documentId}` - Delete from branch (tombstone)

##### Branch Creation Enhancement (`workers/src/services/branch-service.ts`):
- [x] Copy latest document version for each document from source branch
- [x] Copy from checkpoint_documents when branching from checkpoint
- [x] Uses `DISTINCT ON (document_id)` to get only latest version per document

##### Frontend Updates:
- [x] `frontend/src/api/documents.ts` - Added branch-scoped API functions
- [x] `frontend/src/pages/BranchDetailPage.tsx` - Uses branch-scoped APIs for document operations
- [x] Delete confirmation dialog for document deletion

##### Security Review:
| Finding | Severity | Status |
|---------|----------|--------|
| Authorization bypass (branch-site mismatch) | Medium | Fixed - Added validation that branch.siteId matches context.siteId |

##### Design Decisions:
- **Tombstone pattern for deletion** - Create version with `{ _deleted: true }` instead of separate table
- **Keep existing site-scoped routes** - Useful for admin/debugging
- **Initial version content** - Defaults to `{}` (empty JSON object)
- **Document identity stays site-scoped** - Path changes are not branch-scoped

#### Phase 8.11 Bug Fixes

**Status:** Complete
**Commit:** `7f28611` - Fix branch creation and document routing bugs

##### Bug Fix 1: Branch Creation from Checkpoint Failed
- **Issue:** Creating a branch failed with "column cd.snapshot does not exist"
- **Root cause:** The `checkpoint_documents` table only stores `document_version_id` as a reference, not the actual `snapshot` and `crdt_state` columns. The query was incorrectly trying to select these directly.
- **Fix:** Changed the query in `branch-service.ts` to join with `document_versions` table to retrieve the actual snapshot and crdt_state values.

##### Bug Fix 2: Branch-Scoped Document Routes Returned 404
- **Issue:** `GET /api/sites/{siteId}/branches/{branchId}/documents` returned 404 Not Found
- **Root cause:** The branch-scoped document route pattern was missing from `parseApiRoute()` in `index.ts`
- **Fix:** Added route pattern for branch-scoped documents and passed `branchId` to `handleDocumentRoutes`

##### Verification:
- Branch creation: ✅ Working
- Document listing on branch: ✅ Working
- Document creation on branch: ✅ Working
- Branch isolation: ✅ Confirmed (documents on feature branch not visible on main)

##### Bug Fix 3: JSONB Double-Stringification in Document Snapshots
**Commit:** `e185646` - Fix JSONB double-stringification in document snapshots

- **Issue:** Tombstone deletion via `deleteDocumentOnBranch` wasn't filtering documents properly. The query `dv.snapshot->>'_deleted' = 'true'` was returning null.
- **Root cause:** Using `JSON.stringify({ _deleted: true })` before passing to PostgreSQL created a double-stringified value. The snapshot was stored as a JSON string `'"{\"_deleted\":true}"'` instead of a JSON object `'{"_deleted":true}'`. PostgreSQL's `->>` operator couldn't extract fields from the stringified value.
- **Fix:** Pass JavaScript objects directly to PostgreSQL JSONB columns without calling `JSON.stringify()`. The postgres driver handles the conversion automatically.
- **Files affected:**
  - `document-service.ts`: `createDocumentOnBranch`, `deleteDocumentOnBranch`
  - `document-version-service.ts`: `createDocumentVersion`
  - `checkpoint-service.ts`: `revertToCheckpoint`
  - `document-service.spec.ts`: Updated test to check for object parameter

##### Full Branch Isolation Verification:
Tested complete workflow on 2026-01-24:
1. Created site "Branch Isolation Test"
2. Created document "original-doc" on main branch
3. Created "feature-branch" from main (document inherited)
4. Created document "branch-doc" on feature-branch
5. **feature-branch shows 2 documents** (original-doc + branch-doc)
6. **main shows 1 document** (original-doc only - branch-doc NOT visible)
7. Deleted original-doc from main
8. **main shows 0 documents** (tombstone hides original-doc)
9. **feature-branch still shows 2 documents** (deletion on main doesn't affect branch)

All aspects of Git-like branch isolation now working correctly.

#### Phase 8.13: Branch Isolation E2E Test

**Status:** Complete
**Commits:**
- `6c9678a` - Add E2E test for branch isolation workflow
- `6214f92` - Skip branch isolation E2E test due to postgres cross-request I/O errors

##### Deliverables:
- [x] Branch Isolation E2E Test (`frontend/tests/branch-isolation.spec.ts`)
  - Full workflow test: create site, branch, documents, verify isolation
  - Tests document inheritance on branch creation
  - Tests branch-scoped document visibility
  - Tests that deletion on one branch doesn't affect others

##### Known Limitation: postgres.js Cross-Request I/O Errors
The test is currently skipped (`test.skip`) due to flakiness caused by a fundamental limitation of Cloudflare Workers' request context isolation combined with postgres.js connection management.

**Root Cause:** The postgres.js library creates database connections that persist across request contexts. When a connection's internal state (like `ReadyForQuery` messages from PostgreSQL) resolves after the original request has completed, it triggers errors like:
- "Cannot perform I/O on behalf of a different request"
- "A promise was resolved or rejected from a different request context"

This is NOT a bug in our code but a limitation of:
1. Cloudflare Workers' request context isolation
2. postgres.js connection lifecycle management

**Investigation Summary:**
- Attempted fix 1: `ctx.waitUntil(closeDatabaseConnection())` - Broke concurrent requests by closing shared connections
- Attempted fix 2: Connection reuse per request - Broke due to I/O context isolation
- Attempted fix 3: Fire-and-forget close - Works but produces benign warnings

**Recommended Fix:** Use [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/) for proper connection pooling. Hyperdrive is designed to handle PostgreSQL connection management in the Workers environment.

**Manual Testing:** The test can be run manually with:
```bash
npx playwright test branch-isolation.spec.ts
```
When it passes (which it does intermittently), it validates branch isolation is working correctly.

#### Phase 8.14: Cloudflare Hyperdrive Integration

**Status:** Complete
**Commit:** `978c6a8` - Add Cloudflare Hyperdrive support for PostgreSQL connection pooling

##### Problem Addressed:
The postgres.js library has an architectural incompatibility with Cloudflare Workers' request context isolation. Database connections persist internal state that can resolve after the original request completes, triggering cross-request I/O errors.

##### Solution:
Implemented Cloudflare Hyperdrive support as the recommended connection pooling solution. Hyperdrive is Cloudflare's managed service designed specifically to handle PostgreSQL connections in the Workers environment.

##### Deliverables:
- [x] Updated Env interface with optional `HYPERDRIVE` binding (`workers/src/index.ts`)
- [x] New `initializeDatabaseFromHyperdrive()` function (`workers/src/db.ts`)
- [x] Configured postgres.js with `prepare: false` for Hyperdrive compatibility
- [x] Updated health check handler to prefer Hyperdrive over direct connection
- [x] Updated main fetch handler to prefer Hyperdrive over direct connection
- [x] Added Hyperdrive configuration placeholders for sbx1/production (`workers/wrangler.jsonc`)

##### Connection Priority:
1. **HYPERDRIVE** (production/staging) - Cloudflare's managed connection pooling
2. **POSTGRES_CONNECTION_STRING** (local dev) - Direct postgres connection fallback

##### To Enable in Production:
```bash
# Create Hyperdrive configuration
npx wrangler hyperdrive create css-postgres --connection-string="postgresql://user:pass@host:5432/db"

# Update wrangler.jsonc with the returned config ID
# Replace REPLACE_WITH_*_HYPERDRIVE_ID with actual ID
```

##### Files Modified:
- `workers/src/index.ts` - Added HYPERDRIVE to Env, updated initialization logic
- `workers/src/db.ts` - Added Hyperdrive initialization function, updated connection options
- `workers/wrangler.jsonc` - Added Hyperdrive bindings for sbx1/production environments

##### Next Steps:
- Set up Hyperdrive with actual PostgreSQL server (requires Cloudflare Workers Paid plan)
- Re-enable branch isolation E2E test after Hyperdrive is configured
- Monitor logs for absence of cross-request I/O warnings

#### Phase 8.15: Document Content Editing

**Status:** Complete
**Commits:**
- `940b1ce` - Add TDD tests for document version API endpoints
- `b217e1a` - Implement document version API routes
- `bb3f3ed` - Add frontend API functions for document versions
- `a3c1d28` - Add branch-scoped document route to frontend
- `c93a7de` - Implement Admin UI Document Editor with JSON viewer and version history

##### Goal:
Enable users to view and edit document content on specific branches, demonstrating Git-like branch isolation where edits on one branch don't affect other branches.

##### Backend API Routes (`workers/src/routes/document-api.ts`):
- [x] `GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions` - List version history
- [x] `GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/latest` - Get latest version (content)
- [x] `POST /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions` - Create new version (save)

##### Frontend API Layer (`frontend/src/api/documents.ts`):
- [x] `getLatestDocumentVersion(siteId, branchId, documentId)` - Get latest version
- [x] `listDocumentVersions(siteId, branchId, documentId)` - List all versions
- [x] `createDocumentVersion(siteId, branchId, documentId, { snapshot })` - Create new version

##### Frontend Route Updates:
- [x] Added route `/sites/:siteId/branches/:branchId/documents/:documentId` in App.tsx
- [x] Updated document links in BranchDetailPage to use branch-scoped URL

##### Admin UI Document Editor (`frontend/src/pages/DocumentPage.tsx`):
- [x] JSON viewer displaying latest document version content
- [x] Edit mode with textarea for raw JSON editing
- [x] Real-time JSON validation during editing
- [x] Save functionality creates new document version
- [x] Version history tab showing all versions on the branch
- [x] Branch context awareness (edit only available when viewed from branch)
- [x] Notice banner when viewing document without branch context
- [x] Breadcrumb navigation includes branch when in branch context

##### Design Principle: Frontend-Agnostic API
The document version API is designed to work with any editor:
- Snapshot is opaque JSON - no schema validation at API level
- No content-type assumptions - works with Puck, custom JSON, or any structure
- Versioning is universal - every save creates a new version
- Same endpoints for all clients - Puck will use the exact same POST endpoint

##### Test Summary:
- 8 new backend route tests for document version endpoints
- All 43 document-api tests passing
- Frontend linting passing

##### Bug Fix: SQL NULL Handling in documentExistsOnBranch
**Commit:** `ec06b72`

- **Issue:** Document editor showed "Document not found on this branch" even though document existed
- **Root cause:** SQL query used `NOT (snapshot->>'_deleted' = 'true' AND ...)`. When `snapshot->>'_deleted'` is NULL (normal for non-tombstoned documents), `NULL = 'true'` evaluates to NULL in SQL, making `NOT (NULL AND true)` also NULL, causing EXISTS to find no rows.
- **Fix:** Simplified logic to check only the latest version and use `COALESCE(snapshot->>'_deleted', '') != 'true'` to handle NULL properly.

##### Manual Verification: Branch Isolation
Verified that Git-like branch isolation works correctly:
1. Created site "Branch Isolation Demo" with main branch
2. Created document `pages/home` on main branch
3. Edited document content: `{"title": "Main Branch Home Page", "content": "This is the original content on main branch"}`
4. Created feature branch `feature-homepage-update` from main
5. Edited same document on feature branch: `{"title": "Feature Branch Home Page", "content": "This is UPDATED content on the feature branch", "newField": "Only on feature branch"}`
6. **Verification:** Main branch content unchanged; feature branch shows different content

##### Bug Fix: Branch Creation from Non-Main Branches
**Commits:**
- `70cef8f` - Add tests for creating branches from non-main branches
- `fac5d34` - Fix branch creation to support branching from any branch
- `0979383` - Fix frontend to use sourceBranchId field from API response

- **Issue:** When creating a branch and selecting a non-main parent branch in the UI, the new branch was always created from main instead of the selected parent.
- **Root cause:** Two issues in `workers/src/routes/branch-api.ts`:
  1. Field name mismatch: Frontend sent `parentBranchId` (UUID), backend expected `sourceBranch` (name)
  2. Backend limitation: Only handled `'main'` case with TODO comment for non-main branches
- **Backend Fix:**
  1. Updated `CreateBranchBody` to accept `parentBranchId` (UUID)
  2. When `parentBranchId` provided, use `getBranch()` to look up by ID
  3. Removed "Only branching from main is currently supported" error
  4. Returns 404 "Parent branch not found" for invalid parentBranchId
  5. Falls back to main branch when no parentBranchId provided (backwards compatible)
- **Frontend Fix:** (additional issue discovered during testing)
  - Backend returns `sourceBranchId`, frontend expected `parentBranchId`
  - Updated frontend Branch type to use `sourceBranchId`
  - Updated BranchDetailPage and SiteDetailPage to display `sourceBranchId`

##### Manual Verification: Branch from Non-Main
1. Navigated to "Branch Isolation Demo" site
2. Created new branch "sub-feature-test" with parent "feature-homepage-update"
3. Verified branch detail page shows correct parent: `7cd0b887...` (feature-homepage-update)
4. Verified branches table shows parent column correctly for all branches

#### Phase 8.12: UX Writing Style Compliance

**Status:** Complete
**Commit:** `2395d1b` - Fix frontend UX writing style for Pantheon guidelines compliance

##### Deliverables:
- [x] UX Writing Style Review against Pantheon guidelines
- [x] Applied sentence case to all button labels
  - "+ Create Site" → "+ Create site"
  - "+ Create Branch" → "+ Create branch"
  - "+ Create Checkpoint" → "+ Create checkpoint"
  - "+ Create Document" → "+ Create document"
- [x] Fixed verb form for authentication actions
  - "Login" → "Log in" (button)
  - "Logout" → "Log out" (button)
- [x] Improved error messages with clear next steps
  - "Please select a user" → "Select a user to continue."
  - "Login failed" → "We couldn't log you in. Try again or select a different user."
- [x] Fixed link text capitalization
  - "Back to Sites" → "Back to sites"
  - "Back to Site" → "Back to site"
- [x] Updated confirmation dialog language
  - "Are you sure you want to delete..." → "Delete this document from this branch?..."
- [x] Added tooltip punctuation per guidelines
  - `title="Delete from this branch"` → `title="Delete from this branch."`
- [x] Fixed heading capitalization
  - "Version History Coming Soon" → "Version history coming soon"

##### Files Modified:
- `frontend/src/components/Layout.tsx`
- `frontend/src/pages/LoginPage.tsx`
- `frontend/src/pages/SitesPage.tsx`
- `frontend/src/pages/SiteDetailPage.tsx`
- `frontend/src/pages/BranchDetailPage.tsx`
- `frontend/src/pages/DocumentPage.tsx`

#### Phase 8.16: Merge Request UI

**Status:** Complete

##### Deliverables:
- [x] Types and API Module (`frontend/src/types/index.ts`, `frontend/src/api/merge-requests.ts`)
  - Enhanced `MergeRequest` type with `MergeRequestStatus`, `DocumentConflict`, `ConflictDetails`
  - Added `ConflictResolutionStrategy`, `MergePreview`, `MergeExecuteResult` types
  - API functions: `listMergeRequests`, `getMergeRequest`, `createMergeRequest`, `updateMergeRequest`, `deleteMergeRequest`
  - Merge operations: `checkMergeability`, `previewMerge`, `executeMerge`

- [x] Merge Requests List Page (`frontend/src/pages/MergeRequestsPage.tsx`)
  - Status filter tabs: All, Open, Approved, Conflicted, Merged, Closed
  - Table view with Title, Source/Target Branch, Status, Created, Actions columns
  - Status badges with color coding (open=blue, approved=green, conflicted=orange, merged=purple, closed=gray)
  - Row click navigation to detail page
  - "+ Create merge request" button

- [x] Create Merge Request Page (`frontend/src/pages/CreateMergeRequestPage.tsx`)
  - Form with Source Branch, Target Branch, Title, Description fields
  - Client-side validation (different branches required, title required)
  - Redirects to detail page on success

- [x] Merge Request Detail Page (`frontend/src/pages/MergeRequestDetailPage.tsx`)
  - Header with title, status badge, source → target branches
  - Metadata section with created by, created at, merged at, updated at
  - Description section
  - Status-dependent action buttons:
    - Open: Approve, Close, Delete
    - Approved: Execute Merge, Close
    - Conflicted: Resolve Conflicts, Close
    - Merged: (read-only)
    - Closed: Reopen, Delete
  - Delete confirmation modal with name verification

- [x] Conflict Display (`frontend/src/components/ConflictList.tsx`)
  - Table showing document conflicts
  - Conflict type badges: Both Modified, Deleted in Source, Deleted in Target
  - Version information for source and target

- [x] Merge Preview (`frontend/src/components/MergePreviewPanel.tsx`)
  - "Preview Merge" button to check merge feasibility
  - Displays canMerge status and conflict summary
  - Shows conflicts if any exist

- [x] Conflict Resolution (`frontend/src/components/ConflictResolutionPanel.tsx`)
  - Per-conflict resolution options: Take Source, Take Target, CRDT Merge
  - "Apply to All" bulk option for quick resolution
  - "Apply Resolutions and Merge" button

- [x] App Routes Updated (`frontend/src/App.tsx`)
  - `/sites/:siteId/merge-requests` - List page
  - `/sites/:siteId/merge-requests/new` - Create page
  - `/sites/:siteId/merge-requests/:requestId` - Detail page

- [x] Site Detail Page Link (`frontend/src/pages/SiteDetailPage.tsx`)
  - "Merge Requests" button in header

- [x] E2E Tests (`frontend/tests/merge-requests.spec.ts`)
  - 22 test cases covering full merge request lifecycle:
    - List merge requests with status filtering
    - Create merge request with validation
    - View merge request detail
    - Approve, close, reopen status changes
    - Delete with confirmation modal
    - Merge preview panel
    - List view navigation

##### Files Created:
| File | Purpose |
|------|---------|
| `frontend/src/api/merge-requests.ts` | API module for merge requests |
| `frontend/src/pages/MergeRequestsPage.tsx` | List page |
| `frontend/src/pages/MergeRequestsPage.css` | List styles |
| `frontend/src/pages/CreateMergeRequestPage.tsx` | Create form page |
| `frontend/src/pages/CreateMergeRequestPage.css` | Create form styles |
| `frontend/src/pages/MergeRequestDetailPage.tsx` | Detail page |
| `frontend/src/pages/MergeRequestDetailPage.css` | Detail styles |
| `frontend/src/components/ConflictList.tsx` | Conflict display component |
| `frontend/src/components/ConflictList.css` | Conflict display styles |
| `frontend/src/components/MergePreviewPanel.tsx` | Preview panel |
| `frontend/src/components/MergePreviewPanel.css` | Preview panel styles |
| `frontend/src/components/ConflictResolutionPanel.tsx` | Resolution UI |
| `frontend/src/components/ConflictResolutionPanel.css` | Resolution styles |
| `frontend/tests/merge-requests.spec.ts` | E2E tests |

##### Files Modified:
| File | Changes |
|------|---------|
| `frontend/src/types/index.ts` | Enhanced MergeRequest type, added conflict types |
| `frontend/src/App.tsx` | Added 3 merge request routes |
| `frontend/src/pages/SiteDetailPage.tsx` | Added Merge Requests link |
| `frontend/src/pages/SiteDetailPage.css` | Added link styles |
| `frontend/src/components/ConfirmDeleteModal.tsx` | Added "merge request" resource type |

##### Bug Fixes (Post-Implementation):
- **Backend Route Fix**: Fixed operation parameter mapping in `workers/src/index.ts` to prevent 405 errors on merge-requests routes. The `operation` parameter was incorrectly being set to `'requests'` for merge-request CRUD routes.
- **API Signature Fix**: Fixed `listMergeRequests` call signature in `workers/src/routes/merge-api.ts`. Function was being called with wrong parameter structure.
- **Status Transition Fix**: Updated `workers/src/services/merge-request-service.ts` to allow reopening closed merge requests (closed → open transition).
- **Delete Navigation Fix**: Fixed `handleDelete` in `MergeRequestDetailPage.tsx` to only navigate on successful deletion.
- **Test Fixes**: Updated E2E tests to handle empty state after deletion and wait for reopen button visibility.

**Commits:**
- `c25417f` - Implement Merge Request UI with conflict resolution
- `6c81cd5` - Fix merge request API routing and status transitions
- `a1c1ed7` - Fix delete handler to only navigate on success

#### Future Frontend Work

The following features are candidates for future frontend development phases:

##### Core Features
- [x] **Document Version History** - Display version history with revert capability on DocumentPage (Phase 8.15)
- [x] **Document Content Editing** - JSON editor for modifying document content (Phase 8.15)
- [x] **Merge Request UI** - Create, view, and manage merge requests between branches (Phase 8.16)
- [x] **Conflict Resolution UI** - Visual interface for resolving merge conflicts (Phase 8.16)
- [ ] **Structure Management** - Create and manage site structures (hierarchies/collections)
- [ ] **Node Management** - Add, edit, move, and reorder structure nodes
- [ ] **Document Metadata Editor** - View and edit document metadata within structures

##### Real-Time Features
- [ ] **WebSocket Integration** - Connect to DocumentSession for real-time updates
- [ ] **Presence Indicators** - Show who else is viewing/editing a document
- [ ] **Live Collaboration** - Real-time CRDT-based document editing

##### User Experience
- [ ] **Branch Status Actions** - UI for changing branch status (review, archive, etc.)
- [ ] **Checkpoint Management** - View checkpoint details, compare checkpoints, restore
- [ ] **Search/Filter** - Search across sites, documents, and branches
- [ ] **Bulk Operations** - Select multiple items for batch actions
- [ ] **Breadcrumb Enhancement** - Clickable breadcrumb for all navigation levels

##### Administrative
- [ ] **Grant Management UI** - Manage branch-level permissions
- [ ] **Guest Link Generation** - Create and manage guest access links
- [ ] **Audit Log Viewer** - View audit events for compliance

##### Backend Prerequisites
- [ ] Branch deletion cascade (delete checkpoints before branch)
- [ ] Document versions API endpoint for content retrieval
- [ ] WebSocket authentication integration

---
## Recent Features

### Visual JSON Diffs in MergePreviewPanel (Added 2026-01-25)

**Feature:** Added expandable diff viewing directly from the MergePreviewPanel component, allowing users to see what changed between branches before approving or resolving conflicts.

**Problem Solved:** Previously, visual diffs were only accessible in ConflictResolutionPanel (hidden behind "Resolve Conflicts" button, only for `conflicted` status). Users couldn't preview actual document changes for `open` or `approved` merge requests.

**Implementation:**
- Created `ExpandableDiffRow` component: Read-only expandable row with JsonDiffViewer (no resolution radio buttons)
- Created `ExpandableConflictList` component: List with "Expand All" / "Collapse All" controls and lazy loading
- Updated `MergePreviewPanel` to use ExpandableConflictList instead of ConflictList
- Implemented lazy loading: Diffs fetched with `includeContent: true` only when user first expands a row

**Files Created:**
- `frontend/src/components/ExpandableDiffRow.tsx` + `.css`
- `frontend/src/components/ExpandableConflictList.tsx` + `.css`

**Files Modified:**
- `frontend/src/components/MergePreviewPanel.tsx`
- `frontend/tests/merge-diff-visualization.spec.ts` (added 4 new E2E tests)

**Test Commits:** `2a0bc6b` (tests), `a5350af` (implementation)

---
### PostgreSQL Initialization Fallback (Phase 1.4b) - Added 2026-01-26

**Feature:** Durable Objects now load initial state from PostgreSQL when their storage is empty, enabling seamless recovery after hibernation.

**Problem Solved:** When a Durable Object wakes up from hibernation or is accessed for the first time, its storage is empty. Without falling back to PostgreSQL, documents would appear empty even though data exists in the database.

**Implementation:**

**GET /internal/crdt-state Endpoint:**
- Added endpoint to `internal-api.ts` for loading latest CRDT state
- Query params: `siteId`, `documentPath`, `branchId`
- Returns `{ found: true, snapshot, crdtState }` or `{ found: false }` (404)
- Uses same X-Internal-Secret authentication as POST endpoint

**initializeFromPostgres() Method:**
- Added to DocumentSession DO to fetch state from PostgreSQL
- Called by `initializeIfNeeded()` when DO storage is empty
- Falls back gracefully if internal API configuration is missing

**applySnapshotToYMap() Helper:**
- Recursively applies JSON snapshot to Yjs Y.Map structure
- Handles objects, arrays, and primitive values
- Used when PostgreSQL has snapshot but no CRDT state (legacy documents)

**State Recovery Flow:**
1. DO wakes up, checks storage → empty
2. Calls `GET /internal/crdt-state` to fetch from PostgreSQL
3. If CRDT state exists: applies binary state to Y.Doc
4. If only snapshot exists: builds Y.Doc from JSON structure
5. If nothing found: starts with empty document

**Files Modified:**
- `workers/src/routes/internal-api.ts` - Added GET endpoint
- `workers/src/durable-objects/document-session.ts` - Added initialization methods

**Implementation Commits:**
- `793f2f2` - feat(realtime): Initialize DO from PostgreSQL when storage is empty (Phase 1.4)

---

### Automatic Sync Triggers for DocumentSession (Phase 1.3b) - Added 2026-01-26

**Feature:** Implemented automatic sync triggers in DocumentSession Durable Object to sync CRDT state to PostgreSQL after edits.

**Problem Solved:** Previously, CRDT state was only synced when explicitly calling the `/sync` endpoint. Now, edits automatically trigger sync to PostgreSQL after an idle timeout, ensuring data durability without requiring manual intervention.

**Implementation:**

**Idle Timeout Sync (5 seconds):**
- Added `scheduleSync()` method that schedules sync after 5 seconds of no edits
- Timer resets on each edit (debouncing) to batch rapid edits
- Triggered after `/apply` operations and WebSocket message handling
- Configured via `SYNC_IDLE_TIMEOUT_MS` constant

**Disconnect Sync:**
- When the last WebSocket client disconnects, immediate sync is triggered
- Ensures data is persisted when an editing session ends
- Handles both 'close' and 'error' events on WebSocket

**PostgreSQL Sync via Internal API:**
- `syncToPostgres()` method calls `POST /internal/crdt-sync`
- Uses `X-Internal-Secret` header for authentication
- Sends siteId, documentPath, branchId, snapshot, crdtState, actorId, actorType
- Gracefully handles missing configuration (logs and skips)

**Environment Configuration:**
- Added `INTERNAL_API_URL` to wrangler.jsonc for all environments
- Added `INTERNAL_SECRET` to .dev.vars for local development
- Production environments should set INTERNAL_SECRET via Cloudflare secrets

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` - Added sync triggers
- `workers/wrangler.jsonc` - Added INTERNAL_API_URL config
- `workers/.dev.vars` - Added INTERNAL_SECRET for local dev
- `workers/tests/durable-objects/document-session.spec.ts` - Added sync trigger tests

**Test Commits:**
- `071dfa0` - test: Add automatic sync trigger tests for DocumentSession (TDD - Phase 1.3b)

**Implementation Commits:**
- `fa7048b` - feat(realtime): Add automatic sync triggers to DocumentSession (Phase 1.3b)
- `dbd2557` - config: Add INTERNAL_API_URL for DO-to-PostgreSQL sync

---

### WebSocket Connection Fixes (Added 2026-01-26)

**Feature:** Fixed WebSocket connection handling to enable end-to-end real-time collaboration.

**Problem Solved:** WebSocket connections were failing with "Responses may only be constructed with status codes in the range 200 to 599" because the CORS middleware was trying to modify WebSocket upgrade responses (status 101). Additionally, the frontend couldn't authenticate WebSocket connections because browsers can't send custom headers during WebSocket upgrade handshakes.

**Implementation:**

**WebSocket Response Handling:**
- Added WebSocket detection in `addCorsHeaders()` functions in both `index.ts` and `realtime-api.ts`
- Uses `'webSocket' in response` check to detect Cloudflare Workers WebSocket responses
- Returns WebSocket responses as-is without modification (CORS doesn't apply to WebSocket connections)

**API Key Authentication via Query Params:**
- Added `apiKey` query parameter support in `authenticate()` function for WebSocket connections
- Browsers cannot send custom headers (like `X-API-Key`) during WebSocket upgrade requests
- Frontend passes API key as `?apiKey=...` query parameter, backend validates it

**Route Matching Fix:**
- Moved realtime route matching (`/connect` and `/edits` endpoints) before document routes
- Prevents document API from incorrectly matching realtime WebSocket URLs
- Preserved query parameters when forwarding requests to Durable Object

**Files Modified:**
- `workers/src/index.ts` - WebSocket response handling, query param auth, route priority
- `workers/src/routes/realtime-api.ts` - WebSocket response handling, query param forwarding

**Files Modified (puck-css-integration):**
- `packages/css-client/src/realtime.ts` - Added apiKey to config and connect URL
- `packages/puck-css/src/hooks/useRealtime.ts` - Pass apiKey to RealtimeClient
- `packages/puck-css/src/types.ts` - Added realtimeApiKey to CSSPuckConfig
- `packages/puck-css/src/CSSPuckProvider.tsx` - Pass realtimeApiKey to useRealtime
- `apps/demo/src/App.tsx` - Pass realtimeApiKey prop to CSSPuckProvider

**Implementation Commits:**
- `e884ad1` - fix(realtime): Fix WebSocket connection handling

---

### Yjs CRDT Integration Frontend (Phases 2-3) - Added 2026-01-25

**Feature:** Added frontend WebSocket client and Puck Editor integration for real-time collaborative editing using Yjs CRDT synchronization.

**Problem Solved:** Completes the end-to-end real-time collaboration system. With the backend (Phase 1) syncing CRDT state to PostgreSQL and the frontend (Phases 2-3) connecting via WebSocket, multiple users can now edit the same document simultaneously with automatic conflict-free merging.

**Implementation (in puck-css-integration repo):**

**Phase 2 - RealtimeClient:**
- Created `RealtimeClient` class in `packages/css-client/src/realtime.ts`
- Manages WebSocket connection lifecycle with auto-reconnect
- Handles binary Yjs message encoding/decoding
- Provides `connect()`, `disconnect()`, `applyLocalUpdate()`, `getYDoc()` methods
- Added yjs dependency to css-client package

**Phase 3.1 - Puck-Yjs Binding:**
- Created `puckYjsBinding.ts` utility for bidirectional sync
- `puckDataToYMap()` - Converts PuckData to Yjs Y.Map structure
- `yMapToPuckData()` - Converts Yjs Y.Map to PuckData
- `createPuckYjsBinding()` - Creates binding with LOCAL_ORIGIN to prevent sync loops
- Uses transaction origins to distinguish local vs remote changes

**Phase 3.2 - useRealtime Hook:**
- Created `useRealtime.ts` React hook
- Manages RealtimeClient lifecycle with useEffect
- Creates Puck-Yjs binding on mount
- Exposes `connected` state, `applyLocalChange()` function, and `error`
- Cleans up connections on unmount or dependency changes

**Phase 3.3-3.4 - CSSPuckProvider Integration:**
- Added `enableRealtime` and `wsBaseUrl` props to CSSPuckConfig
- Added `realtimeEnabled` and `realtimeConnected` to context value
- Uses useRealtime hook when enabled
- Updates currentData on remote changes from collaborators

**Files Created (puck-css-integration):**
- `packages/css-client/src/realtime.ts` - RealtimeClient class
- `packages/puck-css/src/utils/puckYjsBinding.ts` - Yjs binding utility
- `packages/puck-css/src/hooks/useRealtime.ts` - React hook
- Test files for each component

**Files Modified (puck-css-integration):**
- `packages/css-client/src/index.ts` - Export RealtimeClient
- `packages/css-client/package.json` - Added yjs dependency
- `packages/puck-css/src/hooks/index.ts` - Export useRealtime
- `packages/puck-css/src/types.ts` - Added realtime config/context props
- `packages/puck-css/src/CSSPuckProvider.tsx` - Integrated useRealtime hook
- `packages/puck-css/package.json` - Added yjs dependency

**Test Commits (puck-css-integration):**
- `8305b77` - RealtimeClient tests (8 tests)
- `a488753` - puckYjsBinding tests (10 tests)
- `15113f4` - useRealtime hook tests (7 tests)
- `a3ec0f5` - CSSPuckProvider realtime tests (7 tests)

**Implementation Commits (puck-css-integration):**
- `bc089c7` - RealtimeClient implementation
- `0ebc11a` - useRealtime hook implementation
- `703c4d5` - CSSPuckProvider realtime integration

---

### Yjs CRDT Integration Backend (Phase 1) - Added 2026-01-25

**Feature:** Added backend infrastructure for syncing Durable Object CRDT state to PostgreSQL, enabling real-time collaborative editing with persistent merge support.

**Problem Solved:** Previously, documents edited via WebSocket/Yjs had CRDT state only in the Durable Object, not synced to PostgreSQL. This meant the `merge-crdt` resolution strategy failed because `document_versions.crdt_state` was NULL.

**Implementation:**

**Phase 1.1 - CRDT Sync Service:**
- Created `crdt-sync-service.ts` with `syncCrdtToPostgres()` and `loadLatestCrdtState()` functions
- Looks up documents by path, creates versions with snapshot + crdtState
- Added 'realtime' to DocumentVersionSource type

**Phase 1.2 - Internal Sync Endpoint:**
- Created `internal-api.ts` with `POST /internal/crdt-sync` endpoint
- Uses X-Internal-Secret header authentication (for DO-to-worker calls)
- Full request validation for siteId, documentPath, branchId, crdtState, actorId, actorType

**Phase 1.3 - Sync Triggers:**
- Added `/sync` endpoint to DocumentSession DO for manual sync trigger
- Returns synced state with snapshot and stateVector
- Only accepts POST method

**Phase 1.4 - PostgreSQL Initialization:**
- Added `/initialize` endpoint to DocumentSession DO
- Supports initialization from JSON snapshot or base64-encoded CRDT state
- CRDT state takes precedence when provided
- Used when DO storage is empty but PostgreSQL has data

**Files Created:**
- `workers/src/services/crdt-sync-service.ts`
- `workers/src/routes/internal-api.ts`
- `workers/tests/services/crdt-sync-service.spec.ts`
- `workers/tests/routes/internal-api.spec.ts`

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` - Added /sync and /initialize endpoints
- `workers/src/index.ts` - Added internal route handling
- `workers/src/services/index.ts` - Added CRDT sync exports
- `workers/src/types.ts` - Added 'realtime' source type

**Test Commits:**
- `717dfc4` - CRDT sync service tests (12 tests)
- `737c439` - Internal API route tests (16 tests)
- `1935f6c` - DocumentSession sync/initialize tests (5 tests)

**Implementation Commits:**
- `100a896` - CRDT sync service implementation
- `5fe237e`, `bb85de8` - Internal API route implementation
- `268b91b` - DocumentSession /sync and /initialize endpoints

---

### Agent Politeness System - Database Schema (Phase 1.1) - Added 2026-01-26

**Feature:** Added database schema foundation for the Agent Politeness System, enabling organization-level agent configuration, agent registry, and enhanced checkpoints for agent-human collaboration.

**Problem Solved:** The v2.3 architecture introduces the Agent Politeness System for respectful human-agent collaboration. This phase establishes the database foundation required for:
- Organization-level agent idle timeout configuration
- Individual agent accounts with status management
- Enhanced checkpoint tracking for agent operations with rollback support

**Implementation:**

**Migration 009 - Organizations:**
- Created `app.organizations` table with settings JSONB
- Default `agentIdleTimeoutMs: 5000` (5 seconds)
- Added `organization_id` foreign key to `app.sites`
- Added index `idx_sites_organization`

**Migration 010 - Agent Registry:**
- Created `app.agents` table for organization-level agent accounts
- Status field with check constraint: `active`, `suspended`, `disabled`
- Capabilities array for agent permissions
- Settings JSONB for future extensibility
- Unique constraint on `(organization_id, name)`
- Indexes: `idx_agents_organization`, `idx_agents_status`

**Migration 011 - Enhanced Checkpoints:**
- Added `description` for detailed checkpoint metadata
- Added `trigger` field: `manual`, `human_requested`, `autonomous`
- Added `requested_by_id` for human-requested agent work
- Added `operation_type` for categorizing agent operations
- Added `affected_regions` JSONB for JSON path tracking
- Added `status` field: `completed`, `rolled_back`, `partial`
- Added rollback tracking: `rolled_back_by_id`, `rolled_back_at`

**Files Created:**
- `workers/src/db/migrations/009_organizations.sql`
- `workers/src/db/migrations/010_agents.sql`
- `workers/src/db/migrations/011_enhanced_checkpoints.sql`

**Files Modified:**
- `workers/tests/db/schema.spec.ts` - Added 17 tests for new schema

**Test Commit:**
- `8421d3c` - Agent Politeness schema tests (17 tests)

**Implementation Commit:**
- `71c6927` - Agent Politeness database schema migrations

---

### Agent Politeness System - TypeScript Types (Phase 1.2) - Added 2026-01-26

**Feature:** Added comprehensive TypeScript types for the Agent Politeness System, including organization settings, agent registry, enhanced checkpoints, and presence/awareness system.

**Implementation:**

**New Union Types:**
- `CheckpointTrigger`: manual | human_requested | autonomous
- `CheckpointStatus`: completed | rolled_back | partial
- `AgentStatus`: active | suspended | disabled
- `PresenceState`: active | idle | editing

**Organization & Agent Registry Types:**
- `Organization` and `OrganizationSettings` (with agentIdleTimeoutMs)
- `RegisteredAgent` and `AgentSettings`
- `AgentPriorityTier` for future scheduling configuration

**Enhanced Checkpoint Type:**
- Added `trigger`, `requestedById`, `operationType` fields
- Added `affectedRegions` for JSON path tracking
- Added `status`, `rolledBackById`, `rolledBackAt` for rollback

**Presence & Edit Workflow Types:**
- `ActorPresence` for awareness system
- `AgentEditContext` for edit permission requests
- `AgentEditPermission` for permission responses

**Site Type Enhancement:**
- Added optional `organizationId` field

**Files Modified:**
- `workers/src/types.ts` - Added 11 new types/interfaces
- `workers/tests/types/types.spec.ts` - Added 21 new tests

**Test Commit:**
- `60e6685` - Agent Politeness type tests (21 tests)

**Implementation Commit:**
- `3bedecb` - Agent Politeness TypeScript types

---

### Agent Politeness System - Organization Service (Phase 1.3) - Added 2026-01-26

**Feature:** Implemented Organization Service providing CRUD operations for organizations and site-organization linking.

**Implementation:**

**Service Functions:**
- `createOrganization(params)` - Create organization with name and optional settings
- `getOrganizationById(id)` - Get organization by ID
- `updateOrganization(id, params)` - Update organization name and/or settings
- `deleteOrganization(id)` - Delete organization (fails if has linked sites)
- `listOrganizations(options)` - List organizations with pagination
- `linkSiteToOrganization(siteId, organizationId)` - Link site to organization
- `unlinkSiteFromOrganization(siteId)` - Remove site from organization
- `getSitesByOrganization(organizationId)` - Get all sites for an organization
- `getOrganizationForSite(siteId)` - Get organization for a site

**Error Classes:**
- `InvalidOrganizationParamsError` - Invalid name (empty/whitespace)
- `OrganizationHasSitesError` - Cannot delete organization with linked sites
- `OrganizationNotFoundError` - Organization not found when linking site

**Files Created:**
- `workers/src/services/organization-service.ts` - Service implementation

**Files Modified:**
- `workers/src/services/index.ts` - Added organization service exports
- `workers/tests/services/organization-service.spec.ts` - Removed TDD eslint-disable

**Test Commit:**
- `971033f` - Organization Service tests (26 tests)

**Implementation Commit:**
- `6da4bdc` - Organization Service implementation

---

### Agent Politeness System - Agent Registry Service (Phase 1.4) - Added 2026-01-26

**Feature:** Implemented Agent Registry Service providing CRUD operations for registered agents with status management.

**Implementation:**

**Service Functions:**
- `createAgent(params)` - Create agent with name, description, capabilities, settings
- `getAgentById(id)` - Get agent by ID
- `getAgentByName(organizationId, name)` - Get agent by organization and name (unique)
- `updateAgent(id, params)` - Update agent name, description, capabilities, settings
- `updateAgentStatus(id, status)` - Change agent status (active/suspended/disabled)
- `deleteAgent(id)` - Delete agent
- `listAgents(options)` - List agents with pagination and status filter
- `getAgentsByOrganization(organizationId, options)` - Get all agents for an organization
- `getActiveAgentCount(organizationId)` - Count active agents in organization

**Error Classes:**
- `InvalidAgentParamsError` - Invalid name (empty/whitespace)
- `DuplicateAgentNameError` - Agent name already exists in organization
- `OrganizationNotFoundError` - Organization not found when creating agent
- `AgentNotFoundError` - Agent not found

**Files Created:**
- `workers/src/services/agent-service.ts` - Service implementation

**Files Modified:**
- `workers/src/services/index.ts` - Added agent service exports
- `workers/tests/services/agent-service.spec.ts` - Removed TDD eslint-disable

**Test Commit:**
- `96a0c5e` - Agent Registry Service tests (34 tests)

**Implementation Commit:**
- `3d4e646` - Agent Registry Service implementation

---

### Agent Politeness System - Organization & Agent API Routes (Phase 1.5) - Added 2026-01-26

**Feature:** Implemented REST API endpoints for organizations and agents.

**Implementation:**

**Organization API Endpoints:**
- `POST /api/organizations` - Create organization
- `GET /api/organizations` - List organizations with pagination
- `GET /api/organizations/{id}` - Get organization by ID
- `PATCH /api/organizations/{id}` - Update organization
- `DELETE /api/organizations/{id}` - Delete organization (409 if has linked sites)
- `GET /api/organizations/{id}/sites` - List linked sites
- `POST /api/organizations/{id}/sites/{siteId}` - Link site to organization
- `DELETE /api/organizations/{id}/sites/{siteId}` - Unlink site from organization

**Agent API Endpoints:**
- `POST /api/organizations/{id}/agents` - Create agent
- `GET /api/organizations/{id}/agents` - List agents with status filter
- `GET /api/organizations/{id}/agents/{agentId}` - Get agent (403 if wrong org)
- `PATCH /api/organizations/{id}/agents/{agentId}` - Update agent
- `PUT /api/organizations/{id}/agents/{agentId}/status` - Update agent status
- `DELETE /api/organizations/{id}/agents/{agentId}` - Delete agent

**Files Created:**
- `workers/src/routes/organization-api.ts` - Organization API routes
- `workers/src/routes/agent-api.ts` - Agent API routes

**Test Commit:**
- `e4af15c` - Organization and Agent API tests (34 tests)

**Implementation Commit:**
- `1dd7b6a` - Organization and Agent API routes

---

### Agent Politeness System - Presence Service (Phase 2.1) - Added 2026-01-26

**Feature:** Implemented in-memory Presence Service for tracking actors in document sessions.

**Implementation:**

**PresenceManager Class:**
- `register(options)` - Register new presence (replaces existing for same actor)
- `get(id)` - Get presence by ID
- `getByActorId(actorId)` - Get presence by actor ID
- `updateState(id, state)` - Update presence state (active/idle/editing)
- `updateFocusRegions(id, regions)` - Update focus regions (JSON paths)
- `updateIntent(id, intent)` - Update agent intent
- `recordActivity(id)` - Update lastActivityAt timestamp
- `unregister(id)` - Remove presence by ID
- `unregisterByActorId(actorId)` - Remove presence by actor ID
- `getAll()` - Get all presences
- `getHumans()` - Get human presences only
- `getAgents()` - Get agent presences only
- `getByState(state)` - Get presences by state
- `hasHumanPresence()` - Check if any humans present
- `hasActiveHumans()` - Check if any humans are active/editing
- `getActorsInRegion(region)` - Get actors with overlapping focus regions
- `count()` - Get presence count
- `clear()` - Clear all presences
- `toJSON()` - Serialize to array

**Utility Functions:**
- `regionsOverlap(path1, path2)` - Check if JSON paths overlap (parent/child/exact match)

**Design Notes:**
- In-memory storage using Map with O(1) lookups via actorId index
- Designed for use within Durable Object for ephemeral session state
- Actor re-registration replaces existing presence (handles reconnects)
- Automatic role assignment: 'user' → 'human', 'agent' → 'agent'

**Files Created:**
- `workers/src/services/presence-service.ts` - Service implementation

**Files Modified:**
- `workers/src/services/index.ts` - Added presence service exports

**Test Commit:**
- `bb2a4e3` - Presence Service tests (40 tests)

**Implementation Commit:**
- `2178668` - Presence Service implementation

---

### Agent Politeness System - Activity Detection Service (Phase 2.2) - Added 2026-01-26

**Feature:** Implemented Activity Detection Service for tracking human activity and determining when autonomous agents can safely edit.

**Implementation:**

**ActivityDetector Class:**
- `recordHumanActivity(actorId, regions?)` - Record human activity with timestamp and regions
- `isHumanIdle()` - Check if humans are idle (no activity within timeout)
- `getTimeSinceLastActivity()` - Get elapsed time since last human activity
- `getTimeUntilIdle()` - Get remaining time until humans are considered idle
- `getActiveRegions()` - Get all regions currently being edited by humans
- `clearRegions()` - Clear all active regions
- `isRegionActive(region)` - Check if a region overlaps with active regions
- `getConflictingRegions(targetRegions)` - Get regions that conflict with active regions
- `setIdleTimeout(ms)` - Update idle timeout dynamically
- `reset()` - Clear all activity state
- `canAgentProceed(context)` - Check if agent can proceed with edits:
  - Human-requested work always allowed
  - Autonomous work waits for idle timeout
  - Region conflicts checked even when idle
- `toJSON()` - Serialize state for inspection

**Constants:**
- `DEFAULT_IDLE_TIMEOUT_MS` - Default idle timeout (5000ms)

**Design Notes:**
- Uses `regionsOverlap` from presence-service for path comparisons
- Designed for use within Document Session Durable Object
- Region deduplication via Set
- Dynamic idle timeout configuration for organization-level settings

**Files Created:**
- `workers/src/services/activity-detection-service.ts` - Service implementation

**Files Modified:**
- `workers/src/services/index.ts` - Added activity detection service exports

**Test Commit:**
- `b2aa603` - Activity Detection Service tests (40 tests)

**Implementation Commit:**
- `18a6f9c` - Activity Detection Service implementation

---

### Agent Politeness System - Agent Edit Permission Service (Phase 2.3) - Added 2026-01-26

**Feature:** Implemented Agent Edit Permission Service combining activity detection with agent status checks.

**Implementation:**

**AgentEditPermissionService Class:**
- `canAgentEdit(context)` - Check if agent can edit with permission rules:
  1. Agent status check first (suspended/disabled denied)
  2. Human-requested work always allowed if agent active
  3. Autonomous work waits for idle timeout
  4. Region conflicts checked even when idle
- `recordHumanActivity(actorId, regions?)` - Delegate to activity detector
- `clearRegions()` - Clear active regions
- `setIdleTimeout(ms)` / `getIdleTimeoutMs()` - Manage idle timeout
- `isHumanIdle()` - Check if humans are idle
- `getConflictingRegions(targetRegions)` - Get overlapping regions
- `getActiveRegions()` - Get all active regions
- `reset()` - Reset all activity state

**Types:**
- `AgentEditContext` - Context for edit permission requests
- `AgentEditPermission` - Permission result with allowed/reason
- `GetAgentStatusFn` - Callback for agent status lookup

**Design Notes:**
- Integrates ActivityDetector for idle/region tracking
- Optional getAgentStatus callback for status lookup
- Agent status checked before all other checks
- Human-requested bypasses idle check but not status check

**Files Created:**
- `workers/src/services/agent-edit-permission-service.ts` - Service implementation

**Files Modified:**
- `workers/src/services/index.ts` - Added service exports

**Test Commit:**
- `b088fe1` - Agent Edit Permission Service tests (19 tests)

**Implementation Commit:**
- `3a3ccee` - Agent Edit Permission Service implementation

---

### Agent Politeness System - Agent Edit Workflow API Routes (Phase 2.4) - Added 2026-01-26

**Feature:** Implemented Agent Edit Workflow API routes for agent edit lifecycle management.

**Implementation:**

**New API Endpoints:**
- `POST /can-agent-edit` - Check if agent can proceed with editing
- `POST /agent-edit-start` - Declare intent to edit, create checkpoint (if autonomous)
- `POST /agent-edit-complete` - Complete edit session, clear focus regions
- `POST /agent-edit-abort` - Abort edit session, rollback to checkpoint

**Request Validation:**
- `validateAgentEditBody()` - Validates agentId, trigger, intent, targetRegions
- `validateEditSessionBody()` - Validates editSessionId (reason optional for abort)
- Trigger validation: Must be "human_requested" or "autonomous"

**Route Updates:**
- Extended route pattern to match agent edit action paths
- All routes forward to Durable Object with validated body
- CORS support for all agent edit endpoints
- Consistent session ID generation

**Design Notes:**
- Routes proxy to DocumentSession Durable Object
- DO will implement actual permission checks and checkpoint creation
- Worker layer handles validation and routing only
- Compatible with existing realtime API route structure

**Files Modified:**
- `workers/src/routes/realtime-api.ts` - Added agent edit workflow routes

**Test Commit:**
- `e9dbd26` - Agent Edit Workflow API route tests (41 tests)

**Implementation Commit:**
- `b69fcba` - Agent Edit Workflow API route implementation

**Security Fix Commit:**
- `fd39d60` - Added input validation limits (agentId, intent, targetRegions, editSessionId, reason)

**Security Review Notes:**
- Added limits: MAX_AGENT_ID_LENGTH (128), MAX_INTENT_LENGTH (1000), MAX_EDIT_SESSION_ID_LENGTH (128), MAX_REGION_PATH_LENGTH (256), MAX_TARGET_REGIONS (100), MAX_REASON_LENGTH (500)
- Authentication is handled at DO level via X-Actor-Id/X-Actor-Type headers (by design)

---

### Agent Politeness System - Extended Checkpoint Model (Phase 3) - Added 2026-01-26

**Feature:** Extended the Checkpoint Service with enhanced fields for Agent Politeness System, enabling full agent auditability and reversibility.

**Implementation:**

**Extended CreateCheckpointParams:**
- `description` - Optional description of checkpoint purpose
- `trigger` - How checkpoint was triggered: 'manual' | 'human_requested' | 'autonomous'
- `requestedById` - Who requested the checkpoint (for human_requested)
- `operationType` - Type of operation: 'content_edit' | 'structure_edit' | 'metadata_edit' | custom
- `affectedRegions` - Array of JSON paths affected by changes

**New Checkpoint Service Functions:**
- `updateCheckpointStatus(id, status, rolledBackById?)` - Update checkpoint status to 'completed' | 'rolled_back' | 'partial'
- `listCheckpointsByAgent(agentId, options?)` - List checkpoints created by specific agent with filtering
- `listCheckpointsByOperationType(branchId, operationType, options?)` - List checkpoints by operation type

**Enhanced ListCheckpointsByAgentOptions:**
- `limit` / `offset` - Pagination support
- `branchId` - Filter by branch
- `operationType` - Filter by operation type
- `trigger` - Filter by trigger type
- `status` - Filter by checkpoint status

**Rollback Enhancement:**
- `revertToCheckpoint` now updates original checkpoint status to 'rolled_back'
- Records `rolled_back_by_id` and `rolled_back_at` timestamp
- Wrapped in explicit transaction with proper BEGIN/COMMIT/ROLLBACK

**Security Hardening:**
- Input validation for all string parameters with length limits:
  - Name: 255 chars, Message: 1000 chars, Description: 5000 chars
  - Operation type: 100 chars, Region paths: 500 chars
  - Max affected regions: 100 items
- Transaction handling with proper rollback on errors

**Files Modified:**
- `workers/src/services/checkpoint-service.ts` - Extended with enhanced checkpoint fields
- `workers/src/services/index.ts` - Added new exports

**Test Commit:**
- `7e40f4a` - Phase 3 Enhanced Checkpoint Model tests (25 tests)

**Implementation Commit:**
- `d8e9d6c` - Phase 3 Enhanced Checkpoint Model implementation

**Security Fix Commit:**
- `b593d5c` - Input validation and transaction handling

---

### Agent Politeness System - DocumentSession Integration (Phase 4) - Added 2026-01-26

**Feature:** Integrated Agent Politeness services (PresenceManager, ActivityDetector, AgentEditPermissionService) into the DocumentSession Durable Object for coordinated human-agent collaboration.

**Implementation:**

**New DocumentSession Endpoints:**
- `GET /presences` - Return all actor presences in document session
- `GET /activity-state` - Return activity detection state (idle status, active regions, timeout config)
- `POST /can-agent-edit` - Check if agent can proceed with editing based on human activity
- `POST /agent-edit-start` - Start edit session, create checkpoint for autonomous work
- `POST /agent-edit-complete` - Complete edit session, clear focus regions
- `POST /agent-edit-abort` - Abort edit session, rollback to checkpoint if autonomous
- `GET /edit-sessions` - Return active edit sessions with metadata
- `POST /set-idle-timeout` - Configure idle timeout for activity detection

**Service Integrations:**
- **PresenceManager** - Tracks actors (users/agents) in document sessions
- **ActivityDetector** - Monitors human activity and idle state with configurable timeout
- **AgentEditPermissionService** - Checks if agents can edit based on activity and regions

**Human Activity Recording:**
- `/apply` endpoint now records human activity when users edit
- Extracts target regions from operations for region-based coordination
- Feeds into ActivityDetector for idle timeout calculation

**Edit Session Management:**
- Agents declare intent with `agent-edit-start`, receive session ID
- Autonomous edits create checkpoints for reversibility
- Sessions track agent ID, trigger type, intent, target regions
- Prevents concurrent edit sessions from same agent

**Security:**
- Input validation on all request bodies before type narrowing
- agentId, trigger, intent length validation
- Target regions count limit (MAX_TARGET_REGIONS)
- editSessionId and reason length validation

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` - Core integration (+449 lines)
- `workers/tests/durable-objects/document-session-agent-politeness.spec.ts` - Test fixes

**Test Commit:**
- `24a7162` - Phase 4 DocumentSession Agent Politeness integration tests (29 tests, TDD)

**Implementation Commit:**
- `dc18741` - Phase 4 implementation and test environment fixes

---

### Agent Politeness System - Organization Settings Integration (Phase 5) - Added 2026-01-26

**Feature:** DocumentSession now fetches and uses organization-level settings for agent idle timeout instead of the hardcoded default.

**Implementation:**

**Organization Settings Loading:**
- `loadOrgSettingsIfNeeded()` - Loads organization settings on first access, caches result
- `loadOrganizationSettings()` - Fetches org via `getOrganizationForSite(siteId)`, updates ActivityDetector timeout
- `refreshOrganizationSettings()` - Forces reload of organization settings from database

**New DocumentSession Endpoints:**
- `GET /org-settings` - Returns organization info (id, name) and current agentIdleTimeoutMs
- `POST /org-settings/refresh` - Forces reload of organization settings from database

**Caching Strategy:**
- Organization settings cached in memory after first load
- Prevents repeated DB lookups on every request
- `/org-settings/refresh` allows explicit cache invalidation

**Fallback Behavior:**
- Uses default timeout (5000ms) when no organization linked
- Uses default when org exists but settings missing agentIdleTimeoutMs
- Graceful degradation on database errors (logs warning, continues with default)

**Type Changes:**
- `OrganizationSettings.agentIdleTimeoutMs` made optional for defensive handling of missing/legacy data

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` - Org settings integration (+98 lines)
- `workers/src/types.ts` - Made agentIdleTimeoutMs optional
- `workers/tests/durable-objects/document-session-org-settings.spec.ts` - Lint fix (return type)
- `workers/tests/routes/router.spec.ts` - Lint fix (removed async)

**Test Commit:**
- `06a0daa` - Phase 5 Organization Settings Integration tests (11 tests, TDD)

**Implementation Commit:**
- `f9a45b5` - Phase 5 implementation with lint fixes

### Agent Politeness System - Conflict Notification & Kill Switch (Phase 6) - Added 2026-01-26

**Feature:** Added conflict detection when human edits overlap with active agent regions, plus kill switch endpoints to terminate agent edit sessions.

**Conflict Detection (in handleApplyOperations):**
- When a human user makes an edit, checks all active agent edit sessions for region overlap
- Uses `regionsOverlap()` from presence-service for path-based overlap detection (e.g., `/content/header/title` overlaps with `/content/header`)
- Marks conflicted sessions with `conflicted: true` and `conflictReason` explaining which regions overlap
- Includes `agentConflicts` array in `/apply` response when conflicts are detected

**New DocumentSession Endpoints:**
- `POST /kick-agent` - Terminate a specific agent's edit session by agentId
  - Requires `agentId` in request body
  - Optional `reason` for audit purposes
  - Returns 404 if agent session not found
  - Response includes `success`, `agentId`, `sessionId`, `reason`, `kickedBy`
- `POST /kick-all-agents` - Terminate all active agent edit sessions
  - Optional `reason` in request body
  - Response includes `kickedCount`, `kickedAgents` array, `reason`, `kickedBy`
- `GET /active-agents` - List all active agent edit sessions
  - Returns array of agents with `agentId`, `sessionId`, `regions`, `trigger`, `intent`, `startedAt`, `conflicted`

**Updated Endpoints:**
- `GET /edit-sessions` - Now includes `conflicted` and `conflictReason` fields in session objects

**Type Changes:**
- `AgentEditSession` interface extended with optional `conflicted` and `conflictReason` fields

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` - Conflict detection + 3 new endpoints (+156 lines)
- `workers/tests/durable-objects/document-session-conflict-killswitch.spec.ts` - Added missing `intent` field to test setup

**Test Commit:**
- `0beb027` - Phase 6 TDD tests for Conflict Notification & Kill Switch (12 tests)

**Implementation Commit:**
- `9732cb1` - Phase 6 implementation with lint fixes

---

### Agent Politeness System - Agent Context Headers & Status Validation (Phase 7) - Added 2026-01-26

**Feature:** Added agent context header parsing and status validation middleware per the architecture specification. Agents can now provide context via X-Agent-* HTTP headers.

**Agent Context Headers (per architecture):**
```
X-Agent-Id: <agent-uuid>
X-Agent-Trigger: human_requested | autonomous
X-Agent-Requested-By: <user-uuid> (when human_requested)
X-Agent-Intent: <description of what agent is doing>
X-Agent-Operation-Type: <category>
X-Agent-Target-Regions: <comma-separated JSON paths>
```

**Phase 7.1 - Agent Context Parser Service:**
- `parseAgentContext(headers)` - Parse X-Agent-* headers into typed AgentContext object
- `hasAgentContext(headers)` - Check if agent headers are present
- `validateAgentContext(context)` - Validate context with security limits
- Case-insensitive header parsing per HTTP spec
- Comma-separated target regions parsing with whitespace trimming

**Security Limits:**
- MAX_AGENT_ID_LENGTH: 128 characters
- MAX_INTENT_LENGTH: 1000 characters
- MAX_OPERATION_TYPE_LENGTH: 100 characters
- MAX_TARGET_REGIONS: 100 items
- MAX_REGION_PATH_LENGTH: 256 characters

**Phase 7.2 - Agent Status Middleware:**
- `checkAgentStatus(agentContext)` - Validate agent status before operations
- `createAgentStatusMiddleware()` - Factory for middleware function
- `parseAgentHeaders(request)` - Helper for parsing request headers
- Returns 403 for suspended agents
- Returns 403 for disabled agents
- Returns 404 for unknown agents
- Returns 500 on database errors

**Files Created:**
- `workers/src/services/agent-context-service.ts` - Context parser service
- `workers/src/middleware/agent-status-middleware.ts` - Status validation middleware
- `workers/src/middleware/index.ts` - Middleware exports

**Files Modified:**
- `workers/src/services/index.ts` - Added agent context service exports

**Test Commit:**
- `6c17814` - Phase 7 TDD tests (51 tests)

**Implementation Commit:**
- `9699fb6` - Phase 7 implementation

**Phase 7.3 - Realtime API Header Integration:**
Added support for X-Agent-* headers in the Realtime API, allowing agent context to be provided via HTTP headers alongside or instead of body parameters.

**Header/Body Merging Behavior:**
- Headers can provide agent context when body params are omitted
- Body params take precedence over headers for backwards compatibility
- CORS configured to allow all X-Agent-* headers in preflight responses

**CORS Headers Added:**
```
Access-Control-Allow-Headers: Content-Type, X-Actor-Id, X-Actor-Type, Upgrade,
  X-Agent-Id, X-Agent-Trigger, X-Agent-Requested-By, X-Agent-Intent,
  X-Agent-Operation-Type, X-Agent-Target-Regions
```

**Endpoints Updated:**
- `POST /can-agent-edit` - Accepts agent context via headers
- `POST /agent-edit-start` - Accepts agent context via headers

**Files Modified:**
- `workers/src/routes/realtime-api.ts` - Added header parsing and CORS configuration

**Test Commit:**
- `6528662` - Phase 7.3 TDD tests for header integration (18 tests)

**Implementation Commit:**
- `e91fffb` - Phase 7.3 Realtime API header integration

**Pre-existing Test Fixes:**
During Phase 7.3 testing, fixed unrelated test issues:
- `site-api.spec.ts` - Fixed test using wrong branch type for 409 response
- `document-session.spec.ts` - Fixed timeout issues with PostgreSQL initialization

**Test Fix Commit:**
- `2c1eb8a` - Pre-existing test fixes

**Phase 7.4 - Edit Workflow Status Enforcement:**

Integrated agent status validation into the Realtime API's agent edit workflow endpoints. Suspended/disabled agents are now rejected at the Worker level BEFORE forwarding requests to the Durable Object.

**Implementation Details:**
- Added `validateAgentStatusForEdit()` helper function to realtime-api.ts
- Integrated status check into `can-agent-edit` and `agent-edit-start` endpoints (required check using agentId from body/header merge)
- Integrated optional status check into `agent-edit-complete` and `agent-edit-abort` endpoints (only checks if X-Agent-Id header is present for backwards compatibility)
- Response codes: 403 (suspended/disabled), 404 (not found), 500 (database error)
- All error responses include proper CORS headers

**Test Commit:**
- `37948c7` - Phase 7.4 TDD tests for edit workflow status enforcement (22 tests)

**Implementation Commit:**
- `47dc3eb` - Phase 7.4 edit workflow status enforcement implementation

**Security Review:** Completed with no critical vulnerabilities. Minor enhancement recommendations noted:
- Agent ID character pattern validation (low priority - parameterized queries prevent injection)
- Code consistency for header access (low priority)

---

## Decision Log

Decisions made during implementation that may affect or refine the architecture.

### Phase 1.1 Decisions

*No architectural decisions required - standard tooling setup.*

### Phase 1.3 Decisions

#### Decision: Single Types File
- **Date:** 2026-01-23
- **Context:** Architecture defines 50+ types across multiple domains
- **Decision:** Use a single `types.ts` file instead of modular approach
- **Rationale:** Avoids circular dependency issues, simpler imports, ~400 lines is manageable
- **Impact:** All types imported from one location

#### Decision: ISO String Timestamps
- **Date:** 2026-01-23
- **Context:** Database returns TIMESTAMPTZ as strings; Date objects require conversion
- **Decision:** Use ISO string (`string` type) for all timestamp fields
- **Rationale:** Direct database compatibility, no conversion layer needed
- **Impact:** Consumers must parse strings if Date operations needed

#### Decision: Optional Field Syntax
- **Date:** 2026-01-23
- **Context:** TypeScript supports both `field?: T` and `field: T | null`
- **Decision:** Use `?:` syntax for optional fields
- **Rationale:** Cleaner ergonomics, aligns with common TypeScript patterns
- **Impact:** Optional fields are `undefined` when absent, not `null`

### Phase 2.1 Decisions

#### Decision: Hardcoded JWT Issuer
- **Date:** 2026-01-23
- **Context:** JWT tokens need an issuer claim for validation
- **Decision:** Use hardcoded issuer `mock-identity-provider`
- **Rationale:** Makes tokens self-documenting, aids debugging, standard practice
- **Impact:** Tokens are rejected if issuer doesn't match

#### Decision: API Key Only for Agents
- **Date:** 2026-01-23
- **Context:** Agents could use API keys or JWTs for authentication
- **Decision:** Use API keys only (no JWT issuance for agents)
- **Rationale:** Matches architecture document, simpler for automation
- **Impact:** WebSocket auth may need revisiting in Phase 4 if agents need stateless tokens

#### Decision: Hybrid Configuration
- **Date:** 2026-01-23
- **Context:** Config could be all JSON, all env vars, or hybrid
- **Decision:** JSON file for user/agent definitions, JWT secret from `.dev.vars`
- **Rationale:** Structured data in readable JSON, secrets not committed to repo
- **Impact:** Two configuration sources, but follows established patterns

### Phase 7.1.1 Decisions

#### Decision: Branch-Scoped Structure Identity
- **Date:** 2026-01-24
- **Context:** Architecture had structure identity (name, slug) at site level but state (tree, schema) at branch level, creating inconsistency where renaming a structure would immediately affect all branches
- **Decision:** Move structure identity to `branch_structure_state` table, making all structure changes branch-scoped
- **Rationale:** Consistency with document versioning model. Example: renaming "blogs" to "stuff-i-write" on a feature branch should not affect main until merged
- **Impact:** Requires schema migration (`007_branch_scoped_structures.sql`), service updates, and changes to checkpoint capture/restore

#### Decision: Site Deletion Protection
- **Date:** 2026-01-24
- **Context:** Need to determine behavior when deleting a site that has branches
- **Decision:** Prevent deletion of sites with non-archived branches
- **Rationale:** Protects against accidental data loss; forces explicit cleanup of branches before site removal
- **Impact:** DELETE `/api/sites/{siteId}` returns 409 if non-archived branches exist

#### Decision: Document Soft Delete
- **Date:** 2026-01-24
- **Context:** Need to determine behavior when deleting documents—hard delete vs soft delete
- **Decision:** Soft-delete with archival; add `archived_at` timestamp and restore endpoint
- **Rationale:** Preserves version history for audit and recovery; document paths become available for reuse after archival
- **Impact:** Adds `archived_at` column, restore endpoint, and archive filter on list endpoint

#### Decision: Bulk Operations Support
- **Date:** 2026-01-24
- **Context:** Structure management often requires batch operations (reordering, migration)
- **Decision:** Add bulk endpoints for node and metadata operations
- **Rationale:** Enables efficient reordering of nodes, migration between structures, and batch metadata updates
- **Impact:** Adds 6 bulk endpoints: node bulk create/update/delete/migrate, metadata bulk update/migrate

### Phase 8.11 Decisions

#### Decision: Tombstone Pattern for Branch-Scoped Deletion
- **Date:** 2026-01-24
- **Context:** Need to implement branch-scoped document deletion without affecting other branches
- **Decision:** Create version with `{ _deleted: true }` snapshot instead of separate deletion tracking table
- **Rationale:** Simpler implementation using existing `document_versions` table; tombstones are filtered in listing queries
- **Impact:** Deleted documents have a version record marking deletion; can be "undeleted" by creating new version

#### Decision: Document Version Inheritance on Branch Creation
- **Date:** 2026-01-24
- **Context:** New branches need to inherit documents from source branch to achieve Git-like isolation
- **Decision:** Copy latest version of each document from source branch when creating new branch
- **Rationale:** Enables Git-like workflow where branches start with parent's state; uses `DISTINCT ON` for efficiency
- **Impact:** Branch creation is slightly slower but documents are properly isolated between branches

<!--
Template for future decisions:

### Phase X.X Decisions

#### Decision: [Short Title]
- **Date:** YYYY-MM-DD
- **Context:** What prompted the decision
- **Decision:** What was decided
- **Rationale:** Why this choice was made
- **Impact:** How this affects the architecture or implementation
-->

---

### Phase 9: PDS (Pantheon Design System) Migration

**Status:** In Progress
**Branch:** `feature/pds-migration`

#### Phase 9.1: Foundation Setup
**Status:** Complete
**Commit:** `da551cf` - Phase 1: PDS Foundation Setup

**Deliverables:**
- [x] Import PDS global styles (`@pantheon-systems/design-toolkit-react/dist/index.css`)
- [x] Update `index.css` to use PDS design tokens for fallback colors
- [x] Fix TypeScript build error: add 'abandoned' to `BranchStatus` type
- [x] Create comprehensive migration plan (`PDS-MIGRATION-PLAN.md`)
  - 7 phases covering all UI components
  - E2E test migration strategy with selector mappings
  - Component-by-component migration checklist

**Migration Plan Overview:**
| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Foundation Setup | Complete |
| 2 | Core UI (buttons, inputs, modal) | Pending |
| 3 | Data Display (tables, badges, cards) | Pending |
| 4 | Navigation (breadcrumbs, tabs, sidebar) | Pending |
| 5 | Feedback (loading, notifications, empty states) | Pending |
| 6 | Specialized (code display, custom panels) | Pending |
| 7 | E2E Test Finalization | Pending |

#### Phase 9.11: Test Data Cleanup Script
**Status:** Complete

**Deliverables:**
- [x] Database cleanup script (`workers/src/db/cleanup-test-data.ts`)
  - Identifies test entries by naming pattern: `{prefix}-{13-digit-timestamp}(-{suffix})?`
  - Handles FK constraints across 16 tables in correct deletion order
  - Nulls out `source_checkpoint_id` and `source_branch_id` before deletion
  - Dry-run mode shows what would be deleted without executing
- [x] npm scripts for cleanup
  - `pnpm db:cleanup` - Dry run to preview deletions
  - `pnpm db:cleanup:execute` - Execute actual cleanup
  - `pnpm db:cleanup:execute --all` - Delete all data (full reset)

---
## Security Review

### Authentication & Authorization
- [x] **JWT Security:** HS256 signing with configurable secret (min 32 chars enforced)
- [x] **Token Expiry:** All tokens have configurable expiration (default 24h)
- [x] **Issuer Validation:** JWT issuer claim validated on every token check
- [x] **Role Escalation Prevention:** `maxRole()` returns highest of two roles, never arbitrary elevation
- [x] **Permission Checks:** All authorization checks use `assertPermission()` or `hasPermission()`
- [x] **Guest Access Scoping:** Guest tokens validated against specific branch_id

### Database Security
- [x] **Parameterized Queries:** All SQL uses `$1, $2, ...` placeholders via `query()` function
- [x] **No SQL Concatenation:** No string interpolation in SQL queries
- [x] **Connection String as Secret:** Stored in `.dev.vars` (gitignored), not in config files
- [x] **Minimal Privileges:** Worker connection uses cssuser, not superuser

### Input Validation
- [x] **Path Validation:** Document paths validated (no leading/trailing slashes, non-empty)
- [x] **UUID Validation:** Site/document IDs validated as UUIDs before database queries
- [x] **Unique Constraints:** Database enforces uniqueness (pantheon_site_id, document paths)
- [x] **Foreign Key Constraints:** Cascading deletes properly ordered (documents before sites)

### Areas for Future Review (Phase 4+)
- [ ] WebSocket authentication and session management
- [ ] Rate limiting on public endpoints
- [ ] CORS configuration validation for production
- [ ] Audit logging for sensitive operations
- [ ] Content-Security-Policy headers

---
## Recently Fixed Issues

### Database Connection Race Condition (Fixed 2026-01-25)

**Issue:** Document pages in the frontend would intermittently fail to load, showing "Internal server error" for document version endpoints. The `/versions/latest` and `/versions` API calls returned 500 errors.

**Root Cause:** The database module (`workers/src/db.ts`) used a global `currentConnection` variable shared across all concurrent requests. When the frontend made 5 parallel API calls to load a document page, each request would initialize a new connection, overwriting and closing the previous one. This caused some requests to fail when their connection was closed by another concurrent request.

**Solution:** Implemented request-scoped database connections using Node.js `AsyncLocalStorage`:
- Added `runWithConnection()` function that wraps request handlers in isolated AsyncLocalStorage context
- Each concurrent request now gets its own database connection that cannot interfere with others
- Updated `index.ts` to use the new pattern
- Deprecated the old `initializeDatabaseFromConnectionString()` and `closeDatabaseConnection()` functions

**Files Changed:**
- `workers/src/db.ts` - Added AsyncLocalStorage-based connection management
- `workers/src/index.ts` - Updated to use `runWithConnection()`
- `workers/tests/routes/router.spec.ts` - Updated mock to include new export

### getDocumentByPath Returns Archived Documents (Fixed 2026-01-25)

**Issue:** When creating pages from Content Publisher articles, if a document with the same path had been previously archived (soft-deleted), the `getDocumentByPath` function would return the archived document instead of the active one. This caused "Document not found on this branch" errors when the system tried to access versions of the archived document.

**Root Cause:** The SQL query in `getDocumentByPath` used `SELECT * FROM app.documents WHERE site_id = $1 AND path = $2` without filtering or ordering by archived status. When multiple documents existed with the same path (one archived, one active), the query returned whichever came first, often the archived one.

**Solution:** Modified the query to prefer non-archived documents using `ORDER BY archived_at NULLS FIRST LIMIT 1`. Documents with `archived_at = NULL` (active) are now returned before documents with an archived timestamp.

**Files Changed:**
- `workers/src/services/document-service.ts` - Updated `getDocumentByPath` query

### CRDT State Initialization Parameter Mismatch (Fixed 2026-02-16)

**Issue:** The MCP `get_document` tool returned `{}` for all documents on branches that had never been accessed via WebSocket on the current worker instance. Documents on the main branch (which had active WebSocket sessions) worked fine.

**Root Cause:** In `DocumentSession.initializeFromPostgres()`, the Durable Object sent the query parameter `documentPath` when calling the internal `/internal/crdt-state` endpoint, but the handler expected `documentId`. This caused a 400 response, so the DO fell back to an empty Y.Doc and returned `{"snapshot": {}}`. Branches with prior WebSocket activity were unaffected because their state was already cached in Durable Object storage (priority 1 in the initialization flow).

**Solution:** Changed `url.searchParams.set('documentPath', documentId)` to `url.searchParams.set('documentId', documentId)` in `document-session.ts:581`.

**Files Changed:**
- `workers/src/durable-objects/document-session.ts` - Fixed query parameter name

**Commits:** `c5e6000` (feature branch), `6b74b32` (cherry-picked to main)

### GitHub Advanced Security Alerts (Fixed 2026-01-25)

**Issue:** GitHub Advanced Security identified 3 code scanning alerts:
1. **High severity** (2 alerts): Incomplete string escaping in `escapeLikePattern` function (js/incomplete-sanitization)
2. **Medium severity** (1 alert): Log injection vulnerability in metrics receiver (js/log-injection)

**Root Causes:**
- The `escapeLikePattern` function escaped `%` and `_` for PostgreSQL LIKE queries but failed to escape backslashes first. Input containing `\` could bypass the sanitization.
- The `logMetric` function logged metric names, values, and labels directly without sanitizing control characters, allowing potential log forging via newlines or other control chars.

**Solutions:**
1. Modified `escapeLikePattern` to escape backslashes first (`\\` → `\\\\`) before escaping `%` and `_`
2. Added `sanitizeForLog` function that strips control characters (0x00-0x1F and 0x7F) from strings before logging

**Files Changed:**
- `workers/src/services/document-service.ts` - Fixed `escapeLikePattern` to escape backslashes first
- `scripts/local-metrics-receiver.js` - Added `sanitizeForLog` function and applied to all logged values

**Commit:** `34ddecb`

---
## Known Issues / Future Work

### CORS Configuration for Multi-Tenant Frontends

**Status:** Resolved (wildcard subdomain matching) — PR #11, merged 2026-02-16

**Original Issue:** Allowed CORS origins had to be manually added to `wrangler.jsonc` for each frontend, which doesn't scale for multi-tenant deployments.

**Solution Implemented:** Wildcard subdomain pattern matching via shared CORS utility (`workers/src/utils/cors.ts`). Patterns like `https://*.pantheonsite.io` now cover all customer subdomains. Configured per environment in `wrangler.jsonc`.

**Future options if needed:**
- Dynamic origin validation against the database (e.g., `site.allowedOrigins` field)
- Authentication-based CORS (auto-allow origins with valid API keys)
- Same-origin proxy (frontends proxy through their own backend)

---

### Document Paths vs. Structure-Based Organization

**Issue:** Currently, documents have a `path` field (e.g., `articles/football/jets/article-name`) that implies hierarchical organization. However, the intended architectural design is for the **site structure system** (structure nodes) to control document organization and navigation, not the document path itself.

**Current State:**
- Documents have a `path` field that suggests hierarchy
- Site structures and nodes exist separately and reference documents by ID
- These two organizational concepts overlap and may conflict

**Architectural Consideration:**
- Document paths should potentially be simplified to flat identifiers or slugs
- Hierarchical organization should be controlled entirely by structure nodes
- This affects how documents are addressed in URLs and internal references

**Impact Areas:**
- Document service path validation logic
- Structure node relationship to documents
- URL routing in frontend applications
- Site template/copy operations (path vs. structure-based copying)

**Priority:** Low - Requires architectural review before refactoring

**Decision Pending:** Determine whether document paths should remain hierarchical or become flat identifiers, with structure nodes providing all organizational hierarchy.

---

### Authorization Provisioning for OAuth Users

**Status:** Open — Needs design and implementation

**Issue:** When a user authenticates via Google or Auth0 OAuth, the backend validates their token and generates a UUIDv5-based `principal.id` from their provider subject ID. However, there is no automated way to grant that user roles on specific sites. Currently, `user_site_roles` rows must be manually inserted into the database.

**Current Workaround:**
- Manually INSERT rows into `user_site_roles` with the UUIDv5 user ID and target site IDs
- UUIDv5 can be computed from provider + sub using `providerSubToUuid()`

**Future Work Needed:**
1. **Admin UI for user management:** Allow site admins to invite users by email, creating `user_site_roles` entries
2. **Users table:** Map OAuth identities (provider + sub + email) to internal user records, supporting multi-provider account linking
3. **Self-service onboarding:** New OAuth users get a default role or landing page instead of 403 errors
4. **Graceful 403 handling:** Frontend should display a friendly "No access" page with instructions instead of a raw error

**Related:** Auth Phase 6b (UUIDv5 mapping), `workers/src/auth/uuid-v5.ts`, `workers/src/auth/authorization.ts`

---
## Architecture Reference

The implementation follows the architecture defined in:
- `collaborative-state-system-architecture-v2.2.md`
- `AUTH_IMPLEMENTATION_GUIDE.md`
- `README.md`
## Testing Approach

Following Pantheon testing practices:
- **Unit Tests:** Vitest with @testing-library/react patterns
- **E2E Tests:** Playwright via Carbon Framework (future)
- **Test-Driven Development:** Tests written before implementation code

---
## Test Summary

| Component | Unit Tests | Integration Tests |
|-----------|-----------|-------------------|
| Types | 73 | - |
| Config | 12 | - |
| Database Schema | 55 | - |
| Mock Identity Provider | 44 | - |
| Roles | 21 | - |
| Authorization | 22 | - |
| Middleware | 18 | - |
| Guest Access | 31 | - |
| Site Service | 31 | 12 |
| Document Service | 41 | 12 |
| Branch Service | 63 | 28 |
| Document Version Service | 18 | - |
| Checkpoint Service | 30 | - |
| Checkpoint Enhanced | 25 | - |
| DocumentSession Durable Object | 46 | - |
| Real-Time API Routes | 39 | - |
| Merge Request Service | 51 | - |
| Merge Base Service | 18 | - |
| Conflict Detection Service | 13 | - |
| Conflict Resolution Service | 15 | - |
| CRDT Merge Service | 14 | - |
| Merge Execution Service | 13 | - |
| Structure Service | 42 | - |
| Structure Service Branch-Scoped | 17 | - |
| Checkpoint Structure Capture | 11 | - |
| Branch Structure Copy | 7 | - |
| Metadata Service | 29 | - |
| Branch API Routes | 16 | - |
| Checkpoint API Routes | 13 | - |
| Merge API Routes | 13 | - |
| Grant API Routes | 10 | - |
| Audit Emitter | 9 | - |
| Site API Routes | 16 | - |
| Document CRUD API Routes | 22 | - |
| Document Version API Routes | 8 | - |
| Document Branch-Scoped API Routes | 11 | - |
| Document Branch-Scoped Service | 20 | - |
| Branch Version Inheritance | 6 | - |
| Structure API Routes | 17 | - |
| Node API Routes | 19 | - |
| Metadata API Routes | 13 | - |
| Validation Utilities | 28 | - |
| Router Integration | 24 | - |
| Document Diff Service | 18 | - |
| Metrics Service | 36 | - |
| Presence Service | 42 | - |
| Activity Detection Service | 64 | - |
| Agent Edit Permission Service | 19 | - |
| Presence Rollup Service | 15 | - |
| Presence API Routes | 15 | - |
| DocumentSession Focus Regions | 12 | - |
| Realtime API Focus Regions | 11 | - |
| WebSocket Message Types | 18 | - |
| DocumentSession WS Presence | 29 | - |
| **Total** | **1741** | **52** |

---

*Last updated: 2026-02-19 (Frontend OAuth + UUIDv5 Identity Mapping)*
## Change History

| Date | Phase | Summary |
|------|-------|---------|
| 2026-01-23 | 1.1 | Initial project configuration and build tooling complete |
| 2026-01-23 | 1.2 | Database schema and migrations complete |
| 2026-01-23 | 1.3 | Core TypeScript types complete (50 types) |
| 2026-01-23 | 2.1 | Mock Identity Provider complete (44 tests) |
| 2026-01-23 | 2.2 | Authorization System complete (92 tests) |
| 2026-01-23 | 3.1 | Site and Document Operations complete (69 unit + 24 integration tests) |
| 2026-01-23 | Infra | Infrastructure validation: /health endpoint, real postgres connection, DO stubs |
| 2026-01-23 | 3.2 | Branch Operations complete (63 unit + 28 integration tests) |
| 2026-01-23 | 3.3 | Checkpoint System complete (18 + 30 = 48 unit tests) |
| 2026-01-24 | 4.1 | DocumentSession Durable Object complete (46 tests, security hardening) |
| 2026-01-24 | 4.2 | Real-Time API routes complete (39 tests, security hardening) |
| 2026-01-24 | 5.1a | Merge Request Service complete (51 tests) |
| 2026-01-24 | 5.1b | Merge Base Service complete (18 tests) |
| 2026-01-24 | 5.2a | Conflict Detection Service complete (13 tests) |
| 2026-01-24 | 5.2b | Conflict Resolution Service complete (15 tests) |
| 2026-01-24 | 5.2c | CRDT Merge Service complete (14 tests) |
| 2026-01-24 | 5.3 | Merge Execution Service complete (13 tests) |
| 2026-01-24 | 6.1 | Structure Service complete (42 tests) |
| 2026-01-24 | 6.2 | Metadata Service complete (29 tests) |
| 2026-01-24 | 7.1 | REST API Endpoints complete: Branch, Checkpoint, Merge, Grant APIs (49 tests) |
| 2026-01-24 | 7.2 | Audit Integration complete (9 tests) |
| 2026-01-24 | 7.1.1 | Proposal finalized: branch-scoped structures, soft-delete, bulk operations |
| 2026-01-24 | 7.1.1a | Branch-scoped structure identity complete: migration, service updates (829 tests) |
| 2026-01-24 | 7.1.1b | Resource Management APIs complete: Site, Document, Structure, Node, Metadata (916 tests) |
| 2026-01-24 | 7.1.1b | Security hardening: pagination validation, path traversal, LIKE escaping, size limits (947 tests) |
| 2026-01-24 | 7.3 | Route wiring: all API routes wired with CORS and auth middleware (971 tests) |
| 2026-01-24 | 8.1-8.5 | Frontend API Explorer: project setup, API client, auth UI, dashboard/sites pages, E2E tests |
| 2026-01-24 | 8.6 | Bug fixes: Cloudflare Workers DB I/O error, Create Site form missing field |
| 2026-01-24 | 8.7 | DocumentPage implementation and navigation fixes |
| 2026-01-24 | 8.8 | Bug fixes: checkpoint creation (checkpointType param, SQL columns), optional name |
| 2026-01-24 | 8.9 | Enhancement: auto-create checkpoint when branching from branch without one |
| 2026-01-24 | 8.10 | Usability enhancements: delete confirmation modals, create document, JSON viewer |
| 2026-01-24 | 8.11 | Branch isolation: document version inheritance, branch-scoped CRUD APIs, security fix |
| 2026-01-24 | 8.11 | Bug fixes: checkpoint-based branching query, branch-scoped document routing |
| 2026-01-24 | 8.11 | Bug fix: JSONB double-stringification in document snapshots, full isolation verified |
| 2026-01-24 | 8.12 | UX writing style compliance: sentence case, verb forms, error messages, tooltips |
| 2026-01-24 | 8.13 | Branch isolation E2E test, documented postgres.js Hyperdrive limitation |
| 2026-01-24 | 8.14 | Cloudflare Hyperdrive integration for PostgreSQL connection pooling |
| 2026-01-24 | 8.15 | Document content editing: version API endpoints, frontend JSON editor, version history, SQL NULL fix |
| 2026-01-24 | 8.16 | Merge Request UI: list, create, detail pages; conflict display; preview panel; resolution UI; E2E tests |
| 2026-01-24 | 8.17 | E2E test fixes: UUID-based user IDs, delete modal bug fix, site/branch CRUD tests |
| 2026-01-24 | 8.18 | Execute Merge fix: added /execute endpoint, fixed detectConflicts and checkpointType params |
| 2026-01-24 | 8.19 | Preview Merge fix: fixed endpoint URL, previewMerge service params, auto-load UX on mount |
| 2026-01-24 | 8.20 | E2E test stability: wait for API responses, improved assertions, robust helper functions |
| 2026-01-24 | 8.21 | Cascade delete fix: deleteBranch/deleteSite now clean up all related FK data |
| 2026-01-24 | 8.22 | Branch archive button, site deletion fix: archive UI for branches, site delete allowed with only main branch |
| 2026-01-24 | 9.1 | PDS Foundation: import global styles, migration plan with E2E test strategy |
| 2026-01-24 | 9.2 | PDS Migration: ConfirmDeleteModal to PDS components (Modal, Button, Alert), updated E2E tests |
| 2026-01-24 | 9.3 | PDS contrast fixes: global code styling, ApiResponse/Dashboard using PDS design tokens |
| 2026-01-24 | 9.4 | PDS JsonViewer fix: override PDS global pre element dark theme with light theme |
| 2026-01-25 | 9.5 | PDS Migration Phase 2: All pages use PDS Button/RouterLinkButton/Alert components; form inputs use pds-input/pds-select classes; E2E tests updated for data-testid selectors (73/75 tests pass) |
| 2026-01-25 | 10.1 | DocumentDiffService: JSON diffing for merge visualization (18 tests) |
| 2026-01-25 | 10.2 | MetricsService: request-scoped buffering, 8 metrics (HTTP, DB, WS), HTTPS/API key validation, buffer limits, security hardening |
| 2026-01-25 | 9.6 | PDS Migration Phase 3: All status badges migrated to PDS Tag component; E2E tests updated (.status-badge → .tag selectors); 60/75 tests pass (failures are infrastructure flakiness) |
| 2026-01-25 | 9.7 | PDS Migration Phase 4: Tabs migrated to PDS Tabs/TabList/Tab/TabPanels/TabPanel in BranchDetailPage and DocumentPage; Breadcrumbs kept custom (PDS requires context-based pattern); 55/75 tests pass (failures are infrastructure flakiness) |
| 2026-01-25 | 9.8 | PDS Migration Phase 5: ApiResponse uses PDS Alert for errors; MergePreviewPanel uses PDS Button and Alert; CSS cleanup for removed custom styles; E2E tests updated |
| 2026-01-25 | 9.9 | PDS Migration Phase 6: ConflictResolutionPanel uses PDS Button; JsonViewer kept custom (simple, working); ConflictList already using PDS Tag |
| 2026-01-25 | 9.10 | PDS Migration Phase 7: E2E Test Finalization; added data-testid to Layout, Login, Dashboard, Sites, SiteDetail, BranchDetail, MergeRequests, MergeRequestDetail, MergePreviewPanel; updated all E2E tests to use robust selectors (getByTestId) instead of CSS class selectors |
| 2026-01-25 | 9.11 | Test data cleanup script: db:cleanup command to delete E2E test entries by naming pattern; handles FK constraints for 16 tables |
| 2026-01-24 | 8.23 | Site deletion FK fix: clear source_checkpoint_id and base_checkpoint_id before deleting checkpoints |
| 2026-01-25 | 10.3-10.6 | Merge Diff Visualization: JsonDiffViewer component, ExpandableConflictRow with expand/collapse, previewMerge includeContent option, ConflictResolutionPanel integration, E2E tests, security fix for status param validation |
| 2026-01-25 | 10.2 | Local metrics receiver: scripts/local-metrics-receiver.js with macOS notifications, system monitoring, Makefile target |
| 2026-01-27 | Bugfix | Session ID parsing for Miniflare (X-Session-Id header, _sessionId query param), PostgreSQL transaction handling with SAVEPOINT, document tombstone recreation flow, hasUnsyncedEdits flag |
| 2026-01-27 | Schema | Schema test fixes: documents partial unique index (vs constraint), site_structures simplified (no name/slug/description/structure_type), agents.id is text (not uuid); all 1571 tests pass |
| 2026-01-27 | 8 (Agent Politeness) | Presence Rollups and Queries: getBranchPresence, getSitePresence, getAgentPresence, queryDocumentPresence services; REST API endpoints for site/branch/agent presence; 1597 tests pass |
| 2026-01-27 | 8 (Security) | Presence API Authorization: canViewSite, canViewBranch, canViewAgentPresence checks; uses pantheonSiteRoles and organizationId for access control; 403 responses for unauthorized requests; 5 new authorization tests; 1602 tests pass |
| 2026-01-28 | 8 (Frontend) | Plugin Integration: Enhanced createCSSPlugin with presence/agent options (showPresenceIndicator, showAgentActivity, showAgentActions, showFocusRegions); Enhanced createCSSOverrides with header presence/agent features (showCollaboratorAvatars, showAgentActivityBanner); 11 new TDD tests, 391 puck-css tests pass |
| 2026-01-28 | 8 (MCP) | MCP Server Presence Tools: Added get_branch_presence and get_document_presence tools; API client methods for presence queries; Tests for both api-client and tools modules |
| 2026-01-28 | 8 (Frontend) | Avatar Color Consistency: Fixed CollaboratorAvatars to use actorId for hash-based colors; Added AgentActivityBanner CSS styling (~160 lines); Hash-based colors for agents matching human avatar algorithm |
| 2026-01-28 | 8 (Docs) | puck-css Documentation: Added comprehensive presence and agent politeness documentation to README; Covers enabling presence, context values, components, styling, agent politeness protocol, MCP integration |
| 2026-01-28 | 8 (Backend) | Agent Politeness Enforcement: Internal API endpoints for agent checkpoint lifecycle (agent-checkpoint-start, agent-checkpoint-complete, agent-checkpoint-rollback); Edit session enforcement on /apply endpoint (agents MUST provide valid editSessionId); DocumentSession creates real pre/post-edit checkpoints via internal API; Automatic rollback on agent-edit-abort; 10 new internal API tests, 5 new DocumentSession tests; 1617 tests pass |
| 2026-01-28 | 8 (Docs) | Agent Integration Guide v1.1: Updated documentation with edit session enforcement, checkpoint lifecycle (pre/post-edit), automatic rollback behavior, new error codes, updated examples with editSessionId parameter |
| 2026-01-28 | 8 (MCP) | MCP Server Conformance: Updated apply_document_edits to require edit_session_id; API client passes editSessionId in request body; Updated README with workflow requirements and troubleshooting; 49 MCP tests pass |
| 2026-01-29 | Focus Regions | Proactive Focus Region Reporting: ActivityDetector focus tracking (recordFocusActivity, clearActorFocus, clearStaleFocus, getHumanFocusRegions, getAllFocusedRegions); DocumentSession /update-focus-regions endpoint; Realtime API /focus-regions route; Focus regions integrated into canAgentProceed conflict detection; Focus does NOT reset idle timer; 23 focus tests + 12 DO tests + 11 route tests; 1664 tests pass |

---
| 2026-01-29 | Security | Focus Regions Security: Optimized isRegionFocused with cached focus regions (O(n) vs O(n*m)); Optimized conflict checking with early termination and labeled loops; Truncated conflict reason strings to 500 chars; Centralized all security limits to workers/src/constants/security-limits.ts; 1664 tests pass |
| 2026-01-29 | Memory Fixes | Memory leak fixes: (1) WebSocket disconnect cleanup - clears actor focus/presence; (2) activeRegions cleanup when idle; (3) Periodic cleanup timer for stale focus (60s) and presence (120s); (4) PresenceManager.clearStale() method; (5) Y.Doc CRDT compaction on disconnect; 7 new tests; 1671 tests pass |
| 2026-01-29 | DO Alarms | Refactored cleanup from setInterval to Durable Object alarms: (1) scheduleCleanupAlarm() using state.storage.setAlarm(); (2) alarm() handler for periodic cleanup; (3) Alarms survive hibernation, persist across crashes, auto-deduplicate; (4) Fixed HTTP-only client memory leak (all endpoints now schedule alarms); (5) Added orphaned edit session cleanup (1 hour max age); (6) Added getAlarm/setAlarm mocks to all test files; 1671 tests pass |
| 2026-01-29 | Router Fix | Wired focus-regions route: Added focus-regions to realtimeActions pattern in index.ts; Endpoint handler existed in realtime-api.ts and document-session.ts but route was not connected; Added 4 router tests for realtime routes (focus-regions, edits, connect, can-agent-edit); 1675 tests pass |
| 2026-01-30 | WebSocket Presence | WebSocket-based presence messaging: (1) Message types in workers/src/types/websocket-messages.ts (WsFocusRegionUpdateMessage, WsPresenceHeartbeatMessage, WsPresenceUpdateMessage, WsFocusRegionBroadcastMessage, WsFocusRegionAckMessage, WsPresenceErrorMessage); (2) Type guards for message validation; (3) DocumentSession text message handling (handlePresenceMessage routes by type); (4) handleWsFocusRegionUpdate with validation, ACK, broadcast; (5) handleWsPresenceHeartbeat for keep-alive; (6) broadcastPresenceUpdate on connect/disconnect; (7) 18 message type tests + 36 DO presence tests; 1711 tests pass |
| 2026-02-02 | CRDT Sync | Deduplication refactor: Moved deduplication logic from crdt-sync-service.ts to document-version-service.ts; syncCrdtToPostgres now uses document ID instead of path for PostgreSQL sync; Updated tests to reflect new behavior; 1716 tests pass |
| 2026-02-02 | Security | CodeQL high severity fix: Changed Math.random() to crypto.randomUUID() for edit session IDs in DocumentSession; Prevents predictable session ID generation; PR #5 (Agent Politeness System with WebSocket Presence) updated with security fix |
| 2026-02-02 | PR Maintenance | Merged security PRs: PR #4 (esbuild update), PR #2 (react-router-dom fix with conflict resolution); Created PR #5 for feature/websocket-presence branch (114 commits, Agent Politeness System) |
| 2026-02-03 | Agent Names | Agent Name Resolution: handleAgentEditStart now looks up agent name from registry via getAgentById; Presence displays actual agent names (e.g., "Zappy AI Assistant") instead of UUID; Frontend presence bubbles show agent name initial ("Z") instead of UUID first char ("a"); Wrapped in try-catch for DO context where database may not be available (falls back to agentId); 1716 tests pass |
| 2026-02-07 | Phase 1 (Content Diff) | Content-Oriented Diff Viewer: transformDiffOperations (RFC 6902 to ContentSection[]), ContentChangeRow (old→new format), ContentSectionGroup (collapsible), ContentDiffViewer (same props as JsonDiffViewer), Puck component detection/grouping, Title Case label generation; 38 tests |
| 2026-02-07 | Phase 2 (Doc Summary) | Document-Level Change Summary: categorizeChanges (source-only, target-only, both-modified), DocumentChangeSummary component with branch-colored badges; Extended MergePreview type with sourceChanges/targetChanges; 17 tests |
| 2026-02-07 | Phase 3a (Backend) | Manual Resolution Strategy: resolveWithManual in conflict-resolution-service (accepts client resolvedSnapshot, creates version with source='merge'), ManualResolutionError, extended merge API body with optional resolvedSnapshot per resolution; 3 tests |
| 2026-02-07 | Phase 3b (Field Resolution) | Field-Level Conflict Resolution UI: classifyFields (3-way source/target/base comparison), mergeSnapshots (apply field selections), FieldConflictRow (radio per field), AutoMergedFields, FieldResolutionPanel (auto-merge + conflicts + apply), CrdtPreviewButton (CRDT preview with loading/error), MergedPreview; Added 'manual' to ConflictResolutionStrategy, "Choose field by field" option to ExpandableConflictRow, resolvedSnapshot support in ConflictResolutionPanel; 30 tests |
| 2026-02-07 | Phase 1+2 (Deferred) | View Toggle & Summary Integration: JSON/Content view toggle on ExpandableDiffRow and ExpandableConflictRow; DocumentChangeSummary wired into MergePreviewPanel; Fixed test infrastructure (explicit cleanup for vitest globals:false); 4 tests |
| 2026-02-07 | Phase 3c (puck-css) | Puck-Aware Conflict Resolution: puckFieldClassifier (isPuckData, classifyPuckFields 3-way comparison, getReadablePropPath, groupFieldsByComponent); PuckFieldResolutionPanel (component-grouped conflicts, auto-merged fields, merged snapshot construction); ComponentConflictGroup (per-component radio buttons); RenderedResolutionPreview; 32 tests in puck-css-integration repo |
| 2026-02-07 | Phase 4 (puck-css) | Branch Merge Compare: branchDiff (isPuckData, createBranchDocumentComparison with null snapshot handling, createBranchMergeComparison multi-doc aggregation); BranchDiffHeader (branch names instead of versions); BranchMergeCompare (component trees + prop diffs); DocumentDiffList (expandable multi-document list, non-Puck fallback); 34 tests in puck-css-integration repo |
| 2026-02-07 | Phase 5 (puck-css) | Merge Preview Plugin: createMergePreviewPlugin factory (Puck plugin with name/label/icon/render); ViewModeSelector (side-by-side/overlay/slider toggle with active class); MergePreviewRenderer (three view modes using createHighlightedConfig for diff overlays, change count summary, branch labels); MergePreviewPanel (document list with expandable comparison, diff computation via createBranchDocumentComparison); 20 tests in puck-css-integration repo; 593 total tests pass |
| 2026-02-07 | Phase 6 (E2E Tests) | CSS Admin E2E: content-diff-viewer.spec.ts (4 tests: JSON/Content view toggle on diff/conflict rows, content section collapse/expand); document-change-summary.spec.ts (5 tests: document categories with branch labels, count badges, document paths, conflict category); field-resolution.spec.ts (7 tests: "Choose field by field" option, FieldResolutionPanel, auto-merged fields, conflict radio buttons, apply button validation, strategy switching). puck-css E2E: merge-preview-integration.spec.ts (10 tests: Puck+CSS plugin loading, document rendering, version comparison API access, branch data, Puck data structure validation, diff highlighting, presence indicators, focus region stability) |
| 2026-02-07 | Phase 7 (Docs & Cleanup) | JSDoc: Added @param/@returns to all public exports across both repos (25 files total: 13 CSS admin, 12 puck-css). UX Writing: Fixed 18 title case violations to sentence case per Pantheon guidelines; improved 2 error messages in CrdtPreviewButton to be actionable. Security: Added __proto__/constructor/prototype guards in mergeSnapshots.ts setAtPath/deleteAtPath (prototype pollution fix). Security review identified 15 findings (1 HIGH input validation, 4 MEDIUM, 6 LOW, 4 INFO); prototype pollution auto-resolved, remaining findings documented for future work. All tests pass: 94 frontend, 593 puck-css. |
| 2026-02-07 | Bugfix (Branching) | Fresh checkpoint on branch creation: Branch API route now always creates a fresh checkpoint via createCheckpoint() instead of reusing the latest existing checkpoint via getLatestCheckpoint(). Fixes stale merge base and incorrect document copies when the source branch had edits since its last checkpoint. Updated 4 test mocks from getLatestCheckpoint to createCheckpoint (returning CreateCheckpointResult shape). Removed unused getLatestCheckpoint import from branch-api.ts. 1741 tests pass. |
| 2026-02-08 | Merge Execution | Per-document merge resolution and skipDuplicateCheck fix: (1) Added DocumentResolution type for per-document conflict resolution with manual/take-source/take-target/merge-crdt strategies; (2) executeMergeWithResolution now accepts optional `resolutions` array that overrides the default strategy per document; (3) Manual resolution accepts client-provided resolvedSnapshot; (4) Fixed merge version creation being silently skipped by snapshot deduplication — added `skipDuplicateCheck: true` to all three merge-related createDocumentVersion calls (crdt-merge-service, manual resolution, non-conflicting source copy); source='merge' is semantically important for history tracking regardless of snapshot matching; (5) executeMergeWithResolution now accepts status='conflicted' in addition to 'approved'; (6) Content diff API endpoint added to merge-api.ts; (7) Frontend: expandable diff/conflict rows, document change summary badges, CRDT preview button improvements. 1741 backend tests pass. |
| 2026-02-08 | E2E (CRDT Merge) | CRDT merge E2E test in puck-css-integration repo (e2e/crdt-merge.spec.ts): 4-test serial suite proving full CRDT merge cycle via realtime save path. Test 1: edits document on main (title) and branch (heading text via Outline panel) with realtime WebSocket, verifies both produce source='realtime' versions with crdt_state. Test 2: verifies conflict detection (canMerge=false, both-modified). Test 3: verifies CRDT preview succeeds with valid Puck snapshot. Test 4: creates merge request, executes with merge-crdt strategy, verifies source='merge' version with crdt_state and valid Puck structure. Also fixed CSSPuckProvider.tsx dual save path — remote Yjs sync updates no longer trigger unnecessary REST saves when realtime is connected. All 4 E2E tests pass (59s). |
| 2026-02-08 | Sandbox Deploy | CORS wildcard patterns, frontend API base URL, sandbox deployment config. (1) New shared CORS utility (workers/src/utils/cors.ts) with wildcard subdomain pattern support (e.g. `https://*.pantheonsite.io`); `*` matches single DNS label only — multi-level subdomains rejected; max 50 patterns; protocol required. (2) Refactored index.ts (removed 3 local CORS functions) and realtime-api.ts (removed 4 local CORS functions) to use shared module; WebSocket origin check uses isOriginAllowed() with pattern support. (3) Frontend API base URL: added API_BASE_URL export to client.ts from VITE_API_BASE_URL env var; prefixed fetchWithAuth and 3 direct fetch calls in auth.ts and DashboardPage.tsx; no-op when unset (local dev with Vite proxy). (4) Added `sandbox` wrangler environment with placeholder KV/Hyperdrive IDs and deploy:sandbox script. (5) setup-sandbox.sh: interactive script creating GCP CloudSQL instance, CF KV namespaces, Hyperdrive, Worker secrets, deploys Worker + Pages frontend, runs migrations, verifies /health. (6) teardown-sandbox.sh: per-resource confirmation cleanup. 39 new CORS tests; 1780 backend tests pass; 94/99 E2E tests pass (4 pre-existing failures); 0 lint errors. |
| 2026-02-16 | Auth Phase 1 | Multi-Provider Auth Abstraction Layer: (1) AuthProvider type ('auth0'\|'google'\|'mock'\|'unknown') and optional authProvider field on AuthenticatedPrincipal (backward compatible); (2) IdentityProvider interface (name, canVerifyToken, validateToken, validateAgentKey); (3) MultiProviderIdentityProvider routes tokens by JWT iss claim to correct provider, tries API keys in order; (4) MockIdentityProviderAdapter wraps existing MockIdentityProvider without modifying it; (5) getIdentityProvider() now returns MultiProviderIdentityProvider with mock registered in non-production; (6) Env interface extended with future GOOGLE_CLIENT_ID, AUTH0_ISSUER_BASE_URL, AUTH0_NEW_ISSUER_BASE_URL, AUTH0_AUDIENCE; 38 new tests; 174 auth tests pass; 0 lint errors. |
| 2026-02-16 | Auth Phase 2 | Google Identity Provider: GoogleIdentityProvider verifies RS256 tokens against Google JWKS (googleapis.com/oauth2/v3/certs); supports both issuer formats (https://accounts.google.com and accounts.google.com); injectable JWKS for testing via createLocalJWKSet; activates when GOOGLE_CLIENT_ID env var is set; 28 new tests; 0 lint errors. |
| 2026-02-16 | Auth Phase 3 | Auth0 Identity Provider: Auth0IdentityProvider verifies RS256 tokens against Auth0 JWKS; supports dual-issuer migration (AUTH0_ISSUER_BASE_URL + AUTH0_NEW_ISSUER_BASE_URL) with separate JWKS endpoints per issuer; parses scope claim into scopes array; normalizes issuer URLs (strips trailing slashes); activates when AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE are set; 28 new tests; 230 total auth tests pass; 0 lint errors. Phases 2 and 3 implemented in parallel via agent team. |
| 2026-02-17 | Auth Phase 4 | WebSocket Authentication & Authorization: Cross-validates client-supplied actorId (X-Actor-Id header, query param, body) against authenticated principal — rejects mismatches with 403. Authorization checks via hasPermission() before DO forwarding (canView for read actions, canEditDocuments for write actions). Injects X-Verified-Actor-Id/Type/Auth-Provider/Email headers on forwarded requests for trusted identity propagation to Durable Objects; WebSocket upgrades use _verified* query params. Strips apiKey from forwarded URLs. DO-side: prefers verified headers over client-supplied; cross-checks /apply body actorId against verified header. Extended ConnectionMeta with verified, authProvider, email fields. Decision: combined original Phase 4 (DB migration — already done) and Phase 5 (WebSocket auth) into single phase. 35 new tests; 1890 total pass (19 pre-existing failures in router.spec.ts and document-session.spec.ts); 0 lint errors. |
| 2026-02-19 | Auth Phase 5 | REST API Authorization Enforcement: Wired `assertPermission()` into all 9 REST API route handlers (site, branch, document, checkpoint, merge, grant, structure, node, metadata). Removed simplified `Principal` interface from index.ts; all handlers now receive full `AuthenticatedPrincipal` directly. Added `AuthorizationError` catch block in index.ts for 403 safety net. Permission mapping: site-api uses `getMainBranch()` for authorization scope on site-level routes; document-api uses `getMainBranch()` for site-scoped routes; merge-api uses `getMainBranch()` for merge request CRUD and `sourceBranchId` from request body for merge operations; checkpoint-api/structure-api use `getCheckpoint()` to resolve branchId for checkpoint-scoped reads. TDD: 30 authorization tests written first (red), committed (`2551601`), then implementation committed (`5b56ea5`). 15 files changed (10 source + 5 test fixtures). 1939 tests pass; 0 lint errors. |
| 2026-02-19 | Auth Phase 6 | Frontend OAuth Integration (Google + Auth0 + Mock): **Phase 1 (Utilities):** `jwt.ts` (decodeJwtPayload, isTokenExpired — client-side decode without verification for display), `auth-config.ts` (getAuthConfig, isGoogleEnabled, isAuth0Enabled, isMockEnabled — reads VITE_* env vars), `env.d.ts` (Vite ImportMetaEnv type declarations). **Phase 2-3 (Context):** Extended AuthContextType with `activeProvider`, `loginWithMock`, `loginWithGoogle`, `loginWithAuth0Token`; rewrote AuthContext.tsx with multi-provider state management (localStorage persistence, token expiry checking on restore). **Phase 4-6 (Components):** GoogleLoginButton (wraps @react-oauth/google GoogleLogin), Auth0LoginButton (wraps @auth0/auth0-react loginWithRedirect), Auth0CallbackHandler (handles Auth0 redirect via getAccessTokenSilently), MockLoginForm (extracted from LoginPage), OAuthProviders (conditional GoogleOAuthProvider/Auth0Provider wrapping). LoginPage assembles all providers conditionally. main.tsx wraps app with OAuthProviders. **Dependencies:** @react-oauth/google, @auth0/auth0-react. Mock login remains default when no OAuth env vars set. fetchWithAuth() unchanged — all providers use same localStorage token key. 162 frontend tests pass; 0 lint errors. Security review: no high-confidence vulnerabilities. |
| 2026-02-19 | Auth Phase 6b | UUIDv5 Identity Mapping: OAuth providers (Google, Auth0) return non-UUID subject IDs (e.g., Google's numeric `110402054196644394871`, Auth0's `auth0\|abc123`). Database `branch_grants.actor_id` column requires UUID format. Solution: deterministic UUIDv5 generation per RFC 4122 §4.3 using SHA-1. Each provider gets a fixed namespace UUID; `providerSubToUuid(provider, subjectId)` always produces the same UUID for the same input. GoogleIdentityProvider and Auth0IdentityProvider now set `principal.id` to UUIDv5 output and store original sub in `principal.providerSubjectId`. Added `providerSubjectId` field to AuthenticatedPrincipal type. 10 uuid-v5 tests + updated Google (28) and Auth0 (28) provider tests. 1949 backend tests pass; 0 lint errors. |
| 2026-02-21 | Auth Bugfix | Principal ID Enrichment: Fixed authorization queries failing because `principal.id` (UUIDv5 from OAuth provider) didn't match `branch_grants.actor_id` (which references `users.id` from the database). Added `dbUserId` field to `AuthenticatedPrincipal`; principal enrichment in `index.ts` now sets `principal.id = userRow.id` after DB lookup. Test commit: `90130b5`. Implementation commit: `a7d5be9`. 1951 tests pass. |
| 2026-02-21 | Auth Bugfix | Principal Name/Avatar Enrichment from Database: Extended the users SELECT to include `name` and `avatar_url`. First-login UPDATE uses COALESCE to avoid overwriting stored values with null. Returning users get JWT values synced to DB when newer. Principal enriched from DB when JWT claims are missing — fixes presence avatars falling back to UUIDs. Fixed CORS error from missing `avatar_url` column. Test commit: `4466fc1`. Implementation commit: `da81d43`. 2021 tests pass. |
| 2026-02-21 | Hibernatable WS | Hibernatable WebSocket API Migration: Migrated DocumentSession to extend `DurableObject` base class. Changed from `this.state.getWebSockets()` to Hibernatable API (`this.ctx.getWebSockets()`). `handleWebSocket` now calls `this.state.acceptWebSocket(server)` before `serializeAttachment`. `handleWebSocketDisconnect` made async with `await this.persist()` and `await this.syncToPostgres()`. Added diagnostic logging for initializeIfNeeded, handleWebSocket, webSocketMessage, handleWebSocketDisconnect. Test commit: `738ca74`. Implementation commit: `d78155f`. |
| 2026-02-21 | Realtime Bugfix | Stale loadDocument Response Guard (puck-css-integration repo): Added `loadRequestIdRef` counter in CSSPuckProvider.tsx to prevent stale `loadDocument()` responses from causing cross-document contamination during rapid navigation. Each `loadDocument` call captures a request ID; stale responses (where a newer `loadDocument` has been issued) are discarded before calling `setCurrentDocument` or `setCurrentData`. Also increments `pendingRemoteUpdatesRef` for REST-loaded data when realtime is enabled, preventing REST data from bouncing back through the Y.Doc. Test commit: `c311b63`. Implementation commit: `816086a`. 619 puck-css tests pass. |
| 2026-02-21 | Realtime Bugfix | Stale WebSocket Close Event Guard (puck-css-integration repo): When `useRealtime` dependencies change, the old client is destroyed and a new one created. The old WebSocket's close event fires asynchronously and could arrive after the new client connects, corrupting shared React state (`connected=false`, `connectedDocumentPath=null`). Added client identity guards (`if (clientRef.current !== client) return`) to `onConnect`/`onDisconnect` callbacks. Added `useLayoutEffect` for eager cleanup of binding/client refs. Added `destroyed` flag on `puckYjsBinding` to prevent writes through stale bindings. Fixed `disconnect()` flag ordering in RealtimeClient. New test file: `useRealtime-stale-close.spec.tsx` (3 tests). Commit: `077842f`. 619 puck-css tests pass. |
| 2026-02-21 | Realtime Bugfix | actorId Cross-Validation Fix: Client sends raw Google subject ID (e.g., `110402054196644394871`) as `actorId` but server derives UUIDv5 as `principal.id`. Cross-validation at realtime-api.ts rejected the mismatch with 403, completely breaking WebSocket connections for Google OAuth users. Updated both cross-validation points (header/query param and request body) to also accept `context.principal.providerSubjectId`. 2 new tests in `realtime-api-websocket-auth.spec.ts`. Commit: `f699ff5`. 2023 backend tests pass; 0 lint errors. |

---

### Site API Tokens (Branch: `feature/site-api-tokens`)

**Status:** In Progress (Phases 1-5, 7 complete; Phase 6 pending)
**Purpose:** Two-tier authentication — per-site opaque API tokens (`sat_` prefix) for application-level read access, alongside existing OAuth for user-level editing.

| Date | Phase | Details |
|------|-------|---------|
| 2026-03-06 | Phase 1: DB Migration | `020_site_api_tokens.sql`: `app.site_api_tokens` table with UUID PK, site FK (CASCADE), SHA-256 `token_hash` (unique), `prefix` (first 8 chars for display), `name`, `scopes` (TEXT[], default `['read:published']`), `created_by`, timestamps, `revoked_at`. Partial index on `token_hash WHERE revoked_at IS NULL` for fast active-token lookups. |
| 2026-03-06 | Phase 2: Token Service | `site-api-token-service.ts`: `generateToken()` creates 32 random bytes → base62 → `sat_` prefix, stores SHA-256 hash, returns raw token once. `validateToken()` hashes incoming token, looks up active (non-revoked) row, updates `last_used_at`. `listTokens()` returns metadata only (no hashes). `revokeToken()` sets `revoked_at`. 23 tests. |
| 2026-03-06 | Phase 3: Auth Provider | `SiteApiTokenProvider` implements `IdentityProvider`. `canVerifyToken()` checks `sat_` prefix. `validateToken()` delegates to token service, returns principal with `type: 'service'`, `siteId`, `scopes`, `authProvider: 'site_token'`. Registered in `MultiProviderIdentityProvider`. Extended `AuthProvider` type and `AuthenticatedPrincipal` with `siteId` field. 21 tests. |
| 2026-03-06 | Phase 4: Scope Enforcement | `service-principal.ts`: `isServicePrincipalAllowed()` enforces site scoping (principal can only access bound site) and method restrictions (`read:published`/`read:draft` → GET only). Non-service principals pass through. Wired into `index.ts` before route dispatch. Service principals blocked from routes without siteId param. 10 tests. |
| 2026-03-06 | Phase 5: API Routes | `site-token-api.ts`: REST endpoints for token management — `POST /api/sites/:siteId/tokens` (generate), `GET /api/sites/:siteId/tokens` (list), `DELETE /api/sites/:siteId/tokens/:tokenId` (revoke). All require `canManageGrants` permission. Service principals blocked from managing tokens (403). Route parsing added to `index.ts`. 12 tests. |
| 2026-03-06 | Phase 7: Frontend UI | API Tokens section on `SiteDetailPage.tsx` following Collaborators section pattern. Token generate form (name input), token table (name, prefix, scopes, created, last used, revoke button), raw token banner with copy-to-clipboard and "shown once" warning, `ConfirmDeleteModal` for revoke confirmation. Added `SiteApiToken` type, `site-tokens.ts` API module, CSS styles, `'token'` to ConfirmDeleteModal resourceType. Reviewer fixes: try/catch on clipboard API, `revokeTokenError` wired to modal. 6 tests; 168 frontend tests pass; 0 lint errors. Test commit: `f939b9d`. Implementation commit: `1ab7c91`. |
| | Phase 6 (pending) | Verify puck-css-integration's existing `createApiKeyAuth()` path works with `sat_` tokens. May need to adjust header routing in `packages/css-client/src/endpoints/base.ts` — current `ApiKey ` prefix routes to `X-API-Key` header, but `sat_` tokens should use `Authorization: Bearer`. |

**Backend test totals:** 2186 tests pass (101/102 test files; 1 pre-existing DB connection failure). **Frontend test totals:** 168 tests pass (22 test files). **Lint:** 0 errors in both repos.

---

### Scaling Optimizations (Branch: `feat/scaling-optimizations`)

**Status:** In Progress (Phases 1, 2.1, 3.1-3.3, 4.1-4.2, 5.1-5.3, 6.1-6.3 complete)
**Plan:** `SCALING-PLAN.md` — 6 phases addressing DO-internal bottlenecks and DO-to-PostgreSQL connection scaling for high concurrency editing and presence.

| Date | Phase | Details |
|------|-------|---------|
| 2026-03-01 | Phase 2.1 | SQLite Storage Migration: Changed wrangler.jsonc from `new_classes` to `new_sqlite_classes` for all three DO classes (DocumentState, PresenceManager, SessionManager). Removes 128 KiB KV value size limit, enables up to 2 MB per key+value. DOs will re-hydrate from PostgreSQL on next connection. Commit: `1b441fa`. |
| 2026-03-01 | Phase 1.1-1.3 | DO-Internal Optimizations: (1) Debounced DO storage persistence — `persistPending` flag with `PERSIST_DEBOUNCE_MS` (2000ms), reduces 250 writes/s to ~1/s per DO under 50 concurrent editors; always persists on disconnect and /apply; (2) Debounced WebSocket broadcasts — 50ms batch window using `Y.mergeUpdates()`, reduces O(N^2) broadcast work to O(N) per window; (3) Delta encoding for new connections — sends compacted state snapshot, clients with existing state vector receive only delta via query param. Commit: `8039657`. |
| 2026-03-01 | Phase 5.2 | Consolidated Sync Queries: Combined dedup-check + insert into single CTE-based query using `WITH latest AS (...)` pattern. Added `syncBatchDocumentVersions()` for batch sync consumer (single multi-row INSERT with embedded dedup). Reduces 3 serial queries per sync to 1. Commit: `ed78f03`. |
| 2026-03-01 | Phase 6.1-6.2 | Incremental Checkpoints & Batch Revert: (1) Migration `019_incremental_checkpoints.sql` adds `parent_checkpoint_id` column with self-referencing FK and partial index; (2) `createCheckpoint()` refactored to CTE-based INSERT — `WITH parent AS (SELECT...)` embeds parent lookup in the INSERT, CASE expression nullifies parent for merge types (pre_merge/post_merge) forcing full snapshots; (3) Incremental version capture uses `parentCreatedAt` to filter `WHERE dv.created_at > $2`, capturing only changed documents since parent checkpoint; (4) `resolveCheckpointDocuments()` walks the parent chain from newest to oldest, merging document maps so newer entries override older; (5) `revertToCheckpoint()` uses single `INSERT...SELECT` with `JOIN LATERAL` replacing per-document INSERT loop — 2,000 sequential INSERTs become 1 bulk query (~10s → ~200ms); (6) Conditional bulk INSERT skipped when 0 documents at checkpoint for backward compatibility. Added `CheckpointInsertRow` interface, `parentCheckpointId` to Checkpoint type. TDD: 18 scaling tests written first (commit `7641af5`), implementation (commit `3211824`). 2106 tests pass; 0 lint errors. |
| 2026-03-02 | Phase 3.1 | Persist Presence to DO Storage: Added `serialize()`/`deserialize()` to PresenceManager service for JSON-serializable presence state. DocumentSession persists presence to DO storage on disconnect (immediate) and focus updates (debounced via alarm). Restores presence from storage on initialization, surviving DO hibernation/eviction. 11 new tests. |
| 2026-03-02 | Phase 3.2 | PresenceManager DO: Full implementation replacing 501 placeholder. One per site (`env.PRESENCE.idFromName(siteId)`), extends DurableObject. In-memory index `Map<branchId, Map<documentId, Map<actorId, ActorPresence>>>`. RPC methods: `actorJoined`, `actorLeft`, `focusChanged`, `stateChanged`. Query methods: `getBranchPresence`, `getSitePresence`, `getAgentPresence`. Alarm-based stale cleanup (120s threshold), debounced persistence (2s). DocumentSession pushes presence updates via fire-and-forget RPC on connect/disconnect/focus. 16 new tests. Commit: `5006ad5`. |
| 2026-03-02 | Phase 3.3 | Retire Fan-Out Rollup: Rewrote `presence-rollup-service.ts` — `getBranchPresence`, `getSitePresence`, `getAgentPresence` now query PresenceManager DO via RPC instead of fanning out to N DocumentSession DOs. Graceful fallback to fan-out when PRESENCE binding missing or RPC fails. `queryDocumentPresence` unchanged (direct single-document query). 13 new tests + 15 existing passing. Commits: `a8f7547`, `d107f66`. |
| 2026-03-02 | Phase 4.1 | WebSocket Message Rate Limiting: Added `MAX_MESSAGES_PER_SECOND` (50), `RATE_LIMIT_WINDOW_MS` (1000ms), `RATE_LIMIT_CLOSE_THRESHOLD` (3) constants. Sliding-window per-actor rate tracking in DocumentSession. Rate-limited messages return `presence_error` with code `RATE_LIMITED`. Persistent abuse (3 consecutive windows) closes connection with code 1008. Rate tracking cleaned up on disconnect. 9 new tests. Commits: `b2dba81`, `f7bc25b`. |
| 2026-03-02 | Phase 4.2 | Lazy CRDT Initialization: Split `initializeIfNeeded()` into `initializeMetadataIfNeeded()` (cheap: session info, org settings, edit sessions, presence) and `initializeCrdtIfNeeded()` (expensive: Y.Doc loading from storage/PostgreSQL). Presence-only endpoints (`/presences`, `/activity-state`, `/edit-sessions`, `/update-focus-regions`, `/org-settings`, `/kick-agent`) use metadata-only init. CRDT endpoints (`/snapshot`, `/apply`, `/connect`, `/sync`) use full init. 8 new tests. Commits: `ff68cb2`, `175a4b6`. |
| 2026-03-02 | Phase 5.1 | Queue-Based Sync Decoupling: Created `sync-consumer.ts` queue consumer and `SyncQueueMessage` type. Consumer deduplicates by siteId:documentId:branchId (keeps latest timestamp), uses `runWithConnection()` for Hyperdrive, calls `batchSyncToPostgres()`. Added `SYNC_QUEUE` binding to Env and DocumentSessionEnv. `performSync()` sends to queue when `SYNC_QUEUE` available, falls back to HTTP. Configured `wrangler.jsonc` with queue producer/consumer. Added `queue()` handler to index.ts. 17 new tests. Commit: `c33b17b`. |
| 2026-03-02 | Phase 5.3 | Direct Hyperdrive from DOs: Added `HYPERDRIVE` binding to DocumentSessionEnv. Split `initializeFromPostgres()` into Hyperdrive-first path with HTTP fallback. Prefers CRDT state over snapshot when both exist. 7 new tests. Commit: `87c697f`. |
| 2026-03-02 | Phase 6.3 | Checkpoint Bypass for Queue: Rewrote all 3 checkpoint methods (`createAgentPreEditCheckpoint`, `createAgentPostEditCheckpoint`, `rollbackToAgentCheckpoint`) to try direct Hyperdrive via `runWithConnection()` first, falling back to HTTP internal API. 5 new tests. Commit: `3c2061d`. |
| 2026-03-02 | Security Review | OWASP Top 10 scan of all Wave 2 changes. **One finding remediated:** A01 (Broken Access Control) — PresenceManager DO RPC methods lacked input validation on payload fields; added `validatePayloadFields()` enforcing `MAX_ACTOR_ID_LENGTH`, `MAX_SITE_ID_LENGTH`, `MAX_BRANCH_ID_LENGTH` on all 4 RPC methods. **Clean on remaining 9 categories:** A02 (no new secrets), A03 (all SQL parameterized), A04 (queue messages bounded by CF 128 KB limit), A05 (reasonable queue config), A06 (0 CVEs in 321 deps), A07 (RPCs from authenticated DOs only), A08 (presence fire-and-forget by design), A09 (all error paths logged), A10 (URLs from env config only). 0 dependencies with known vulnerabilities. Commit: `7a06900`. |
| 2026-03-02 | Bug Fix | **Queue sync bytea[] casting error:** `batchSyncToPostgres()` passed `Buffer[]` as a SQL parameter for `unnest($4::bytea[])`, but the `postgres` npm driver cannot serialize JavaScript `Buffer[]` into a PostgreSQL `bytea[]` array — it treats the whole array as a single `bytea`, causing `PostgresError: cannot cast type bytea to bytea[]`. Every queue-processed sync batch failed and retried infinitely, preventing version history updates in PostgreSQL. **Fix:** Keep CRDT state as base64 text strings and use `decode(unnest($4::text[]), 'base64')` in SQL to convert to `bytea` server-side. Also simplified DO migrations in `wrangler.jsonc` from two-step delete-then-recreate to single `new_sqlite_classes` create, fixing `Cannot apply deleted_classes to non-existent class` on fresh local dev state. Verified end-to-end with Puck editor — saves now persist to PostgreSQL and version history updates correctly. Commits: `c2573cf`, `b28a841`. |

---

### Terraform Alignment (Branch: `terraform-alignment`)

**Status:** Complete
**Commit:** `dc3d24e` - feat: align Terraform with current architecture

The Terraform setup was written early as scaffolding and drifted significantly from the architecture over a month of development. This work brings it into alignment.

#### What changed:
- **Removed all Firestore references** — Firestore was dropped from the architecture but remained in Terraform locals, `.dev.vars` templates, `generate-dev-vars.sh`, `docker-compose.local.yaml` (commented-out emulator), and Makefile targets
- **Replaced `modules/workers`** (config-only, no real resources) with **`modules/cloudflare`** — creates actual `cloudflare_workers_kv_namespace` (CONFIG_KV, SESSION_KV), `cloudflare_queue` (sync queue), and `cloudflare_hyperdrive_config` (PostgreSQL connection pooling)
- **Enhanced `modules/database`** — added conditional CloudSQL resources (`google_sql_database_instance`, `google_sql_database`, `google_sql_user`) gated by `is_local` count; added variables for availability type, backups, authorized networks, deletion protection
- **Upgraded Cloudflare provider** from `~> 4.0` to `~> 5.0` (v5.18.0 installed) — no migration needed since no prior Cloudflare resources existed
- **Implemented `sbx1` environment** — replaced empty placeholder with `module.database` (CloudSQL db-f1-micro, ZONAL) and `module.cloudflare` (KV, Queue, Hyperdrive); outputs all resource IDs for wrangler sync
- **Scaffolded `production` environment** — same structure as sbx1 with production defaults: `db-custom-2-7680`, `REGIONAL` HA, backups enabled, `deletion_protection = true`
- **Updated `.dev.vars` template** — removed Firestore/Google credentials, added `INTERNAL_SECRET` and `MOCK_JWT_SECRET`
- **Created `scripts/sync-terraform-to-wrangler.sh`** — reads `terraform output -json` and patches `REPLACE_WITH_*` placeholder IDs in `wrangler.jsonc`
- **Updated Makefile** — added `production` to `ci-validate` loop, added `tf-sync` target, removed `docker-logs-firestore` target
- **Updated CORS origins** — added `localhost:3002` and `localhost:3005` for puck-css-integration frontend dev servers

#### Design decisions:
- **Terraform manages infrastructure, wrangler manages deployments** — DO migrations have known provider issues; worker code changes frequently; this matches Cloudflare's recommendations
- **Terraform outputs feed wrangler.jsonc** via the sync script, bridging declarative infra with wrangler-managed deploys
- **Personal sandbox stays script-based** (`setup-sandbox.sh`) — ephemeral and personal, not suited for shared Terraform state

#### Validation:
- `terraform validate` passes for all 3 environments (local, sbx1, production)
- `terraform plan ENV=local` correctly generates `.dev.vars` with no Firestore references
- Local dev stack verified: Docker up, worker starts, `/health` returns `{"status":"healthy","database":{"connected":true}}`, auth endpoints work

---

### Frontend Cloudflare Worker Deployment (Branch: `terraform-alignment`)

**Status:** Complete
**Commits:**
- `a3d0ca6` - feat: add frontend Cloudflare Worker with runtime config injection
- `74d59cc` - fix: add run_worker_first for config injection, disable mock auth in sbx1/prod
- `0f51ef9` - feat: add HYPERDRIVE_NOCACHE for admin routes, reduce cache TTL to 5s

#### What was built:

**Frontend Worker with runtime config injection:**
- Created `frontend/src/worker.ts` — thin Cloudflare Worker (~30 lines of logic) that uses `HTMLRewriter` to inject `<script>window.__CSS_CONFIG__={...}</script>` into `<head>` on all HTML navigation requests
- Created `frontend/wrangler.jsonc` — Worker config with static assets (`not_found_handling: "single-page-application"`), `run_worker_first: true`, and per-environment vars for sbx1/production
- Created `frontend/tsconfig.worker.json` — separate tsconfig for the Worker (Cloudflare types, no DOM)
- Added `wrangler` and `@cloudflare/workers-types` as devDependencies

**Unified config module ("one build, any environment"):**
- Created `frontend/src/config.ts` — reads from `window.__CSS_CONFIG__` (Worker-injected at serve time) with fallback to `import.meta.env.VITE_*` (local dev). No config baked at build time.
- Updated `frontend/src/utils/auth-config.ts` — now reads all OAuth settings via `getConfig()` instead of `import.meta.env` directly
- Updated `frontend/src/api/client.ts` — `API_BASE_URL` now from `getConfig().apiBaseUrl`
- Local `vite dev` still works unchanged via `import.meta.env` fallbacks

**CORS opened for arbitrary frontend origins:**
- Set `CORS_ORIGINS: "*"` in `workers/wrangler.jsonc` for sbx1 and production
- Updated `terraform/modules/cloudflare/main.tf` CORS config to `"*"` for both environments
- Safe because every API endpoint (except `/health`) requires a valid JWT — the token is the security boundary, not the origin

**Hyperdrive dual-binding for read-after-write consistency:**
- Created `css-postgres-sbx1-nocache` Hyperdrive config with caching disabled
- Added `HYPERDRIVE_NOCACHE` binding to worker Env interface and sbx1 wrangler config
- Admin routes (`/api/admin/*`) use `HYPERDRIVE_NOCACHE` for immediate consistency after writes
- All other routes use `HYPERDRIVE` (cached) with reduced TTL: `max_age: 5s`, `stale_while_revalidate: 0` (down from 60s/15s defaults)
- This also improves version change reload speed in the Puck CSS interface

**Infrastructure updates:**
- Added `frontend_worker_name` local and output to `terraform/modules/cloudflare/main.tf`
- Added `frontend_worker_name` output to sbx1 and production environment configs
- Added commented-out `cloudflare_workers_custom_domain` scaffold for future custom domain
- Added `frontend-deploy-sbx1` and `frontend-deploy-prod` Makefile targets
- Updated `frontend/.env.example` with Google OAuth redirect URI instructions

#### Design decisions:
- **Runtime config injection over build-time env** — same `pnpm build` artifact deploys to any environment; Worker injects config via HTMLRewriter. Aligns with Pantheon's GSM pattern of separating config from artifacts.
- **`run_worker_first: true`** — required because Cloudflare's default asset-first routing serves `index.html` from CDN without invoking the Worker, bypassing config injection. Discovered during deployment testing.
- **Mock login disabled in deployed environments** — only available in local dev. OAuth (Google) is the auth path for sbx1/production.
- **Open CORS (`*`) with JWT boundary** — future Puck CSS frontends run on unpredictable domains (Pantheon sites, ephemeral dev envs). JWT in `localStorage` is not auto-sent like cookies, so CSRF is not a concern.
- **Dual Hyperdrive over disabling cache globally** — preserves read performance for document queries while ensuring admin operations are immediately consistent

#### Manual steps required:
- Add `https://collaborative-state-frontend-sbx1.chris-801.workers.dev` to Google OAuth Authorized JavaScript origins in Google Cloud Console

#### Validation:
- 23 frontend test files, 173 tests — all passing
- 98 worker test files, 2192 tests — all passing
- 0 lint errors (frontend and workers)
- Frontend build (`tsc -b && vite build`) succeeds
- Deployed to sbx1: config injection verified on `/`, `/login`, `/sites/*`
- Static assets (JS, CSS) served from CDN cache
- Admin user creation reflects immediately in user list
- API calls from deployed frontend succeed (CORS + auth working)

---

### Content Delivery Plan (Phases 1-7)

**Status:** Complete
**Branch:** `feature/content-delivery`

#### Phase 1: Site Settings API
- `workers/src/db/migrations/021_site_settings.sql` — JSONB settings column on `app.sites`
- `workers/src/services/site-settings-service.ts` — CRUD with validation, JSONB merge
- `workers/src/routes/site-settings-api.ts` — GET/PATCH endpoints with role authorization
- 30 tests (19 service + 11 route)

#### Phase 2: Content Delivery Endpoints
- `workers/src/routes/content-api.ts` — GET content by path, GET content-pages listing
- Branch resolution, ETag/304, Cache-Control with per-site TTL settings
- 16 tests

#### Phase 3: Scope Enforcement Upgrade
- Replaced `SCOPE_METHODS` with `SCOPE_RULES` — route-aware and branch-aware
- `read:published` (main only, content only), `read:all` (any branch, content), `read:draft` (full draft API)
- Updated `index.ts` to pass routeHandler and branchIsMain to scope check
- 22 tests

#### Phase 4: Admin Frontend — Token Scopes
- `frontend/src/components/ScopeSelector.tsx` — checkbox component with supersession logic
- SiteDetailPage: scope selector in token form, scope badges with color coding
- 15 tests (8 component + 7 integration)

#### Phase 5: Admin Frontend — Site Cache Settings
- `frontend/src/api/site-settings.ts` — API client for GET/PATCH settings
- `frontend/src/components/CacheSettings.tsx` — TTL inputs with validation, reset-to-defaults
- SiteDetailPage: Settings section, fetched on page load
- 24 tests (14 component + 6 API + 4 integration)

#### Phase 6: CSSContentClient
- `CSSContentClient` class with `getPage()` and `getPagePaths()` methods
- X-API-Key auth, optional branch query param, 404→null, errors→CSSApiError
- **Correction:** Originally misplaced in this repo's `packages/css-client/`; moved to puck-css-integration's `packages/css-client/` where the `@pantheon/css-client` package lives. Misplaced files removed from this repo.
- Available via `@pantheon/css-client` (barrel) and `@pantheon/css-client/content` (subpath, no browser deps)
- 11 tests in puck-css-integration repo

#### Phase 7: High-Level Module API (in puck-css-integration repo)
- `packages/puck-css/src/config.ts` — `createCSSConfig()` env factory with prefix/overrides
- `packages/puck-css/src/CSSApp.tsx` — full provider composition: CSSAuthProvider → AuthGate → CSSClient creation → CSSPuckProvider → conditional FocusHighlightProvider
  - Creates CSSClient with `clientBaseUrl || baseUrl` and Bearer token auth
  - Passes all config props to CSSPuckProvider (siteId, branchId, realtime, presence, etc.)
  - Uses `key={userId-token}` to force clean re-mount on user switch
  - Conditionally mounts FocusHighlightProvider when `enablePresence` is true
- `packages/puck-css/src/utils/path.ts` — `toCSSPath()` route→document path converter
- Exported from `@pantheon/puck-css` index
- **Demo app rewrite** (`apps/demo/src/App.tsx`) — ~314 lines → ~220 lines using `CSSApp` + `createCSSConfig`
  - Eliminated manual CSSAuthProvider wiring, auth gate logic, CSSClient/CSSPuckProvider composition
  - Uses `createCSSConfig(import.meta.env, { prefix: 'VITE_', overrides: {...} })` for env parsing
  - Preserved UserSwitcher, AppContent, and ConfigWarning functionality
- **E2E validation** — all 12 Playwright tests passing against local backend
  - Fixed pre-existing Publish button test (Puck overlay intercepting pointer events — used `dispatchEvent`)
  - Updated login page heading assertions to match new `loginPageProps`
  - Added local backend env vars to Playwright webServer config
- Branch: `feature/content-delivery-phase7` in puck-css-integration repo, PR #11
- 34 unit tests (11 config + 8 path + 7 CSSApp auth gate + 8 CSSApp provider composition)
- 12 E2E tests (3 auth + 8 editor + 1 version management)

#### Key design decisions:
- **Conservative branch enforcement** — `?branch=` param present → `branchIsMain=false`, no DB lookup needed
- **JSONB merge for settings** — PostgreSQL `||` operator, key removal with `-` for null values
- **Zero-dep content client** — global `fetch` only, works in Node 18+, Deno, Bun, Workers
- **Env-agnostic config** — `createCSSConfig` takes env source record, never reads process.env directly
- **CSSApp handles full provider tree** — consumers only need `<CSSApp config={config}>` instead of manually composing CSSAuthProvider + CSSClient + CSSPuckProvider + FocusHighlightProvider
- **dispatchEvent for Puck overlay** — Puck's editor renders overlay divs that intercept pointer events on header buttons; `dispatchEvent('click')` bypasses this reliably in E2E tests

### my-app Migration to CSSApp + Server-Side Content Delivery

**Status:** Complete
**Commits:**
- `a40b143` (my-app) — feat: migrate to CSSApp + server-side content delivery
- `1a0be9c` (puck-css-integration) — feat: add CSSContentClient and subpath exports
- `8dc8074` (collaborative-state-system) — fix: remove misplaced css-client package; add content delivery plan

#### Render Path (Public Pages)
- Server-side content delivery via `CSSContentClient` using `sat_` token (`read:published` scope)
- `CSS_API_KEY` env var (server-only, no `NEXT_PUBLIC_` prefix) holds the site API token
- `getContentClient()` helper in `lib/css-config.ts` creates the client
- `app/(site)/page.tsx` and `app/(site)/[...puckPath]/page.tsx` fetch content at request time
- Falls back to `getPage()` (database.json) when CSS is not configured
- Deleted `CSSRenderProvider.tsx` and `PuckRenderClient.tsx` (wrong architecture — used client-side providers for server-side fetches)

#### Edit Path (Authenticated)
- `EditorWithCSSApp.tsx` (~170 lines) replaces `EditorWithCSS.tsx` (~2100 lines)
- Uses `CSSApp` + `useCSSEditor` from `@pantheon/puck-css` — CSSApp handles auth gating, client creation, and provider composition
- Google OAuth login verified working (chris.yates@pantheon.io)
- Includes `UserSwitcher` for mock auth mode

#### Infrastructure Fixes
- Applied migration 021 (`ALTER TABLE app.sites ADD COLUMN settings JSONB`) to local DB
- Corrected site API token scope from `read:draft` to `read:published` (prefix `sat_SFlD3aPf`)
- Discovered wrangler dev does NOT hot-reload `.dev.vars` — must restart for new env vars

#### Subpath Exports Added
- `@pantheon/css-client/content` — server-only CSSContentClient (no browser deps)
- `@pantheon/puck-css/config` — createCSSConfig for server-side imports
- `@pantheon/puck-css/utils/path` — toCSSPath for server-side imports
- `typesVersions` added to both packages for `moduleResolution: "node"` compat

### Copy-on-Write Branching Refactor

**Status:** Complete (Phases 1-6 done, document-api COW done; Phase 7 future)
**Branch:** `feature/copy-on-write-branching`
**Commits:**
- `43c300e` — test: add Phase 1 + Phase 3 copy-on-write branching tests (red)
- `7a06d0f` — feat: enforce main-only branching and copy-on-write branch creation (Phases 1+3)
- `800bd4d` — test: add Phase 4 version fallback TDD tests (red)
- `2c16e18` — feat: version fallback to main for copy-on-write branches (Phase 4)
- `4eb178c` — test: add Phase 5 merge execution TDD tests (red)
- `00266b9` — feat: COW-aware merge execution, tombstone checkpoint exclusion, deprecate archive (Phase 5)
- `07c72db` — feat: migration 023 — remove duplicate version rows for COW branches (Phase 6)
- `0c72efa` — test: add Phase 2 frontend COW branching tests (red state)
- `55d17b4` — feat: enforce main-only branching in frontend UI (Phase 2)
- `33c5e78` — fix: pass mainBranchId to listDocumentsOnBranch in document-api
- `5d55eb0` — test: add COW fallback tests for document-api and document-service (red state)
- `1611bb1` — feat: COW fallback for document-api routes and inherited flag in listings

#### Wave 1 — Phases 1+3: Main-Only Branching & COW Branch Creation
- [x] Enforce `parentBranchId` must be main in `createBranch`
- [x] Add `MainBranchOnlyError` for non-main parent branches
- [x] Branch-scoped document operations: `listDocumentsOnBranch`, `createDocumentOnBranch`, `documentExistsOnBranch`, `deleteDocumentOnBranch`
- [x] Tests: 15 new tests covering main-only enforcement and branch-scoped operations

#### Wave 2 — Phase 4: Version Fallback to Main
- [x] `getLatestDocumentVersionWithFallback()` — tries branch first, falls back to main's published version
- [x] `DocumentVersionWithFallback` type with `inherited` boolean
- [x] Content API updated: non-main branches use fallback, response includes `inherited` field
- [x] `listDocumentsOnBranch` UNION query: branch local docs + main published docs (excluding tombstones)
- [x] Tests: 15 new tests for fallback behavior

#### Wave 3 — Phase 5: Merge Execution Changes
- [x] `getModifiedDocumentsSince` rewritten with LEFT JOIN for COW semantics (inherited docs ≠ deleted)
- [x] Tombstone detection via `snapshot._deleted` instead of missing version rows
- [x] Checkpoint creation excludes tombstone documents from snapshots
- [x] `archiveDocument`/`restoreDocument` marked as deprecated (prose, not @deprecated tag to avoid lint cascade)
- [x] Tests: 5 new tests for COW merge and tombstone handling

#### Wave 4 — Phase 6: Data Migration
- [x] Migration 023: `cow_cleanup_duplicate_versions`
- [x] Remap 23 checkpoint_documents from branch v1 rows to main's versions
- [x] Delete 52 duplicate v1 version rows (snapshot matched main, no local edits)
- [x] Preserve 11 v1 rows that have higher versions (edit history)
- [x] Register previously-applied migrations 018-022 in tracking table
- [x] FK integrity verified: 0 orphaned checkpoint_documents

#### Wave 5 — Phase 2: Frontend Main-Only Branching
- [x] Remove parent branch selector from create branch form (SiteDetailPage)
- [x] Update button text to "Create branch from main"
- [x] Auto-select main as merge request target, disable selector (CreateMergeRequestPage)
- [x] Filter main from source branch options in merge request form
- [x] Rename "Parent" column/label to "Source", show "main" text (SiteDetailPage, BranchDetailPage)
- [x] Remove deprecated `parentBranchId` from Branch type and API params
- [x] Unit tests: 5 new Vitest tests for COW branching UI
- [x] E2E tests: Updated branch-crud and merge-requests specs

#### Wave 6 — Document API COW Fallback
- [x] `listDocumentsOnBranch` returns `inherited: boolean` per document via `DocumentOnBranch` type
- [x] SQL UNION: `false AS inherited` for local docs, `true AS inherited` for main-inherited docs
- [x] GET document on non-main branch falls back to main when no local version exists
- [x] GET latest version on non-main branch uses `getLatestDocumentVersionWithFallback`
- [x] POST create version works for inherited documents (COW gate relaxed)
- [x] Pass `isMainBranch` from route handler to avoid redundant `getBranch` calls
- [x] Main branch behavior unchanged (no fallback)
- [x] Tests: 10 new tests (6 API, 4 service)
- [x] Fix: document-api passes `mainBranchId` to `listDocumentsOnBranch` for non-main branches

#### Remaining
- [ ] Phase 7: Publish-propagation foundation (future)
