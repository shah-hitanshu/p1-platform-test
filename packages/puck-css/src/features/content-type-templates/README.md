# Content Type Templates

Structural templates that content editors scaffold new documents from, with role-based permissions that keep a page's required components in place.

## What it does

- Templates are stored and edited as Puck-shaped snapshots, the same shape as a document.
- `_registry/templates/{name}` documents hold a template's layout; editing one in the canvas is how a template's content is authored.
- Creating a document from a template copies its content into a fresh page (`scaffoldFromTemplate`).
- Pinning a component in a template (`root.props._pinMap`) marks it structurally required; pages scaffolded from that template can't have the pinned component moved or removed, regardless of editor role.
- `ContentRole` (`admin` / `editor` / `junior-editor`) gates coarser editing capabilities such as adding components or overriding a page's URL pattern.

## Template shape

```typescript
interface Template {
  id: string;
  name: string; // kebab-case identifier
  version: number;
  updatedAt: string;
  content: TemplateContentItem[]; // component instances; their props seed scaffolded pages
  root: {
    props: {
      _template: TemplateMetadata; // label, description, defaultUrlPattern, deprecated
      _pinMap: Record<string, boolean>; // pin state keyed by component instance id
    };
  };
  zones: Record<string, unknown>;
}

interface TemplateContentItem {
  type: string;
  props: { id: string; [key: string]: unknown };
}

interface TemplateSummary extends TemplateMetadata {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
}
```

`templates.list()` returns `TemplateSummary[]`: metadata only, no `content`, `root`, or `zones`. Fetch a template by ID to get its full snapshot.

## Creating and updating templates

`create()` and `update()` accept metadata fields only; a template's layout is authored afterward on the editor canvas and persisted through the document's normal version history.

```typescript
import { P1Client } from '@pantheon-systems/css-client';

const client = new P1Client({ baseUrl, apiKey });

const template = await client.templates.create(siteId, branchId, {
  name: 'blog-post',
  label: 'Blog Post',
  description: 'Standard blog post layout',
});

// Later, edit metadata without touching content or pin state:
await client.templates.update(siteId, branchId, template.id, {
  description: 'Standard blog post layout with a hero image',
});
```

`templates.deprecate()` / `templates.reactivate()` are convenience wrappers over `update()` that toggle `deprecated` without changing other metadata. A deprecated template stays bound to any documents already created from it but is excluded from template pickers.

A `TemplateStore` (`createInMemoryTemplateStore`, `createApiTemplateStore`) wraps the same operations plus document-to-template bindings (`getBinding` / `setBinding` / `listBindings` / `removeBinding`); the API-backed store's binding methods are managed server-side through the documents API and are not implemented on the store itself.

## Scaffolding a page

```typescript
import { scaffoldFromTemplate } from '@pantheon-systems/puck-css';

const template = await client.templates.get(siteId, branchId, templateId);
const initialData = scaffoldFromTemplate(template); // Puck Data for a new document
```

Each content item is copied with a fresh component id, so a scaffolded page's components are independent of the template's.

## Validating structure

```typescript
import { validateStructure } from '@pantheon-systems/puck-css';

const result = validateStructure(documentData, template);

if (!result.valid) {
  // result.errors[].code is MISSING_PINNED_COMPONENT or PINNED_COMPONENT_OUT_OF_ORDER
}
```

A document conforms when every pinned component type from the template is present in the document, in the same relative order. Non-pinned components can be added freely.

## Permissions

`getPermissionsForRole` / `useContentRole` compute coarse, role-only capabilities (`canAddComponents`, `canRemoveComponents`, `canMoveComponents`, `canEditProps`, `canOverrideUrl`). `junior-editor` is restricted to prop edits; `admin` and `editor` otherwise get the same capabilities. `useResolveContentRole` resolves a user's `ContentRole` from the CSS backend's role for a site/branch.

Pin locking is enforced per component, independent of role: the editor resolves Puck's `resolvePermissions` so that pinned components can never be dragged or deleted, and (for `junior-editor`) non-pinned components and blank pages get no structural permissions either. Viewing a historical version disables all structural permissions for every role.

## API endpoints

- `GET /api/sites/{siteId}/branches/{branchId}/templates` - list templates as `TemplateSummary[]`
- `GET /api/sites/{siteId}/branches/{branchId}/templates/{templateId}` - get a template's full snapshot
- `POST /api/sites/{siteId}/branches/{branchId}/templates` - create a template (metadata only)
- `PATCH /api/sites/{siteId}/branches/{branchId}/templates/{templateId}` - update metadata, or toggle `deprecated`
- `DELETE /api/sites/{siteId}/branches/{branchId}/templates/{templateId}` - delete a template

The client also exposes `migrate()`, `previewMigration()`, `rollbackMigration()`, and `getMigrationJob()` under `/api/sites/{siteId}/branches/{branchId}/templates/{templateId}/...` and `/api/sites/{siteId}/branches/{branchId}/migrations/{jobId}` for rolling a structural template change out across existing documents. `client.migrationConflicts.list()` and `client.migrationConflicts.resolve()` review and resolve the conflicts a migration job records.

## Compatibility

The backend serves a top-level `label` and a `components` array (with `pinned` and `defaultProps` per entry) alongside the snapshot fields, for a deprecation window, so 0.4.x clients keep working against the same backend. Both derived fields are deprecated; read metadata from `root.props._template` and content from `content` / `root.props._pinMap` instead.

## Files

- `types.ts` - `ContentRole`, `TemplateBinding`, and re-exports of the `@pantheon-systems/css-client` template types
- `stores/` - `TemplateStore` interface, in-memory and API-backed implementations
- `permissions/` - role-based `ComponentPermissions`, the `useContentRole` / `useResolveContentRole` hooks, and the Puck `resolvePermissions` resolver
- `editor/` - scaffolding (`scaffoldFromTemplate`) and role/history permission merging
- `validation/` - `validateStructure` and its error codes
- `ui/` - template picker, the template metadata panel, and the pin-toggle action bar button used by the editor
- `hooks/useTemplateList.ts` - fetches and refreshes a branch's `TemplateSummary[]`
