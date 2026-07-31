# PROPOSAL-010: Content Types and Template Migration

**Status:** Draft  
**Date:** 2026-05-18  
**Author:** Chris Yates (with Claude)  
**Jira:** [PCC-3225](https://getpantheon.atlassian.net/browse/PCC-3225) (story) · [PCC-3217](https://getpantheon.atlassian.net/browse/PCC-3217) (parent epic)  
**Affects:**
- CSS backend — new columns on `documents` and `document_versions`, new `_registry/templates/` path convention, migration queue job
- Puck editor integration — `onAction` forwarding at save time
- MCP server / agent worker — template-aware document creation, structural enforcement
- Role system — new template-editor capability tier

---

## TL;DR

Add a **content type system** to CSS that lets site admins define structural templates for documents (Blog, Event, Product, etc.), associate individual documents with a template, enforce structural conformance at write time, and propagate structural changes across all conforming documents when the template evolves — at scale, on branches, with rollback.

---

## Background and Motivation

Today every new document in CSS is a blank slate. Authors face an empty canvas and must construct each page from scratch. There is no mechanism to say "all blog posts should have a HeroBlock, a BodyBlock, and a CTABlock in that order" and have the system enforce it.

This creates three problems:

1. **Inconsistency** — documents of the same conceptual type diverge in structure because there is nothing enforcing a pattern.
2. **No structural evolution** — if the design team decides all blog posts should now include a StatsBlock between the BodyBlock and CTABlock, there is no way to propagate that change to the hundreds or thousands of existing blog posts without manual re-editing.
3. **Authoring friction** — editors must know what components to use and in what order, knowledge that should be encoded in the system, not in people's heads.

The site structure document (`PROPOSAL-site-structure`) describes a similar concept at the routing layer (path patterns with `:slug`). This proposal is complementary: it handles the *document structure* layer — what components appear in a document and in what order — independently of where that document lives in the URL hierarchy. A Blog template defines document structure; `/blog/:date/:slug` defines URL routing. They may be associated by default but are not coupled.

---

## Design

### 1. What a Template Is

A template is a CSS document stored at `_registry/templates/{name}` (e.g., `_registry/templates/blog`). Its snapshot describes the structural skeleton all documents of that type should conform to:

```json
{
  "name": "Blog",
  "label": "Blog Post",
  "description": "Standard structure for all blog posts",
  "defaultUrlPattern": "/blog/:year/:month/:slug",
  "components": [
    {
      "type": "HeroBlock",
      "pinned": true,
      "defaultProps": { "title": "", "subtitle": "", "background": "dark" }
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
```

**`pinned: true`** means Puck renders the component with `{ drag: false, delete: false }` permissions — the component is part of the structural skeleton and cannot be moved or removed by editors. Puck supports this today via its permissions API.

**`pinned: false`** means the component is included in the initial skeleton but editors with appropriate permissions can remove, move, or add components around it.

The template document is itself versioned by the existing CSS document version system. Every structural edit to a template creates a new version.

### 2. Document-Template Association

Two new nullable columns on the `documents` table:

```sql
ALTER TABLE app.documents
  ADD COLUMN template_id UUID REFERENCES app.documents(id),
  ADD COLUMN template_version INTEGER;
```

`template_id` is the document ID of the template document. `template_version` is the version number of that template document at the time the association was last established or migrated to. Together they allow the migration system to determine which documents are behind and by how much.

Not all documents need a template. A blank-slate document (today's default) has `template_id = NULL`.

### 3. Creating a Document from a Template

Today: user initiates new page creation → blank document.

With this proposal:

1. User initiates new page creation
2. System presents a template selector populated from `_registry/templates/` documents
3. User selects "Blog" (or selects "Blank" to get today's behavior)
4. A default URL pattern is suggested based on the template's `defaultUrlPattern`, with the user free to override it (subject to their role)
5. New CSS document created, initialized with the template's component skeleton in Puck's data format
6. `documents.template_id` set to the Blog template's document ID; `documents.template_version` set to current template version number
7. User edits content (prop values) within the structural skeleton

The Puck editor renders pinned components with `drag: false, delete: false` permissions. Editors can still edit prop values on pinned components; they just cannot remove or reorder them. Non-pinned components can be freely edited per the user's role.

### 4. Role-Based Editing

| Action | Admin | Editor | Junior Editor |
|---|---|---|---|
| Create/edit templates | ✓ | ✗ | ✗ |
| Create document from template | ✓ | ✓ | ✓ |
| Override default URL pattern | ✓ | ✓ | ✗ |
| Add/remove non-pinned components | ✓ | ✓ | ✗ |
| Edit prop values on any component | ✓ | ✓ | ✓ |
| Move non-pinned components | ✓ | ✓ | ✗ |

Template editing is an admin capability. This is enforced at the MCP server and agent worker level (structural validation rejects edits to `_registry/templates/` from non-admin principals) and at the Puck editor UI level (template edit mode only available to admins).

### 5. Structural Action Capture

#### The gap

The existing version system already computes an RFC 6902 JSON Patch per version. The patch encodes what bytes changed but not the semantic intent behind the change. A component moved from index 2 to index 0 produces a `remove` + `add` patch that is indistinguishable from a delete-at-2 followed by an insert-at-0.

The migration system needs to know the *intent* — specifically for template documents, where the action log is the migration delta. For regular documents, it is needed to detect whether a user's structural customisation conflicts with an incoming migration.

#### The mechanism

Puck's `onAction` callback ([docs](https://puckeditor.com/docs/api-reference/components/puck#onaction), [source](https://github.com/puckeditor/puck/blob/main/packages/core/types/API/index.ts)) triggers whenever Puck dispatches an action. Its signature is non-async (`(action, appState, prevAppState) => void`), indicating it fires on the dispatch call stack. Relevant action types include:

- `ReorderAction { type: "reorder", sourceIndex, destinationIndex, sourceZone, destinationZone }` — same-zone drag reorder
- `MoveAction { type: "move", sourceIndex, destinationIndex, sourceZone, destinationZone }` — cross-zone move

These are forwarded from the browser to the CSS backend at save/checkpoint time as an optional payload alongside the snapshot. The backend stores them in the currently-unused `action_type` and `action_metadata` columns on `document_versions`.

This applies to **all documents** — both template documents and regular documents — using the same code path. One mechanism, consistent data quality everywhere.

#### Data pattern

`action_type` (TEXT): one of:
- `null` — no structural change in this version (prop edits only)
- `"structural"` — at least one component was inserted, removed, or reordered

`action_metadata` (JSONB): when `action_type = "structural"`, contains the forwarded Puck action payload:

```json
{
  "puckActions": [
    {
      "type": "reorder",
      "sourceIndex": 2,
      "destinationIndex": 0,
      "sourceZone": "content",
      "destinationZone": "content"
    }
  ]
}
```

Multiple actions may be batched into a single version if the user performed several structural changes before saving.

#### What fills in the columns

At version creation time, the server-side code:

1. Inspects the RFC 6902 patch paths to classify the version as structural or prop-only (fast, always available as a fallback)
2. If the browser forwarded Puck actions with the save, stores them verbatim in `action_metadata`

If the browser did not forward actions (e.g., a programmatic edit via the MCP server or agent worker), the classification falls back to the patch-path analysis. This is slightly less precise but acceptable for non-interactive edits, which are already subject to the content validator for structural correctness.

### 6. Template Migration

#### How the delta is derived

When an admin edits a template document in the Puck editor and saves:

- A new template document version is created (e.g., v6)
- That version's `action_metadata` contains the `puckActions` from the edit session — the precise structural changes the admin made

The migration delta from v5 → v6 is simply the `action_metadata` entries on template versions 6 through N. No separate delta authoring step. The admin edits the template; the edit log becomes the migration spec.

#### Branch scoping

Template changes stay on the branch where they were made. The migration for documents on that branch runs within that branch context. The branch serves as the preview environment: admins can see exactly which documents would be affected and how before committing.

Migration propagates to main only via the publish action (bulk merge or individual page publish). At merge time, the migration runs against main-branch documents that share the same `template_id`.

#### Dry-run

Because the migration is branch-scoped, a dry-run is as simple as:

1. Create a feature branch
2. Edit the template on that branch
3. Trigger the migration preview — the system shows which documents would be updated, which have conflicts, and what changes would be applied
4. Discard the branch to abort with zero consequence
5. Merge the branch to commit

No separate dry-run infrastructure needed. The branch *is* the dry-run.

#### Migration execution

The migration job runs when:
- A template version increment is detected on a branch, AND
- The admin explicitly triggers migration (not automatic — intentional opt-in)

Execution:

1. **Enumerate** — query `documents` where `template_id = X AND template_version < current AND branch_id = Y`
2. **Enqueue** — one queue message per batch of ~50 documents
3. **Apply per document**:
   a. Load the document's current snapshot
   b. Check for conflict (see below)
   c. If clean: apply the template delta as edit ops in memory, write the new version, update `template_version`
   d. If conflict: write to a `migration_conflicts` review queue with both action sets visible

All writes use the existing document version infrastructure. A pre-migration checkpoint is written before any changes — enabling per-document rollback.

#### Conflict detection

A conflict occurs when:
- The template delta includes a structural action on a component (by type or position)
- The document's action log since its last `template_version` update includes a structural action on the *same* component

Example:
```
Template delta:  reorder HeroBlock from index 2 → index 0
Document log:    reorder HeroBlock from index 2 → index 3 (editor customisation)
Result:          conflict — both parties moved HeroBlock
```

Example:
```
Template delta:  insert CTABlock at end of content
Document log:    replace HeroBlock.props.title (prop edit only, no structural actions)
Result:          clean — no structural overlap, apply migration automatically
```

Documents with `action_metadata = null` since their last migration (prop-only edits) are always clean and migrate automatically. This is the common case and requires no human review.

#### Rollback

Each document gets a checkpoint written immediately before the migration applies. If a migration produces unexpected results:

- Per-document rollback: revert to the pre-migration checkpoint using the existing checkpoint/rollback system
- Bulk rollback: revert the entire branch and discard it

### 7. Scale

#### Throughput estimate

The migration processes documents in batches of 50, with queue parallelism across batches.

Per-document cost:
- Read latest snapshot: ~5ms (Hyperdrive, single row)
- Conflict check: ~1ms (in-memory comparison of action log)
- Apply delta in memory: ~2ms
- Write new version: amortized ~2ms in a bulk insert of 50

Per-batch cost: ~50ms for 50 documents = ~1,000 documents/second with sufficient queue parallelism.

At 10 concurrent queue workers: 10,000 documents/second → 100,000 documents in ~10 seconds.

The bottleneck is Hyperdrive connection limits. With production configuration (60+20=80 connections), throughput is bounded by ~800 concurrent DB operations — well within the batch-and-bulk-insert approach.

For very large corpora (millions of documents), the enumeration query itself becomes the bottleneck. An index on `(template_id, template_version, branch_id)` makes it fast.

### 8. What Needs to Be Built

**Schema changes:**
- `documents.template_id UUID NULL` — foreign key to template document
- `documents.template_version INTEGER NULL` — version at last migration
- Index on `(template_id, template_version, branch_id)` for migration enumeration
- `migration_conflicts` table for human review queue

**`_registry/templates/` path convention:**
- Template documents stored here; existing `_registry` exclusion in `list_documents` already hides them from content listings
- Admin-only write access enforced at the backend permission layer

**Puck editor integration (`onAction` forwarding):**
- Capture `ReorderAction` and `MoveAction` events via Puck's `onAction` callback
- Buffer actions during an edit session
- Forward them alongside the snapshot at save/checkpoint time
- Backend: store in `action_type` / `action_metadata` on `document_versions`

**Template selector UI:**
- New page creation flow prompts for template selection
- Populated from `list_documents({ pathPrefix: '_registry/templates/' })`
- "Blank" option preserves today's behavior

**Migration job:**
- Queue-based, triggered manually by admin after template edit
- Enumeration, conflict detection, bulk apply, conflict queue
- Pre-migration checkpoint per document

**Role enforcement:**
- Template edit access (admin only) at API and Puck editor level
- URL override permission (admin + editor)
- Structural freedom (admin + editor; junior editor prop-only)

**`validateDocumentStructure` — content validator library extension (PCC-3169 dependency):**
- New exported function in `@pantheon-systems/p1-content-validator`
- Validates that a document snapshot conforms to a template's structural skeleton — pinned components present, in correct order, no unexpected component type at a pinned slot
- Called at write time alongside `validateOps` for documents with a `template_id`
- Runs in the MCP server (`apply_document_edits`, `create_page`) and agent worker
- Also called by the migration job to validate migrated snapshots before writing

### 9. Relationship to Content Validator (PCC-3169)

This proposal depends on the content validator (`@pantheon-systems/p1-content-validator`) in two ways.

**Complementary validation layers.** The content validator operates at the component level — prop keys, enum values, id format. The template system operates at the document level — which components are present and in what order. Both should run on writes to template-associated documents:

1. Template conformance check (`validateDocumentStructure`) — "does this document have the required structural skeleton?"
2. Content validator (`validateOps`) — "does each component have valid props?"

A document can pass one and fail the other. They are not redundant.

**`validateDocumentStructure` as a library extension.** The content validator library is the correct home for document-level structural validation. It should gain a new exported function:

```ts
export function validateDocumentStructure(input: {
  snapshot: Record<string, unknown>;
  template: TemplateSnapshot;
}): { errors: StructuralConformanceError[] }
```

Error codes: `missing_pinned_component`, `pinned_component_out_of_order`, `unexpected_component_at_pinned_slot`.

This is Phase 2 of the content validator work and should be tracked as a follow-on to PCC-3169.

### 10. Open Questions

1. **Template inheritance** — should templates support inheritance (a "Featured Blog" template that extends "Blog" with one additional pinned component)? Deferred to follow-on proposal.

2. **Template deprecation** — what happens when a template is retired? Documents associated with it continue to exist; they just stop receiving migration updates. Should they be marked as "unmanaged"?

3. **Partial conformance** — is a document that has all the pinned components but additional non-pinned components considered conforming? Recommendation: yes, if all pinned components are present and in order, the document conforms.

4. **Cross-branch template versions** — if branch A and branch B both edit the same template independently, merging either to main creates a migration. The second merge would need to reconcile the two sets of template changes. This is the template-level equivalent of a document merge conflict. Deferred.

5. **Agent and MCP access to templates** — agents and the MCP server should be able to create documents from templates. Template selection should be a parameter to `create_page`. Structural conformance enforcement on agent writes is handled by `validateDocumentStructure` (see §9).

---

## Appendix: Implementation Sketches

### A. Schema Changes

**Migration file:** `workers/src/db/migrations/027_content_types.sql`

```sql
-- Template association on documents
ALTER TABLE app.documents
  ADD COLUMN template_id UUID REFERENCES app.documents(id),
  ADD COLUMN template_version INTEGER;

-- Efficient enumeration of documents needing migration
CREATE INDEX idx_documents_template_migration
  ON app.documents(template_id, template_version, branch_id)
  WHERE template_id IS NOT NULL;

-- Human review queue for conflicted migrations
CREATE TABLE app.migration_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES app.documents(id),
  branch_id       UUID NOT NULL REFERENCES app.branches(id),
  template_id     UUID NOT NULL REFERENCES app.documents(id),
  from_version    INTEGER NOT NULL,
  to_version      INTEGER NOT NULL,
  template_delta  JSONB NOT NULL,  -- structural puckActions from template versions
  document_actions JSONB NOT NULL, -- structural puckActions on the document since last migration
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT             -- 'apply' | 'skip' | 'manual'
);
```

The `action_type` and `action_metadata` columns already exist on `document_versions` (confirmed in the live database — present but empty). No schema change needed there, only population logic.

---

### B. Template Storage and Access Control

**Template document path:** `_registry/templates/{name}`

**Template snapshot shape** (TypeScript interface in `workers/src/types/template.ts`):

```ts
export interface TemplateComponent {
  type: string;
  pinned: boolean;           // if true: drag:false, delete:false in Puck
  defaultProps: Record<string, unknown>;
}

export interface TemplateSnapshot {
  name: string;
  label: string;
  description?: string;
  defaultUrlPattern?: string; // e.g. "/blog/:year/:month/:slug"
  components: TemplateComponent[];
}
```

**Access control** — in `workers/src/routes/document-api.ts`, add a check on write paths:

```ts
// In handleCreateDocument and handleApplyEdits (or the shared permission layer)
function requiresAdminForPath(path: string): boolean {
  return path.startsWith('_registry/templates/');
}

if (requiresAdminForPath(documentPath) && !context.actorHasAdminRole()) {
  return errorResponse('Modifying templates requires admin role', 403);
}
```

The `list_documents` exclusion for `_registry/` already filters templates from content listings (added in PCC-3169). `list_templates` becomes a first-class MCP tool and API endpoint:

```
GET /api/sites/{siteId}/branches/{branchId}/templates
→ lists documents at _registry/templates/ with their snapshots
```

---

### C. Puck Editor `onAction` Forwarding

This spans the frontend and the backend checkpoint path.

#### C.1 Frontend (Puck editor component)

File: wherever `<Puck>` is instantiated in the dashboard frontend.

```tsx
import { useState, useRef, useCallback } from 'react';
import type { PuckAction } from '@measured/puck';

// Accumulate structural actions during an edit session
const pendingStructuralActions = useRef<PuckAction[]>([]);

const handlePuckAction = useCallback(
  (action: PuckAction) => {
    // Capture only structural actions — Puck fires these on move/reorder
    if (action.type === 'reorder' || action.type === 'move') {
      pendingStructuralActions.current.push(action);
    }
  },
  [],
);

// Pass to Puck
<Puck
  config={puckConfig}
  data={puckData}
  onAction={handlePuckAction}
  onChange={handleChange}
/>
```

When the edit session completes (user hits Save / session complete call):

```ts
await completeEditSession({
  editSessionId,
  puckActions: pendingStructuralActions.current,  // forwarded to backend
});
pendingStructuralActions.current = [];
```

#### C.2 Backend — edit session complete endpoint

The `/agent-edit-complete` and the equivalent Yjs checkpoint path both accept an optional `puckActions` field in the request body. They pass it to `createDocumentVersion`.

**In `workers/src/services/document-version-service.ts`:**

```ts
// Add to createDocumentVersion params
export interface CreateDocumentVersionParams {
  // ... existing fields ...
  puckActions?: PuckAction[];  // forwarded from client
}

// Classification logic (added before the INSERT CTE)
function classifyChange(
  patch: JSONPatchOp[],
  puckActions?: PuckAction[],
): { actionType: string | null; actionMetadata: Record<string, unknown> | null } {
  const structural = puckActions?.length
    ? puckActions
    : patch.some(op => isStructuralPath(op.path))
      ? [{ type: 'derived' }]   // fallback: patch indicates structural change
      : null;

  if (!structural) return { actionType: null, actionMetadata: null };

  return {
    actionType: 'structural',
    actionMetadata: puckActions?.length
      ? { puckActions }
      : { derived: true },   // signals patch-derived, no precise intent
  };
}

// Path-level structural check (fallback when no puckActions forwarded)
function isStructuralPath(path: string): boolean {
  // /content/N (array element) but NOT /content/N/props/... or deeper
  return /^\/content\/\d+$/.test(path) || path === '/content';
}
```

The INSERT CTE already has `action_type` and `action_metadata` parameters — they just need to be populated:

```ts
const { actionType, actionMetadata } = classifyChange(forwardPatch, params.puckActions);
// Pass actionType and actionMetadata into the existing query at params $5 and $6
```

---

### D. Template Selector UI

#### D.1 Page creation flow change

The "New Page" flow gains a step before the path/slug input:

```
[Select Template]  →  [Set Path / Slug]  →  [Edit in Puck]
```

The template list is fetched from the new `/templates` endpoint:

```ts
const templates = await fetchTemplates(siteId, branchId);
// Returns [{ id, name, label, description, defaultUrlPattern, components }, ...]
```

The "Blank" option is always present and maps to `template_id = null`.

#### D.2 Converting a template to an initial Puck snapshot

```ts
import { generateId } from '@measured/puck';

function templateToInitialSnapshot(template: TemplateSnapshot): PuckData {
  return {
    content: template.components.map(c => ({
      type: c.type,
      props: {
        id: generateId(c.type),  // Puck's own UUID-based id generator
        ...c.defaultProps,
      },
    })),
    root: { props: {} },
    zones: {},
  };
}
```

#### D.3 Document creation API change

`POST /api/sites/{siteId}/branches/{branchId}/documents` gains optional fields:

```ts
interface CreateDocumentBody {
  path: string;
  snapshot: unknown;
  template_id?: string;      // document ID of the template
  template_version?: number; // version number of the template at creation time
}
```

The handler writes these to `documents.template_id` and `documents.template_version` atomically with the document creation.

---

### E. Migration Job

A new internal Cloudflare Worker (or a scheduled Durable Object alarm) triggered by an admin action.

#### E.1 Inputs

```ts
interface MigrationJobInput {
  siteId: string;
  branchId: string;
  templateId: string;         // document ID of the template
  fromTemplateVersion: number;
  toTemplateVersion: number;
}
```

#### E.2 Extract the template delta

```ts
async function getTemplateDelta(
  templateId: string,
  branchId: string,
  fromVersion: number,
  toVersion: number,
): Promise<PuckAction[]> {
  const rows = await query<{ action_metadata: { puckActions: PuckAction[] } }>(
    `SELECT action_metadata
     FROM app.document_versions
     WHERE document_id = $1
       AND branch_id = $2
       AND version_number > $3
       AND version_number <= $4
       AND action_type = 'structural'
     ORDER BY version_number ASC`,
    [templateId, branchId, fromVersion, toVersion],
  );
  // Flatten all puckActions from template versions into one ordered list
  return rows.flatMap(r => r.action_metadata?.puckActions ?? []);
}
```

#### E.3 Enumerate affected documents (cursor-paginated)

```sql
SELECT d.id, dv.snapshot, d.template_version
FROM app.documents d
JOIN app.document_versions dv
  ON dv.document_id = d.id
  AND dv.branch_id = $branch_id
  AND dv.is_latest = true
WHERE d.template_id = $template_id
  AND d.template_version < $to_version
  AND d.branch_id = $branch_id
ORDER BY d.id
LIMIT 50
OFFSET $cursor
```

#### E.4 Conflict detection per document

```ts
async function getDocumentStructuralActions(
  documentId: string,
  branchId: string,
  sinceVersion: number,
): Promise<PuckAction[]> {
  const rows = await query(
    `SELECT action_metadata
     FROM app.document_versions
     WHERE document_id = $1
       AND branch_id = $2
       AND version_number > $3
       AND action_type = 'structural'
     ORDER BY version_number ASC`,
    [documentId, branchId, sinceVersion],
  );
  return rows.flatMap(r => r.action_metadata?.puckActions ?? []);
}

function detectConflict(
  templateDelta: PuckAction[],
  documentActions: PuckAction[],
): boolean {
  // A conflict occurs when both the template and the document have structural
  // actions that affect the same component type in the same zone.
  // Simplified: check if any template action and any document action both
  // touch the same component type.
  const templateTypes = new Set(
    templateDelta.flatMap(a => extractComponentTypes(a)),
  );
  return documentActions.some(a =>
    extractComponentTypes(a).some(t => templateTypes.has(t)),
  );
}
```

#### E.5 Apply delta to snapshot

```ts
function applyTemplateDelta(snapshot: PuckData, delta: PuckAction[]): PuckData {
  let content = [...snapshot.content];
  for (const action of delta) {
    if (action.type === 'reorder') {
      const [item] = content.splice(action.sourceIndex, 1);
      content.splice(action.destinationIndex, 0, item);
    }
    // 'move' (cross-zone), 'insert', 'delete' handled similarly
  }
  return { ...snapshot, content };
}
```

#### E.6 Bulk write pattern (50 documents per batch)

```ts
// 1. Write pre-migration checkpoints for all documents in batch
await query(
  `INSERT INTO app.checkpoints (document_id, branch_id, snapshot, type, created_at)
   SELECT dv.document_id, $1, dv.snapshot, 'pre_migration', now()
   FROM app.document_versions dv
   WHERE dv.document_id = ANY($2) AND dv.is_latest = true`,
  [branchId, cleanDocumentIds],
);

// 2. Bulk insert new versions for clean documents
for (const { id, newSnapshot } of cleanDocuments) {
  await createDocumentVersion({
    documentId: id,
    branchId,
    snapshot: newSnapshot,
    source: 'migration',
    puckActions: [{ type: 'migration', fromVersion: fromTemplateVersion, toVersion: toTemplateVersion }],
  });
}

// 3. Update template_version atomically
await query(
  `UPDATE app.documents
   SET template_version = $1
   WHERE id = ANY($2)`,
  [toTemplateVersion, cleanDocumentIds],
);

// 4. Write conflicts to review queue
for (const { id, templateDelta, documentActions } of conflictedDocuments) {
  await query(
    `INSERT INTO app.migration_conflicts
       (document_id, branch_id, template_id, from_version, to_version,
        template_delta, document_actions)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, branchId, templateId, fromTemplateVersion, toTemplateVersion,
     JSON.stringify(templateDelta), JSON.stringify(documentActions)],
  );
}
```

#### E.7 Queue wiring

The migration job is triggered by a new API endpoint (admin-only):

```
POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migrate
Body: { fromVersion, toVersion }
```

This enqueues the job on the existing `SYNC_QUEUE` (or a dedicated `MIGRATION_QUEUE` if throughput warrants it). Each queue message covers one batch of 50 documents. The handler is a new consumer on the queue that runs the E.1–E.6 logic.

---

### F. Role Enforcement

#### F.1 Admin gate for template writes

In `workers/src/services/site-service.ts` or the document route context builder:

```ts
export function canWriteToPath(path: string, siteRole: SiteRole): boolean {
  if (path.startsWith('_registry/templates/')) {
    return siteRole === 'admin';
  }
  if (path.startsWith('_registry/')) {
    return false; // all other _registry/ paths blocked for all roles
  }
  return true;
}
```

This check runs in the document write handlers before any other logic.

#### F.2 URL override permission

The document creation endpoint checks whether the actor can set an arbitrary path vs. must use the template's default:

```ts
if (templateId && !isTemplateDefaultPath(path, templateDefaultUrlPattern)) {
  if (!actorCanOverrideUrl(siteRole)) {
    return errorResponse('Your role cannot override the default URL pattern', 403);
  }
}

function actorCanOverrideUrl(role: SiteRole): boolean {
  return role === 'admin' || role === 'editor';
}
```

#### F.3 Structural freedom in Puck (frontend)

When opening a document for editing, the frontend fetches the template (if any) and the user's role, then passes `resolvePermissions` to Puck:

```tsx
const resolvePermissions = useCallback(
  ({ type }: { type: string }, { appState }) => {
    const templateComponent = template?.components.find(c => c.type === type);
    const isPinned = templateComponent?.pinned ?? false;
    const isJuniorEditor = userRole === 'junior_editor';

    return {
      edit: true,
      // Pinned components: no drag/delete for anyone
      drag: !isPinned,
      delete: !isPinned,
      // Non-pinned components: junior editors are restricted
      insert: !isJuniorEditor,
      duplicate: !isJuniorEditor,
    };
  },
  [template, userRole],
);

<Puck
  config={puckConfig}
  data={puckData}
  resolvePermissions={resolvePermissions}
/>
```

`resolvePermissions` is called per component instance, so pinning is enforced dynamically based on the live template definition — not baked into the document at creation time. If a component is later pinned in the template, it immediately becomes undraggable in all documents on that branch without a migration needed.

---

### G. `validateDocumentStructure` — Content Validator Extension

**Package:** `@pantheon-systems/p1-content-validator` (follow-on to PCC-3169)
**Files:** `packages/p1-content-validator/src/types.ts`, `packages/p1-content-validator/src/structure-validator.ts`, `packages/p1-content-validator/src/index.ts`

#### New types

```ts
// In types.ts
export interface StructuralConformanceError {
  code:
    | 'missing_pinned_component'      // a pinned component is absent from content[]
    | 'pinned_component_out_of_order' // pinned components are not in the order the template specifies
    | 'unexpected_component_at_pinned_slot'; // wrong component type at a pinned position
  componentType: string;
  expectedIndex?: number;
  actualIndex?: number;
  message: string;
}

export interface ValidateStructureInput {
  snapshot: Record<string, unknown>;
  template: TemplateSnapshot;      // imported from workers/src/types/template.ts or inlined here
  config?: {
    contentKey?: string;           // default 'content'
  };
}
```

#### Implementation sketch

```ts
// In structure-validator.ts
export function validateDocumentStructure(
  input: ValidateStructureInput,
): { errors: StructuralConformanceError[] } {
  const { snapshot, template, config = {} } = input;
  const contentKey = config.contentKey ?? 'content';
  const content = (snapshot[contentKey] ?? []) as Array<{ type: string }>;
  const pinnedComponents = template.components.filter(c => c.pinned);
  const errors: StructuralConformanceError[] = [];

  // Check all pinned components are present and in relative order.
  // Non-pinned components in content[] are ignored — they don't affect pinned order.
  const pinnedInContent = content
    .map((c, i) => ({ type: c.type, index: i }))
    .filter(c => pinnedComponents.some(p => p.type === c.type));

  for (let i = 0; i < pinnedComponents.length; i++) {
    const expected = pinnedComponents[i];
    const actual = pinnedInContent[i];

    if (!actual) {
      errors.push({
        code: 'missing_pinned_component',
        componentType: expected.type,
        message: `Required component "${expected.type}" is missing from the document.`,
      });
      continue;
    }

    if (actual.type !== expected.type) {
      errors.push({
        code: 'unexpected_component_at_pinned_slot',
        componentType: expected.type,
        actualIndex: actual.index,
        message:
          `Expected pinned component "${expected.type}" at position ${i} ` +
          `but found "${actual.type}".`,
      });
    }
  }

  // Verify relative ordering of pinned components in content[]
  const pinnedPositions = pinnedInContent.map(c => c.index);
  for (let i = 1; i < pinnedPositions.length; i++) {
    if (pinnedPositions[i] < pinnedPositions[i - 1]) {
      errors.push({
        code: 'pinned_component_out_of_order',
        componentType: pinnedInContent[i].type,
        expectedIndex: i,
        actualIndex: pinnedPositions[i],
        message:
          `Pinned component "${pinnedInContent[i].type}" appears before ` +
          `"${pinnedInContent[i - 1].type}" but the template requires the reverse order.`,
      });
    }
  }

  return { errors };
}
```

#### Call sites

**MCP server** (`workers/mcp-server/src/shared/tools.ts`) — in `apply_document_edits`, after `validateOps` succeeds:

```ts
if (apiClient.validationEnabled && input.template_id) {
  const template = await apiClient.fetchTemplate(input.site_id, input.branch_id, input.template_id);
  if (template) {
    const { errors } = validateDocumentStructure({ snapshot: currentSnapshot, template });
    if (errors.length > 0) return formatValidationError(errors);
  }
}
```

**Migration job** — after `applyTemplateDelta`, before writing the new version:

```ts
const { errors } = validateDocumentStructure({ snapshot: migratedSnapshot, template });
if (errors.length > 0) {
  // Migration produced a non-conforming result — write to conflicts queue, not to document_versions
  await writeConflict(documentId, 'migration_result_invalid', errors);
  continue;
}
```

---

### H. Key File Touch Points (Summary)

| Area | Files |
|---|---|
| Schema | `workers/src/db/migrations/027_content_types.sql` |
| Template types | `workers/src/types/template.ts` (new) |
| Access control | `workers/src/routes/document-api.ts` |
| Version classification | `workers/src/services/document-version-service.ts` |
| List templates endpoint | `workers/src/routes/document-api.ts` (new route) |
| MCP tool: list_templates | `workers/mcp-server/src/shared/tools.ts` |
| MCP tool: create_page (template param) | `workers/mcp-server/src/shared/tools.ts` |
| Migration job | `workers/src/services/migration-service.ts` (new) |
| Migration queue consumer | `workers/src/index.ts` (new queue handler) |
| Frontend: onAction forwarding | `frontend/src/pages/DashboardPage.tsx` |
| Frontend: template selector | `frontend/src/components/TemplateSelector.tsx` (new) |
| Frontend: Puck permissions | `frontend/src/pages/DashboardPage.tsx` |
| Content validator: structure validation | `packages/p1-content-validator/src/structure-validator.ts` (new) |
| Content validator: new types | `packages/p1-content-validator/src/types.ts` |
| Content validator: exports | `packages/p1-content-validator/src/index.ts` |
