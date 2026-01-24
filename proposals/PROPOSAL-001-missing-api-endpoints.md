# Proposal 001: Missing API Endpoints

**Status:** Draft
**Date:** 2026-01-23
**Author:** Claude (via collaborative session)
**Affects:** Phase 7 API Layer, Architecture v2.2

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

Errors:
- 404 Not Found: Site does not exist
- 409 Conflict: Site has active branches (optional protection)
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

#### Delete Document

```
DELETE /api/sites/{siteId}/documents/{documentId}

Response: 204 No Content

Errors:
- 404 Not Found: Document does not exist
```

---

### 3. Structure API

Site structure management endpoints based on the TypeScript interface defined in architecture lines 2225-2342.

#### Create Structure

```
POST /api/sites/{siteId}/structures

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
    "siteId": "site-uuid",
    "name": "Main Navigation",
    "slug": "main-nav",
    "description": "Primary site navigation",
    "structureType": "hierarchy",
    "createdAt": "2026-01-23T10:00:00Z"
}

Errors:
- 400 Bad Request: Invalid parameters
- 404 Not Found: Site does not exist
- 409 Conflict: Structure with slug already exists
```

#### List Structures

```
GET /api/sites/{siteId}/structures?type=hierarchy

Response: 200 OK
{
    "structures": [
        {
            "id": "structure-uuid",
            "name": "Main Navigation",
            "slug": "main-nav",
            "structureType": "hierarchy",
            "createdAt": "2026-01-23T10:00:00Z"
        }
    ]
}

Query Parameters:
- type: Filter by structureType (hierarchy, collection)
```

#### Get Structure

```
GET /api/sites/{siteId}/structures/{structureId}

Response: 200 OK
{
    "id": "structure-uuid",
    "siteId": "site-uuid",
    "name": "Main Navigation",
    "slug": "main-nav",
    "description": "Primary site navigation",
    "structureType": "hierarchy",
    "createdAt": "2026-01-23T10:00:00Z"
}
```

#### Update Structure

```
PATCH /api/sites/{siteId}/structures/{structureId}

Request:
{
    "name": "Primary Navigation",
    "description": "Updated description"
}

Response: 200 OK
{
    "id": "structure-uuid",
    "siteId": "site-uuid",
    "name": "Primary Navigation",
    "slug": "main-nav",
    "description": "Updated description",
    "structureType": "hierarchy",
    "createdAt": "2026-01-23T10:00:00Z"
}
```

#### Delete Structure

```
DELETE /api/sites/{siteId}/structures/{structureId}

Response: 204 No Content
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

## Proposed Phase

**Phase 7.1.1: Resource Management APIs**

After Phase 7.1 (REST API Endpoints) completes:

1. Add TDD tests for Site API routes
2. Implement Site API routes
3. Add TDD tests for Document CRUD API routes
4. Implement Document CRUD API routes
5. Add TDD tests for Structure API routes
6. Implement Structure API routes
7. Add TDD tests for Metadata API routes
8. Implement Metadata API routes
9. Security review
10. Update PROGRESS.md

---

## Open Questions

1. **Site deletion protection:** Should we prevent deletion of sites with active (non-archived) branches?

2. **Document deletion cascade:** When a document is deleted, should we:
   - Delete all versions across all branches?
   - Only allow deletion if no versions exist?
   - Soft-delete with archival?

3. **Structure API scope:** Should structure definitions be branch-scoped or site-scoped? Current architecture suggests site-scoped with branch-scoped state.

4. **Bulk operations:** Should we add batch endpoints for creating/updating multiple nodes or metadata entries?

---

## Decision Needed

Please review and confirm:

1. Proceed with this proposal as Phase 7.1.1?
2. Any endpoints to add/remove/modify?
3. Answers to open questions above?

---

*Prepared: 2026-01-23*
