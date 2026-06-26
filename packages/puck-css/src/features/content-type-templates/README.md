# Content Type Templates (PROPOSAL-010)

Feature for defining structural templates that content editors can use to create conformant documents.

## Status: Ready for Integration Testing ✅

**Frontend implementation complete.** Backend API exists and is ready for integration.

## What's Implemented

### Core Features
- ✅ Template CRUD operations (via backend API)
- ✅ Role-based permissions (admin/editor/junior-editor)
- ✅ Structural validation (pinned components)
- ✅ Template scaffolding (create documents from templates)
- ✅ API-backed template store for production
- ✅ DAL integration

### Architecture

**Storage:**
- Templates stored as documents at `_registry/templates/{name}` in backend
- Template bindings stored in `documents.template_id`, `documents.template_version` columns
- Frontend uses `createApiTemplateStore(client, siteId, branchId)` for API access

**Permissions:**
- **Admin**: Full template + document control
- **Editor**: Can add/remove non-pinned components, pinned components locked
- **Junior-Editor**: Props editing only, no structural changes

**Types:**
- `ContentRole` - User roles
- `Template` - Template definition with components
- `TemplateComponent` - Component with pinned status and default props
- `TemplateBinding` - Document-to-template association

## Usage

### Initialize Template Store

```typescript
import { createApiTemplateStore, initializeStores } from '@pantheon-systems/puck-css';
import { P1Client } from '@pantheon-systems/css-client';

const client = new P1Client({ baseUrl, apiKey });
const templateStore = createApiTemplateStore(client, siteId, branchId);

initializeStores({ templateStore });
```

### Create a Template

```typescript
import { templateStore } from '@pantheon-systems/puck-css/data/dal';

const template = await templateStore.create({
  name: 'blog-post',
  label: 'Blog Post',
  description: 'Standard blog post layout',
  components: [
    { type: 'HeadingBlock', pinned: true, defaultProps: { title: 'Blog Title' } },
    { type: 'TextBlock', pinned: true, defaultProps: {} },
  ],
});
```

### Create Document from Template

```typescript
import { scaffoldFromTemplate } from '@pantheon-systems/puck-css';

// Get template
const template = await templateStore.get(templateId);

// Create Puck data from template
const initialData = scaffoldFromTemplate(template);

// Create document with template binding
await client.documents.create({
  siteId,
  branchId,
  path: '/my-blog-post',
  // Note: Template binding must be set via backend when it supports it
});
```

### Validate Document Structure

```typescript
import { validateStructure } from '@pantheon-systems/puck-css';

const result = validateStructure(documentData, template);

if (!result.valid) {
  console.error('Validation errors:', result.errors);
  // Errors: MISSING_PINNED_COMPONENT, PINNED_COMPONENT_OUT_OF_ORDER
}
```

### Check Permissions

```typescript
import { useContentRole, useTemplatePermissions } from '@pantheon-systems/puck-css';

function Editor() {
  const { role, permissions } = useContentRole('editor');
  const editorPerms = useTemplatePermissions(role, isHistoricalVersion);
  
  if (!editorPerms.canAddComponents) {
    return <div>Read-only mode</div>;
  }
  
  return <PuckEditor />;
}
```

## Backend API

Endpoints already implemented in `collaborative-state-system`:

- `GET /api/sites/{siteId}/branches/{branchId}/templates` - List templates
- `GET /api/sites/{siteId}/templates/{templateId}` - Get template
- `POST /api/sites/{siteId}/branches/{branchId}/templates` - Create template
- `PATCH /api/sites/{siteId}/templates/{templateId}` - Update template
- `DELETE /api/sites/{siteId}/branches/{branchId}/templates/{templateId}` - Delete template

**Schema** (`039_template_support.sql`):
- `documents.template_id UUID` - Reference to template document
- `documents.template_version INTEGER` - Version of template
- `migration_jobs` - For tracking migrations (future use)
- `migration_conflicts` - For conflict resolution (future use)

## Not Yet Implemented

### Migration System (Phases 9-14)
Deferred pending integration testing:
- Action classification (tracking structural changes)
- Template delta computation
- Migration job orchestration
- Conflict detection and resolution
- Migration UI

Migration endpoints exist but return 501:
- `POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migrate`
- `POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/rollback`

### Document Binding API
Backend needs to support:
- Setting `template_id`/`template_version` on document creation
- Filtering documents by `template_id`
- Updating template bindings

## Testing

**79 tests passing** covering:
- Type system
- Template stores (in-memory + API)
- Role permissions
- Structural validation
- Template scaffolding
- Editor hooks

Run tests:
```bash
pnpm --filter @pantheon-systems/puck-css test
```

## Next Steps

1. **Integration testing** - Test frontend with backend API
2. **Document binding** - Wire template selection into document creation
3. **Migration system** - Implement phases 9-14 when needed
4. **UI components** - Add template management UI to editor

## Files

**Core:**
- `types.ts` - TypeScript definitions
- `stores/` - Template persistence (in-memory, API)
- `validation/` - Structural conformance validation
- `permissions/` - Role-based permission system
- `editor/` - React hooks for template editing

**Integration:**
- `src/data/dal/index.ts` - DAL integration
- `src/index.ts` - Public API exports
