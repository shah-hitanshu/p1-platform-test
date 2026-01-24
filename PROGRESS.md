# Collaborative State System - Implementation Progress

## Overview

This document tracks the implementation progress of the Collaborative JSON State Versioning System as defined in `collaborative-state-system-architecture-v2.2.md`.

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

## Change History

| Date | Phase | Summary |
|------|-------|---------|
| 2026-01-24 | 8.7 | DocumentPage implementation and navigation fixes |
| 2026-01-24 | 8.6 | Bug fixes: Cloudflare Workers DB I/O error, Create Site form missing field |
| 2026-01-24 | 8.1-8.5 | Frontend API Explorer: project setup, API client, auth UI, dashboard/sites pages, E2E tests |
| 2026-01-24 | 7.3 | Route wiring: all API routes wired with CORS and auth middleware (971 tests) |
| 2026-01-24 | 7.1.1b | Security hardening: pagination validation, path traversal, LIKE escaping, size limits (947 tests) |
| 2026-01-24 | 7.1.1b | Resource Management APIs complete: Site, Document, Structure, Node, Metadata (916 tests) |
| 2026-01-24 | 7.1.1a | Branch-scoped structure identity complete: migration, service updates (829 tests) |
| 2026-01-24 | 7.1.1 | Proposal finalized: branch-scoped structures, soft-delete, bulk operations |
| 2026-01-24 | 7.2 | Audit Integration complete (9 tests) |
| 2026-01-24 | 7.1 | REST API Endpoints complete: Branch, Checkpoint, Merge, Grant APIs (49 tests) |
| 2026-01-24 | 6.2 | Metadata Service complete (29 tests) |
| 2026-01-24 | 6.1 | Structure Service complete (42 tests) |
| 2026-01-24 | 5.3 | Merge Execution Service complete (13 tests) |
| 2026-01-24 | 5.2c | CRDT Merge Service complete (14 tests) |
| 2026-01-24 | 5.2b | Conflict Resolution Service complete (15 tests) |
| 2026-01-24 | 5.2a | Conflict Detection Service complete (13 tests) |
| 2026-01-24 | 5.1b | Merge Base Service complete (18 tests) |
| 2026-01-24 | 5.1a | Merge Request Service complete (51 tests) |
| 2026-01-24 | 4.2 | Real-Time API routes complete (39 tests, security hardening) |
| 2026-01-24 | 4.1 | DocumentSession Durable Object complete (46 tests, security hardening) |
| 2026-01-23 | 3.3 | Checkpoint System complete (18 + 30 = 48 unit tests) |
| 2026-01-23 | 3.2 | Branch Operations complete (63 unit + 28 integration tests) |
| 2026-01-23 | Infra | Infrastructure validation: /health endpoint, real postgres connection, DO stubs |
| 2026-01-23 | 3.1 | Site and Document Operations complete (69 unit + 24 integration tests) |
| 2026-01-23 | 2.2 | Authorization System complete (92 tests) |
| 2026-01-23 | 2.1 | Mock Identity Provider complete (44 tests) |
| 2026-01-23 | 1.3 | Core TypeScript types complete (50 types) |
| 2026-01-23 | 1.2 | Database schema and migrations complete |
| 2026-01-23 | 1.1 | Initial project configuration and build tooling complete |

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
| Branch API Routes | 13 | - |
| Checkpoint API Routes | 13 | - |
| Merge API Routes | 13 | - |
| Grant API Routes | 10 | - |
| Audit Emitter | 9 | - |
| Site API Routes | 16 | - |
| Document CRUD API Routes | 22 | - |
| Structure API Routes | 17 | - |
| Node API Routes | 19 | - |
| Metadata API Routes | 13 | - |
| Validation Utilities | 28 | - |
| Router Integration | 24 | - |
| **Total** | **971** | **52** |

---

*Last updated: 2026-01-24*
