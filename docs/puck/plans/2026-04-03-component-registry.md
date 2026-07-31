# Component Registry for AI Agent Autonomy

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Store a machine-readable snapshot of a Puck site's component library in CSS so an external AI agent can discover components and autonomously build pages without access to source code.

**Architecture:** A new `useComponentRegistry` React hook runs at editor startup, serialises the Puck config into `ComponentDescriptor` objects, hashes them, and writes changed descriptors to CSS documents under a reserved `/_registry/` path prefix. Two new MCP tools (`list_components`, `create_page`) expose this data and page-creation capability to agents. Registry documents are filtered from all human-facing document lists.

**Tech Stack:** TypeScript, React hooks (vitest + @testing-library/react), `@pantheon/css-client` (`documents.list`, `documents.create`, `versions.getLatest`, `versions.create`), `@modelcontextprotocol/sdk`, Zod, Cloudflare Workers.

---

## Decision Log

**Why `/_registry/` path prefix?** Reuses existing CSS documents storage with zero backend changes. `pathPrefix` filtering is already supported by `ListDocumentsOptions` in `@pantheon/css-client`. Registry docs behave identically to page docs except for the reserved prefix.

**Why hash-based change detection?** Avoids unnecessary writes on every editor load. The Puck config object is rebuilt from the JS bundle on every render; writing unconditionally would create spurious versions.

**Why djb2 hash?** Minimal, dependency-free, collision rate acceptable for O(100) component configs. SHA-256 via Web Crypto would add async overhead with no practical benefit.

**Why no `startEdit`/`completeEdit` for registry writes?** Registry documents are machine-owned; no human edits them. The agent politeness workflow exists to prevent AI/human conflicts on content documents. Bypassing it for registry writes is correct — the lock would be grabbed and released for every editor load.

**Why `create_page` does NOT use `startEdit`/`completeEdit`?** The page is new (no prior content, no conflict possible). The workflow would create a checkpoint before writing the first version, which is redundant. A direct `documents.create` → `versions.create` sequence is idiomatic for new documents.

**Why inline ULID generation?** `ulid` is not in `mcp-server`'s dependencies. Adding it would increase bundle size. A 26-character ULID can be generated inline in ~10 lines with Cloudflare Workers' `crypto.getRandomValues()` — no dependency needed.

**Why `useComponentRegistry` uses `useCSSPuck()`?** The hook needs `client`, `siteId`, and `branchId` which are already in context. Passing them as explicit props would duplicate what every consumer has to thread through — the same pattern used by `useVersions`, `useAutoSave`, and `useDocuments`.

**Why provenance classification is opt-in?** Sites without a Custom Upstream (the majority) don't need it. Passing `upstreamPuckConfig` is optional; when absent, all components are classified `"site"`.

**Why `list_components` makes N+1 HTTP calls?** `listDocuments(pathPrefix)` returns document metadata only (no snapshot). To get each component's descriptor, we need a snapshot fetch per document. Since `list_components` is called rarely (once per agent session, not in a hot path), N+1 is acceptable. The alternative — storing all descriptors in the index — would make the index document arbitrarily large.

**Why filter `/_registry/` in the plugin, not the API?** The CSS API correctly returns all documents including registry ones. Filtering at the plugin layer keeps the API general-purpose and avoids backend changes. This is the same pattern used for archived (tombstoned) document filtering.

**Why does `useComponentRegistry` depend on `[puckConfig, siteId, branchId]`?** The hook consumes `siteId` and `branchId` from context. If a branch switch happens without the config object reference changing, the effect must re-run to register against the new branch. Depending only on `puckConfig` would silently leave the registry stale after a branch switch.

**Why is the index only written when something changed or the index doesn't exist?** Writing a new index version on every editor open — even when all component hashes match — creates spurious version history and unnecessary write traffic. The index is written only when `registered > 0` (at least one descriptor changed) or when the index document doesn't exist yet (first-time registration).

**Why extract `root` as `__root__`?** Every Puck page has a `root` component with its own `fields` and `defaultProps` (page-level settings such as `background`, `title`, `seo`). An agent building pages via `create_page` must pass `root_props` that match the root's field schema. Without extracting root, `list_components` returns no root field information and the agent cannot correctly populate page-level settings. Storing root as a descriptor named `__root__` at `/_registry/components/__root__` is the minimal, uniform solution — same CSS path convention, same `ComponentDescriptor` shape, same hash-based update logic. The double-underscore prefix makes the special name visually distinct and prevents collision with any real component named `root`.

---

## Data Model

### `ComponentDescriptor` (stored as a CSS document version's `snapshot`)

```typescript
interface ComponentDescriptor {
  name: string;                    // Puck component key, e.g. "HeroBlock"
  label: string;                   // Human-readable label from Puck config
  fields: SerializedField[];
  defaultProps: Record<string, unknown>;
  ai?: {
    instructions?: string;         // From @puckeditor/plugin-ai convention
    defaultZone?: string;
  };
  slots?: Record<string, {
    allowedComponents?: string[];
    minItems?: number;
    maxItems?: number;
  }>;
  provenance: 'site' | 'upstream' | 'overridden';
  descriptorHash: string;          // djb2 hash over canonical JSON (self-excluded)
  upstreamHash?: string;
  registeredAt: string;            // ISO timestamp of last write
}
```

### `SerializedField`

```typescript
type SerializedField =
  | { type: 'text'; name: string; label?: string; ai?: FieldAiMeta }
  | { type: 'textarea'; name: string; label?: string; ai?: FieldAiMeta }
  | { type: 'number'; name: string; label?: string; min?: number; max?: number; ai?: FieldAiMeta }
  | { type: 'select'; name: string; label?: string; options: Array<{ label: string; value: string | number | boolean }>; ai?: FieldAiMeta }
  | { type: 'radio'; name: string; label?: string; options: Array<{ label: string; value: string | number | boolean }>; ai?: FieldAiMeta }
  | { type: 'array'; name: string; label?: string; arrayFields: SerializedField[]; ai?: FieldAiMeta }
  | { type: 'object'; name: string; label?: string; objectFields: SerializedField[]; ai?: FieldAiMeta }
  | { type: 'custom'; name: string; label?: string; ai?: FieldAiMeta };

interface FieldAiMeta {
  instructions?: string;
  required?: boolean;
  schema?: unknown;
  exclude?: boolean;
}
```

### Registry Index (`/_registry/index`)

```typescript
interface RegistryIndex {
  siteId: string;
  branchId: string;
  updatedAt: string;
  componentNames: string[];
  provenance: Record<string, 'site' | 'upstream' | 'overridden'>;
}
```

### CSS document paths

| Path | Content |
|------|---------|
| `/_registry/index` | `RegistryIndex` |
| `/_registry/components/{name}` | `ComponentDescriptor` |

---

## Repository Structure — CRITICAL

This plan spans **two separate git repositories**:

| Repo | Absolute path | Git remote |
|------|--------------|-----------|
| **puck-css-integration** (this worktree) | `/Users/chris.yates/src/puck-css-integration/.worktrees/feature/component-registry` | where `packages/puck-css/` lives |
| **collaborative-state-system** | `/Users/chris.yates/src/collaborative-state-system` | where `workers/mcp-server/` lives |

Tasks 1–8 modify files in **puck-css-integration** (this worktree).  
Tasks 9–13 modify files in **collaborative-state-system** (different repo, different git).

For Tasks 9–13:
- All `git add` / `git commit` commands must be run from `/Users/chris.yates/src/collaborative-state-system`
- All `npx vitest run ...` commands must be run from `/Users/chris.yates/src/collaborative-state-system`
- File paths listed under **Files:** are relative to `/Users/chris.yates/src/collaborative-state-system`

**Do not** run MCP-server git commands inside this worktree — they will silently apply to the wrong repo.

---

## Implementation Order

Tasks 1–5: `componentRegistry.ts` utilities + tests (puck-css-integration worktree)  
Task 6: `useComponentRegistry` hook + tests (puck-css-integration worktree)  
Task 7: `/_registry/` filter in `CSSPlugin.tsx` + test (puck-css-integration worktree)  
Task 8: Barrel exports (puck-css-integration worktree)  
Task 9: MCP api-client `pathPrefix` support (collaborative-state-system)  
Task 10: MCP api-client `getDocumentLatestVersion` + `createDocument` (collaborative-state-system)  
Task 11: MCP `list_components` tool (collaborative-state-system)  
Task 12: MCP `create_page` tool (collaborative-state-system)  
Task 13: Register tools in mcp-handler + update tool-count tests (collaborative-state-system)  
Task 14: Full test suite confirmation for both repos

---

## Task 1: Create `componentRegistry.ts` with `serializeField`

**Files:**
- Create: `packages/puck-css/src/utils/componentRegistry.ts`
- Create: `packages/puck-css/src/__tests__/componentRegistry.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/puck-css/src/__tests__/componentRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { serializeField } from '../utils/componentRegistry.js';

describe('serializeField', () => {
  it('serializes a text field', () => {
    const result = serializeField({ type: 'text', label: 'Title' }, 'title');
    expect(result).toEqual({ type: 'text', name: 'title', label: 'Title' });
  });

  it('serializes a select field with options', () => {
    const result = serializeField(
      { type: 'select', label: 'Color', options: [{ label: 'Red', value: 'red' }] },
      'color',
    );
    expect(result).toEqual({
      type: 'select',
      name: 'color',
      label: 'Color',
      options: [{ label: 'Red', value: 'red' }],
    });
  });

  it('serializes a radio field with options', () => {
    const result = serializeField(
      { type: 'radio', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
      'variant',
    );
    expect(result).toEqual({
      type: 'radio',
      name: 'variant',
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    });
  });

  it('serializes a number field with min/max', () => {
    const result = serializeField({ type: 'number', label: 'Count', min: 1, max: 10 }, 'count');
    expect(result).toEqual({ type: 'number', name: 'count', label: 'Count', min: 1, max: 10 });
  });

  it('serializes an array field with nested fields recursively', () => {
    const result = serializeField(
      {
        type: 'array',
        label: 'Items',
        arrayFields: { title: { type: 'text', label: 'Item Title' } },
      },
      'items',
    );
    expect(result).toEqual({
      type: 'array',
      name: 'items',
      label: 'Items',
      arrayFields: [{ type: 'text', name: 'title', label: 'Item Title' }],
    });
  });

  it('serializes an object field with nested fields recursively', () => {
    const result = serializeField(
      {
        type: 'object',
        label: 'CTA',
        objectFields: { href: { type: 'text', label: 'URL' } },
      },
      'cta',
    );
    expect(result).toEqual({
      type: 'object',
      name: 'cta',
      label: 'CTA',
      objectFields: [{ type: 'text', name: 'href', label: 'URL' }],
    });
  });

  it('treats unknown field types as custom', () => {
    // Puck allows custom field types with render functions — strip the function
    const result = serializeField(
      { type: 'custom', render: () => null, label: 'Rich Text' },
      'body',
    );
    expect(result).toEqual({ type: 'custom', name: 'body', label: 'Rich Text' });
  });

  it('preserves ai metadata when present', () => {
    const result = serializeField(
      { type: 'text', label: 'Headline', ai: { instructions: 'Keep under 10 words', required: true } },
      'headline',
    );
    expect(result).toEqual({
      type: 'text',
      name: 'headline',
      label: 'Headline',
      ai: { instructions: 'Keep under 10 words', required: true },
    });
  });
});
```

**Step 2: Run to verify failure**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feature/component-registry && npx vitest run packages/puck-css/src/__tests__/componentRegistry.test.ts
```

Expected: `FAIL` — `serializeField is not exported from ../utils/componentRegistry.js`

**Step 3: Write the implementation**

```typescript
// packages/puck-css/src/utils/componentRegistry.ts

// =============================================================================
// Types
// =============================================================================

export type ComponentProvenance = 'site' | 'upstream' | 'overridden';

export interface FieldAiMeta {
  instructions?: string;
  required?: boolean;
  schema?: unknown;
  exclude?: boolean;
}

export type SerializedField =
  | { type: 'text'; name: string; label?: string; ai?: FieldAiMeta }
  | { type: 'textarea'; name: string; label?: string; ai?: FieldAiMeta }
  | { type: 'number'; name: string; label?: string; min?: number; max?: number; ai?: FieldAiMeta }
  | { type: 'select'; name: string; label?: string; options: Array<{ label: string; value: string | number | boolean }>; ai?: FieldAiMeta }
  | { type: 'radio'; name: string; label?: string; options: Array<{ label: string; value: string | number | boolean }>; ai?: FieldAiMeta }
  | { type: 'array'; name: string; label?: string; arrayFields: SerializedField[]; ai?: FieldAiMeta }
  | { type: 'object'; name: string; label?: string; objectFields: SerializedField[]; ai?: FieldAiMeta }
  | { type: 'custom'; name: string; label?: string; ai?: FieldAiMeta };

export interface ComponentDescriptor {
  name: string;
  label: string;
  fields: SerializedField[];
  defaultProps: Record<string, unknown>;
  ai?: { instructions?: string; defaultZone?: string };
  slots?: Record<string, { allowedComponents?: string[]; minItems?: number; maxItems?: number }>;
  provenance: ComponentProvenance;
  descriptorHash: string;
  upstreamHash?: string;
  registeredAt: string;
}

export interface RegistryIndex {
  siteId: string;
  branchId: string;
  updatedAt: string;
  componentNames: string[];
  provenance: Record<string, ComponentProvenance>;
}

// =============================================================================
// Field serialization
// =============================================================================

/**
 * Converts a Puck field definition to a JSON-serializable SerializedField.
 * Strips non-serializable properties (render functions, getItemSummary, etc.).
 * Recursively handles array.arrayFields and object.objectFields.
 */
export function serializeField(field: Record<string, unknown>, name: string): SerializedField {
  const ai = field.ai as FieldAiMeta | undefined;

  switch (field.type) {
    case 'text':
    case 'textarea':
      return { type: field.type as 'text' | 'textarea', name, ...(field.label !== undefined && { label: field.label as string }), ...(ai !== undefined && { ai }) };
    case 'number': {
      const result: { type: 'number'; name: string; label?: string; min?: number; max?: number; ai?: FieldAiMeta } = { type: 'number', name };
      if (field.label !== undefined) result.label = field.label as string;
      if (field.min !== undefined) result.min = field.min as number;
      if (field.max !== undefined) result.max = field.max as number;
      if (ai !== undefined) result.ai = ai;
      return result;
    }
    case 'select':
    case 'radio': {
      const options = (field.options as Array<{ label: string; value: string | number | boolean }>) ?? [];
      return { type: field.type as 'select' | 'radio', name, ...(field.label !== undefined && { label: field.label as string }), options, ...(ai !== undefined && { ai }) };
    }
    case 'array': {
      const rawArrayFields = (field.arrayFields ?? {}) as Record<string, Record<string, unknown>>;
      const arrayFields = Object.entries(rawArrayFields).map(([k, v]) => serializeField(v, k));
      return { type: 'array', name, ...(field.label !== undefined && { label: field.label as string }), arrayFields, ...(ai !== undefined && { ai }) };
    }
    case 'object': {
      const rawObjectFields = (field.objectFields ?? {}) as Record<string, Record<string, unknown>>;
      const objectFields = Object.entries(rawObjectFields).map(([k, v]) => serializeField(v, k));
      return { type: 'object', name, ...(field.label !== undefined && { label: field.label as string }), objectFields, ...(ai !== undefined && { ai }) };
    }
    default:
      // Treat all unrecognised types (including custom with render functions) as 'custom'
      return { type: 'custom', name, ...(field.label !== undefined && { label: field.label as string }), ...(ai !== undefined && { ai }) };
  }
}
```

**Step 4: Run to verify pass**

```bash
npx vitest run packages/puck-css/src/__tests__/componentRegistry.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all `serializeField` tests PASS.

**Step 5: Commit**

```bash
git add packages/puck-css/src/utils/componentRegistry.ts packages/puck-css/src/__tests__/componentRegistry.test.ts
git commit -m "feat: add serializeField utility for Puck field serialization"
```

---

## Task 2: Add `hashDescriptor` to `componentRegistry.ts`

**Files:**
- Modify: `packages/puck-css/src/utils/componentRegistry.ts`
- Modify: `packages/puck-css/src/__tests__/componentRegistry.test.ts`

**Step 1: Add failing tests**

Add to the test file:

```typescript
import { serializeField, hashDescriptor } from '../utils/componentRegistry.js';
// (update import)

describe('hashDescriptor', () => {
  const base: ComponentDescriptor = {
    name: 'HeroBlock',
    label: 'Hero',
    fields: [{ type: 'text', name: 'title' }],
    defaultProps: { title: '' },
    provenance: 'site',
    descriptorHash: 'PLACEHOLDER',
    registeredAt: '2026-01-01T00:00:00Z',
  };

  it('is deterministic for the same input', () => {
    const h1 = hashDescriptor(base);
    const h2 = hashDescriptor(base);
    expect(h1).toBe(h2);
  });

  it('produces different hashes when a field changes', () => {
    const modified = { ...base, fields: [{ type: 'text' as const, name: 'headline' }] };
    expect(hashDescriptor(base)).not.toBe(hashDescriptor(modified));
  });

  it('excludes descriptorHash and registeredAt from the hash input', () => {
    const a = { ...base, descriptorHash: 'old-hash', registeredAt: '2020-01-01T00:00:00Z' };
    const b = { ...base, descriptorHash: 'new-hash', registeredAt: '2030-01-01T00:00:00Z' };
    expect(hashDescriptor(a)).toBe(hashDescriptor(b));
  });

  it('is stable across JSON key ordering', () => {
    // JSON.stringify key order should not affect hash
    const orderedFields = { name: 'X', type: 'text' as const };
    const reverseFields = { type: 'text' as const, name: 'X' };
    // Same logical content, may have different key orders — canonicalize by sorting keys
    // (implementation must sort keys before hashing)
    const d1 = { ...base, fields: [orderedFields] };
    const d2 = { ...base, fields: [reverseFields] };
    expect(hashDescriptor(d1)).toBe(hashDescriptor(d2));
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run packages/puck-css/src/__tests__/componentRegistry.test.ts --reporter=verbose 2>&1 | grep "hashDescriptor"
```

Expected: `hashDescriptor` tests fail with import error.

**Step 3: Implement `hashDescriptor`**

Add to `componentRegistry.ts`:

```typescript
/**
 * Sorts object keys recursively to produce a canonical JSON representation.
 * This ensures hash stability regardless of key insertion order.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/**
 * djb2 hash over the canonical JSON of a descriptor.
 * `descriptorHash` and `registeredAt` are excluded from the hash input
 * so that the hash is stable across re-registrations.
 */
export function hashDescriptor(descriptor: Omit<ComponentDescriptor, 'descriptorHash'> & { descriptorHash?: string }): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { descriptorHash: _ignored, registeredAt: _ts, ...hashable } = descriptor;
  const json = JSON.stringify(sortKeys(hashable));
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = ((hash << 5) + hash) ^ json.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16);
}
```

**Step 4: Run to verify pass**

```bash
npx vitest run packages/puck-css/src/__tests__/componentRegistry.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add packages/puck-css/src/utils/componentRegistry.ts packages/puck-css/src/__tests__/componentRegistry.test.ts
git commit -m "feat: add hashDescriptor for stable descriptor change detection"
```

---

## Task 3: Add `extractDescriptors` to `componentRegistry.ts`

**Files:**
- Modify: `packages/puck-css/src/utils/componentRegistry.ts`
- Modify: `packages/puck-css/src/__tests__/componentRegistry.test.ts`

**Step 1: Write failing tests**

Add to the test file (update import to include `extractDescriptors`):

```typescript
describe('extractDescriptors', () => {
  const mockConfig = {
    root: {
      fields: { background: { type: 'select', options: [{ label: 'White', value: 'white' }] } },
      defaultProps: { background: 'white' },
    },
    components: {
      HeroBlock: {
        label: 'Hero',
        fields: {
          title: { type: 'text', label: 'Title' },
          body: { type: 'textarea', label: 'Body' },
        },
        defaultProps: { title: 'Hello', body: '' },
      },
      CardBlock: {
        // No label — should default to component name
        fields: {
          items: {
            type: 'array',
            arrayFields: { text: { type: 'text' } },
          },
        },
        defaultProps: { items: [] },
      },
    },
  };

  it('extracts a descriptor for every component in the config including root as __root__', () => {
    const descriptors = extractDescriptors(mockConfig);
    expect(descriptors.map((d) => d.name).sort()).toEqual(['CardBlock', 'HeroBlock', '__root__']);
  });

  it('uses component label when present, falls back to key; root always gets label "Page Root"', () => {
    const descriptors = extractDescriptors(mockConfig);
    const hero = descriptors.find((d) => d.name === 'HeroBlock')!;
    expect(hero.label).toBe('Hero');
    const card = descriptors.find((d) => d.name === 'CardBlock')!;
    expect(card.label).toBe('CardBlock');
    const root = descriptors.find((d) => d.name === '__root__')!;
    expect(root.label).toBe('Page Root');
  });

  it('serializes fields correctly', () => {
    const descriptors = extractDescriptors(mockConfig);
    const hero = descriptors.find((d) => d.name === 'HeroBlock')!;
    expect(hero.fields).toEqual([
      { type: 'text', name: 'title', label: 'Title' },
      { type: 'textarea', name: 'body', label: 'Body' },
    ]);
  });

  it('preserves defaultProps', () => {
    const descriptors = extractDescriptors(mockConfig);
    const hero = descriptors.find((d) => d.name === 'HeroBlock')!;
    expect(hero.defaultProps).toEqual({ title: 'Hello', body: '' });
  });

  it('populates descriptorHash and registeredAt', () => {
    const descriptors = extractDescriptors(mockConfig);
    for (const d of descriptors) {
      expect(d.descriptorHash).toBeTruthy();
      expect(d.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('all components get provenance "site" when no upstream provided', () => {
    const descriptors = extractDescriptors(mockConfig);
    for (const d of descriptors) {
      expect(d.provenance).toBe('site');
    }
  });

  it('root descriptor has correct field serialization', () => {
    const descriptors = extractDescriptors(mockConfig);
    const root = descriptors.find((d) => d.name === '__root__')!;
    expect(root.fields).toEqual([
      { type: 'select', name: 'background', options: [{ label: 'White', value: 'white' }] },
    ]);
    expect(root.defaultProps).toEqual({ background: 'white' });
  });

  it('handles config with no root gracefully', () => {
    const descriptors = extractDescriptors({ components: { HeroBlock: { label: 'Hero', fields: {}, defaultProps: {} } } });
    expect(descriptors.map((d) => d.name)).not.toContain('__root__');
  });

  it('handles empty components config gracefully', () => {
    const descriptors = extractDescriptors({ components: {} });
    expect(descriptors).toEqual([]);
  });
});

describe('extractDescriptors with upstream', () => {
  const siteConfig = {
    components: {
      SharedBlock: { label: 'Shared', fields: { text: { type: 'text' } }, defaultProps: { text: '' } },
      SiteOnlyBlock: { label: 'Site Only', fields: {}, defaultProps: {} },
      ModifiedBlock: { label: 'Modified', fields: { title: { type: 'text' } }, defaultProps: { title: '' } },
    },
  };

  const upstreamConfig = {
    components: {
      SharedBlock: { label: 'Shared', fields: { text: { type: 'text' } }, defaultProps: { text: '' } },
      ModifiedBlock: { label: 'Original', fields: { title: { type: 'textarea' } }, defaultProps: { title: '' } },
    },
  };

  it('marks component as "upstream" when site and upstream hashes match', () => {
    const descriptors = extractDescriptors(siteConfig, upstreamConfig);
    const shared = descriptors.find((d) => d.name === 'SharedBlock')!;
    expect(shared.provenance).toBe('upstream');
    expect(shared.upstreamHash).toBeTruthy();
  });

  it('marks component as "site" when not present in upstream', () => {
    const descriptors = extractDescriptors(siteConfig, upstreamConfig);
    const siteOnly = descriptors.find((d) => d.name === 'SiteOnlyBlock')!;
    expect(siteOnly.provenance).toBe('site');
    expect(siteOnly.upstreamHash).toBeUndefined();
  });

  it('marks component as "overridden" when hashes differ', () => {
    const descriptors = extractDescriptors(siteConfig, upstreamConfig);
    const modified = descriptors.find((d) => d.name === 'ModifiedBlock')!;
    expect(modified.provenance).toBe('overridden');
    expect(modified.upstreamHash).toBeTruthy();
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run packages/puck-css/src/__tests__/componentRegistry.test.ts 2>&1 | grep -E "FAIL|cannot find"
```

Expected: `extractDescriptors` tests fail — not exported.

**Step 3: Implement `extractDescriptors`**

Add to `componentRegistry.ts`:

```typescript
/**
 * Extracts ComponentDescriptors from a Puck config object.
 * Optionally classifies provenance against an upstream Puck config.
 *
 * @param puckConfig - The site's Puck config (as passed to <Puck config={...} />)
 * @param upstreamConfig - Optional Custom Upstream's Puck config for provenance comparison
 */
export function extractDescriptors(
  puckConfig: unknown,
  upstreamConfig?: unknown,
): ComponentDescriptor[] {
  const config = puckConfig as Record<string, unknown>;
  const components = (config.components ?? {}) as Record<string, Record<string, unknown>>;

  // Pre-compute upstream descriptors for O(1) hash lookup
  let upstreamDescriptors: Map<string, ComponentDescriptor> | null = null;
  if (upstreamConfig !== undefined) {
    const upstream = upstreamConfig as Record<string, unknown>;
    const upstreamComponents = (upstream.components ?? {}) as Record<string, Record<string, unknown>>;
    upstreamDescriptors = new Map();
    for (const [name, compConfig] of Object.entries(upstreamComponents)) {
      const partial = buildPartialDescriptor(name, compConfig);
      upstreamDescriptors.set(name, partial);
    }
    // Also index upstream root if present
    const upstreamRoot = (upstream.root ?? null) as Record<string, unknown> | null;
    if (upstreamRoot !== null) {
      const partial = buildPartialDescriptor('__root__', { ...upstreamRoot, label: 'Page Root' });
      upstreamDescriptors.set('__root__', partial);
    }
  }

  const now = new Date().toISOString();
  const results: ComponentDescriptor[] = [];

  // Build a combined map: root (as __root__) + named components
  const allComponents = new Map<string, Record<string, unknown>>();
  const rootConfig = (config.root ?? null) as Record<string, unknown> | null;
  if (rootConfig !== null) {
    allComponents.set('__root__', { ...rootConfig, label: 'Page Root' });
  }
  for (const [name, compConfig] of Object.entries(components)) {
    allComponents.set(name, compConfig);
  }

  for (const [name, compConfig] of allComponents.entries()) {
    const partial = buildPartialDescriptor(name, compConfig);
    const siteHash = hashDescriptor(partial);

    let provenance: ComponentProvenance = 'site';
    let upstreamHash: string | undefined;

    if (upstreamDescriptors !== null) {
      const upstreamPartial = upstreamDescriptors.get(name);
      if (upstreamPartial !== undefined) {
        upstreamHash = hashDescriptor(upstreamPartial);
        provenance = siteHash === upstreamHash ? 'upstream' : 'overridden';
      }
    }

    results.push({
      ...partial,
      provenance,
      descriptorHash: siteHash,
      ...(upstreamHash !== undefined && { upstreamHash }),
      registeredAt: now,
    });
  }

  return results;
}

/** Builds a descriptor without provenance/hash/timestamp fields (used for hashing) */
function buildPartialDescriptor(
  name: string,
  compConfig: Record<string, unknown>,
): Omit<ComponentDescriptor, 'provenance' | 'descriptorHash' | 'registeredAt' | 'upstreamHash'> {
  const rawFields = (compConfig.fields ?? {}) as Record<string, Record<string, unknown>>;
  const fields = Object.entries(rawFields).map(([k, v]) => serializeField(v, k));

  const result: Omit<ComponentDescriptor, 'provenance' | 'descriptorHash' | 'registeredAt' | 'upstreamHash'> = {
    name,
    label: (compConfig.label as string | undefined) ?? name,
    fields,
    defaultProps: (compConfig.defaultProps as Record<string, unknown>) ?? {},
  };

  // AI metadata (from @puckeditor/plugin-ai convention)
  const ai = compConfig.ai as ComponentDescriptor['ai'] | undefined;
  if (ai !== undefined) result.ai = ai;

  // Slot constraints
  const slots = compConfig.slots as ComponentDescriptor['slots'] | undefined;
  if (slots !== undefined) result.slots = slots;

  return result;
}
```

**Step 4: Run all tests**

```bash
npx vitest run packages/puck-css/src/__tests__/componentRegistry.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add packages/puck-css/src/utils/componentRegistry.ts packages/puck-css/src/__tests__/componentRegistry.test.ts
git commit -m "feat: add extractDescriptors with upstream provenance classification"
```

---

## Task 4: Add `buildRegistryIndex` to `componentRegistry.ts`

**Files:**
- Modify: `packages/puck-css/src/utils/componentRegistry.ts`
- Modify: `packages/puck-css/src/__tests__/componentRegistry.test.ts`

**Step 1: Write failing test**

Add to the test file (update import to include `buildRegistryIndex`):

```typescript
describe('buildRegistryIndex', () => {
  it('builds a RegistryIndex from a list of descriptors', () => {
    const descriptors: ComponentDescriptor[] = [
      { name: 'HeroBlock', label: 'Hero', fields: [], defaultProps: {}, provenance: 'site', descriptorHash: 'abc', registeredAt: '2026-01-01T00:00:00Z' },
      { name: 'CardBlock', label: 'Card', fields: [], defaultProps: {}, provenance: 'upstream', descriptorHash: 'def', registeredAt: '2026-01-01T00:00:00Z' },
    ];

    const index = buildRegistryIndex(descriptors, 'site-1', 'branch-1');

    expect(index.siteId).toBe('site-1');
    expect(index.branchId).toBe('branch-1');
    expect(index.componentNames).toEqual(['HeroBlock', 'CardBlock']);
    expect(index.provenance).toEqual({ HeroBlock: 'site', CardBlock: 'upstream' });
    expect(index.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run packages/puck-css/src/__tests__/componentRegistry.test.ts 2>&1 | grep "buildRegistryIndex"
```

Expected: fails — not exported.

**Step 3: Implement**

Add to `componentRegistry.ts`:

```typescript
/** Builds the RegistryIndex from a list of extracted descriptors. */
export function buildRegistryIndex(
  descriptors: ComponentDescriptor[],
  siteId: string,
  branchId: string,
): RegistryIndex {
  return {
    siteId,
    branchId,
    updatedAt: new Date().toISOString(),
    componentNames: descriptors.map((d) => d.name),
    provenance: Object.fromEntries(descriptors.map((d) => [d.name, d.provenance])),
  };
}
```

**Step 4: Run all tests**

```bash
npx vitest run packages/puck-css/src/__tests__/componentRegistry.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add packages/puck-css/src/utils/componentRegistry.ts packages/puck-css/src/__tests__/componentRegistry.test.ts
git commit -m "feat: add buildRegistryIndex utility"
```

---

## Task 5: Run full puck-css test suite to confirm no regressions

**Step 1: Run all puck-css tests**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feature/component-registry && npx vitest run --project packages/puck-css 2>&1 | tail -20
```

If `--project` flag isn't available, use:

```bash
npx vitest run packages/puck-css/src/__tests__/ --reporter=verbose 2>&1 | tail -30
```

Expected: all pre-existing tests PASS; new tests PASS.

**Step 2: Lint**

```bash
cd packages/puck-css && npx eslint src/utils/componentRegistry.ts src/__tests__/componentRegistry.test.ts --fix
```

Expected: no errors. Fix any lint warnings before committing.

**Step 3: Commit if lint required fixes**

```bash
git add packages/puck-css/src/utils/componentRegistry.ts packages/puck-css/src/__tests__/componentRegistry.test.ts
git commit -m "chore: fix lint issues in componentRegistry"
```

---

## Task 6: Create `useComponentRegistry` hook — skeleton + CSS writes

**Files:**
- Create: `packages/puck-css/src/hooks/useComponentRegistry.ts`
- Create: `packages/puck-css/src/__tests__/useComponentRegistry.test.tsx`

### Context: how the CSS client is used in existing hooks

The `CSSPuckContextValue` (from `types.ts`) exposes:
- `client: CSSClient` — the CSS API client
- `siteId: string`
- `branchId: string`

Access these via `useCSSPuck()` (from `CSSPuckContext.tsx`).

The `client` object exposes:
- `client.documents.list(siteId, branchId, options?)` — `options` accepts `{ pathPrefix?: string }`
- `client.documents.create({ siteId, branchId, path })` → `Promise<Document>` (returns `Document` with `id`, `path`)
- `client.versions.getLatest(siteId, branchId, documentId)` → `Promise<DocumentVersion>` (has `.snapshot`)
- `client.versions.create(siteId, { documentId, branchId, snapshot })` → `Promise<DocumentVersion>`

### Hash-check algorithm

```
1. list all docs at pathPrefix='/_registry/components/'
2. build a Map<componentName, { documentId, storedHash }>:
   - for each listed doc, extract name from path suffix
   - call client.versions.getLatest() to get stored snapshot → cast as ComponentDescriptor → read .descriptorHash
3. for each fresh descriptor:
   - if no doc exists for this name → create document + create version
   - if storedHash !== descriptor.descriptorHash → create new version on existing document
   - else → skip (no write)
4. write /_registry/index document (create or update version)
```

**Step 1: Write failing tests**

```typescript
// packages/puck-css/src/__tests__/useComponentRegistry.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { CSSPuckContext } from '../CSSPuckContext.js';
import type { CSSPuckContextValue } from '../types.js';
import { useComponentRegistry } from '../hooks/useComponentRegistry.js';

// Build a minimal mock context
function makeMockContext(overrides?: Partial<CSSPuckContextValue>): CSSPuckContextValue {
  const mockClient = {
    documents: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'doc-new', path: '/_registry/components/HeroBlock' }),
    },
    versions: {
      getLatest: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'ver-1', versionNumber: 1, snapshot: {} }),
    },
  };
  return {
    client: mockClient as unknown as import('@pantheon/css-client').CSSClient,
    siteId: 'site-1',
    branchId: 'branch-1',
    userId: 'user-1',
    currentDocument: null,
    currentData: null,
    saveStatus: 'idle',
    lastSaved: null,
    saveError: null,
    loadDocument: vi.fn(),
    saveData: vi.fn(),
    notifications: {
      add: vi.fn(),
      remove: vi.fn(),
      notifications: [],
    },
    switchBranch: vi.fn(),
    ...overrides,
  } as unknown as CSSPuckContextValue;
}

function wrapper(ctx: CSSPuckContextValue) {
  return ({ children }: { children: React.ReactNode }) => (
    <CSSPuckContext.Provider value={ctx}>{children}</CSSPuckContext.Provider>
  );
}

const simplePuckConfig = {
  components: {
    HeroBlock: {
      label: 'Hero',
      fields: { title: { type: 'text', label: 'Title' } },
      defaultProps: { title: '' },
    },
  },
};

describe('useComponentRegistry', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns status "registered" after a successful run', async () => {
    const ctx = makeMockContext();
    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));
    expect(result.current.error).toBeNull();
  });

  it('creates a new document and version when no existing registry doc for a component', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    // No existing docs at prefix
    mockClient.documents.list.mockResolvedValue([]);
    mockClient.documents.create.mockResolvedValue({ id: 'doc-hero', path: '/_registry/components/HeroBlock' });

    renderHook(() => useComponentRegistry({ puckConfig: simplePuckConfig }), { wrapper: wrapper(ctx) });

    await waitFor(() => expect(mockClient.documents.create).toHaveBeenCalled());

    // Should create the component doc
    expect(mockClient.documents.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/_registry/components/HeroBlock' }),
    );
    // Should create a version
    expect(mockClient.versions.create).toHaveBeenCalled();
  });

  it('skips write when stored hash matches computed hash', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    // Compute what the actual hash would be for our mock config
    const { extractDescriptors } = await import('../utils/componentRegistry.js');
    const [descriptor] = extractDescriptors(simplePuckConfig);
    const storedHash = descriptor.descriptorHash;

    // Return existing doc with matching hash
    mockClient.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '/_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      { id: 'doc-index', path: '/_registry/index', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    mockClient.versions.getLatest.mockResolvedValue({
      id: 'ver-1', versionNumber: 1,
      snapshot: { ...descriptor, descriptorHash: storedHash },
    });

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('registered'));

    // No new versions should be created: hashes match, so neither component nor index is written.
    expect(mockClient.versions.create).not.toHaveBeenCalled();
  });

  it('writes a new version when stored hash differs', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    mockClient.documents.list.mockResolvedValue([
      { id: 'doc-hero', path: '/_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
    ]);
    // Stored snapshot has a different hash
    mockClient.versions.getLatest.mockResolvedValue({
      id: 'ver-old', versionNumber: 1,
      snapshot: { name: 'HeroBlock', descriptorHash: 'stale-hash-000' },
    });

    renderHook(() => useComponentRegistry({ puckConfig: simplePuckConfig }), { wrapper: wrapper(ctx) });

    await waitFor(() => {
      const calls = mockClient.versions.create.mock.calls as unknown[][];
      return calls.some((args) => {
        const params = args[1] as Record<string, string>;
        return params.documentId === 'doc-hero';
      });
    });

    const calls = mockClient.versions.create.mock.calls as unknown[][];
    const heroCall = calls.find((args) => {
      const params = args[1] as Record<string, string>;
      return params.documentId === 'doc-hero';
    });
    expect(heroCall).toBeDefined();
  });

  it('returns status "error" and non-null error when CSS write fails', async () => {
    const ctx = makeMockContext();
    const mockClient = ctx.client as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    mockClient.documents.list.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('calls onRegistered callback with counts', async () => {
    const ctx = makeMockContext();
    const onRegistered = vi.fn();

    renderHook(
      () => useComponentRegistry({ puckConfig: simplePuckConfig, onRegistered }),
      { wrapper: wrapper(ctx) },
    );

    await waitFor(() => expect(onRegistered).toHaveBeenCalled());
    const [result] = onRegistered.mock.calls[0] as [{ registered: number; skipped: number; total: number }][];
    expect(result.total).toBe(1);
    expect(typeof result.registered).toBe('number');
    expect(typeof result.skipped).toBe('number');
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run packages/puck-css/src/__tests__/useComponentRegistry.test.tsx 2>&1 | head -20
```

Expected: fails — `useComponentRegistry` not found.

**Step 3: Implement the hook**

```typescript
// packages/puck-css/src/hooks/useComponentRegistry.ts

import { useState, useEffect, useRef } from 'react';
import { useCSSPuck } from '../CSSPuckContext.js';
import {
  extractDescriptors,
  buildRegistryIndex,
  type ComponentDescriptor,
  type RegistryIndex,
} from '../utils/componentRegistry.js';
import type { CSSClient, Document, DocumentVersion } from '@pantheon/css-client';

// =============================================================================
// Public API types
// =============================================================================

export interface RegistrationResult {
  registered: number;
  skipped: number;
  total: number;
}

export interface UseComponentRegistryOptions {
  /** Puck config to register. Pass the same object as <Puck config={...} /> */
  puckConfig: unknown;
  /** Optional upstream Puck config for provenance classification */
  upstreamPuckConfig?: unknown;
  /** Called when registration completes (or is a full no-op) */
  onRegistered?: (result: RegistrationResult) => void;
  /** Called if registration fails */
  onError?: (error: Error) => void;
}

export interface UseComponentRegistryReturn {
  status: 'idle' | 'registering' | 'registered' | 'error';
  result: RegistrationResult | null;
  error: Error | null;
}

// =============================================================================
// Registry path helpers
// =============================================================================

const REGISTRY_PREFIX = '/_registry/';
const COMPONENT_PREFIX = '/_registry/components/';
const INDEX_PATH = '/_registry/index';

function componentPath(name: string): string {
  return `${COMPONENT_PREFIX}${name}`;
}

// =============================================================================
// Core registration logic
// =============================================================================

async function runRegistration(
  client: CSSClient,
  siteId: string,
  branchId: string,
  descriptors: ComponentDescriptor[],
): Promise<RegistrationResult> {
  // Step 1: List all existing registry documents
  const existingDocs: Document[] = await client.documents.list(siteId, branchId, {
    pathPrefix: REGISTRY_PREFIX,
  });

  // Step 2: Build lookup maps for existing component docs
  const docByName = new Map<string, Document>();
  let indexDoc: Document | undefined;
  for (const doc of existingDocs) {
    if (doc.path === INDEX_PATH) {
      indexDoc = doc;
    } else if (doc.path.startsWith(COMPONENT_PREFIX)) {
      const name = doc.path.slice(COMPONENT_PREFIX.length);
      docByName.set(name, doc);
    }
  }

  // Step 3: For each doc that exists, fetch its stored hash
  const storedHashByName = new Map<string, string>();
  await Promise.all(
    Array.from(docByName.entries()).map(async ([name, doc]) => {
      try {
        const version: DocumentVersion = await client.versions.getLatest(siteId, branchId, doc.id);
        const snapshot = version.snapshot as Partial<ComponentDescriptor>;
        if (typeof snapshot.descriptorHash === 'string') {
          storedHashByName.set(name, snapshot.descriptorHash);
        }
      } catch {
        // Version fetch failure → treat as hash mismatch, will overwrite
      }
    }),
  );

  // Step 4: Write only changed/new descriptors
  let registered = 0;
  let skipped = 0;

  await Promise.all(
    descriptors.map(async (descriptor) => {
      const storedHash = storedHashByName.get(descriptor.name);
      if (storedHash === descriptor.descriptorHash) {
        skipped++;
        return;
      }

      let docId: string;
      const existingDoc = docByName.get(descriptor.name);

      if (existingDoc === undefined) {
        // Create the document first
        const newDoc = await client.documents.create({
          siteId,
          branchId,
          path: componentPath(descriptor.name),
        });
        docId = newDoc.id;
      } else {
        docId = existingDoc.id;
      }

      await client.versions.create(siteId, {
        documentId: docId,
        branchId,
        snapshot: descriptor as unknown as Record<string, unknown>,
      });

      registered++;
    }),
  );

  // Step 5: Write index only when something changed OR index doesn't exist yet.
  // Avoids creating spurious version history on every editor open when all hashes match.
  const indexNeedsWrite = registered > 0 || indexDoc === undefined;

  if (indexNeedsWrite) {
    const index: RegistryIndex = buildRegistryIndex(descriptors, siteId, branchId);
    let indexDocId: string;
    if (indexDoc === undefined) {
      const newIndexDoc = await client.documents.create({ siteId, branchId, path: INDEX_PATH });
      indexDocId = newIndexDoc.id;
    } else {
      indexDocId = indexDoc.id;
    }
    await client.versions.create(siteId, {
      documentId: indexDocId,
      branchId,
      snapshot: index as unknown as Record<string, unknown>,
    });
  }

  return { registered, skipped, total: descriptors.length };
}

// =============================================================================
// Hook
// =============================================================================

export function useComponentRegistry(
  options: UseComponentRegistryOptions,
): UseComponentRegistryReturn {
  const { puckConfig, upstreamPuckConfig, onRegistered, onError } = options;
  const { client, siteId, branchId } = useCSSPuck();

  const [status, setStatus] = useState<UseComponentRegistryReturn['status']>('idle');
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Use a ref to track the puckConfig identity so re-renders don't re-run
  const puckConfigRef = useRef(puckConfig);

  useEffect(() => {
    puckConfigRef.current = puckConfig;
    let cancelled = false;

    setStatus('registering');

    const descriptors = extractDescriptors(puckConfig, upstreamPuckConfig);

    runRegistration(client, siteId, branchId, descriptors)
      .then((registrationResult) => {
        if (cancelled) return;
        setStatus('registered');
        setResult(registrationResult);
        onRegistered?.(registrationResult);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const registrationError = err instanceof Error ? err : new Error(String(err));
        setStatus('error');
        setError(registrationError);
        onError?.(registrationError);
        // Log but don't re-throw — a registry failure must not break the editor
        console.warn('[useComponentRegistry] Registration failed:', registrationError.message);
      });

    return () => {
      cancelled = true;
    };
  // Re-run when puckConfig identity changes OR when the branch changes (e.g., after a branch switch).
  // client is stable across renders; siteId and branchId may change without puckConfig changing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puckConfig, siteId, branchId]);

  return { status, result, error };
}
```

**Step 4: Run tests**

```bash
npx vitest run packages/puck-css/src/__tests__/useComponentRegistry.test.tsx --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS.

**Step 5: Lint**

```bash
cd packages/puck-css && npx eslint src/hooks/useComponentRegistry.ts src/__tests__/useComponentRegistry.test.tsx --fix
```

**Step 6: Commit**

```bash
git add packages/puck-css/src/hooks/useComponentRegistry.ts packages/puck-css/src/__tests__/useComponentRegistry.test.tsx
git commit -m "feat: implement useComponentRegistry hook for writing component descriptors to CSS"
```

---

## Task 7: Filter `/_registry/` documents from CSSPlugin panel

**Files:**
- Modify: `packages/puck-css/src/plugin/CSSPlugin.tsx` (line ~123)
- Create: `packages/puck-css/src/__tests__/registry-filtering.test.tsx`

**Step 1: Write failing test**

```typescript
// packages/puck-css/src/__tests__/registry-filtering.test.tsx
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { createCSSPlugin } from '../plugin/index.js';
import type { Branch, Document } from '@pantheon/css-client';

const mockBranch: Branch = {
  id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true, createdAt: '2026-01-01T00:00:00Z',
};

function createDoc(overrides: Partial<Document> & { id: string; path: string }): Document {
  return { siteId: 'site-1', archived: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides };
}

describe('Registry document filtering', () => {
  it('hides /_registry/ documents from the plugin document list', () => {
    const documents: Document[] = [
      createDoc({ id: 'doc-home', path: '/home' }),
      createDoc({ id: 'doc-about', path: '/about' }),
      createDoc({ id: 'doc-reg-index', path: '/_registry/index' }),
      createDoc({ id: 'doc-reg-hero', path: '/_registry/components/HeroBlock' }),
    ];

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents,
      onDocumentSelect: vi.fn(),
    });

    render(<>{plugin.render()}</>);

    expect(screen.getByText('/home')).toBeDefined();
    expect(screen.getByText('/about')).toBeDefined();
    expect(screen.queryByText('/_registry/index')).toBeNull();
    expect(screen.queryByText('/_registry/components/HeroBlock')).toBeNull();
  });

  it('still shows non-registry documents alongside normal filter (archived)', () => {
    const documents: Document[] = [
      createDoc({ id: 'doc-home', path: '/home' }),
      createDoc({ id: 'doc-archived', path: '/old', archived: true }),
      createDoc({ id: 'doc-reg', path: '/_registry/index' }),
    ];

    const plugin = createCSSPlugin({
      branches: [mockBranch],
      currentBranch: mockBranch,
      onBranchSwitch: vi.fn(),
      documents,
      onDocumentSelect: vi.fn(),
    });

    render(<>{plugin.render()}</>);

    expect(screen.getByText('/home')).toBeDefined();
    expect(screen.queryByText('/old')).toBeNull();
    expect(screen.queryByText('/_registry/index')).toBeNull();
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run packages/puck-css/src/__tests__/registry-filtering.test.tsx 2>&1 | tail -15
```

Expected: FAIL — `/_registry/index` appears in rendered output (not yet filtered).

**Step 3: Apply the one-line change to CSSPlugin.tsx**

Locate line ~123 in `packages/puck-css/src/plugin/CSSPlugin.tsx`:

```typescript
// Before:
const documents = rawDocuments.filter((doc) => !doc.archived);

// After:
const documents = rawDocuments.filter(
  (doc) => !doc.archived && !doc.path.startsWith('/_registry/'),
);
```

**Step 4: Run to verify pass**

```bash
npx vitest run packages/puck-css/src/__tests__/registry-filtering.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: all tests PASS.

**Step 5: Run full puck-css suite to confirm no regressions**

```bash
npx vitest run packages/puck-css/src/__tests__/ --reporter=verbose 2>&1 | tail -20
```

**Step 6: Commit**

```bash
git add packages/puck-css/src/plugin/CSSPlugin.tsx packages/puck-css/src/__tests__/registry-filtering.test.tsx
git commit -m "feat: filter /_registry/ documents from plugin document list"
```

---

## Task 8: Export `useComponentRegistry` and types from the package barrel

**Files:**
- Modify: `packages/puck-css/src/index.ts`

**Step 1: Add exports**

Add to `packages/puck-css/src/index.ts` after the `// Agent Edit Hooks (Phase 4)` block:

```typescript
// Component Registry
export { useComponentRegistry } from './hooks/useComponentRegistry.js';
export type {
  UseComponentRegistryOptions,
  UseComponentRegistryReturn,
  RegistrationResult,
} from './hooks/useComponentRegistry.js';
export type {
  ComponentDescriptor,
  ComponentProvenance,
  SerializedField,
  FieldAiMeta,
  RegistryIndex,
} from './utils/componentRegistry.js';
```

**Step 2: Typecheck**

```bash
cd packages/puck-css && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

**Step 3: Run full test suite one more time**

```bash
npx vitest run packages/puck-css/src/__tests__/ 2>&1 | tail -10
```

Expected: all PASS.

**Step 4: Commit**

```bash
git add packages/puck-css/src/index.ts
git commit -m "feat: export useComponentRegistry and registry types from package barrel"
```

---

## Task 9: Add `pathPrefix` support to MCP api-client `listDocuments`

> **Repo:** `/Users/chris.yates/src/collaborative-state-system` — all file paths below are relative to this directory.

**Files:**
- Modify: `workers/mcp-server/src/shared/api-client.ts`
- Modify: `workers/mcp-server/tests/shared/api-client.spec.ts`

**Step 1: Write failing test**

Add to `api-client.spec.ts`:

```typescript
describe('listDocuments with pathPrefix', () => {
  it('appends pathPrefix as a query parameter when provided', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'a1', agentApiKey: 'aak_test' });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [] }));

    await client.listDocuments('site-1', 'branch-1', { pathPrefix: '/_registry/components/' });

    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('pathPrefix=%2F_registry%2Fcomponents%2F');
  });

  it('does not append query params when pathPrefix is not provided', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'a1', agentApiKey: 'aak_test' });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [] }));

    await client.listDocuments('site-1', 'branch-1');

    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).not.toContain('pathPrefix');
  });
});
```

**Step 2: Run to verify failure**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/tests/shared/api-client.spec.ts 2>&1 | tail -15
```

Expected: FAIL — `listDocuments` doesn't accept `options`.

**Step 3: Update `listDocuments` in api-client.ts**

```typescript
// Replace:
async listDocuments(siteId: string, branchId: string): Promise<ListDocumentsResponse> {
  const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents`;
  const response = await this.doFetch(url, {
    method: 'GET',
    headers: this.getHeaders(),
  });
  return this.handleResponse<ListDocumentsResponse>(response);
}

// With:
async listDocuments(
  siteId: string,
  branchId: string,
  options?: { pathPrefix?: string },
): Promise<ListDocumentsResponse> {
  const params = options?.pathPrefix !== undefined && options.pathPrefix !== ''
    ? `?pathPrefix=${encodeURIComponent(options.pathPrefix)}`
    : '';
  const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents${params}`;
  const response = await this.doFetch(url, {
    method: 'GET',
    headers: this.getHeaders(),
  });
  return this.handleResponse<ListDocumentsResponse>(response);
}
```

**Step 4: Run to verify pass**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/tests/shared/api-client.spec.ts --reporter=verbose 2>&1 | tail -15
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system && git add workers/mcp-server/src/shared/api-client.ts workers/mcp-server/tests/shared/api-client.spec.ts && git commit -m "feat: add pathPrefix option to MCP api-client listDocuments"
```

---

## Task 10: Add `getDocumentLatestVersion` and `createDocument` to MCP api-client

> **Repo:** `/Users/chris.yates/src/collaborative-state-system` — all file paths below are relative to this directory.

**Files:**
- Modify: `workers/mcp-server/src/shared/api-client.ts`
- Modify: `workers/mcp-server/tests/shared/api-client.spec.ts`

These two methods are needed by `list_components` (to fetch snapshots by document ID) and `create_page` (to create a doc with its initial snapshot in one atomic call).

### Key facts about the CSS API (read before implementing)

- `GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/latest` — the `{documentId}` segment is a **UUID**, not an encoded path. The route parser regex uses `[^/]+` which would match an encoded path, but the backing query looks up by UUID and would return nothing for a non-UUID. Always pass `doc.id` (from `listDocuments`) here.
- `POST /api/sites/{siteId}/branches/{branchId}/documents` — accepts `{ path, snapshot? }` and creates both the document and its first version **atomically**. Response shape: `{ document: { id, path, ... }, version: { ... } }`. The `createDocument` method uses this single call.
- The `versions/latest` endpoint returns a `DocumentVersion` object: `{ id, documentId, branchId, versionNumber, snapshot, source, createdById, createdByType, createdAt }`. The version ID field is `id`, not `versionId`.

**Step 1: Add types to api-client.ts**

Add after `ListDocumentsResponse`:

```typescript
export interface DocumentVersionLatest {
  id: string;
  documentId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
}

export interface CreateDocumentResult {
  documentId: string;
  documentPath: string;
  versionId: string;
}
```

**Step 2: Write failing tests**

Add to `api-client.spec.ts`:

```typescript
describe('getDocumentLatestVersion', () => {
  it('fetches the latest version snapshot by document ID', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'a1', agentApiKey: 'aak_test' });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      id: 'ver-1',
      documentId: 'doc-abc123',
      versionNumber: 1,
      snapshot: { name: 'HeroBlock', descriptorHash: 'abc' },
    }));

    const result = await client.getDocumentLatestVersion('site-1', 'branch-1', 'doc-abc123');

    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    // URL must use documentId directly — not an encoded path
    expect(url).toContain('/documents/doc-abc123/versions/latest');
    expect(url).not.toContain('%2F'); // no path encoding — it is a UUID segment
    expect(result.snapshot).toEqual({ name: 'HeroBlock', descriptorHash: 'abc' });
    expect(result.id).toBe('ver-1');
  });
});

describe('createDocument', () => {
  it('creates a document with snapshot in one atomic call', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const client = new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'a1', agentApiKey: 'aak_test' });

    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      document: { id: 'doc-1', path: '/about', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-1', branchId: 'branch-1', source: 'edit', createdById: '', createdByType: 'agent', createdAt: '' },
    }, 201));

    const result = await client.createDocument(
      'site-1', 'branch-1', '/about', { content: [], root: { props: {} } },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1); // single atomic call
    const [url, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/documents');
    const body = JSON.parse(init.body) as { path: string; snapshot: unknown };
    expect(body.path).toBe('/about');
    expect(body.snapshot).toBeDefined();
    expect(result.documentId).toBe('doc-1');
    expect(result.versionId).toBe('ver-1');
    expect(result.documentPath).toBe('/about');
  });
});
```

**Step 3: Run to verify failure**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/tests/shared/api-client.spec.ts 2>&1 | grep -E "FAIL|getDocumentLatestVersion|createDocument"
```

**Step 4: Implement both methods**

Add to `McpApiClient` class in `api-client.ts`:

```typescript
/**
 * Get the latest version snapshot for a document by its UUID.
 *
 * IMPORTANT: documentId must be a UUID (from listDocuments response doc.id),
 * NOT an encoded document path. The backend route uses [^/]+ to capture this
 * segment and performs a UUID-based DB lookup — passing an encoded path
 * would produce a 404 or wrong result.
 */
async getDocumentLatestVersion(
  siteId: string,
  branchId: string,
  documentId: string,
): Promise<DocumentVersionLatest> {
  const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents/${documentId}/versions/latest`;
  const response = await this.doFetch(url, {
    method: 'GET',
    headers: this.getHeaders(),
  });
  return this.handleResponse<DocumentVersionLatest>(response);
}

/**
 * Create a new document and its first version atomically.
 *
 * The CSS backend accepts an optional `snapshot` in the POST body alongside
 * `path` and creates both document and version in a single transaction.
 * This is preferred over separate create-then-version calls.
 *
 * Used by create_page — bypasses agent edit workflow since the doc is new
 * (no checkpoint is needed before writing a first version).
 */
async createDocument(
  siteId: string,
  branchId: string,
  path: string,
  snapshot: unknown,
): Promise<CreateDocumentResult> {
  const url = `${this.baseUrl}/api/sites/${siteId}/branches/${branchId}/documents`;
  const response = await this.doFetch(url, {
    method: 'POST',
    headers: this.getHeaders(),
    body: JSON.stringify({ path, snapshot }),
  });
  const result = await this.handleResponse<{
    document: { id: string; path: string };
    version: { id: string };
  }>(response);

  return {
    documentId: result.document.id,
    documentPath: result.document.path,
    versionId: result.version.id,
  };
}
```

**Step 5: Run to verify pass**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/tests/shared/api-client.spec.ts --reporter=verbose 2>&1 | tail -20
```

**Step 6: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system && git add workers/mcp-server/src/shared/api-client.ts workers/mcp-server/tests/shared/api-client.spec.ts && git commit -m "feat: add getDocumentLatestVersion and createDocument to MCP api-client"
```

---

## Task 11: Implement `list_components` MCP tool

> **Repo:** `/Users/chris.yates/src/collaborative-state-system` — all file paths below are relative to this directory.

**Files:**
- Modify: `workers/mcp-server/src/shared/tools.ts`
- Create: `workers/mcp-server/tests/shared/list-components.spec.ts`

**Step 1: Write failing tests**

```typescript
// workers/mcp-server/tests/shared/list-components.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('list_components tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const defaultConfig = { baseUrl: 'http://localhost:8787', agentId: 'agent-1', agentApiKey: 'aak_test' };

  it('returns formatted list of components from the registry', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    // First call: list docs at /_registry/components/ prefix
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      documents: [
        { id: 'doc-hero', path: '/_registry/components/HeroBlock', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
      ],
    }));

    // Second call: getDocumentLatestVersion for HeroBlock (by doc.id = 'doc-hero')
    // Response shape matches the CSS backend's DocumentVersion: { id, documentId, versionNumber, snapshot, ... }
    mockFetch.mockResolvedValueOnce(createMockResponse(true, {
      id: 'ver-1',
      documentId: 'doc-hero',
      versionNumber: 1,
      snapshot: {
        name: 'HeroBlock',
        label: 'Hero',
        provenance: 'site',
        fields: [{ type: 'text', name: 'title', label: 'Title' }],
        defaultProps: { title: '' },
        ai: { instructions: 'Use for page hero sections.' },
        descriptorHash: 'abc123',
        registeredAt: '2026-04-01T00:00:00Z',
      },
    }));

    const result = await handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('HeroBlock');
    expect(text).toContain('[site]');
    expect(text).toContain('1 field');
    expect(text).toContain('Use for page hero sections.');

    // Verify the second call used doc.id (UUID), not the doc.path
    const [secondUrl] = mockFetch.mock.calls[1] as [string, ...unknown[]];
    expect(secondUrl).toContain('/documents/doc-hero/versions/latest');
    expect(secondUrl).not.toContain('%2F_registry'); // must not use encoded path
  });

  it('returns a graceful message when no components are registered', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [] }));

    const result = await handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('No components registered');
  });

  it('returns isError true on API failure', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Internal server error' }, 500));

    const result = await handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' });

    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run to verify failure**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/tests/shared/list-components.spec.ts 2>&1 | head -20
```

Expected: FAIL — `list_components` handler not found.

**Step 3: Implement `list_components` in tools.ts**

Add to the input schemas section:

```typescript
const ListComponentsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
});
```

Add to `getToolDefinitions()`:

```typescript
{
  name: 'list_components',
  description:
    'List all Puck components registered in the site\'s component registry. Returns component names, provenance (site/upstream/overridden), field count, and any AI instructions. The special component __root__ describes the page-level root props accepted by root_props in create_page. Use this to discover what components and root fields are available before calling create_page.',
  inputSchema: ListComponentsInputSchema,
},
```

Add to `ToolHandlers` interface:

```typescript
list_components: (input: z.infer<typeof ListComponentsInputSchema>) => Promise<ToolResult>;
```

Add to `createToolHandlers()`:

```typescript
async list_components(input: { site_id: string; branch_id: string }): Promise<ToolResult> {
  try {
    const docs = await apiClient.listDocuments(input.site_id, input.branch_id, {
      pathPrefix: '/_registry/components/',
    });

    if (docs.documents.length === 0) {
      return formatResult('No components registered in this site. The site editor must be opened at least once to populate the registry.');
    }

    // Fetch each component's snapshot
    const componentLines: string[] = [];
    const counts = { site: 0, upstream: 0, overridden: 0 };

    await Promise.all(
      docs.documents.map(async (doc) => {
        const name = doc.path.slice('/_registry/components/'.length);
        try {
          // Use doc.id (UUID) — NOT doc.path. The backend versions/latest route
          // performs a UUID-based lookup; passing a path would return 404.
          const version = await apiClient.getDocumentLatestVersion(
            input.site_id, input.branch_id, doc.id,
          );
          const descriptor = version.snapshot as Record<string, unknown>;
          const provenance = (descriptor.provenance as string) ?? 'site';
          const fields = (descriptor.fields as unknown[] | undefined) ?? [];
          const ai = descriptor.ai as { instructions?: string } | undefined;
          const label = (descriptor.label as string | undefined) ?? name;

          if (provenance in counts) counts[provenance as keyof typeof counts]++;

          const aiNote = ai?.instructions !== undefined && ai.instructions !== ''
            ? ` — AI: "${ai.instructions.slice(0, 60)}${ai.instructions.length > 60 ? '...' : ''}"`
            : '';
          const fieldNote = fields.length === 1 ? '1 field' : `${String(fields.length)} fields`;

          componentLines.push(`- ${name} (${String(label)}) [${provenance}] — ${fieldNote}${aiNote}`);
        } catch {
          componentLines.push(`- ${name} [error fetching descriptor]`);
        }
      }),
    );

    componentLines.sort(); // Alphabetical order for readability

    const summary = `Components registered in this site (${String(docs.documents.length)} total — ${String(counts.site)} site, ${String(counts.upstream)} upstream, ${String(counts.overridden)} overridden):\n${componentLines.join('\n')}`;
    return formatResult(summary);
  } catch (error) {
    return formatError(error);
  }
},
```

Add to `schemas` export:

```typescript
export const schemas = {
  // ... existing ...
  list_components: ListComponentsInputSchema,
};
```

**Step 4: Run to verify pass**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/tests/shared/list-components.spec.ts --reporter=verbose 2>&1 | tail -15
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system && git add workers/mcp-server/src/shared/tools.ts workers/mcp-server/tests/shared/list-components.spec.ts && git commit -m "feat: add list_components MCP tool for agent component discovery"
```

---

## Task 12: Implement `create_page` MCP tool

> **Repo:** `/Users/chris.yates/src/collaborative-state-system` — all file paths below are relative to this directory.

**Files:**
- Modify: `workers/mcp-server/src/shared/tools.ts`
- Create: `workers/mcp-server/tests/shared/create-page.spec.ts`

### ULID generation (inline, no dependency)

The mcp-server does not have a `ulid` dependency. Use this inline generator — it produces a valid 26-character Crockford Base32 ULID using `crypto.getRandomValues()`, which is available in Cloudflare Workers:

```typescript
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function generateULID(): string {
  const now = Date.now();
  let id = '';
  // 10-char timestamp component
  let t = now;
  for (let i = 9; i >= 0; i--) {
    id = ENCODING[t % 32] + id;
    t = Math.floor(t / 32);
  }
  // 16-char randomness component
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  let rnd = BigInt(0);
  for (const byte of rand) { rnd = (rnd << BigInt(8)) | BigInt(byte); }
  for (let i = 0; i < 16; i++) {
    id += ENCODING[Number(rnd % BigInt(32))];
    rnd >>= BigInt(5);
  }
  return id;
}
```

### Puck `Data` structure

A valid Puck `Data` object has this shape:

```typescript
interface PuckData {
  content: Array<{ type: string; props: Record<string, unknown> & { id: string } }>;
  root: { props: Record<string, unknown> };
  zones?: Record<string, Array<{ type: string; props: Record<string, unknown> & { id: string } }>>;
}
```

- Each component instance requires a unique `id` in `props` (generated via ULID)
- Slot/zone components go in `zones["{parentId}:{slotFieldName}"]` rather than `content`

**Step 1: Write failing tests**

```typescript
// workers/mcp-server/tests/shared/create-page.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i * 17 % 256;
    return arr;
  },
});

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

describe('create_page tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const defaultConfig = { baseUrl: 'http://localhost:8787', agentId: 'agent-1', agentApiKey: 'aak_test' };

  it('creates a document with Puck Data in one atomic call', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    // Single atomic response: backend creates document + version together
    mockFetch.mockResolvedValueOnce(createMockResponse(
      true,
      {
        document: { id: 'doc-about', path: '/about', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
        version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-about', branchId: 'branch-1', source: 'edit', createdById: '', createdByType: 'agent', createdAt: '' },
      },
      201,
    ));

    const result = await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/about',
      components: [
        { type: 'HeroBlock', props: { title: 'About Us' } },
        { type: 'TextBlock', props: { body: 'We are a team.' } },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('/about');
    // One HTTP call — document + version created atomically
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the POST body contains valid Puck Data as the snapshot
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { path: string; snapshot: { content: Array<{ type: string; props: { id: string } }> } };
    expect(body.path).toBe('/about');
    expect(body.snapshot.content).toHaveLength(2);
    expect(body.snapshot.content[0].type).toBe('HeroBlock');
    expect(typeof body.snapshot.content[0].props.id).toBe('string');
    expect(body.snapshot.content[0].props.id).toHaveLength(26); // ULID length
  });

  it('places zone components in zones object, not content', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    mockFetch.mockResolvedValueOnce(createMockResponse(
      true,
      {
        document: { id: 'doc-1', path: '/page', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
        version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-1', branchId: 'branch-1', source: 'edit', createdById: '', createdByType: 'agent', createdAt: '' },
      },
      201,
    ));

    await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/page',
      components: [
        { type: 'Layout', props: {} },
        { type: 'HeroBlock', props: { title: 'Hi' }, zone: 'mainSlot', parentId: 'PARENT-ID-123' },
      ],
    });

    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as {
      path: string;
      snapshot: {
        content: Array<{ type: string }>;
        zones?: Record<string, Array<{ type: string }>>;
      };
    };

    // Layout goes to content (no zone), HeroBlock goes to zones
    expect(body.snapshot.content).toHaveLength(1);
    expect(body.snapshot.content[0].type).toBe('Layout');
    expect(body.snapshot.zones?.['PARENT-ID-123:mainSlot']).toHaveLength(1);
    expect(body.snapshot.zones?.['PARENT-ID-123:mainSlot'][0].type).toBe('HeroBlock');
  });

  it('rejects document_path starting with /_registry/', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    const result = await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/_registry/components/Foo',
      components: [],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('_registry');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns isError true when document creation fails', async () => {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createToolHandlers } = await import('../../src/shared/tools.js');
    const client = new McpApiClient(defaultConfig);
    const handlers = createToolHandlers(client);

    // Backend returns 409 when path already exists (single call — atomic)
    mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Document already exists at this path' }, 409));

    const result = await handlers.create_page({
      site_id: 'site-1',
      branch_id: 'branch-1',
      document_path: '/existing',
      components: [],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already exists');
  });
});
```

**Step 2: Run to verify failure**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/tests/shared/create-page.spec.ts 2>&1 | head -20
```

Expected: FAIL — `create_page` handler not found.

**Step 3: Implement `create_page` in tools.ts**

Add schema:

```typescript
const CreatePageInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('Path for the new page (e.g. "/about"). Must start with /. Cannot start with /_registry/.'),
  components: z.array(z.object({
    type: z.string().describe('Component type name (from list_components)'),
    props: z.record(z.unknown()).describe('Component props matching the registered fields'),
    zone: z.string().optional().describe('Slot field name when placing in a nested slot (requires parentId)'),
    parentId: z.string().optional().describe('ID of the parent component for slot placement (must match a component\'s generated id)'),
  })).describe('Components to place on the page, in order'),
  root_props: z.record(z.unknown()).optional().describe('Page-level root props'),
});
```

Add inline ULID generator (place near the top of the file, after imports):

```typescript
// =============================================================================
// ULID generator (inline — no external dependency required in Workers)
// =============================================================================

const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateULID(): string {
  const now = Date.now();
  let id = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    id = ULID_ENCODING[t % 32] + id;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  let rnd = BigInt(0);
  for (const byte of rand) { rnd = (rnd << BigInt(8)) | BigInt(byte); }
  for (let i = 0; i < 16; i++) {
    id += ULID_ENCODING[Number(rnd % BigInt(32))];
    rnd >>= BigInt(5);
  }
  return id;
}
```

Add to `getToolDefinitions()`:

```typescript
{
  name: 'create_page',
  description:
    'Create a new page with a structured set of Puck components. Use list_components first to discover available component types and their field schemas. Each component is given a unique ID automatically. Returns the new document path and ID.',
  inputSchema: CreatePageInputSchema,
},
```

Add to `ToolHandlers` interface:

```typescript
create_page: (input: z.infer<typeof CreatePageInputSchema>) => Promise<ToolResult>;
```

Add to `createToolHandlers()`:

```typescript
async create_page(input: z.infer<typeof CreatePageInputSchema>): Promise<ToolResult> {
  try {
    if (input.document_path.startsWith('/_registry/')) {
      return formatError(new Error(
        'Cannot create pages at the /_registry/ path prefix — this is reserved for system use.',
      ));
    }

    // Build valid Puck Data
    type PuckComponent = { type: string; props: Record<string, unknown> & { id: string } };
    const content: PuckComponent[] = [];
    const zones: Record<string, PuckComponent[]> = {};

    for (const component of input.components) {
      const id = generateULID();
      const instance: PuckComponent = {
        type: component.type,
        props: { ...component.props, id },
      };

      if (component.parentId !== undefined && component.zone !== undefined) {
        const zoneKey = `${component.parentId}:${component.zone}`;
        if (zones[zoneKey] === undefined) zones[zoneKey] = [];
        zones[zoneKey].push(instance);
      } else {
        content.push(instance);
      }
    }

    const puckData = {
      content,
      root: { props: input.root_props ?? {} },
      ...(Object.keys(zones).length > 0 && { zones }),
    };

    const { documentId, documentPath } = await apiClient.createDocument(
      input.site_id,
      input.branch_id,
      input.document_path,
      puckData,
    );

    return formatResult({
      message: `Page created at "${documentPath}".`,
      documentPath,
      documentId,
      componentCount: content.length + Object.values(zones).reduce((n, arr) => n + arr.length, 0),
    });
  } catch (error) {
    return formatError(error);
  }
},
```

Add to `schemas`:

```typescript
export const schemas = {
  // ... existing ...
  list_components: ListComponentsInputSchema,
  create_page: CreatePageInputSchema,
};
```

**Step 4: Run to verify pass**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/tests/shared/create-page.spec.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system && git add workers/mcp-server/src/shared/tools.ts workers/mcp-server/tests/shared/create-page.spec.ts && git commit -m "feat: add create_page MCP tool for autonomous page creation"
```

---

## Task 13: Register new tools in mcp-handler and update tool-count tests

> **Repo:** `/Users/chris.yates/src/collaborative-state-system` — all file paths below are relative to this directory.

**Files:**
- Modify: `workers/mcp-server/src/mcp-handler.ts`
- Modify: `workers/mcp-server/tests/mcp-handler.spec.ts`
- Modify: `workers/mcp-server/tests/shared/tools.spec.ts`

**Step 1: Update mcp-handler.ts**

Change the comment from `// Register all 11 tools` to `// Register all 13 tools`.

Add after the `get_document_presence` registration block:

```typescript
server.registerTool(
  'list_components',
  {
    description: toolDefinitions.find((t) => t.name === 'list_components')?.description ?? '',
    inputSchema: schemas.list_components,
  },
  async (params) => handlers.list_components(params),
);

server.registerTool(
  'create_page',
  {
    description: toolDefinitions.find((t) => t.name === 'create_page')?.description ?? '',
    inputSchema: schemas.create_page,
  },
  async (params) => handlers.create_page(params),
);
```

**Step 2: Update tool count in `tools.spec.ts`**

Change:
```typescript
expect(defs).toHaveLength(11);
```
To:
```typescript
expect(defs).toHaveLength(13);
```

Add `'list_components'` and `'create_page'` to the `toContain` assertions list.

**Step 3: Update tool count in `mcp-handler.spec.ts`**

Change:
```typescript
// Test 30: createMcpServer registers all 11 tools
it('should register all 11 tools on the MCP server', async () => {
```
To:
```typescript
// Test 30: createMcpServer registers all 13 tools
it('should register all 13 tools on the MCP server', async () => {
```

Change:
```typescript
expect(expectedToolNames).toHaveLength(11);
```
To:
```typescript
expect(expectedToolNames).toHaveLength(13);
```

Add to `expectedNames` array:
```typescript
'list_components', 'create_page',
```

**Step 4: Run all mcp-server tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/ --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS including updated counts.

**Step 5: Typecheck**

```bash
cd /Users/chris.yates/src/collaborative-state-system/workers/mcp-server && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

**Step 6: Lint**

```bash
cd /Users/chris.yates/src/collaborative-state-system/workers/mcp-server && npx eslint src tests --fix
```

Expected: no errors. Fix any warnings before committing.

**Step 7: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system && git add workers/mcp-server/src/mcp-handler.ts workers/mcp-server/tests/mcp-handler.spec.ts workers/mcp-server/tests/shared/tools.spec.ts && git commit -m "feat: register list_components and create_page MCP tools (13 tools total)"
```

---

## Task 14: Run full test suite for both repos and confirm clean state

**Step 1: Run all puck-css tests**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feature/component-registry && npx vitest run packages/puck-css/ 2>&1 | tail -20
```

Expected: all pass.

**Step 2: Run all mcp-server tests**

```bash
cd /Users/chris.yates/src/collaborative-state-system && npx vitest run workers/mcp-server/ 2>&1 | tail -20
```

Expected: all pass.

**Step 3: Typecheck both**

```bash
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feature/component-registry/packages/puck-css && npx tsc --noEmit && echo "puck-css OK"
cd /Users/chris.yates/src/collaborative-state-system/workers/mcp-server && npx tsc --noEmit && echo "mcp-server OK"
```

Expected: both print OK.

**Step 4: Final lint**

```bash
# puck-css
cd /Users/chris.yates/src/puck-css-integration/.worktrees/feature/component-registry/packages/puck-css && npx eslint src/__tests__/componentRegistry.test.ts src/__tests__/useComponentRegistry.test.tsx src/__tests__/registry-filtering.test.tsx src/utils/componentRegistry.ts src/hooks/useComponentRegistry.ts

# mcp-server
cd /Users/chris.yates/src/collaborative-state-system/workers/mcp-server && npx eslint src tests
```

Expected: no errors.

**Step 5: Verify changed files (puck-css-integration only)**

Note: MCP server changes are committed in a separate git repo (`/Users/chris.yates/src/collaborative-state-system`). Verify those separately with `git -C /Users/chris.yates/src/collaborative-state-system diff --name-only HEAD~4..HEAD` (or however many commits were made in that repo).

```bash
git -C /Users/chris.yates/src/puck-css-integration/.worktrees/feature/component-registry diff --name-only main...HEAD
```

Expected files changed in puck-css-integration:
```
docs/plans/2026-04-03-component-registry.md
packages/puck-css/src/__tests__/componentRegistry.test.ts
packages/puck-css/src/__tests__/registry-filtering.test.tsx
packages/puck-css/src/__tests__/useComponentRegistry.test.tsx
packages/puck-css/src/hooks/useComponentRegistry.ts
packages/puck-css/src/index.ts
packages/puck-css/src/plugin/CSSPlugin.tsx
packages/puck-css/src/utils/componentRegistry.ts
```

Expected files changed in collaborative-state-system (run `git diff --name-only HEAD~4..HEAD` from that repo):
```
workers/mcp-server/src/mcp-handler.ts
workers/mcp-server/src/shared/api-client.ts
workers/mcp-server/src/shared/tools.ts
workers/mcp-server/tests/mcp-handler.spec.ts
workers/mcp-server/tests/shared/api-client.spec.ts
workers/mcp-server/tests/shared/create-page.spec.ts
workers/mcp-server/tests/shared/list-components.spec.ts
workers/mcp-server/tests/shared/tools.spec.ts
```

---

## Out of Scope

- Automatic re-registration on hot module reload. A page reload is required for code changes.
- Registry cleanup / tombstoning of removed components. Stale entries are harmless; agents ignore unknown components.
- Upstream-only components (components present upstream but removed from the site's Puck config are simply absent).
- CSS API changes. All operations use existing endpoints.
- Admin UI changes. The `/_registry/` prefix filter in `CSSPlugin.tsx` covers all existing human-facing document surfaces.
