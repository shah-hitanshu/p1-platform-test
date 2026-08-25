# Proposal 001: Missing API Endpoints

**Status:** Draft
**Date:** 2026-01-23
**Updated:** 2026-01-24
**Author:** Claude (via collaborative session)
**Affects:** Phase 6 Schema, Phase 7 API Layer, Architecture v2.2

---

## Summary

The API specification in `collaborative-state-system-architecture-v2.2.md` (Section: API Specification, lines 934-1297) omits REST endpoints for several services that have already been implemented. This proposal defines the missing endpoints to ensure full API coverage.

**Note:** Phase 7.1 implementation is underway. These additions should be scheduled as Phase 7.1.1 (or similar) after current work completes.

---

## Gap Analysis

| Service | Implementation Status | API Spec Status |
|---------|----------------------|-----------------|
| Site Service | Complete (Phase 3.1) | **Missing** |
| Document Service (CRUD) | Complete (Phase 3.1) | **Missing** |
| Document Service (Real-time) | Complete (Phase 4.2) | Defined |
| Branch Service | Complete (Phase 3.2) | Defined |
| Checkpoint Service | Complete (Phase 3.3) | Defined |
| Merge Services | Complete (Phase 5.x) | Defined |
| Structure Service | Complete (Phase 6.1) | Interface only (no REST) |
| Metadata Service | Complete (Phase 6.2) | Interface only (no REST) |

---

## Schema Changes Required

### Decision: Branch-Scoped Structure Identity

**Context:** The current architecture has structure identity (name, slug, structureType) at the site level, but structure state (tree, schema) at the branch level. This creates inconsistency—renaming a structure on a branch would immediately affect all branches.

**Decision:** Move structure identity fields to be branch-scoped, matching how documents work. All changes on a branch are isolated until merged.

**Example Scenario:**
```
1. Main branch has structure: name="blogs", slug="blogs"
2. Create feature branch (structure state copied)
3. On feature: rename to name="stuff-i-write", slug="stuff-i-write"
4. On feature: reorder nodes in the structure
5. Main still sees: name="blogs" with original node order
6. Merge feature → main: both changes apply together
7. Rollback main: restores "blogs" with original order
```

### Current Schema (Inconsistent)

```sql
-- Structure identity is site-scoped (shared across all branches)
CREATE TABLE site_structures (
    id UUID PRIMARY KEY,
    site_id UUID NOT NULL REFERENCES sites(id),
    name TEXT NOT NULL,           -- ❌ Shared
    slug TEXT NOT NULL,           -- ❌ Shared
    description TEXT,             -- ❌ Shared
    structure_type TEXT NOT NULL, -- ❌ Shared
    created_at TIMESTAMPTZ,
    UNIQUE(site_id, slug)
);

-- Structure state is branch-scoped (isolated per branch)
CREATE TABLE branch_structure_state (
    branch_id UUID NOT NULL,
    structure_id UUID NOT NULL,
    structure_tree JSONB NOT NULL,      -- ✓ Isolated
    metadata_schema JSONB NOT NULL,     -- ✓ Isolated
    schema_enforcement TEXT NOT NULL,   -- ✓ Isolated
    ...
);

-- Checkpoint captures state but not identity
CREATE TABLE checkpoint_structures (
    checkpoint_id UUID NOT NULL,
    structure_id UUID NOT NULL,
    structure_tree JSONB NOT NULL,
    metadata_schema JSONB NOT NULL,
    schema_enforcement TEXT NOT NULL
    -- ❌ Missing: name, slug, description, structure_type
);
```

### Proposed Schema (Consistent)

```sql
-- Structure identity is minimal (just existence)
CREATE TABLE site_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
    -- Removed: name, slug, description, structure_type
);

-- All mutable fields are branch-scoped
CREATE TABLE branch_structure_state (
    branch_id UUID NOT NULL REFERENCES branches(id),
    structure_id UUID NOT NULL REFERENCES site_structures(id),

    -- Identity (moved from site_structures)
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    structure_type TEXT NOT NULL DEFAULT 'hierarchy',

    -- State (already here)
    structure_tree JSONB NOT NULL DEFAULT '[]',
    metadata_schema JSONB NOT NULL DEFAULT '{"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}',
    schema_enforcement TEXT NOT NULL DEFAULT 'warn',

    has_changes_since_checkpoint BOOLEAN DEFAULT FALSE,
    last_modified_at TIMESTAMPTZ,
    last_modified_by UUID,

    PRIMARY KEY (branch_id, structure_id),
    UNIQUE(branch_id, slug)  -- Slug uniqueness is per-branch
);

-- Checkpoint captures full state for rollback
CREATE TABLE checkpoint_structures (
    checkpoint_id UUID NOT NULL REFERENCES checkpoints(id),
    structure_id UUID NOT NULL REFERENCES site_structures(id),

    -- Identity (added for rollback support)
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    structure_type TEXT NOT NULL,

    -- State
    structure_tree JSONB NOT NULL,
    metadata_schema JSONB NOT NULL,
    schema_enforcement TEXT NOT NULL,

    PRIMARY KEY (checkpoint_id, structure_id)
);
```

### Migration Required

```sql
-- Migration: 007_branch_scoped_structures.sql

-- Step 1: Add identity columns to branch_structure_state
ALTER TABLE branch_structure_state
    ADD COLUMN name TEXT,
    ADD COLUMN slug TEXT,
    ADD COLUMN description TEXT,
    ADD COLUMN structure_type TEXT;

-- Step 2: Copy existing data from site_structures
UPDATE branch_structure_state bss
SET
    name = ss.name,
    slug = ss.slug,
    description = ss.description,
    structure_type = ss.structure_type
FROM site_structures ss
WHERE bss.structure_id = ss.id;

-- Step 3: Make columns NOT NULL after data migration
ALTER TABLE branch_structure_state
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN slug SET NOT NULL,
    ALTER COLUMN structure_type SET NOT NULL,
    ALTER COLUMN structure_type SET DEFAULT 'hierarchy';

-- Step 4: Add unique constraint for slug per branch
ALTER TABLE branch_structure_state
    ADD CONSTRAINT unique_branch_slug UNIQUE(branch_id, slug);

-- Step 5: Add identity columns to checkpoint_structures
ALTER TABLE checkpoint_structures
    ADD COLUMN name TEXT,
    ADD COLUMN slug TEXT,
    ADD COLUMN description TEXT,
    ADD COLUMN structure_type TEXT;

-- Step 6: Backfill checkpoint_structures from site_structures
UPDATE checkpoint_structures cs
SET
    name = ss.name,
    slug = ss.slug,
    description = ss.description,
    structure_type = ss.structure_type
FROM site_structures ss
WHERE cs.structure_id = ss.id;

-- Step 7: Make checkpoint columns NOT NULL
ALTER TABLE checkpoint_structures
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN slug SET NOT NULL,
    ALTER COLUMN structure_type SET NOT NULL;

-- Step 8: Drop old columns from site_structures
-- (Do this after verifying data migration)
ALTER TABLE site_structures
    DROP COLUMN name,
    DROP COLUMN slug,
    DROP COLUMN description,
    DROP COLUMN structure_type;

-- Step 9: Drop old unique constraint
ALTER TABLE site_structures
    DROP CONSTRAINT IF EXISTS site_structures_site_id_slug_key;
```

### Service Updates Required

The following services need updates to work with the new schema:

| Service | Changes Needed |
|---------|----------------|
| `structure-service.ts` | Read/write identity from `branch_structure_state` instead of `site_structures` |
| `checkpoint-service.ts` | Capture/restore identity fields in checkpoint operations |
| `merge-base-service.ts` | Include structure identity in merge base calculations |
| `conflict-detection-service.ts` | Detect conflicts when both branches modify structure identity |

### Branch Creation Behavior

When creating a branch from a source branch:

1. Copy all `branch_structure_state` rows from source branch
2. New rows get the new `branch_id` but same `structure_id`
3. Changes on new branch only affect its `branch_structure_state` rows

```typescript
async function copyStructureStateForNewBranch(
    sourceBranchId: string,
    newBranchId: string
): Promise<void> {
    await db.query(`
        INSERT INTO branch_structure_state (
            branch_id, structure_id,
            name, slug, description, structure_type,
            structure_tree, metadata_schema, schema_enforcement
        )
        SELECT
            $2, structure_id,
            name, slug, description, structure_type,
            structure_tree, metadata_schema, schema_enforcement
        FROM branch_structure_state
        WHERE branch_id = $1
    `, [sourceBranchId, newBranchId]);
}
```

---

## Proposed API Additions

### 1. Site API

Site management endpoints for creating and configuring sites.

#### Create Site

```
POST /api/sites

Request:
{
    "pantheonSiteId": "site-abc-123",
    "name": "Marketing Website",
    "workflowSettings": {
        "mergeApprovalMode": "required",
        "minApprovers": 2,
        "allowSelfApproval": false,
        "approverMode": "both",
        "approverMinRole": "EDITOR"
    }
}

Response: 201 Created
{
    "id": "site-uuid",
    "pantheonSiteId": "site-abc-123",
    "name": "Marketing Website",
    "workflowSettings": {
        "mergeApprovalMode": "required",
        "minApprovers": 2,
        "allowSelfApproval": false,
        "approverMode": "both",
        "approverMinRole": "EDITOR"
    },
    "createdAt": "2026-01-23T10:00:00Z",
    "updatedAt": "2026-01-23T10:00:00Z"
}

Errors:
- 400 Bad Request: Invalid parameters
- 409 Conflict: pantheonSiteId already exists
```

#### List Sites

```
GET /api/sites?limit=20&offset=0

Response: 200 OK
{
    "sites": [
        {
            "id": "site-uuid",
            "pantheonSiteId": "site-abc-123",
            "name": "Marketing Website",
            "createdAt": "2026-01-23T10:00:00Z"
        }
    ],
    "pagination": {
        "total": 42,
        "limit": 20,
        "offset": 0
    }
}
```

#### Get Site

```
GET /api/sites/{siteId}

Response: 200 OK
{
    "id": "site-uuid",
    "pantheonSiteId": "site-abc-123",
    "name": "Marketing Website",
    "workflowSettings": {
        "mergeApprovalMode": "required",
        "minApprovers": 2,
        "allowSelfApproval": false,
        "approverMode": "both",
        "approverMinRole": "EDITOR"
    },
    "createdAt": "2026-01-23T10:00:00Z",
    "updatedAt": "2026-01-23T10:00:00Z"
}

Errors:
- 404 Not Found: Site does not exist
```

#### Update Site

```
PATCH /api/sites/{siteId}

Request:
{
    "name": "Marketing Website (Redesign)",
    "workflowSettings": {
        "minApprovers": 3
    }
}

Response: 200 OK
{
    "id": "site-uuid",
    "pantheonSiteId": "site-abc-123",
    "name": "Marketing Website (Redesign)",
    "workflowSettings": {
        "mergeApprovalMode": "required",
        "minApprovers": 3,
        "allowSelfApproval": false,
        "approverMode": "both",
        "approverMinRole": "EDITOR"
    },
    "createdAt": "2026-01-23T10:00:00Z",
    "updatedAt": "2026-01-23T10:30:00Z"
}

Notes:
- workflowSettings is merged (partial update supported)

Errors:
- 400 Bad Request: Invalid parameters
- 404 Not Found: Site does not exist
```

#### Delete Site

```
DELETE /api/sites/{siteId}

Response: 204 No Content

Notes:
- Site can only be deleted when all branches are archived or merged
- Returns 409 if any non-archived branches exist

Errors:
- 404 Not Found: Site does not exist
- 409 Conflict: Site has non-archived branches
```

---

### 2. Document CRUD API

Document management endpoints separate from real-time collaboration.

**Note:** These endpoints manage document records (path, existence). Document *content* is managed via the real-time API (Phase 4.2) at `/api/sites/{siteId}/branches/{branchId}/documents/{documentPath}`.

#### Create Document

```
POST /api/sites/{siteId}/documents

Request:
{
    "path": "pages/about-us"
}

Response: 201 Created
{
    "id": "doc-uuid",
    "siteId": "site-uuid",
    "path": "pages/about-us",
    "createdAt": "2026-01-23T10:00:00Z"
}

Errors:
- 400 Bad Request: Invalid path format
- 404 Not Found: Site does not exist
- 409 Conflict: Document already exists at path
```

#### List Documents

```
GET /api/sites/{siteId}/documents?pathPrefix=pages/&limit=20&offset=0

Response: 200 OK
{
    "documents": [
        {
            "id": "doc-uuid-1",
            "path": "pages/home",
            "createdAt": "2026-01-20T10:00:00Z"
        },
        {
            "id": "doc-uuid-2",
            "path": "pages/about-us",
            "createdAt": "2026-01-23T10:00:00Z"
        }
    ],
    "pagination": {
        "total": 15,
        "limit": 20,
        "offset": 0
    }
}

Query Parameters:
- pathPrefix: Filter documents by path prefix
- limit: Max results (default 20, max 100)
- offset: Pagination offset
```

#### Get Document

```
GET /api/sites/{siteId}/documents/{documentId}

Response: 200 OK
{
    "id": "doc-uuid",
    "siteId": "site-uuid",
    "path": "pages/about-us",
    "createdAt": "2026-01-23T10:00:00Z"
}

Errors:
- 404 Not Found: Document does not exist
```

#### Get Document by Path

```
GET /api/sites/{siteId}/documents/by-path/{documentPath}

Response: 200 OK
{
    "id": "doc-uuid",
    "siteId": "site-uuid",
    "path": "pages/about-us",
    "createdAt": "2026-01-23T10:00:00Z"
}

Notes:
- documentPath is URL-encoded (e.g., pages%2Fabout-us)

Errors:
- 404 Not Found: No document at path
```

#### Update Document Path

```
PATCH /api/sites/{siteId}/documents/{documentId}

Request:
{
    "path": "pages/about"
}

Response: 200 OK
{
    "id": "doc-uuid",
    "siteId": "site-uuid",
    "path": "pages/about",
    "createdAt": "2026-01-23T10:00:00Z"
}

Errors:
- 400 Bad Request: Invalid path format
- 404 Not Found: Document does not exist
- 409 Conflict: Document already exists at new path
```

#### Delete Document (Soft Delete)

```
DELETE /api/sites/{siteId}/documents/{documentId}

Response: 204 No Content

Notes:
- Soft-delete: sets `archived_at` timestamp rather than hard-deleting
- Preserves version history for audit and potential recovery
- Archived documents are excluded from listings by default
- Document path becomes available for reuse after archival

Errors:
- 404 Not Found: Document does not exist
- 409 Conflict: Document has active references in structures (optional)
```

#### Restore Document

```
POST /api/sites/{siteId}/documents/{documentId}/restore

Response: 200 OK
{
    "id": "doc-uuid",
    "siteId": "site-uuid",
    "path": "pages/about-us",
    "createdAt": "2026-01-23T10:00:00Z",
    "archivedAt": null
}

Notes:
- Restores a soft-deleted document
- Fails if original path is now occupied by another document

Errors:
- 404 Not Found: Document does not exist or is not archived
- 409 Conflict: Path is now occupied by another document
```

#### List Documents (with archived filter)

Update to List Documents endpoint:

```
GET /api/sites/{siteId}/documents?pathPrefix=pages/&archived=false&limit=20&offset=0

Query Parameters:
- pathPrefix: Filter documents by path prefix
- archived: Include archived documents (default: false, use "true" or "only")
- limit: Max results (default 20, max 100)
- offset: Pagination offset
```

---

### 3. Structure API

Structure management endpoints. **Structures are branch-scoped** for consistency with documents—changes on a branch are isolated until merged.

> **Note:** This API reflects the schema changes in the "Schema Changes Required" section above. Structure identity (name, slug, etc.) is stored in `branch_structure_state`, not `site_structures`.

#### Create Structure

Creates a new structure on a specific branch. The structure only exists on that branch until merged.

```
POST /api/sites/{siteId}/branches/{branchId}/structures

Request:
{
    "name": "Main Navigation",
    "slug": "main-nav",
    "description": "Primary site navigation",
    "structureType": "hierarchy"
}

Response: 201 Created
{
    "id": "structure-uuid",
    "branchId": "branch-uuid",
    "name": "Main Navigation",
    "slug": "main-nav",
    "description": "Primary site navigation",
    "structureType": "hierarchy",
    "createdAt": "2026-01-23T10:00:00Z"
}

Errors:
- 400 Bad Request: Invalid parameters
- 404 Not Found: Site or branch does not exist
- 409 Conflict: Structure with slug already exists on this branch
```

#### List Structures

Lists structures visible on a specific branch.

```
GET /api/sites/{siteId}/branches/{branchId}/structures?type=hierarchy

Response: 200 OK
{
    "structures": [
        {
            "id": "structure-uuid",
            "name": "Main Navigation",
            "slug": "main-nav",
            "structureType": "hierarchy"
        }
    ]
}

Query Parameters:
- type: Filter by structureType (hierarchy, collection)
```

#### Get Structure

Gets structure details as they exist on a specific branch.

```
GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}

Response: 200 OK
{
    "id": "structure-uuid",
    "branchId": "branch-uuid",
    "name": "Main Navigation",
    "slug": "main-nav",
    "description": "Primary site navigation",
    "structureType": "hierarchy",
    "metadataSchema": { ... },
    "schemaEnforcement": "warn"
}

Errors:
- 404 Not Found: Structure does not exist on this branch
```

#### Update Structure

Updates structure identity on a specific branch. Changes are isolated to this branch.

```
PATCH /api/sites/{siteId}/branches/{branchId}/structures/{structureId}

Request:
{
    "name": "stuff-i-write",
    "slug": "stuff-i-write",
    "description": "My blog posts and articles"
}

Response: 200 OK
{
    "id": "structure-uuid",
    "branchId": "branch-uuid",
    "name": "stuff-i-write",
    "slug": "stuff-i-write",
    "description": "My blog posts and articles",
    "structureType": "hierarchy"
}

Notes:
- Changes only affect this branch
- Other branches (including main) still see the original name/slug
- Changes are merged when this branch is merged to target

Errors:
- 400 Bad Request: Invalid parameters
- 404 Not Found: Structure does not exist on this branch
- 409 Conflict: Another structure with this slug exists on this branch
```

#### Delete Structure

Deletes a structure from a specific branch.

```
DELETE /api/sites/{siteId}/branches/{branchId}/structures/{structureId}

Response: 204 No Content

Notes:
- Only deletes from this branch
- If structure exists on other branches, they are unaffected
- Deleting from main (and merging that deletion) removes structure from future branches

Errors:
- 404 Not Found: Structure does not exist on this branch
```

#### Get Structure at Checkpoint

Gets structure state as it was at a specific checkpoint (for viewing history or rollback preview).

```
GET /api/sites/{siteId}/checkpoints/{checkpointId}/structures/{structureId}

Response: 200 OK
{
    "id": "structure-uuid",
    "checkpointId": "checkpoint-uuid",
    "name": "blogs",
    "slug": "blogs",
    "description": "Original blog structure",
    "structureType": "hierarchy",
    "structureTree": [ ... ],
    "metadataSchema": { ... },
    "schemaEnforcement": "warn"
}

Notes:
- Returns the full structure state as captured at the checkpoint
- Used for viewing history or previewing rollback
```

---

### 4. Structure Node API

Node management within structures (branch-scoped).

#### Create Node

```
POST /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes

Request:
{
    "parentNodeId": "parent-node-uuid",  // null for root level
    "name": "Getting Started",
    "slug": "getting-started",
    "nodeType": "section",
    "position": 0
}

// For document nodes:
{
    "parentNodeId": null,
    "name": "Home Page",
    "slug": "home",
    "nodeType": "document",
    "documentId": "doc-uuid"
}

// For external links:
{
    "parentNodeId": null,
    "name": "External Resources",
    "slug": "resources",
    "nodeType": "external",
    "externalUrl": "https://example.com/resources"
}

Response: 201 Created
{
    "id": "node-uuid",
    "structureId": "structure-uuid",
    "parentNodeId": null,
    "name": "Getting Started",
    "slug": "getting-started",
    "nodeType": "section",
    "position": 0,
    "createdAt": "2026-01-23T10:00:00Z"
}
```

#### List Nodes

```
GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes?parentId=null

Response: 200 OK
{
    "nodes": [
        {
            "id": "node-uuid-1",
            "name": "Getting Started",
            "slug": "getting-started",
            "nodeType": "section",
            "position": 0
        },
        {
            "id": "node-uuid-2",
            "name": "Home Page",
            "slug": "home",
            "nodeType": "document",
            "documentId": "doc-uuid",
            "position": 1
        }
    ]
}

Query Parameters:
- parentId: Filter by parent node (use "null" for root nodes)
```

#### Get Node

```
GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}

Response: 200 OK
{
    "id": "node-uuid",
    "structureId": "structure-uuid",
    "parentNodeId": null,
    "name": "Getting Started",
    "slug": "getting-started",
    "nodeType": "section",
    "position": 0,
    "createdAt": "2026-01-23T10:00:00Z"
}
```

#### Update Node

```
PATCH /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}

Request:
{
    "name": "Quick Start Guide",
    "slug": "quick-start"
}

Response: 200 OK
{
    "id": "node-uuid",
    "structureId": "structure-uuid",
    "parentNodeId": null,
    "name": "Quick Start Guide",
    "slug": "quick-start",
    "nodeType": "section",
    "position": 0,
    "createdAt": "2026-01-23T10:00:00Z"
}
```

#### Move Node

```
POST /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}/move

Request:
{
    "newParentId": "new-parent-uuid",  // null for root level
    "newPosition": 2
}

Response: 200 OK
{
    "id": "node-uuid",
    "parentNodeId": "new-parent-uuid",
    "position": 2,
    ...
}

Errors:
- 400 Bad Request: Move would create circular reference
```

#### Reorder Nodes

```
POST /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/reorder

Request:
{
    "parentNodeId": null,  // Reorder root nodes
    "nodeOrder": ["node-uuid-3", "node-uuid-1", "node-uuid-2"]
}

Response: 200 OK
{
    "success": true,
    "reorderedCount": 3
}
```

#### Delete Node

```
DELETE /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/{nodeId}

Response: 204 No Content

Notes:
- Deleting a section node also deletes all child nodes
- Deleting a document node does NOT delete the underlying document
```

#### Get Navigation Tree

```
GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/navigation?depth=3&visibleOnly=true

Response: 200 OK
{
    "structureId": "structure-uuid",
    "structureName": "Main Navigation",
    "tree": [
        {
            "id": "node-uuid-1",
            "name": "Getting Started",
            "slug": "getting-started",
            "path": "/getting-started",
            "nodeType": "section",
            "children": [
                {
                    "id": "node-uuid-2",
                    "name": "Installation",
                    "slug": "installation",
                    "path": "/getting-started/installation",
                    "nodeType": "document",
                    "documentId": "doc-uuid-1",
                    "documentPath": "docs/installation",
                    "children": []
                }
            ]
        }
    ]
}

Query Parameters:
- depth: Maximum tree depth to return (default: unlimited)
- visibleOnly: Only include visible nodes (default: false)
```

#### Bulk Create Nodes

Create multiple nodes in a single request. Useful for importing or migrating structure content.

```
POST /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/bulk

Request:
{
    "nodes": [
        {
            "parentNodeId": null,
            "name": "Section A",
            "slug": "section-a",
            "nodeType": "section",
            "position": 0
        },
        {
            "parentNodeId": null,
            "name": "Section B",
            "slug": "section-b",
            "nodeType": "section",
            "position": 1
        },
        {
            "parentNodeId": null,
            "name": "Home",
            "slug": "home",
            "nodeType": "document",
            "documentId": "doc-uuid",
            "position": 2
        }
    ]
}

Response: 201 Created
{
    "created": [
        { "id": "node-uuid-1", "slug": "section-a" },
        { "id": "node-uuid-2", "slug": "section-b" },
        { "id": "node-uuid-3", "slug": "home" }
    ],
    "errors": []
}

Notes:
- Nodes are created in order; later nodes can reference earlier nodes as parents
- Use temporary IDs (e.g., "temp-1") in parentNodeId to reference nodes created in same batch
- Atomic: all succeed or all fail

Errors:
- 400 Bad Request: Invalid node data
- 409 Conflict: Slug conflicts
```

#### Bulk Update Nodes

Update multiple nodes in a single request. Useful for batch reordering or renaming.

```
PATCH /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/bulk

Request:
{
    "updates": [
        {
            "nodeId": "node-uuid-1",
            "position": 2
        },
        {
            "nodeId": "node-uuid-2",
            "position": 0
        },
        {
            "nodeId": "node-uuid-3",
            "name": "Updated Name",
            "position": 1
        }
    ]
}

Response: 200 OK
{
    "updated": [
        { "id": "node-uuid-1", "position": 2 },
        { "id": "node-uuid-2", "position": 0 },
        { "id": "node-uuid-3", "position": 1, "name": "Updated Name" }
    ],
    "errors": []
}

Notes:
- Useful for complex reordering operations
- Atomic: all succeed or all fail
```

#### Bulk Delete Nodes

Delete multiple nodes in a single request.

```
DELETE /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/bulk

Request:
{
    "nodeIds": ["node-uuid-1", "node-uuid-2", "node-uuid-3"]
}

Response: 200 OK
{
    "deleted": ["node-uuid-1", "node-uuid-2", "node-uuid-3"],
    "errors": []
}

Notes:
- Deleting a section node also deletes all child nodes
- Atomic: all succeed or all fail
```

#### Migrate Nodes Between Structures

Move nodes from one structure to another on the same branch.

```
POST /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/nodes/migrate

Request:
{
    "sourceStructureId": "old-structure-uuid",
    "nodeIds": ["node-uuid-1", "node-uuid-2"],
    "targetParentId": null,
    "startPosition": 0
}

Response: 200 OK
{
    "migrated": [
        { "id": "node-uuid-1", "newPosition": 0 },
        { "id": "node-uuid-2", "newPosition": 1 }
    ]
}

Notes:
- Moves nodes and their children to target structure
- Document metadata is also migrated if schemas are compatible
- Validates against target structure's metadata schema
```

---

### 5. Metadata API

Document metadata management within structures (branch-scoped).

#### Get Branch Structure State

```
GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/state

Response: 200 OK
{
    "branchId": "branch-uuid",
    "structureId": "structure-uuid",
    "metadataSchema": {
        "type": "object",
        "properties": {
            "title": { "type": "string", "maxLength": 100 },
            "description": { "type": "string", "maxLength": 300 }
        },
        "required": ["title"]
    },
    "schemaEnforcement": "warn",
    "hasChangesSinceCheckpoint": false,
    "lastModifiedAt": "2026-01-23T10:00:00Z"
}
```

#### Update Metadata Schema

```
PUT /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/schema

Request:
{
    "schema": {
        "type": "object",
        "properties": {
            "title": { "type": "string", "maxLength": 100 },
            "description": { "type": "string", "maxLength": 300 },
            "author": { "type": "string" },
            "publishDate": { "type": "string", "format": "date-time" }
        },
        "required": ["title", "author"]
    },
    "enforcement": "strict"
}

Response: 200 OK
{
    "metadataSchema": { ... },
    "schemaEnforcement": "strict",
    "validationResult": {
        "totalDocuments": 15,
        "conformingDocuments": 12,
        "nonConformingDocuments": [
            {
                "documentId": "doc-uuid-1",
                "documentPath": "pages/old-page",
                "errors": [
                    {
                        "field": "author",
                        "message": "Required field missing"
                    }
                ]
            }
        ]
    }
}
```

#### Validate All Documents

```
POST /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/validate

Response: 200 OK
{
    "structureId": "structure-uuid",
    "totalDocuments": 15,
    "conformingDocuments": 12,
    "nonConformingDocuments": [
        {
            "documentId": "doc-uuid-1",
            "documentPath": "pages/old-page",
            "errors": [
                {
                    "field": "author",
                    "message": "Required field missing",
                    "currentValue": null
                }
            ]
        }
    ]
}
```

#### Get Document Metadata

```
GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/documents/{documentId}/metadata

Response: 200 OK
{
    "documentId": "doc-uuid",
    "structureId": "structure-uuid",
    "metadata": {
        "title": "About Us",
        "description": "Learn more about our company",
        "author": "Marketing Team"
    },
    "conformsToSchema": true,
    "validationErrors": [],
    "lastModifiedAt": "2026-01-23T10:00:00Z"
}

Errors:
- 404 Not Found: Document not in structure
```

#### Update Document Metadata

```
PUT /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/documents/{documentId}/metadata

Request:
{
    "title": "About Our Company",
    "description": "Learn more about our history and mission",
    "author": "Content Team",
    "publishDate": "2026-01-25T00:00:00Z"
}

Response: 200 OK
{
    "documentId": "doc-uuid",
    "structureId": "structure-uuid",
    "metadata": {
        "title": "About Our Company",
        "description": "Learn more about our history and mission",
        "author": "Content Team",
        "publishDate": "2026-01-25T00:00:00Z"
    },
    "conformsToSchema": true,
    "validationErrors": [],
    "lastModifiedAt": "2026-01-23T10:30:00Z"
}

Errors:
- 400 Bad Request: Schema validation failed (when enforcement is "strict")
```

#### Delete Document Metadata

```
DELETE /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/documents/{documentId}/metadata

Response: 204 No Content
```

#### List Document Metadata

```
GET /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/metadata?conforming=false

Response: 200 OK
{
    "documents": [
        {
            "documentId": "doc-uuid-1",
            "documentPath": "pages/old-page",
            "metadata": {
                "title": "Old Page"
            },
            "conformsToSchema": false,
            "validationErrors": [
                { "field": "author", "message": "Required field missing" }
            ]
        }
    ]
}

Query Parameters:
- conforming: Filter by schema conformance (true, false, or omit for all)
```

#### Bulk Update Metadata

Update metadata for multiple documents in a single request.

```
PATCH /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/metadata/bulk

Request:
{
    "updates": [
        {
            "documentId": "doc-uuid-1",
            "metadata": {
                "title": "Updated Title 1",
                "author": "New Author"
            }
        },
        {
            "documentId": "doc-uuid-2",
            "metadata": {
                "title": "Updated Title 2",
                "author": "New Author"
            }
        }
    ]
}

Response: 200 OK
{
    "updated": [
        { "documentId": "doc-uuid-1", "conformsToSchema": true },
        { "documentId": "doc-uuid-2", "conformsToSchema": true }
    ],
    "errors": []
}

Notes:
- Useful for applying common metadata (e.g., author) to many documents
- Validates each against schema; returns validation errors per document
- In strict mode, entire batch fails if any document fails validation
- In warn mode, updates proceed and errors are returned for review
```

#### Bulk Migrate Metadata

Copy metadata from one structure to another, useful when restructuring content.

```
POST /api/sites/{siteId}/branches/{branchId}/structures/{structureId}/metadata/migrate

Request:
{
    "sourceStructureId": "old-structure-uuid",
    "documentIds": ["doc-uuid-1", "doc-uuid-2", "doc-uuid-3"],
    "fieldMapping": {
        "old_title": "title",
        "old_author": "author"
    }
}

Response: 200 OK
{
    "migrated": [
        { "documentId": "doc-uuid-1", "conformsToSchema": true },
        { "documentId": "doc-uuid-2", "conformsToSchema": false, "errors": [...] }
    ]
}

Notes:
- Copies and optionally transforms metadata between structures
- fieldMapping allows renaming fields during migration
- Validates against target structure's schema
```

---

## Implementation Considerations

### Authorization

All endpoints should follow the existing authorization pattern:

| Endpoint Category | Required Permission |
|-------------------|---------------------|
| Site (read) | `canView` on any site branch |
| Site (write) | ADMIN role (site-level) |
| Document CRUD | `canEdit` on site |
| Structure (read) | `canView` on branch |
| Structure (write) | `canEdit` on branch |
| Node operations | `canEdit` on branch |
| Metadata operations | `canEdit` on branch |

### Audit Events

New audit event types to add:

```typescript
// Site events
'site.created'
'site.updated'
'site.deleted'

// Document CRUD events
'document.created'
'document.path_updated'
'document.deleted'

// Structure events
'structure.created'
'structure.updated'
'structure.deleted'
'structure.node_created'
'structure.node_updated'
'structure.node_moved'
'structure.node_deleted'
'structure.nodes_reordered'
'structure.schema_updated'

// Metadata events
'metadata.updated'
'metadata.deleted'
```

### Route Organization

Suggested file organization:

```
workers/src/routes/
├── branch-api.ts       (existing - Phase 7.1)
├── checkpoint-api.ts   (existing - Phase 7.1)
├── merge-api.ts        (existing - Phase 7.1)
├── site-api.ts         (new - this proposal)
├── document-api.ts     (new - this proposal)
├── structure-api.ts    (new - this proposal)
├── metadata-api.ts     (new - this proposal)
└── index.ts            (router aggregation)
```

---

## Decisions Made

| Decision | Date | Resolution |
|----------|------|------------|
| Structure API scope | 2026-01-24 | Branch-scoped. All structure changes (including name, slug) are isolated per-branch until merged. This matches document behavior and enables full version control of site refactoring. |
| Site deletion protection | 2026-01-24 | Prevent deletion of sites with non-archived branches. Sites can only be deleted when all branches are archived or merged. |
| Document deletion | 2026-01-24 | Soft-delete with archival. Documents are marked as archived rather than hard-deleted, preserving version history for audit and potential recovery. |
| Bulk operations | 2026-01-24 | Yes, add batch endpoints. Useful for reordering nodes or migrating documents between structures. |

---

## Implementation Phases

This proposal should be implemented in two sub-phases:

### Phase 7.1.1a: Schema Migration

**Prerequisite:** Must complete before API implementation.

1. Create migration `007_branch_scoped_structures.sql`
2. Update `structure-service.ts` to read/write from `branch_structure_state`
3. Update `checkpoint-service.ts` to capture/restore structure identity
4. Update `branch-service.ts` to copy structure state on branch creation
5. Update conflict detection for structure identity changes
6. Run tests, fix any regressions
7. Security review

### Phase 7.1.1b: Resource Management APIs

**Depends on:** Phase 7.1.1a schema migration.

1. Site API routes + tests
2. Document CRUD API routes + tests
3. Structure API routes + tests (using new branch-scoped schema)
4. Node API routes + tests
5. Metadata API routes + tests
6. Security review
7. Update PROGRESS.md

---

## Status

**All open questions resolved.** This proposal is ready for implementation.

### Summary of Changes from Original Draft

1. **Schema migration required** — Structure identity moved to `branch_structure_state` for branch-scoped versioning
2. **Site deletion protection** — Prevents deletion when non-archived branches exist
3. **Document soft-delete** — Archive rather than hard-delete, with restore endpoint
4. **Bulk operations added** — Node bulk CRUD, migration, and metadata bulk update/migrate

---

*Prepared: 2026-01-23*
*Updated: 2026-01-24 — Resolved all open questions, added schema migration and bulk operations*
