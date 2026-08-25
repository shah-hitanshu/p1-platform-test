# Proposal 002: Site Templates

**Status:** Draft
**Date:** 2026-01-25
**Author:** Claude (via collaborative session)
**Affects:** Site Service, Branch Service, Structure Service, Merge Services, API Layer

---

## Summary

This proposal adds two related capabilities:

1. **Site Copy:** Create a new site as a copy of an existing site (or designated template). The copy includes documents and structure but **not** branches, checkpoints, or version history. The new site starts fresh with a clean `main` branch containing the copied content.

2. **Template Sync:** Push or pull changes between a template site and its descendant sites. This enables ongoing synchronization of shared content, components, and structure while preserving local customizations.

A site can have at most one template association.

---

## Use Cases

### Site Copy

1. **Agency workflow:** Create new client sites from a starter template with pre-built components and structure
2. **Multisite management:** Clone an existing site to create a staging or regional variant
3. **Design system rollout:** Distribute a reference implementation to multiple sites

### Template Sync

4. **Component library updates:** Push updated header/footer components to all client sites
5. **Legal compliance:** Push updated privacy policy or terms pages to all descendant sites
6. **Brand refresh:** Distribute new branding elements across a portfolio of sites
7. **Bug fixes:** Fix a component issue in the template and push the fix to all sites using it
8. **Selective adoption:** Site owners pull specific updates from the template when ready

---

## Design Principles

### What Gets Copied

| Entity | Copied | Notes |
|--------|--------|-------|
| Documents | Yes | New IDs, same paths |
| Latest document content | Yes | From source `main` branch, becomes version 1 |
| Site structures | Yes | New IDs |
| Structure nodes | Yes | New IDs, remapped references |
| Branch structure state | Yes | Copied to new `main` |
| Document metadata | Yes | Copied to new `main` |

### What Does NOT Get Copied

| Entity | Copied | Rationale |
|--------|--------|-----------|
| Branches (other than main) | No | New site starts fresh |
| Checkpoints | No | No history to preserve |
| Document version history | No | Only current state matters |
| Branch grants | No | New site, new permissions |
| Merge requests | No | No branches to merge |
| Guest links | No | Access must be re-granted |
| Workflow settings | Configurable | Can inherit or override |

---

## Schema Changes

### Phase 1: Copy with Lineage Tracking

Track where a site came from:

```sql
-- Migration: 009_site_templates.sql

-- Track template relationship (a site can have at most one template)
ALTER TABLE app.sites ADD COLUMN template_site_id UUID REFERENCES app.sites(id);
```

This allows querying "which sites were created from this template" while keeping the model simple.

### Phase 2: Sync State Tracking

Track synchronization state for ongoing updates:

```sql
-- Migration: 010_template_sync.sql

-- Track last sync point
ALTER TABLE app.sites ADD COLUMN template_last_synced_checkpoint_id UUID;
ALTER TABLE app.sites ADD COLUMN template_last_synced_at TIMESTAMPTZ;

-- Sync preferences
ALTER TABLE app.sites ADD COLUMN template_sync_mode TEXT DEFAULT 'manual';
-- Values: 'manual' (default), 'notify' (alert when updates available)
```

### Optional: Explicit Template Flag

If templates should be discoverable as a distinct category (Phase 3):

```sql
ALTER TABLE app.sites ADD COLUMN is_template BOOLEAN DEFAULT FALSE;
```

**Recommendation:** Start with Phase 1 schema. Add Phase 2 when implementing sync. Add `is_template` later if needed for UI filtering.

---

## Service Layer

### Site Template Service (Phase 1: Copy)

New service: `workers/src/services/site-template-service.ts`

```typescript
interface CopySiteParams {
  templateSiteId: string;
  newPantheonSiteId: string;
  newName: string;
  workflowSettings?: Partial<WorkflowSettings>;  // Override or inherit
  actor: {
    id: string;
    type: ActorType;
  };
}

interface CopySiteResult {
  site: Site;
  mainBranch: Branch;
  documentsCopied: number;
  structuresCopied: number;
}

interface SiteTemplateService {
  /**
   * Create a new site by copying documents and structure from a template site.
   *
   * Copies from the template site's main branch:
   * - All documents (new IDs, same paths)
   * - Latest document versions (become version 1 on new main)
   * - All structures and nodes (new IDs, remapped references)
   * - Structure state and document metadata
   *
   * Does NOT copy:
   * - Other branches, checkpoints, version history
   * - Branch grants, merge requests, guest links
   */
  copySite(params: CopySiteParams): Promise<CopySiteResult>;

  /**
   * List sites that were created from a given template site.
   */
  listDescendants(templateSiteId: string): Promise<Site[]>;
}
```

### Implementation Strategy (Copy)

The copy operation is performed in a single transaction:

```typescript
async function copySite(params: CopySiteParams): Promise<CopySiteResult> {
  const templateSite = await getSite(params.templateSiteId);
  const templateMain = await getMainBranch(params.templateSiteId);
  const templateCheckpoint = await getLatestCheckpoint(templateMain.id);

  return await db.transaction(async (tx) => {
    // 1. Create new site with template reference
    const site = await createSite({
      pantheonSiteId: params.newPantheonSiteId,
      name: params.newName,
      workflowSettings: params.workflowSettings ?? templateSite.workflowSettings,
      templateSiteId: params.templateSiteId,
      templateLastSyncedCheckpointId: templateCheckpoint?.id,
      templateLastSyncedAt: new Date(),
    });

    // 2. Create main branch
    const mainBranch = await createMainBranch(site.id, params.actor);

    // 3. Copy documents (build ID mapping)
    const documentIdMap = await copyDocuments(tx, params.templateSiteId, site.id);

    // 4. Copy latest document versions
    await copyDocumentVersions(tx, templateMain.id, mainBranch.id, documentIdMap);

    // 5. Copy structures (build ID mapping)
    const structureIdMap = await copyStructures(tx, params.templateSiteId, site.id);

    // 6. Copy structure nodes (remap document and parent references)
    await copyStructureNodes(tx, structureIdMap, documentIdMap);

    // 7. Copy branch structure state
    await copyBranchStructureState(tx, templateMain.id, mainBranch.id, structureIdMap);

    // 8. Copy document metadata
    await copyDocumentMetadata(tx, templateMain.id, mainBranch.id, structureIdMap, documentIdMap);

    return {
      site,
      mainBranch,
      documentsCopied: documentIdMap.size,
      structuresCopied: structureIdMap.size,
    };
  });
}
```

### ID Remapping

The copy operation builds mapping tables for ID translation:

```typescript
// Document ID mapping: source ID -> new ID
const documentIdMap = new Map<string, string>();

// Structure ID mapping: source ID -> new ID
const structureIdMap = new Map<string, string>();

// Node ID mapping: source ID -> new ID (for parent references)
const nodeIdMap = new Map<string, string>();
```

Structure nodes reference both documents and parent nodes, so remapping is applied:

```typescript
async function copyStructureNodes(
  tx: Transaction,
  structureIdMap: Map<string, string>,
  documentIdMap: Map<string, string>
): Promise<Map<string, string>> {
  const nodeIdMap = new Map<string, string>();

  // Copy nodes in order (parents before children) to resolve references
  for (const [oldStructureId, newStructureId] of structureIdMap) {
    const nodes = await getNodesOrderedByDepth(tx, oldStructureId);

    for (const node of nodes) {
      const newNodeId = generateUUID();
      nodeIdMap.set(node.id, newNodeId);

      await tx.query(`
        INSERT INTO app.structure_nodes (
          id, structure_id, parent_node_id, position,
          name, slug, node_type, document_id, external_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        newNodeId,
        newStructureId,
        node.parentNodeId ? nodeIdMap.get(node.parentNodeId) : null,
        node.position,
        node.name,
        node.slug,
        node.nodeType,
        node.documentId ? documentIdMap.get(node.documentId) : null,
        node.externalUrl,
      ]);
    }
  }

  return nodeIdMap;
}
```

### Template Sync Service (Phase 2: Sync)

New service: `workers/src/services/template-sync-service.ts`

```typescript
interface SyncStatus {
  templateSiteId: string;
  templateName: string;
  lastSyncedAt: Date | null;
  lastSyncedCheckpointId: string | null;
  currentTemplateCheckpointId: string | null;
  updateAvailable: boolean;
  pendingChanges?: {
    documents: { added: number; modified: number; deleted: number };
    structures: { added: number; modified: number; deleted: number };
  };
}

interface SyncPreview {
  templateSiteId: string;
  templateCheckpointId: string;
  lastSyncedCheckpointId: string | null;
  changes: {
    documents: {
      added: string[];      // Document paths
      modified: string[];
      deleted: string[];
    };
    structures: {
      added: string[];      // Structure slugs
      modified: string[];
      deleted: string[];
    };
  };
  conflicts: SyncConflict[];
  canAutoMerge: boolean;
}

interface SyncConflict {
  type: 'document' | 'structure';
  path: string;                           // Document path or structure slug
  reason: 'both-modified' | 'deleted-in-template' | 'deleted-locally';
  templateVersion?: unknown;
  localVersion?: unknown;
}

interface SyncResult {
  success: boolean;
  syncedToCheckpointId: string;
  documentsUpdated: number;
  structuresUpdated: number;
  conflictsResolved: number;
}

interface PullParams {
  siteId: string;
  previewOnly?: boolean;
  conflictResolutions?: Array<{
    path: string;
    strategy: 'take-template' | 'keep-local' | 'merge-crdt';
  }>;
  actor: Actor;
}

interface PushParams {
  templateSiteId: string;
  targetSiteIds?: string[];       // All descendants if omitted
  previewOnly?: boolean;
  conflictStrategy: 'skip' | 'require-resolution';
  actor: Actor;
}

interface BatchSyncResult {
  templateCheckpointId: string;
  results: Array<{
    siteId: string;
    siteName: string;
    status: 'synced' | 'conflicts' | 'up-to-date' | 'skipped' | 'error';
    changes?: SyncPreview['changes'];
    conflicts?: SyncConflict[];
    error?: string;
  }>;
}

interface TemplateSyncService {
  /**
   * Get sync status for a site that has a template.
   */
  getSyncStatus(siteId: string): Promise<SyncStatus>;

  /**
   * Pull changes from template to descendant site.
   *
   * The sync operation is essentially a cross-site merge:
   * 1. Find the checkpoint the site was last synced to
   * 2. Compute what changed on template since that checkpoint
   * 3. Compute what changed locally since that checkpoint
   * 4. Detect conflicts (both modified same document/structure)
   * 5. Apply non-conflicting changes, present conflicts for resolution
   * 6. Update sync pointer
   */
  pullFromTemplate(params: PullParams): Promise<SyncPreview | SyncResult>;

  /**
   * Push changes from template to one or more descendant sites.
   *
   * This is a batch operation that applies pullFromTemplate to each target.
   */
  pushToDescendants(params: PushParams): Promise<BatchSyncResult>;

  /**
   * Change template association for a site.
   *
   * Warning: This resets sync state. The site will need to be
   * manually reconciled with the new template.
   */
  reassociateTemplate(params: {
    siteId: string;
    newTemplateSiteId: string | null;  // null to detach
    actor: Actor;
  }): Promise<void>;
}
```

### Sync Implementation Strategy

The sync operation leverages existing merge infrastructure:

```
Template main branch ──────────────────────► Descendant main branch
       │                                              │
       │ Changes since last sync                      │ Local changes since sync
       │                                              │
       └──────────────► MERGE ◄──────────────────────┘
                          │
                          ▼
                 Conflicts (if any)
```

**Key insight:** Sync is conceptually identical to a branch merge, except:
- It's cross-site instead of cross-branch
- The "source" is a template's main branch
- The "target" is a descendant site's main branch
- ID remapping is required (same documents may have different IDs across sites)

**ID Correlation:** Since documents are copied with new IDs, we correlate by **path**, not ID:

```typescript
// Find matching documents across sites by path
const templateDoc = templateDocuments.find(d => d.path === localDoc.path);
```

This means:
- Documents with matching paths are candidates for sync
- New documents in template (no matching path) are added
- Deleted documents in template (path no longer exists) trigger deletion
- Renamed paths are treated as delete + add (may need manual handling)

---

## API Endpoints

### Phase 1: Copy Site

```
POST /api/sites/{siteId}/copy

Request:
{
    "pantheonSiteId": "new-site-abc-123",
    "name": "New Site (Copy of Template)",
    "workflowSettings": {           // Optional, inherits if omitted
        "mergeApprovalMode": "required"
    }
}

Response: 201 Created
{
    "site": {
        "id": "new-site-uuid",
        "pantheonSiteId": "new-site-abc-123",
        "name": "New Site (Copy of Template)",
        "templateSiteId": "source-site-uuid",
        "templateLastSyncedAt": "2026-01-25T10:00:00Z",
        "workflowSettings": { ... },
        "createdAt": "2026-01-25T10:00:00Z"
    },
    "mainBranch": {
        "id": "new-main-branch-uuid",
        "name": "main",
        "isMain": true
    },
    "documentsCopied": 42,
    "structuresCopied": 3
}

Errors:
- 400 Bad Request: Invalid parameters
- 404 Not Found: Source site does not exist
- 409 Conflict: pantheonSiteId already exists
```

### List Descendant Sites

```
GET /api/sites/{siteId}/descendants

Response: 200 OK
{
    "sites": [
        {
            "id": "copy-1-uuid",
            "name": "Client A Website",
            "lastSyncedAt": "2026-01-20T10:00:00Z",
            "updateAvailable": true
        },
        {
            "id": "copy-2-uuid",
            "name": "Client B Website",
            "lastSyncedAt": "2026-01-22T14:00:00Z",
            "updateAvailable": false
        }
    ]
}
```

### Phase 2: Template Sync

#### Get Sync Status

```
GET /api/sites/{siteId}/template/status

Response: 200 OK
{
    "templateSiteId": "template-uuid",
    "templateName": "Starter Template",
    "lastSyncedAt": "2026-01-20T10:00:00Z",
    "lastSyncedCheckpointId": "checkpoint-uuid",
    "currentTemplateCheckpointId": "newer-checkpoint-uuid",
    "updateAvailable": true,
    "pendingChanges": {
        "documents": { "added": 2, "modified": 3, "deleted": 0 },
        "structures": { "added": 0, "modified": 1, "deleted": 0 }
    }
}

Errors:
- 404 Not Found: Site has no template association
```

#### Pull from Template

```
POST /api/sites/{siteId}/template/pull

Request:
{
    "previewOnly": true
}

Response (preview): 200 OK
{
    "templateSiteId": "template-uuid",
    "templateCheckpointId": "checkpoint-uuid",
    "lastSyncedCheckpointId": "old-checkpoint-uuid",
    "changes": {
        "documents": {
            "added": ["pages/new-feature"],
            "modified": ["pages/home", "components/header"],
            "deleted": ["pages/deprecated"]
        },
        "structures": {
            "added": [],
            "modified": ["main-nav"],
            "deleted": []
        }
    },
    "conflicts": [
        {
            "type": "document",
            "path": "pages/home",
            "reason": "both-modified",
            "templateVersion": { ... },
            "localVersion": { ... }
        }
    ],
    "canAutoMerge": false
}
```

```
POST /api/sites/{siteId}/template/pull

Request (execute with resolutions):
{
    "previewOnly": false,
    "conflictResolutions": [
        {
            "path": "pages/home",
            "strategy": "take-template"
        }
    ]
}

Response (execute): 200 OK
{
    "success": true,
    "syncedToCheckpointId": "new-checkpoint-uuid",
    "documentsUpdated": 5,
    "structuresUpdated": 1,
    "conflictsResolved": 1
}

Errors:
- 400 Bad Request: Unresolved conflicts remain
- 404 Not Found: Site has no template association
- 409 Conflict: Conflicts require resolution
```

#### Push to Descendants

```
POST /api/sites/{siteId}/template/push

Request:
{
    "targetSiteIds": ["site-a-uuid", "site-b-uuid"],  // Optional, all if omitted
    "previewOnly": true,
    "conflictStrategy": "skip"
}

Response: 200 OK
{
    "templateCheckpointId": "checkpoint-uuid",
    "results": [
        {
            "siteId": "site-a-uuid",
            "siteName": "Client A",
            "status": "ready",
            "changes": {
                "documents": { "added": [], "modified": ["pages/home"], "deleted": [] },
                "structures": { "added": [], "modified": [], "deleted": [] }
            },
            "conflicts": []
        },
        {
            "siteId": "site-b-uuid",
            "siteName": "Client B",
            "status": "conflicts",
            "conflicts": [
                {
                    "type": "document",
                    "path": "pages/home",
                    "reason": "both-modified"
                }
            ]
        }
    ]
}
```

```
POST /api/sites/{siteId}/template/push

Request (execute):
{
    "previewOnly": false,
    "conflictStrategy": "skip"  // Skip sites with conflicts
}

Response: 200 OK
{
    "templateCheckpointId": "checkpoint-uuid",
    "results": [
        {
            "siteId": "site-a-uuid",
            "siteName": "Client A",
            "status": "synced"
        },
        {
            "siteId": "site-b-uuid",
            "siteName": "Client B",
            "status": "skipped",
            "conflicts": [...]
        }
    ]
}
```

#### Detach from Template

```
DELETE /api/sites/{siteId}/template

Response: 200 OK
{
    "id": "site-uuid",
    "templateSiteId": null,
    "message": "Site detached from template"
}

Notes:
- Site retains all content but loses template association
- No further sync operations available
- Can be re-associated with a different template
```

#### Reassociate Template

```
PUT /api/sites/{siteId}/template

Request:
{
    "templateSiteId": "new-template-uuid"
}

Response: 200 OK
{
    "id": "site-uuid",
    "templateSiteId": "new-template-uuid",
    "templateLastSyncedAt": null,
    "message": "Template association changed. Manual reconciliation may be needed."
}

Warnings:
- Sync state is reset
- Next pull will compare against new template from scratch
- May result in many conflicts if content has diverged significantly
```

### Phase 3: Template Management (Optional)

If explicit template designation is needed for discoverability:

```
POST /api/sites/{siteId}/mark-as-template

Response: 200 OK
{
    "id": "site-uuid",
    "isTemplate": true
}

DELETE /api/sites/{siteId}/mark-as-template

Response: 200 OK
{
    "id": "site-uuid",
    "isTemplate": false
}

GET /api/templates

Response: 200 OK
{
    "templates": [
        {
            "id": "template-uuid",
            "name": "Starter Template",
            "descendantCount": 15
        }
    ]
}
```

---

## Content Reference Considerations

### Internal Document References

If document content (Puck component JSON) contains references to other documents, these references must use **paths** rather than **UUIDs** to survive copying:

```json
// GOOD - survives copy (paths are preserved)
{
  "type": "Link",
  "props": {
    "href": "/pages/about-us"
  }
}

// BAD - breaks on copy (UUIDs change)
{
  "type": "Link",
  "props": {
    "documentId": "uuid-123-456"
  }
}
```

**Recommendation:** Document this requirement for Puck component developers. Consider adding a content validation step that warns about UUID references.

### Structure Node Document References

Structure nodes reference documents by ID. The copy operation handles this by remapping:

- Source node: `documentId: "old-doc-uuid"`
- Copied node: `documentId: "new-doc-uuid"` (from mapping table)

This is handled automatically by the copy operation.

---

## Authorization

### Phase 1: Copy Operations

| Operation | Required Permission |
|-----------|---------------------|
| Copy site | `canView` on template site + ability to create sites (ADMIN or platform permission) |
| List descendants | `canView` on template site |

### Phase 2: Sync Operations

| Operation | Required Permission |
|-----------|---------------------|
| Get sync status | `canView` on site |
| Pull from template | `canEdit` on site's main branch + `canView` on template |
| Push to descendants | ADMIN on template site |
| Detach from template | ADMIN on site |
| Reassociate template | ADMIN on site |

### Phase 3: Template Management

| Operation | Required Permission |
|-----------|---------------------|
| Mark as template | ADMIN on site |
| List templates | Platform-level permission |

---

## Audit Events

```typescript
// Phase 1: Copy
'site.copied'                    // New site created from template

// Phase 2: Sync
'site.template.pull_started'     // Pull operation initiated
'site.template.pull_completed'   // Pull operation completed
'site.template.pull_failed'      // Pull operation failed
'site.template.push_started'     // Push operation initiated (batch)
'site.template.push_completed'   // Push operation completed
'site.template.detached'         // Site detached from template
'site.template.reassociated'     // Site associated with different template

// Phase 3: Template Management
'site.marked_template'           // Site designated as template
'site.unmarked_template'         // Template designation removed
```

Audit event context examples:

```typescript
// Copy event
{
  action: 'site.copied',
  resource: { type: 'site', id: newSiteId, siteId: newSiteId },
  context: {
    templateSiteId: templateSiteId,
    documentsCopied: 42,
    structuresCopied: 3,
  }
}

// Pull event
{
  action: 'site.template.pull_completed',
  resource: { type: 'site', id: siteId, siteId: siteId },
  context: {
    templateSiteId: templateSiteId,
    fromCheckpointId: oldCheckpointId,
    toCheckpointId: newCheckpointId,
    documentsUpdated: 5,
    structuresUpdated: 1,
    conflictsResolved: 1,
  }
}

// Push event
{
  action: 'site.template.push_completed',
  resource: { type: 'site', id: templateSiteId, siteId: templateSiteId },
  context: {
    targetSites: ['site-a', 'site-b'],
    sitesSynced: 1,
    sitesSkipped: 1,
    checkpointId: checkpointId,
  }
}
```

---

## Implementation Phases

### Phase 1: Core Copy Functionality

1. Schema migration: Add `template_site_id` to sites table
2. Implement `SiteTemplateService.copySite()`
3. Implement `SiteTemplateService.listDescendants()`
4. Add `POST /api/sites/{siteId}/copy` endpoint
5. Add `GET /api/sites/{siteId}/descendants` endpoint
6. Unit tests for service layer
7. Integration tests for API endpoints
8. Security review

**Estimated scope:** ~200-250 lines service code, ~80 lines API routes, ~150 lines tests

### Phase 2: Template Sync

1. Schema migration: Add sync tracking columns (`template_last_synced_checkpoint_id`, `template_last_synced_at`, `template_sync_mode`)
2. Implement `TemplateSyncService.getSyncStatus()`
3. Implement `TemplateSyncService.pullFromTemplate()` (preview mode)
4. Implement `TemplateSyncService.pullFromTemplate()` (execute mode)
5. Implement `TemplateSyncService.pushToDescendants()` (preview mode)
6. Implement `TemplateSyncService.pushToDescendants()` (execute mode)
7. Implement `TemplateSyncService.reassociateTemplate()`
8. Add sync API endpoints
9. Unit tests for sync service
10. Integration tests for sync API
11. Security review

**Estimated scope:** ~400-500 lines service code, ~150 lines API routes, ~300 lines tests

**Dependencies:** Reuses existing merge infrastructure (conflict detection, resolution strategies)

### Phase 3: Template Management (Optional)

Only if explicit template designation is needed for discoverability:

1. Schema migration: Add `is_template` flag
2. Template marking/unmarking endpoints
3. Template listing endpoint
4. UI for template browsing

---

## Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| Should workflow settings be inherited or required? | Resolved | Inherit by default, allow override |
| Should we track copy lineage? | Resolved | Yes, via `template_site_id` |
| Need explicit template flag? | Deferred | Start without it; add in Phase 3 if needed for discoverability |
| How to handle renamed document paths during sync? | Open | Treated as delete + add; may need manual handling |
| Should sync support selective content (e.g., only sync certain paths)? | Deferred | Start with all-or-nothing; add filtering later if needed |
| Content locking (forced sync for certain paths)? | Deferred | Consider for Phase 3 if compliance use cases arise |

---

## Related Considerations

### Document Paths vs. Structure Organization

As noted in PROGRESS.md, there's an architectural tension between:
- Document `path` field implying hierarchy
- Structure nodes controlling actual organization

For site templates and sync, this means:
- Documents are correlated by **path** across sites (not by ID)
- Structure organization is synced separately from document content
- The two remain independent (until the architectural decision is made)

This proposal does not depend on resolving that tension, but the path-based correlation for sync reinforces the importance of stable document paths.

### Sync and Merge Infrastructure Reuse

The sync operation is conceptually a cross-site merge. Key reusable components:

| Existing Component | Reuse in Sync |
|-------------------|---------------|
| `conflict-detection-service` | Detect conflicts between template and local changes |
| `conflict-resolution-service` | Apply resolution strategies |
| `crdt-merge-service` | CRDT-based content merging |
| `document-version-service` | Create new versions after sync |
| `checkpoint-service` | Record sync points |

The main new logic is **path-based correlation** across sites rather than ID-based matching within a site.

---

## Status

**Ready for review.**

- Phase 1 (Copy) has no blocking dependencies
- Phase 2 (Sync) depends on Phase 1 and reuses existing merge infrastructure

---

*Prepared: 2026-01-25*
*Updated: 2026-01-25 — Added Phase 2 (Template Sync) with push/pull capabilities*
