# PROPOSAL-010: Content Types and Template Migration -- Backend API Reference

All endpoints are branch-scoped. The `{branchId}` parameter accepts either a UUID or a branch name (e.g., `main`).

All request/response bodies are JSON. Authentication is required on all endpoints (bearer token).

## Base URL

```
/api/sites/{siteId}/branches/{branchId}
```

---

## Template CRUD

Templates are stored as versioned documents at `_registry/templates/{name}`. All write operations (POST, PATCH, DELETE) require **ADMIN** role. Read operations (GET) require **VIEWER** or above.

### List Templates

```
GET /api/sites/{siteId}/branches/{branchId}/templates
```

Returns all templates on the branch. Templates are branch-scoped -- a template edited on a feature branch only appears in that branch's listing.

**Response** `200`

```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "blog",
      "label": "Blog Post",
      "description": "Standard structure for all blog posts",
      "defaultUrlPattern": "/blog/:year/:month/:slug",
      "deprecated": false,
      "components": [
        {
          "type": "HeroBlock",
          "pinned": true,
          "defaultProps": { "title": "", "subtitle": "" }
        },
        {
          "type": "BodyBlock",
          "pinned": true,
          "defaultProps": { "content": "" }
        },
        {
          "type": "CTABlock",
          "pinned": false,
          "defaultProps": { "label": "Learn more", "url": "" }
        }
      ]
    }
  ]
}
```

### Get Template

```
GET /api/sites/{siteId}/branches/{branchId}/templates/{templateId}
```

**Response** `200` -- same shape as a single item in the list response.

**Errors:** `404` template not found, `400` document is not a template.

### Create Template

```
POST /api/sites/{siteId}/branches/{branchId}/templates
```

Requires **ADMIN** role.

**Request Body**

```json
{
  "name": "blog",
  "label": "Blog Post",
  "description": "Standard structure for all blog posts",
  "defaultUrlPattern": "/blog/:year/:month/:slug",
  "components": [
    {
      "type": "HeroBlock",
      "pinned": true,
      "defaultProps": { "title": "", "subtitle": "" }
    }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Alphanumeric, hyphens, underscores only. Becomes the document path suffix. |
| `label` | Yes | Display name shown in the template selector UI. |
| `description` | No | |
| `defaultUrlPattern` | No | Suggested URL pattern for documents created from this template (frontend hint only, not enforced). |
| `components` | Yes | Array of component definitions. |
| `components[].type` | Yes | Puck component type name (e.g., `HeroBlock`). |
| `components[].pinned` | Yes | If `true`, the component cannot be moved or deleted by editors. |
| `components[].defaultProps` | Yes | Default prop values for the component. |

**Response** `201` -- created template with `id`.

**Errors:** `400` validation (missing name/label, invalid name format, components not an array), `403` non-admin, `409` duplicate name.

### Update Template

```
PATCH /api/sites/{siteId}/branches/{branchId}/templates/{templateId}
```

Requires **ADMIN** role. Partial update -- only include fields to change. The `name` field cannot be changed.

**Request Body** (all fields optional)

```json
{
  "label": "Updated Label",
  "description": "Updated description",
  "defaultUrlPattern": "/blog/:slug",
  "deprecated": true,
  "components": [
    { "type": "HeroBlock", "pinned": true, "defaultProps": {} },
    { "type": "StatsBlock", "pinned": true, "defaultProps": {} },
    { "type": "BodyBlock", "pinned": true, "defaultProps": {} }
  ]
}
```

Each update creates a new template version. The version history is used by the migration system to compute structural deltas.

**Response** `200` -- updated template.

**Errors:** `403` non-admin, `404` not found.

### Delete Template

```
DELETE /api/sites/{siteId}/branches/{branchId}/templates/{templateId}
```

Requires **ADMIN** role. Blocked if any documents still reference the template.

**Response** `204` no content.

**Errors:** `403` non-admin, `404` not found, `409` documents still reference this template (includes count in error message).

---

## Document Creation from Template

Existing document creation endpoint, extended with optional template fields.

### Create Document from Template

```
POST /api/sites/{siteId}/branches/{branchId}/documents
```

**Request Body**

```json
{
  "path": "blog/my-first-post",
  "snapshot": { ... },
  "templateId": "uuid-of-blog-template",
  "templateVersion": 3
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `path` | Yes | Document path. Any valid path -- `defaultUrlPattern` is not enforced. |
| `snapshot` | No | Initial Puck snapshot. If creating from a template, the frontend should generate this from the template's component skeleton. |
| `templateId` | No | UUID of the template document. Omit for a blank document. |
| `templateVersion` | No | Version number of the template at creation time. Used for migration tracking. |

**Response** `201` -- created document with `id`.

**Errors:** `400` if template is deprecated ("Cannot create document from deprecated template"), `403` if path is under `_registry/templates/` and user is not admin.

### Converting a Template to an Initial Snapshot

The frontend is responsible for converting a template's component list into a valid Puck snapshot. Example:

```typescript
function templateToInitialSnapshot(template: Template): PuckData {
  return {
    content: template.components.map(c => ({
      type: c.type,
      props: {
        id: generateId(c.type),
        ...c.defaultProps,
      },
    })),
    root: { props: {} },
    zones: {},
  };
}
```

---

## Puck Editor Integration

### Pinned Component Permissions

When opening a templated document for editing, the frontend should fetch the template and use Puck's `resolvePermissions` to enforce pinning:

```typescript
const resolvePermissions = ({ type }) => {
  const templateComponent = template?.components.find(c => c.type === type);
  const isPinned = templateComponent?.pinned ?? false;
  const isJuniorEditor = userRole === 'junior_editor';

  return {
    edit: true,
    drag: !isPinned,
    delete: !isPinned,
    insert: !isJuniorEditor,
    duplicate: !isJuniorEditor,
  };
};
```

Pinning is resolved dynamically from the live template definition, not baked into the document at creation time. If a component's pinned status changes in the template, the constraint takes effect immediately for all documents on that branch without requiring a migration.

### Structural Action Capture (onAction forwarding)

The frontend must capture Puck's structural actions and forward them at save/checkpoint time. This data powers the migration conflict detection system.

```typescript
const pendingStructuralActions = useRef<PuckAction[]>([]);

const handlePuckAction = (action: PuckAction) => {
  if (action.type === 'reorder' || action.type === 'move') {
    pendingStructuralActions.current.push(action);
  }
};

// At save time, include in the checkpoint/save request:
await saveDocument({
  ...snapshot,
  puckActions: pendingStructuralActions.current,
});
pendingStructuralActions.current = [];
```

The backend stores these in `action_type` and `action_metadata` on `document_versions`. When no `puckActions` are forwarded (e.g., programmatic edits via MCP), the backend falls back to RFC 6902 patch-path analysis.

---

## Template Migration

Migration updates documents to match a newer version of their template's structural skeleton. Triggered manually by an admin after editing a template.

### Trigger Migration

```
POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migrate
```

Requires **ADMIN** role. Runs synchronously.

**Request Body** (all fields optional)

```json
{
  "fromVersion": 2,
  "toVersion": 5
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `fromVersion` | `toVersion - 1` | Starting template version. Documents with `template_version >= fromVersion` are skipped. |
| `toVersion` | Latest template version | Target template version. |

**Response** `200`

```json
{
  "job": {
    "id": "uuid",
    "siteId": "uuid",
    "branchId": "uuid",
    "templateId": "uuid",
    "fromVersion": 2,
    "toVersion": 5,
    "checkpointId": "uuid",
    "status": "completed",
    "totalDocuments": 150,
    "processedDocuments": 150,
    "createdById": "uuid",
    "createdByType": "user",
    "createdAt": "2026-06-12T10:00:00.000Z",
    "completedAt": "2026-06-12T10:00:02.000Z"
  },
  "processedDocuments": 148,
  "conflictedDocuments": 2
}
```

**How it works:**
1. Creates a pre-migration checkpoint for rollback
2. Extracts the template's structural delta between the version range
3. Finds all documents with `template_id` matching and `template_version < toVersion`
4. For each document:
   - If the document has no structural edits since last migration (prop-only changes): applies the delta automatically
   - If the document has structural edits that overlap with the template delta: routes to the conflict queue
   - If the delta application fails structural validation: routes to the conflict queue
5. Updates `template_version` on successfully migrated documents

**Errors:** `400` invalid version range (from >= to), `403` non-admin, `404` template not found.

### Rollback Migration

```
POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/rollback
```

Requires **ADMIN** role.

**Request Body**

```json
{
  "jobId": "uuid-of-migration-job"
}
```

**Response** `200`

```json
{
  "rolledBackDocuments": 148
}
```

Reverts to the pre-migration checkpoint and resets `template_version` on affected documents.

**Errors:** `403` non-admin, `404` job not found.

---

## Migration Job and Conflict Management

Separate endpoints for viewing migration status and resolving conflicts.

### Get Migration Job

```
GET /api/sites/{siteId}/branches/{branchId}/migrations/{jobId}
```

Requires **ADMIN** role.

**Response** `200` -- MigrationJob object (same shape as `job` in the migrate response).

### List Migration Conflicts

```
GET /api/sites/{siteId}/branches/{branchId}/migrations/{jobId}/conflicts
```

Requires **ADMIN** role.

**Response** `200`

```json
{
  "conflicts": [
    {
      "id": "uuid",
      "migrationJobId": "uuid",
      "documentId": "uuid",
      "branchId": "uuid",
      "templateId": "uuid",
      "fromVersion": 2,
      "toVersion": 5,
      "templateDelta": {
        "added": [
          {
            "component": { "type": "CtaBlock", "props": { "id": "CtaBlock-c3d4", "label": "Sign up" } },
            "placement": { "zone": null, "precedingIds": ["BodyBlock-b2c3"] }
          }
        ],
        "removed": ["PromoBlock-p9q8"],
        "moved": [
          { "id": "HeroBlock-a1b2", "placement": { "zone": null, "precedingIds": [] } }
        ],
        "templateIds": ["HeroBlock-a1b2", "BodyBlock-b2c3", "CtaBlock-c3d4", "PromoBlock-p9q8"]
      },
      "documentDelta": {
        "added": [],
        "removed": [],
        "moved": [
          { "id": "HeroBlock-a1b2", "placement": { "zone": null, "precedingIds": ["BodyBlock-b2c3"] } }
        ],
        "templateIds": ["HeroBlock-a1b2", "BodyBlock-b2c3"]
      },
      "resolution": null,
      "createdAt": "2026-06-12T10:00:01.000Z",
      "resolvedAt": null
    }
  ]
}
```

Both `templateDelta` and `documentDelta` are slot-delta objects: an id-keyed diff of two snapshots. `added` carries new components with their placement (destination `zone`, and the `precedingIds` that sit before them there); `removed` lists slot ids; `moved` repositions surviving slot ids; `templateIds` is the union of slot ids in either snapshot. `templateDelta` is the template's diff between its two versions; `documentDelta` is the document's own diff since its last migration baseline. When both deltas touch the same slot id, it's a conflict.

### Resolve Conflict

```
POST /api/sites/{siteId}/branches/{branchId}/migrations/{jobId}/conflicts/{conflictId}/resolve
```

Requires **ADMIN** role.

**Request Body**

```json
{
  "resolution": "apply"
}
```

| Resolution | Effect |
|-----------|--------|
| `apply` | Force the template delta onto the document, overwriting the editor's structural customization. Updates `template_version`. |
| `skip` | Leave the document as-is. It will not receive this migration. |
| `manual` | Records the resolution as manual. The admin is expected to edit the document directly. |

**Response** `200` -- updated MigrationConflict object with `resolution` and `resolvedAt` set.

---

## Role Matrix

| Action | Admin | Editor | Junior Editor | Viewer |
|--------|-------|--------|---------------|--------|
| List templates | Yes | Yes | Yes | Yes |
| Get template | Yes | Yes | Yes | Yes |
| Create template | Yes | No | No | No |
| Update template | Yes | No | No | No |
| Delete template | Yes | No | No | No |
| Deprecate template | Yes | No | No | No |
| Create document from template | Yes | Yes | Yes | No |
| Edit prop values on any component | Yes | Yes | Yes | No |
| Add/remove/move non-pinned components | Yes | Yes | No | No |
| Move/delete pinned components | No | No | No | No |
| Trigger migration | Yes | No | No | No |
| Rollback migration | Yes | No | No | No |
| View/resolve conflicts | Yes | No | No | No |

Note: Pinned component constraints are enforced in the Puck editor via `resolvePermissions`, not by the backend. Structural conformance is checked via `validateDocumentStructure` in the MCP tool layer as an advisory post-edit validation; the REST and Durable Object write paths do not enforce structural conformance. If validation fails, the MCP agent is advised to call `abort_edit_session` to rollback.

---

## Template Deprecation

Templates can be deprecated by setting `deprecated: true` via PATCH. Deprecated templates:

- Still appear in the template list (with `deprecated: true` in the response)
- Block new document creation ("Cannot create document from deprecated template")
- Do not affect existing documents -- editors can still edit them
- Can still receive migrations (if the admin edits and migrates before fully retiring)

To fully retire a template, first deprecate it, then delete it once all referencing documents are disassociated or removed.

---

## Merge-Time Behavior

Template documents at `_registry/templates/` are included in branch merges (unlike other `_registry/` paths which are excluded). When a branch with template edits is merged to the target branch:

1. The template document is merged like any other document
2. After the merge completes, the system detects if any documents on the target branch reference the merged template with a stale `template_version`
3. If stale documents exist, a migration is automatically triggered (best-effort -- failures are logged but do not roll back the merge)

This means the admin flow for propagating template changes is:
1. Create a feature branch
2. Edit the template on the branch
3. Trigger migration on the branch to preview impact
4. Merge the branch -- template changes and document migrations propagate to the target
