# Site Export/Import Bundle Format (PROPOSAL-013, PCC-3249) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Add `GET /api/admin/sites/{siteId}/export` and `POST /api/admin/sites/{siteId}/import` endpoints to the CCR backend, producing and consuming a versioned ZIP bundle that preserves full site data fidelity across environments.

**Architecture:** The export endpoint gathers all site data from the database, assembles a ZIP in memory, writes it to an R2 bucket (`ccr-bundles-{env}`), then returns a presigned download URL valid for 7 days. The import endpoint accepts a multipart upload, validates the SHA-256 manifest, and writes entities to PostgreSQL in dependency order: site → branches → documents → versions → checkpoints. UUID remapping (source→target) is tracked in a new `app.import_id_maps` table; `createdBy` fields are serialized as portable `{type, email|name}` refs for cross-environment fidelity. Import progress is persisted in KV (`CONFIG_KV`) for idempotent resume.

**Tech Stack:** Cloudflare Workers (TypeScript), PostgreSQL via Hyperdrive, Cloudflare KV (progress tracking via `CONFIG_KV`), Cloudflare R2 (bundle storage), `fflate` (synchronous ZIP generation/parsing, Workers-compatible), existing `aws4fetch` (R2 presigning via `signR2GetUrl`), Vitest (unit tests), existing test harness patterns.

---

## Key Design Decisions and Constraints

These decisions are recorded here so the implementing agent does not re-derive or deviate from them:

### Auth and permissions

- Both export and import require `assertPermission(principal, siteId, mainBranch.id, 'canManageGrants')`. This is the highest permission defined in `RolePermissions` (see `workers/src/types/auth.ts`). **Do NOT use `canManageSite` — that key does not exist in `RolePermissions` and would cause a TypeScript error.** For service principals (`sat_` tokens), `assertPermission` ignores the permission name and only checks site binding; `write:create` scoped tokens already have `allowedHandlers: '*'` so they pass scope enforcement.
- Routes are `/api/admin/sites/{siteId}/export` and `/api/admin/sites/{siteId}/import` — the `/api/admin/sites/` prefix is new (only `/api/admin/users/` existed before). Adding new admin routes here is consistent and intentional.

### Bundle structure (v1)

Each document gets a single `versions.jsonl` containing versions from all branches, with a `branchName` field per line so the import handler can route each version to the correct target branch. This matches the PROPOSAL-013 bundle spec exactly.

**Bundle structure:**

```
bundle.json                               - metadata + SHA-256 manifest
site.json                                 - site record (no secrets)
branches.json                             - all branches
documents/
  {path}/
    meta.json                             - document metadata
    versions.jsonl                        - versions for all branches (includes branchName field)
    publish_checkpoints.jsonl             - publish checkpoints for this document
```

Each line in `versions.jsonl` includes a `branchName` field so the import handler knows which branch the version belongs to:

```json
{"branchName":"main","versionNumber":3,"isPublished":true,"snapshot":{"root":{}},"createdAt":"2026-03-01T10:00:00Z","createdByRef":{"type":"user","email":"chris.yates@pantheon.io"}}
```

The import handler uses `branchName` to look up the target branch ID (from the branches mapping built during the branch import phase) and inserts the version into the correct branch. Version numbers from different branches can overlap (unique constraint is `(document_id, branch_id, version_number)`), so the import can insert them using sequential numbering on the target starting from 1.

### Import targets empty sites only

If the target site already has documents (excluding `_registry/`) or has non-main branches, the import returns 409. The main branch always exists (created when the site was created via `createSite`), so "empty site" means: no non-main branches AND no non-registry documents.

### R2 binding pattern

The wrangler.jsonc follows the `R2_SCREENSHOTS` pattern exactly:
- Add `R2_BUNDLES_BUCKET` as a string env var in each `vars` block (local, sbx1, staging, production).
- Add `{ "binding": "R2_BUNDLES", "bucket_name": "ccr-bundles-{env}" }` to each `r2_buckets` array.
- Add `R2_BUNDLES?: R2Bucket` and `R2_BUNDLES_BUCKET?: string` to the `Env` interface in `workers/src/index.ts`, near `R2_SCREENSHOTS`.

### Import handler: version numbering on target

Because source version numbers are per-branch and may collide, the import handler does NOT use source version numbers. It inserts versions sequentially (starting from 1) for each document+branch, ordered by `createdAt` ascending. Source version numbers are stored in `import_id_maps` for traceability but not replicated.

### Import handler: branch creation constraint

`CreateBranchParams.createdByType` only accepts `'user' | 'agent'` — not `'system'`. Use the resolved `createdByRefToId` result as `createdById` and the ref type as `createdByType` (fallback to `'user'` with SYSTEM_UUID when type is `'system'`).

### sha256Hex is defined in two places

`bundle-export-service.ts` and `bundle-import-service.ts` both need it. Do not share it via an import to avoid coupling. Keep it as a module-private function in each file (it is 4 lines of code — duplication is acceptable here per YAGNI).

### Streaming note

The ZIP is assembled using `fflate`'s synchronous `zipSync`. The result is a `Uint8Array` held in memory before upload to R2. Cloudflare Workers have a 128MB memory limit. This is acceptable for site export bundles in v1. The plan does not implement streaming ZIP generation.

---

## Preliminary: Clean Up Old Migration Approach

These files from the old API-based migration script are abandoned and must be removed before any new code is written. They have no tests and are not wired into the application.

### Task 0: Delete Abandoned Scripts

**Files:**
- Delete: `workers/scripts/migrate-site.ts`
- Delete: `workers/tsconfig.scripts.json`

**Step 1: Delete the files**

Run from the worktree root:
```bash
git rm workers/scripts/migrate-site.ts workers/tsconfig.scripts.json
```

**Step 2: Verify deletion**

```bash
git status --short
```

Expected: both files show as `D` (deleted).

**Step 3: Confirm no remaining references**

```bash
grep -rn "tsconfig.scripts\|migrate-site" workers/ --include="*.ts" --include="*.json" --include="*.jsonc"
```

Expected: no output.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(PCC-3249): remove abandoned API-based migration script"
```

---

## Task 1: Add fflate Dependency and Wire R2 Bundle Binding

**Why fflate:** The Cloudflare Workers runtime does not expose Node.js `zlib` or `archiver`. `fflate` is a pure-JS, tree-shakeable ZIP library that works in both browser and Worker environments. It is the standard choice for ZIP generation in Workers.

**Files:**
- Modify: `workers/package.json` (add fflate)
- Modify: `workers/wrangler.jsonc` (add R2_BUNDLES binding and env var in all env blocks)
- Modify: `workers/src/index.ts` (add `R2_BUNDLES` and `R2_BUNDLES_BUCKET` to `Env` interface)

**Step 1: Install fflate**

```bash
cd workers && pnpm add fflate
```

**Step 2: Verify fflate is in dependencies**

```bash
grep fflate workers/package.json
```

Expected: `"fflate": "^0.8.x"` (or current version).

**Step 3: Add R2_BUNDLES_BUCKET to wrangler.jsonc vars blocks and r2_buckets arrays**

Open `workers/wrangler.jsonc`. Make the following additions, following the exact same pattern as `R2_SCREENSHOTS_BUCKET` and `R2_SCREENSHOTS`:

**Top-level `vars` block** — add after `"R2_SCREENSHOTS_BUCKET": "css-screenshots"`:
```json
"R2_BUNDLES_BUCKET": "ccr-bundles-local"
```

**Top-level `r2_buckets` array** — add after the screenshots entry:
```json
{ "binding": "R2_BUNDLES", "bucket_name": "ccr-bundles-local" }
```

**`env.sbx1.vars` block** — add after `"R2_SCREENSHOTS_BUCKET": "css-screenshots-sbx1"`:
```json
"R2_BUNDLES_BUCKET": "ccr-bundles-sbx1"
```

**`env.sbx1.r2_buckets` array** — add:
```json
{ "binding": "R2_BUNDLES", "bucket_name": "ccr-bundles-sbx1" }
```

**`env.staging.vars` block** — add after `"R2_SCREENSHOTS_BUCKET": "css-screenshots-staging"`:
```json
"R2_BUNDLES_BUCKET": "ccr-bundles-staging"
```

**`env.staging.r2_buckets` array** — add:
```json
{ "binding": "R2_BUNDLES", "bucket_name": "ccr-bundles-staging" }
```

**`env.production.vars` block** — add after `"R2_SCREENSHOTS_BUCKET": "css-screenshots-prod"`:
```json
"R2_BUNDLES_BUCKET": "ccr-bundles-prod"
```

**`env.production.r2_buckets` array** — add:
```json
{ "binding": "R2_BUNDLES", "bucket_name": "ccr-bundles-prod" }
```

**Step 4: Add R2_BUNDLES to Env interface in workers/src/index.ts**

Locate the `export interface Env` block. Find the `R2_SCREENSHOTS` and `R2_SCREENSHOTS_BUCKET` lines and add after them:

```typescript
// R2 bundle storage for site export/import
R2_BUNDLES?: R2Bucket;
R2_BUNDLES_BUCKET?: string;
```

**Step 5: Run lint**

```bash
cd workers && pnpm lint
```

Expected: 0 errors.

**Step 6: Commit**

```bash
git add workers/package.json workers/pnpm-lock.yaml workers/wrangler.jsonc workers/src/index.ts
git commit -m "feat(PCC-3249): add fflate dependency and R2_BUNDLES binding"
```

---

## Task 2: Export Service — Version Selection and createdByRef Resolution

This is the core data-gathering logic for export. It queries the database for the correct versions to include and resolves `createdByRef` portable identifiers.

**Design decisions:**
- Version selection follows PROPOSAL-013: main branch gets all publish-checkpoint-referenced versions + latest draft (if not already published). Non-main branches get the latest version only. Tombstoned versions are excluded.
- `reconstructVersionSnapshot` already exists in `document-version-service.ts` — reuse it directly.
- User email lookup: `SELECT email FROM app.users WHERE id = $1`. If not found (deleted user), return `{type: "user", email: null}` and log a warning. Do not fail the export.
- Agent name lookup: `SELECT name FROM app.agents WHERE id = $1`. Same fallback.
- The version selection query uses a correlated subquery with alias `dv` — the outer query uses `FROM app.document_versions dv`, and the EXISTS subquery references `dv.id` which is valid SQL.

**Files:**
- Create: `workers/src/services/bundle-export-service.ts`
- Create: `workers/tests/services/bundle-export-service.spec.ts`

**Step 1: Write the failing tests**

Create `workers/tests/services/bundle-export-service.spec.ts`:

```typescript
/**
 * Bundle Export Service Tests (PCC-3249)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ query: vi.fn() }));
vi.mock('../../src/services/document-version-service', () => ({
  reconstructVersionSnapshot: vi.fn(),
}));

import { query } from '../../src/db';
import { reconstructVersionSnapshot } from '../../src/services/document-version-service';
import {
  resolveCreatedByRef,
  selectVersionsForDocument,
} from '../../src/services/bundle-export-service';

const mockQuery = vi.mocked(query);
const mockReconstruct = vi.mocked(reconstructVersionSnapshot);

describe('resolveCreatedByRef', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns {type:"system"} for system type without db lookup', async () => {
    const ref = await resolveCreatedByRef('some-id', 'system');
    expect(ref).toEqual({ type: 'system' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('resolves user UUID to email from app.users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ email: 'chris@example.com' }], rowCount: 1 } as never);
    const ref = await resolveCreatedByRef('user-uuid-123', 'user');
    expect(ref).toEqual({ type: 'user', email: 'chris@example.com' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('app.users'), ['user-uuid-123']);
  });

  it('returns null email when user UUID not found (deleted user)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const ref = await resolveCreatedByRef('missing-uuid', 'user');
    expect(ref).toEqual({ type: 'user', email: null });
  });

  it('resolves agent UUID to name from app.agents', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Zappy AI Assistant' }], rowCount: 1 } as never);
    const ref = await resolveCreatedByRef('agent-uuid-456', 'agent');
    expect(ref).toEqual({ type: 'agent', name: 'Zappy AI Assistant' });
  });

  it('returns null name when agent UUID not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const ref = await resolveCreatedByRef('missing-agent', 'agent');
    expect(ref).toEqual({ type: 'agent', name: null });
  });
});

describe('selectVersionsForDocument', () => {
  const DOC_ID = 'doc-1';
  const MAIN_BRANCH = 'main-branch-id';
  const OTHER_BRANCH = 'branch-2';

  beforeEach(() => { vi.resetAllMocks(); });

  it('returns empty array when document has no versions on branch', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    expect(result).toEqual([]);
  });

  it('on main branch: includes all published versions plus latest unpublished draft', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
        { id: 'v3', version_number: 3, snapshot: null, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-03T00:00:00Z' },
      ],
      rowCount: 3,
    } as never);
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root', props: { v: 2 } } });
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root', props: { v: 3 } } });

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    // v2 (published) and v3 (latest draft) included; v1 skipped
    expect(result).toHaveLength(2);
    expect(result[0].versionNumber).toBe(2);
    expect(result[0].isPublished).toBe(true);
    expect(result[1].versionNumber).toBe(3);
    expect(result[1].isPublished).toBe(false);
  });

  it('on main branch: includes only latest when nothing is published', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
      ],
      rowCount: 2,
    } as never);
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root' } });

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    expect(result).toHaveLength(1);
    expect(result[0].versionNumber).toBe(2);
  });

  it('on main branch: if latest is already published, does not duplicate it', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: true, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
      ],
      rowCount: 1,
    } as never);

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    expect(result).toHaveLength(1);
    expect(result[0].snapshot).toEqual({ root: {} });
  });

  it('on non-main branch: returns only the latest version', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
      ],
      rowCount: 2,
    } as never);
    mockReconstruct.mockResolvedValueOnce({ root: { type: 'Root', props: { v: 2 } } });

    const result = await selectVersionsForDocument(DOC_ID, OTHER_BRANCH, false);
    expect(result).toHaveLength(1);
    expect(result[0].versionNumber).toBe(2);
  });

  it('excludes tombstone versions', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'v1', version_number: 1, snapshot: { root: {} }, is_published: false, is_tombstone: false, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-01T00:00:00Z' },
        { id: 'v2', version_number: 2, snapshot: null, is_published: false, is_tombstone: true, created_by_id: 'u1', created_by_type: 'user', created_at: '2026-01-02T00:00:00Z' },
      ],
      rowCount: 2,
    } as never);

    const result = await selectVersionsForDocument(DOC_ID, MAIN_BRANCH, true);
    expect(result).toHaveLength(1);
    expect(result[0].versionNumber).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd workers && pnpm test -- tests/services/bundle-export-service.spec.ts
```

Expected: FAIL with "Cannot find module '../../src/services/bundle-export-service'"

**Step 3: Commit failing tests**

```bash
git add workers/tests/services/bundle-export-service.spec.ts
git commit -m "test(PCC-3249): failing tests for bundle export service"
```

**Step 4: Write the implementation**

Create `workers/src/services/bundle-export-service.ts`:

```typescript
/**
 * Bundle Export Service (PCC-3249 / PROPOSAL-013)
 *
 * Queries the database to gather all data needed for a site export bundle.
 * Version selection:
 *   - main branch: all published versions + latest draft if not published
 *   - non-main branch: latest version only
 * createdByRef: portable cross-environment user/agent references.
 */
import { query } from '../db';
import { reconstructVersionSnapshot } from './document-version-service';

export type CreatedByRef =
  | { type: 'user'; email: string | null }
  | { type: 'agent'; name: string | null }
  | { type: 'system' };

export interface SelectedVersion {
  id: string;
  versionNumber: number;
  isPublished: boolean;
  snapshot: Record<string, unknown>;
  createdAt: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
}

interface RawVersionRow {
  id: string;
  version_number: number;
  snapshot: Record<string, unknown> | null;
  is_published: boolean;
  is_tombstone: boolean;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
}

/**
 * Resolves a created_by_id + created_by_type to a portable cross-environment reference.
 * System principals need no lookup. Users/agents are looked up by UUID.
 * If the UUID is not found (deleted user/agent), email/name is null.
 */
export async function resolveCreatedByRef(
  createdById: string,
  createdByType: 'user' | 'agent' | 'system',
): Promise<CreatedByRef> {
  if (createdByType === 'system') {
    return { type: 'system' };
  }
  if (createdByType === 'user') {
    const result = await query<{ email: string }>(
      'SELECT email FROM app.users WHERE id = $1',
      [createdById],
    );
    const row = result.rows[0];
    if (row === undefined) {
      console.warn(`[bundle-export] User UUID ${createdById} not found — attribution will be null`);
      return { type: 'user', email: null };
    }
    return { type: 'user', email: row.email };
  }
  const result = await query<{ name: string }>(
    'SELECT name FROM app.agents WHERE id = $1',
    [createdById],
  );
  const row = result.rows[0];
  if (row === undefined) {
    console.warn(`[bundle-export] Agent UUID ${createdById} not found — attribution will be null`);
    return { type: 'agent', name: null };
  }
  return { type: 'agent', name: row.name };
}

/**
 * Selects the versions to include in the export bundle for a single document on a branch.
 *
 * For main branch:
 *   - All versions referenced by a publish checkpoint (is_published=true)
 *   - The latest version if it is not already published (current draft)
 *   - If nothing is published, only the latest version
 * For non-main branch:
 *   - Only the latest version
 *
 * Tombstone versions are excluded.
 * All returned versions have a resolved full snapshot.
 */
export async function selectVersionsForDocument(
  documentId: string,
  branchId: string,
  isMainBranch: boolean,
): Promise<SelectedVersion[]> {
  const result = await query<RawVersionRow>(
    `SELECT
       dv.id,
       dv.version_number,
       dv.snapshot,
       EXISTS(
         SELECT 1 FROM app.checkpoint_documents cd
         JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
         WHERE cd.document_version_id = dv.id
           AND cp.checkpoint_type = 'publish'
       ) AS is_published,
       dv.is_tombstone,
       dv.created_by_id,
       dv.created_by_type,
       dv.created_at
     FROM app.document_versions dv
     WHERE dv.document_id = $1 AND dv.branch_id = $2
     ORDER BY dv.version_number ASC`,
    [documentId, branchId],
  );

  const allVersions = result.rows.filter((row) => !row.is_tombstone);
  if (allVersions.length === 0) return [];

  const latestRow = allVersions[allVersions.length - 1];
  if (latestRow === undefined) return [];

  let toExport: RawVersionRow[];

  if (!isMainBranch) {
    toExport = [latestRow];
  } else {
    const publishedVersions = allVersions.filter((row) => row.is_published);
    if (publishedVersions.length === 0) {
      toExport = [latestRow];
    } else if (latestRow.is_published) {
      toExport = publishedVersions; // latest is already in the published set
    } else {
      toExport = [...publishedVersions, latestRow];
    }
  }

  const resolved: SelectedVersion[] = [];
  for (const row of toExport) {
    let snapshot: Record<string, unknown>;
    if (row.snapshot !== null) {
      snapshot = row.snapshot;
    } else {
      const reconstructed = await reconstructVersionSnapshot(documentId, branchId, row.version_number);
      if (reconstructed === null) {
        console.error(`[bundle-export] Could not reconstruct snapshot for doc ${documentId} v${String(row.version_number)} — skipping`);
        continue;
      }
      snapshot = reconstructed;
    }
    resolved.push({
      id: row.id,
      versionNumber: row.version_number,
      isPublished: row.is_published,
      snapshot,
      createdAt: row.created_at,
      createdById: row.created_by_id,
      createdByType: row.created_by_type,
    });
  }
  return resolved;
}
```

**Step 5: Run tests to verify they pass**

```bash
cd workers && pnpm test -- tests/services/bundle-export-service.spec.ts
```

Expected: all PASS.

**Step 6: Run lint**

```bash
cd workers && pnpm lint
```

Expected: 0 errors.

**Step 7: Commit**

```bash
git add workers/src/services/bundle-export-service.ts
git commit -m "feat(PCC-3249): bundle export service — version selection and createdByRef resolution"
```

---

## Task 3: Export Handler — ZIP Assembly to R2 and Presigned URL

**Key design decisions:**
- Bundle written to R2, presigned URL returned. This avoids the 128MB response limit and creates a durable artifact.
- The ZIP is assembled in memory using `fflate`'s synchronous `zipSync`.
- Bundle key: `{siteId}/{exportedAt-safe}.zip` (colons replaced with dashes for key compat).
- `bundle.json` is added LAST (after all other file SHA-256s are computed). `bundle.json` itself is NOT included in `manifest.files` — it is the manifest container.
- Auth: `assertPermission(principal, siteId, mainBranch.id, 'canManageGrants')`. This is the correct highest-privilege permission that exists in `RolePermissions`. Verify by reading `workers/src/types/auth.ts` before coding.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are shared with the screenshot pipeline (already in Env).
- Route: `GET /api/admin/sites/{siteId}/export` → handler name `site-export`.
- `versions.jsonl` lines include a `branchName` field (see bundle structure section above). Sort lines by `createdAt` ascending (not by `versionNumber`, since version numbers from different branches can collide).

**Files:**
- Create: `workers/src/routes/site-export-api.ts`
- Create: `workers/tests/routes/site-export-api.spec.ts`
- Modify: `workers/src/routes/route-parser.ts`
- Modify: `workers/src/routes/route-dispatch.ts`

**Step 1: Write the failing handler tests**

Create `workers/tests/routes/site-export-api.spec.ts`:

```typescript
/**
 * Site Export API Handler Tests (PCC-3249)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

vi.mock('../../src/services/site-service', () => ({ getSite: vi.fn() }));
vi.mock('../../src/services/branch-service', () => ({
  listBranches: vi.fn(),
  getMainBranch: vi.fn(),
}));
vi.mock('../../src/services/document-service', () => ({ listDocuments: vi.fn() }));
vi.mock('../../src/services/bundle-export-service', () => ({
  selectVersionsForDocument: vi.fn(),
  resolveCreatedByRef: vi.fn(),
}));
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthorizationError'; }
  },
}));
vi.mock('../../src/storage/r2-presign', () => ({ signR2GetUrl: vi.fn() }));
vi.mock('../../src/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }));

import { getSite } from '../../src/services/site-service';
import { listBranches, getMainBranch } from '../../src/services/branch-service';
import { listDocuments } from '../../src/services/document-service';
import {
  selectVersionsForDocument,
  resolveCreatedByRef,
} from '../../src/services/bundle-export-service';
import { assertPermission, AuthorizationError } from '../../src/auth/authorization';
import { signR2GetUrl } from '../../src/storage/r2-presign';
import { handleSiteExportRoute } from '../../src/routes/site-export-api';

const mockGetSite = vi.mocked(getSite);
const mockListBranches = vi.mocked(listBranches);
const mockGetMainBranch = vi.mocked(getMainBranch);
const mockListDocuments = vi.mocked(listDocuments);
const mockSelectVersions = vi.mocked(selectVersionsForDocument);
const mockResolveRef = vi.mocked(resolveCreatedByRef);
const mockAssertPermission = vi.mocked(assertPermission);
const mockSignR2 = vi.mocked(signR2GetUrl);

function createPrincipal(): AuthenticatedPrincipal {
  return { id: 'user-123', type: 'user', email: 'admin@example.com', systemRole: 'admin', pantheonSiteRoles: {}, tokenExpiry: new Date(Date.now() + 3600000).toISOString() };
}

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: 'sbx1',
    R2_BUNDLES: { put: vi.fn().mockResolvedValue(undefined) },
    R2_BUNDLES_BUCKET: 'ccr-bundles-sbx1',
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    ...overrides,
  };
}

function makeRequest(method = 'GET') {
  return new Request('https://example.com/api/admin/sites/site-1/export', { method });
}

const MOCK_SITE = { id: 'site-1', name: 'Test Site', pantheonSiteId: 'p1', workflowSettings: { requireReviewForPublish: false, allowDirectPublish: true }, allowedOrigins: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null };
const MOCK_MAIN_BRANCH = { id: 'main-branch', siteId: 'site-1', name: 'main', isMain: true, status: 'active', createdById: 'u1', createdByType: 'user', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null };

describe('handleSiteExportRoute', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 400 when siteId is undefined', async () => {
    const resp = await handleSiteExportRoute(makeRequest(), { siteId: undefined, principal: createPrincipal() }, createEnv() as never);
    expect(resp.status).toBe(400);
  });

  it('returns 405 for non-GET requests', async () => {
    const resp = await handleSiteExportRoute(makeRequest('POST'), { siteId: 'site-1', principal: createPrincipal() }, createEnv() as never);
    expect(resp.status).toBe(405);
  });

  it('returns 404 when site does not exist', async () => {
    mockGetSite.mockResolvedValueOnce(null);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    const resp = await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, createEnv() as never);
    expect(resp.status).toBe(404);
  });

  it('returns 503 when R2_BUNDLES binding is missing', async () => {
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    const env = createEnv({ R2_BUNDLES: undefined });
    const resp = await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, env as never);
    expect(resp.status).toBe(503);
  });

  it('returns 200 with downloadUrl for empty site', async () => {
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    const resp = await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, createEnv() as never);
    expect(resp.status).toBe(200);
    const body = await resp.json() as { downloadUrl: string };
    expect(body.downloadUrl).toBe('https://r2.example.com/signed');
  });

  it('returns 403 when principal lacks canManageGrants permission', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockRejectedValueOnce(new AuthorizationError('Forbidden'));
    const resp = await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, createEnv() as never);
    expect(resp.status).toBe(403);
  });

  it('excludes _registry/ documents from version selection', async () => {
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN_BRANCH as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN_BRANCH] as never);
    mockListDocuments.mockResolvedValueOnce([
      { id: 'doc-reg', siteId: 'site-1', path: '_registry/schema', createdAt: '' },
      { id: 'doc-2', siteId: 'site-1', path: 'home', createdAt: '' },
    ] as never);
    mockSelectVersions.mockResolvedValueOnce([{
      id: 'v1', versionNumber: 1, isPublished: false,
      snapshot: { root: {} }, createdAt: '2026-01-01T00:00:00Z',
      createdById: 'u1', createdByType: 'user',
    }]);
    mockResolveRef.mockResolvedValueOnce({ type: 'user', email: 'admin@example.com' });
    mockSignR2.mockResolvedValueOnce({ url: 'https://r2.example.com/signed', expiresAt: '2026-06-01T00:00:00Z' });

    await handleSiteExportRoute(makeRequest(), { siteId: 'site-1', principal: createPrincipal() }, createEnv() as never);

    // _registry/ doc should NOT trigger selectVersionsForDocument; only 'home' should
    expect(mockSelectVersions).toHaveBeenCalledTimes(1);
    expect(mockSelectVersions).toHaveBeenCalledWith('doc-2', 'main-branch', true);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd workers && pnpm test -- tests/routes/site-export-api.spec.ts
```

Expected: FAIL with "Cannot find module '../../src/routes/site-export-api'"

**Step 3: Commit failing tests**

```bash
git add workers/tests/routes/site-export-api.spec.ts
git commit -m "test(PCC-3249): failing tests for site export handler"
```

**Step 4: Write the implementation**

Create `workers/src/routes/site-export-api.ts`:

```typescript
/**
 * Site Export Route Handler (PCC-3249 / PROPOSAL-013)
 *
 * GET /api/admin/sites/{siteId}/export
 *
 * Assembles a full site bundle as a ZIP file, writes it to R2, and returns
 * a presigned download URL (7-day TTL). Requires canManageGrants permission
 * (admin-level) or a write:create scoped SAT token.
 *
 * Bundle structure:
 *   bundle.json                             - metadata + SHA-256 manifest (not self-hashed)
 *   site.json                               - site record (no secrets)
 *   branches.json                           - all branches
 *   documents/{path}/meta.json              - document metadata
 *   documents/{path}/versions.jsonl         - versions for all branches (includes branchName)
 *   documents/{path}/publish_checkpoints.jsonl
 *
 * NOTE: Bundle content is assembled in memory before ZIPping. Cloudflare
 * Workers memory limit is 128MB. For very large sites, use the SQL migration path.
 *
 * NOTE: bundle.json is NOT included in manifest.files — it is the manifest container
 * and therefore cannot self-reference its own hash.
 */
import { zipSync, strToU8 } from 'fflate';
import type { AuthenticatedPrincipal } from '../types';
import { getSite } from '../services/site-service';
import { listBranches, getMainBranch } from '../services/branch-service';
import { listDocuments } from '../services/document-service';
import { query } from '../db';
import {
  selectVersionsForDocument,
  resolveCreatedByRef,
} from '../services/bundle-export-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { signR2GetUrl } from '../storage/r2-presign';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

export interface SiteExportRouteContext {
  siteId?: string;
  principal: AuthenticatedPrincipal;
}

export interface SiteExportEnv {
  ENVIRONMENT?: string;
  R2_BUNDLES?: R2Bucket;
  R2_BUNDLES_BUCKET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

const BUNDLE_VERSION = '1';
const PRESIGN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REGISTRY_PREFIX = '_registry/';

export async function handleSiteExportRoute(
  request: Request,
  context: SiteExportRouteContext,
  env: SiteExportEnv,
): Promise<Response> {
  const { siteId, principal } = context;

  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('Site ID is required', 400);
  }
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) return errorResponse('Site not found', 404);

    // canManageGrants is the highest permission in RolePermissions (see workers/src/types/auth.ts).
    // Service principals bypass permission checks; the scope enforcement in index.ts handles them.
    await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');

    const site = await getSite(siteId);
    if (site === null) return errorResponse('Site not found', 404);

    if (
      env.R2_BUNDLES === undefined ||
      env.R2_BUNDLES_BUCKET === undefined || env.R2_BUNDLES_BUCKET === '' ||
      env.R2_ACCOUNT_ID === undefined || env.R2_ACCOUNT_ID === '' ||
      env.R2_ACCESS_KEY_ID === undefined || env.R2_ACCESS_KEY_ID === '' ||
      env.R2_SECRET_ACCESS_KEY === undefined || env.R2_SECRET_ACCESS_KEY === ''
    ) {
      console.error('[site-export] R2 bundle storage not configured');
      return errorResponse('Bundle storage is not configured', 503);
    }

    const exportedAt = new Date().toISOString();
    const environment = env.ENVIRONMENT ?? 'local';

    const [branches, allDocuments] = await Promise.all([
      listBranches(siteId),
      listDocuments(siteId),
    ]);

    const documents = allDocuments.filter((d) => !d.path.startsWith(REGISTRY_PREFIX));
    const branchIsMainMap = new Map(branches.map((b) => [b.id, b.isMain ?? false]));

    const files: Record<string, Uint8Array> = {};

    // site.json — omit secrets (allowedOrigins, tokens excluded by design)
    files['site.json'] = strToU8(JSON.stringify({
      id: site.id,
      pantheonSiteId: site.pantheonSiteId,
      name: site.name,
      url: site.url,
      workflowSettings: site.workflowSettings,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    }, null, 2));

    // branches.json
    files['branches.json'] = strToU8(JSON.stringify(branches.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      status: b.status,
      isMain: b.isMain,
      sourceBranchId: b.sourceBranchId,
      sourceCheckpointId: b.sourceCheckpointId,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      archivedAt: b.archivedAt,
    })), null, 2));

    // documents/
    for (const doc of documents) {
      // Sanitize path for use as a filesystem key (no leading slash)
      const safePath = doc.path.replace(/^\//, '');

      files[`documents/${safePath}/meta.json`] = strToU8(
        JSON.stringify({ id: doc.id, path: doc.path, createdAt: doc.createdAt }, null, 2),
      );

      // Collect versions from all branches. Each line includes branchName so the
      // import handler can map them to the correct target branch.
      // Sort by createdAt ascending (not versionNumber — version numbers are per-branch
      // and can collide across branches).
      const versionLines: Array<{ line: string; createdAt: string }> = [];

      for (const branch of branches) {
        const isMain = branchIsMainMap.get(branch.id) ?? false;
        const selected = await selectVersionsForDocument(doc.id, branch.id, isMain);
        for (const v of selected) {
          const createdByRef = await resolveCreatedByRef(v.createdById, v.createdByType);
          versionLines.push({
            createdAt: v.createdAt,
            line: JSON.stringify({
              branchName: branch.name,
              versionNumber: v.versionNumber,
              isPublished: v.isPublished,
              snapshot: v.snapshot,
              createdAt: v.createdAt,
              createdByRef,
            }),
          });
        }
      }

      versionLines.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      files[`documents/${safePath}/versions.jsonl`] = strToU8(
        versionLines.map((v) => v.line).join('\n'),
      );

      // publish_checkpoints.jsonl
      const cpResult = await query<{
        checkpoint_id: string;
        document_version_id: string;
        checkpoint_created_at: string;
      }>(
        `SELECT cd.checkpoint_id, cd.document_version_id, cp.created_at AS checkpoint_created_at
         FROM app.checkpoint_documents cd
         JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
         WHERE cp.checkpoint_type = 'publish'
           AND cd.document_id = $1
         ORDER BY cp.created_at ASC`,
        [doc.id],
      );
      files[`documents/${safePath}/publish_checkpoints.jsonl`] = strToU8(
        cpResult.rows.map((r) => JSON.stringify({
          checkpointId: r.checkpoint_id,
          documentVersionId: r.document_version_id,
          checkpointCreatedAt: r.checkpoint_created_at,
        })).join('\n'),
      );
    }

    // Compute SHA-256 manifest over all files (bundle.json is NOT included — it is the container)
    const manifest: Record<string, string> = {};
    for (const [filePath, content] of Object.entries(files)) {
      manifest[filePath] = await sha256Hex(content);
    }
    files['bundle.json'] = strToU8(JSON.stringify({
      bundleVersion: BUNDLE_VERSION,
      exportedAt,
      sourceEnvironment: environment,
      sourceSiteId: siteId,
      files: manifest,
    }, null, 2));

    const zipBuffer = zipSync(files, { level: 6 });
    const safeTimestamp = exportedAt.replace(/:/g, '-');
    const r2Key = `${siteId}/${safeTimestamp}.zip`;

    await env.R2_BUNDLES.put(r2Key, zipBuffer, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: { sourceSiteId: siteId, exportedAt, bundleVersion: BUNDLE_VERSION },
    });

    const signed = await signR2GetUrl({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUNDLES_BUCKET,
      key: r2Key,
      ttlSeconds: PRESIGN_TTL_SECONDS,
    });

    return jsonResponse({
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
      exportedAt,
      bundleKey: r2Key,
      documentCount: documents.length,
      branchCount: branches.length,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return errorResponse(error.message, 403);
    console.error('[site-export] Error generating export bundle:', error);
    return errorResponse('Internal server error', 500);
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

**Step 5: Wire the route in route-parser.ts**

Read `workers/src/routes/route-parser.ts` and find the `adminUsersMatch` block. Add the following BEFORE the first generic site routes block, and also add the import route at the same location:

```typescript
// Site export route (must be before generic site routes)
const siteExportMatch = /^\/api\/admin\/sites\/([^/]+)\/export$/.exec(normalizedPath);
if (siteExportMatch) {
  return { handler: 'site-export', params: { siteId: siteExportMatch[1] } };
}

// Site import route (must be before generic site routes)
const siteImportMatch = /^\/api\/admin\/sites\/([^/]+)\/import$/.exec(normalizedPath);
if (siteImportMatch) {
  return { handler: 'site-import', params: { siteId: siteImportMatch[1] } };
}
```

**Step 6: Wire the dispatch case in route-dispatch.ts**

Add import at top of `workers/src/routes/route-dispatch.ts` (near the other route handler imports):
```typescript
import { handleSiteExportRoute } from './site-export-api';
```

Add case inside the switch statement (near `site-screenshot`):
```typescript
case 'site-export':
  return await handleSiteExportRoute(request, {
    siteId: route.params.siteId,
    principal,
  }, env);
```

**Step 7: Run tests to verify they pass**

```bash
cd workers && pnpm test -- tests/routes/site-export-api.spec.ts
```

Expected: all PASS.

**Step 8: Run full test suite**

```bash
cd workers && pnpm test
```

Expected: all PASS.

**Step 9: Run lint**

```bash
cd workers && pnpm lint
```

Expected: 0 errors.

**Step 10: Commit**

```bash
git add workers/src/routes/site-export-api.ts workers/src/routes/route-parser.ts workers/src/routes/route-dispatch.ts
git commit -m "feat(PCC-3249): site export handler — ZIP assembly to R2 with presigned URL"
```

---

## Task 4: Import Service — Bundle Validation, UUID Resolution, and Progress Tracking

**Design decisions:**
- KV key format: `import:{targetSiteId}:{bundleExportedAt}` (deterministic, idempotent).
- Source→target UUID mapping stored in `app.import_id_maps` table (migration 038) keyed by `(import_key, source_id, entity_type)`. This allows re-runs to reload the mapping.
- `resolveCreatedByRefToId` fallback: any missing user/agent maps to the system UUID (`'00000000-0000-0000-0000-000000000000'`). Do not fail the import for unresolvable refs.
- Manifest validation rejects: (1) unsupported bundleVersion, (2) missing files, (3) SHA-256 mismatch.
- `bundle.json` itself is NOT in `manifest.files` (it is the container). The import handler extracts `bundle.json` first, parses it as the manifest, then validates all other files listed in `manifest.files`.
- `sha256Hex` is duplicated in this service (also used in export service). This is intentional — the two services are independent and the function is 4 lines. Do not create a shared utility.

**Files:**
- Create: `workers/src/db/migrations/038_import_id_maps.sql`
- Create: `workers/src/services/bundle-import-service.ts`
- Create: `workers/tests/services/bundle-import-service.spec.ts`

**Step 1: Write migration 038**

Create `workers/src/db/migrations/038_import_id_maps.sql`:

```sql
-- Migration 038: Import ID maps table for bundle import traceability
-- Stores source UUID to target UUID mappings per import run.

CREATE TABLE IF NOT EXISTS app.import_id_maps (
  import_key  TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (import_key, source_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_import_id_maps_key ON app.import_id_maps(import_key);
```

**Step 2: Write the failing service tests**

Create `workers/tests/services/bundle-import-service.spec.ts`:

```typescript
/**
 * Bundle Import Service Tests (PCC-3249)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ query: vi.fn() }));

import { query } from '../../src/db';
import {
  resolveCreatedByRefToId,
  validateBundleManifest,
  buildImportKey,
  type BundleManifest,
} from '../../src/services/bundle-import-service';

const mockQuery = vi.mocked(query);

describe('buildImportKey', () => {
  it('returns a deterministic key', () => {
    expect(buildImportKey('site-abc', '2026-05-27T10:00:00.000Z'))
      .toBe('import:site-abc:2026-05-27T10:00:00.000Z');
  });
});

describe('validateBundleManifest', () => {
  it('passes when all SHA-256 hashes match', async () => {
    const content = new TextEncoder().encode('{"hello":"world"}');
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashHex = 'sha256:' + Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const manifest: BundleManifest = {
      bundleVersion: '1',
      exportedAt: '2026-05-27T00:00:00Z',
      sourceEnvironment: 'sbx1',
      sourceSiteId: 'site-1',
      files: { 'site.json': hashHex },
    };
    const result = await validateBundleManifest(manifest, { 'site.json': content });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when a file hash does not match', async () => {
    const manifest: BundleManifest = {
      bundleVersion: '1', exportedAt: '2026-05-27T00:00:00Z', sourceEnvironment: 'sbx1', sourceSiteId: 'site-1',
      files: { 'site.json': 'sha256:000000' },
    };
    const content = new TextEncoder().encode('{"different":"content"}');
    const result = await validateBundleManifest(manifest, { 'site.json': content });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('site.json');
  });

  it('fails when a manifest file is missing from content', async () => {
    const manifest: BundleManifest = {
      bundleVersion: '1', exportedAt: '2026-05-27T00:00:00Z', sourceEnvironment: 'sbx1', sourceSiteId: 'site-1',
      files: { 'site.json': 'sha256:abc', 'branches.json': 'sha256:def' },
    };
    const result = await validateBundleManifest(manifest, { 'site.json': new TextEncoder().encode('{}') });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('branches.json'))).toBe(true);
  });

  it('rejects bundleVersion !== "1"', async () => {
    const manifest: BundleManifest = {
      bundleVersion: '99', exportedAt: '', sourceEnvironment: '', sourceSiteId: '', files: {},
    };
    const result = await validateBundleManifest(manifest, {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('bundleVersion');
  });
});

describe('resolveCreatedByRefToId', () => {
  const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

  beforeEach(() => { vi.resetAllMocks(); });

  it('returns system UUID for {type:"system"}', async () => {
    const id = await resolveCreatedByRefToId({ type: 'system' });
    expect(id).toBe(SYSTEM_UUID);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('resolves user email to UUID from app.users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-target-uuid' }], rowCount: 1 } as never);
    const id = await resolveCreatedByRefToId({ type: 'user', email: 'chris@example.com' });
    expect(id).toBe('user-target-uuid');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('app.users'), ['chris@example.com']);
  });

  it('returns system UUID when user email is null', async () => {
    const id = await resolveCreatedByRefToId({ type: 'user', email: null });
    expect(id).toBe(SYSTEM_UUID);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns system UUID when user email not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const id = await resolveCreatedByRefToId({ type: 'user', email: 'unknown@example.com' });
    expect(id).toBe(SYSTEM_UUID);
  });

  it('resolves agent name to UUID from app.agents', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-target-uuid' }], rowCount: 1 } as never);
    const id = await resolveCreatedByRefToId({ type: 'agent', name: 'Zappy AI' });
    expect(id).toBe('agent-target-uuid');
  });

  it('returns system UUID when agent name is null', async () => {
    const id = await resolveCreatedByRefToId({ type: 'agent', name: null });
    expect(id).toBe(SYSTEM_UUID);
  });

  it('returns system UUID when agent name not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const id = await resolveCreatedByRefToId({ type: 'agent', name: 'Unknown Agent' });
    expect(id).toBe(SYSTEM_UUID);
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
cd workers && pnpm test -- tests/services/bundle-import-service.spec.ts
```

Expected: FAIL with "Cannot find module '../../src/services/bundle-import-service'"

**Step 4: Commit failing tests and migration**

```bash
git add workers/tests/services/bundle-import-service.spec.ts workers/src/db/migrations/038_import_id_maps.sql
git commit -m "test(PCC-3249): failing tests for bundle import service + migration 038"
```

**Step 5: Write the implementation**

Create `workers/src/services/bundle-import-service.ts`:

```typescript
/**
 * Bundle Import Service (PCC-3249 / PROPOSAL-013)
 *
 * Validates and processes a site export bundle.
 * UUID remapping, SHA-256 validation, KV progress tracking.
 */
import { query } from '../db';
import type { CreatedByRef } from './bundle-export-service';

export interface BundleManifest {
  bundleVersion: string;
  exportedAt: string;
  sourceEnvironment: string;
  sourceSiteId: string;
  files: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ImportProgress {
  completedPhases: string[];
  errors: string[];
  startedAt: string;
  lastUpdatedAt: string;
}

const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';
const SUPPORTED_BUNDLE_VERSION = '1';

export function buildImportKey(targetSiteId: string, exportedAt: string): string {
  return `import:${targetSiteId}:${exportedAt}`;
}

export async function validateBundleManifest(
  manifest: BundleManifest,
  fileContents: Record<string, Uint8Array>,
): Promise<ValidationResult> {
  const errors: string[] = [];

  if (manifest.bundleVersion !== SUPPORTED_BUNDLE_VERSION) {
    errors.push(`Unsupported bundleVersion: "${manifest.bundleVersion}". Only "${SUPPORTED_BUNDLE_VERSION}" is supported.`);
    return { valid: false, errors };
  }

  for (const [filePath, expectedHash] of Object.entries(manifest.files)) {
    const content = fileContents[filePath];
    if (content === undefined) {
      errors.push(`File "${filePath}" listed in manifest but missing from bundle`);
      continue;
    }
    const actualHash = await sha256Hex(content);
    if (actualHash !== expectedHash) {
      errors.push(`SHA-256 mismatch for "${filePath}": expected ${expectedHash}, got ${actualHash}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Resolves a portable createdByRef to a local UUID in the target environment.
 * Falls back to SYSTEM_UUID when the user/agent is not found.
 */
export async function resolveCreatedByRefToId(ref: CreatedByRef): Promise<string> {
  if (ref.type === 'system') return SYSTEM_UUID;

  if (ref.type === 'user') {
    if (ref.email === null) return SYSTEM_UUID;
    const result = await query<{ id: string }>(
      'SELECT id FROM app.users WHERE email = $1',
      [ref.email],
    );
    const row = result.rows[0];
    if (row === undefined) {
      console.warn(`[bundle-import] User "${ref.email}" not found — attribution set to system`);
      return SYSTEM_UUID;
    }
    return row.id;
  }

  // agent
  if (ref.name === null) return SYSTEM_UUID;
  const result = await query<{ id: string }>(
    'SELECT id FROM app.agents WHERE name = $1',
    [ref.name],
  );
  const row = result.rows[0];
  if (row === undefined) {
    console.warn(`[bundle-import] Agent "${ref.name}" not found — attribution set to system`);
    return SYSTEM_UUID;
  }
  return row.id;
}

export async function getImportProgress(kv: KVNamespace, importKey: string): Promise<ImportProgress | null> {
  const raw = await kv.get(importKey);
  if (raw === null) return null;
  return JSON.parse(raw) as ImportProgress;
}

export async function saveImportProgress(kv: KVNamespace, importKey: string, progress: ImportProgress): Promise<void> {
  await kv.put(importKey, JSON.stringify(progress), { expirationTtl: 7 * 24 * 60 * 60 });
}

export function hasCompletedPhase(progress: ImportProgress | null, phase: string): boolean {
  return progress?.completedPhases.includes(phase) ?? false;
}

// Private — duplicated from bundle-export-service intentionally (services are independent).
async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

**Step 6: Run tests to verify they pass**

```bash
cd workers && pnpm test -- tests/services/bundle-import-service.spec.ts
```

Expected: all PASS.

**Step 7: Run lint**

```bash
cd workers && pnpm lint
```

Expected: 0 errors.

**Step 8: Commit**

```bash
git add workers/src/services/bundle-import-service.ts
git commit -m "feat(PCC-3249): bundle import service — validation, UUID resolution, progress tracking"
```

---

## Task 5: Import Handler — Full Pipeline

**Design decisions:**
- Import handler accepts `multipart/form-data` with a `file` field (ZIP bytes).
- ZIP parsing: `fflate`'s `unzipSync` (synchronous, full ZIP in memory).
- Empty site check after auth, before ZIP parsing: if `listDocuments` returns non-registry documents OR `listBranches` has non-main branches, return 409.
- The `bundle.json` is read first from the ZIP, parsed as the manifest, then the rest of the files are validated via SHA-256.
- `site.json` name and workflowSettings are applied to the target site via `updateSite`. The target site must already exist.
- Branch creation: `CreateBranchParams.createdByType` only accepts `'user' | 'agent'`. When `createdByRef.type === 'system'`, use SYSTEM_UUID as `createdById` with `createdByType: 'user'` as the fallback.
- Version numbering on target: do NOT use source version numbers. Insert versions sequentially (1, 2, 3...) ordered by `createdAt` ASC for each document+branch pair. Source version number is stored in `import_id_maps` for traceability.
- After each version where `isPublished=true`, insert a publish checkpoint via direct `query()` into `app.checkpoints` and `app.checkpoint_documents`. Do not use checkpoint service functions to avoid side effects.
- KV progress tracking with `CONFIG_KV`. Progress key: `import:{targetSiteId}:{exportedAt}`. Phases: `'site'`, `'branches'`, `'document:{path}'` (one per doc). Validation is NOT tracked as a phase — it always re-runs on every call, which is correct (cheap and ensures bundle integrity on every attempt).
- ID maps stored in `app.import_id_maps` after each entity creation.
- Auth: `assertPermission(principal, siteId, mainBranch.id, 'canManageGrants')`.

**CRITICAL: Before writing the import handler, read the exact function signatures:**
- `createBranch` in `workers/src/services/branch-service.ts` (line ~291) — note `createdByType: 'user' | 'agent'`
- `createDocument` in `workers/src/services/document-service.ts` (line ~84)
- `createDocumentVersion` in `workers/src/services/document-version-service.ts` (line ~222) — use `source: 'import'` if `DocumentVersionSource` allows it, otherwise `source: 'edit'`
- `updateSite` in `workers/src/services/site-service.ts` (line ~331)

**Files:**
- Create: `workers/src/routes/site-import-api.ts`
- Create: `workers/tests/routes/site-import-api.spec.ts`
- Modify: `workers/src/routes/route-dispatch.ts`

**Step 1: Write failing handler tests**

Create `workers/tests/routes/site-import-api.spec.ts`:

```typescript
/**
 * Site Import API Handler Tests (PCC-3249)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { AuthenticatedPrincipal } from '../../src/types';

vi.mock('../../src/services/site-service', () => ({ getSite: vi.fn(), updateSite: vi.fn() }));
vi.mock('../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
  createBranch: vi.fn(),
  listBranches: vi.fn(),
}));
vi.mock('../../src/services/document-service', () => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
}));
vi.mock('../../src/services/document-version-service', () => ({
  createDocumentVersion: vi.fn(),
}));
vi.mock('../../src/services/bundle-import-service', () => ({
  validateBundleManifest: vi.fn(),
  buildImportKey: vi.fn().mockReturnValue('import:site-1:2026-05-27T00:00:00Z'),
  getImportProgress: vi.fn().mockResolvedValue(null),
  saveImportProgress: vi.fn().mockResolvedValue(undefined),
  hasCompletedPhase: vi.fn().mockReturnValue(false),
  resolveCreatedByRefToId: vi.fn().mockResolvedValue('00000000-0000-0000-0000-000000000000'),
}));
vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthorizationError'; }
  },
}));
vi.mock('../../src/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }));

import { getSite, updateSite } from '../../src/services/site-service';
import { getMainBranch, listBranches } from '../../src/services/branch-service';
import { listDocuments } from '../../src/services/document-service';
import { validateBundleManifest } from '../../src/services/bundle-import-service';
import { assertPermission, AuthorizationError } from '../../src/auth/authorization';
import { handleSiteImportRoute } from '../../src/routes/site-import-api';

const mockGetSite = vi.mocked(getSite);
const mockGetMainBranch = vi.mocked(getMainBranch);
const mockListBranches = vi.mocked(listBranches);
const mockListDocuments = vi.mocked(listDocuments);
const mockValidateManifest = vi.mocked(validateBundleManifest);
const mockAssertPermission = vi.mocked(assertPermission);

function createPrincipal(): AuthenticatedPrincipal {
  return { id: 'user-1', type: 'user', email: 'admin@example.com', systemRole: 'admin', pantheonSiteRoles: {}, tokenExpiry: new Date(Date.now() + 3600000).toISOString() };
}

function createMockKV(): KVNamespace {
  return { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) } as unknown as KVNamespace;
}

function buildMinimalZip(): Uint8Array {
  const siteContent = strToU8(JSON.stringify({ id: 'src-site-1', name: 'Test', pantheonSiteId: 'p1', workflowSettings: {}, createdAt: '', updatedAt: '' }));
  const branchesContent = strToU8(JSON.stringify([{ id: 'src-main', name: 'main', isMain: true, status: 'active', createdAt: '', updatedAt: '', archivedAt: null }]));
  const bundleContent = strToU8(JSON.stringify({
    bundleVersion: '1',
    exportedAt: '2026-05-27T00:00:00Z',
    sourceEnvironment: 'sbx1',
    sourceSiteId: 'src-site-1',
    files: { 'site.json': 'sha256:placeholder', 'branches.json': 'sha256:placeholder' },
  }));
  return zipSync({
    'bundle.json': bundleContent,
    'site.json': siteContent,
    'branches.json': branchesContent,
  });
}

function makeFormRequest(zip: Uint8Array): Request {
  const form = new FormData();
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'bundle.zip');
  return new Request('https://example.com/api/admin/sites/site-1/import', { method: 'POST', body: form });
}

const MOCK_SITE = { id: 'site-1', name: 'Target', pantheonSiteId: 'p1', workflowSettings: {}, allowedOrigins: [], createdAt: '', updatedAt: '', archivedAt: null };
const MOCK_MAIN = { id: 'main-1', siteId: 'site-1', name: 'main', isMain: true, status: 'active', createdAt: '', updatedAt: '', archivedAt: null };

describe('handleSiteImportRoute', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 400 when siteId is missing', async () => {
    const resp = await handleSiteImportRoute(
      new Request('https://example.com/', { method: 'POST' }),
      { siteId: undefined, principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(400);
  });

  it('returns 405 for GET requests', async () => {
    const resp = await handleSiteImportRoute(
      new Request('https://example.com/', { method: 'GET' }),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(405);
  });

  it('returns 404 when target site does not exist', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(null);
    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(404);
  });

  it('returns 409 when target site already has documents', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([{ id: 'doc-1', siteId: 'site-1', path: 'home', createdAt: '' }] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(409);
  });

  it('returns 422 when bundle manifest validation fails', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);
    mockValidateManifest.mockResolvedValueOnce({ valid: false, errors: ['SHA-256 mismatch for site.json'] });

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(422);
    const body = await resp.json() as { error: string; details: string[] };
    expect(body.error).toContain('manifest');
    expect(body.details).toHaveLength(1);
  });

  it('returns 403 when principal lacks canManageGrants permission', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockRejectedValueOnce(new AuthorizationError('Forbidden'));
    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(403);
  });

  it('returns 200 with importKey for a minimal valid bundle', async () => {
    mockGetMainBranch.mockResolvedValueOnce(MOCK_MAIN as never);
    mockAssertPermission.mockResolvedValueOnce(undefined);
    mockGetSite.mockResolvedValueOnce(MOCK_SITE as never);
    mockListDocuments.mockResolvedValueOnce([] as never);
    mockListBranches.mockResolvedValueOnce([MOCK_MAIN] as never);
    mockValidateManifest.mockResolvedValueOnce({ valid: true, errors: [] });
    vi.mocked(updateSite).mockResolvedValueOnce(MOCK_SITE as never);

    const resp = await handleSiteImportRoute(
      makeFormRequest(buildMinimalZip()),
      { siteId: 'site-1', principal: createPrincipal() },
      { CONFIG_KV: createMockKV() } as never,
    );
    expect(resp.status).toBe(200);
    const body = await resp.json() as { importKey: string };
    expect(body.importKey).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd workers && pnpm test -- tests/routes/site-import-api.spec.ts
```

Expected: FAIL with "Cannot find module"

**Step 3: Commit failing tests**

```bash
git add workers/tests/routes/site-import-api.spec.ts
git commit -m "test(PCC-3249): failing tests for site import handler"
```

**Step 4: Write the implementation**

Before writing `site-import-api.ts`, read these files to verify function signatures:
- `workers/src/services/branch-service.ts` — `createBranch` (line ~291), `CreateBranchParams` (line ~20)
- `workers/src/services/document-service.ts` — `createDocument` (line ~84)
- `workers/src/services/document-version-service.ts` — `createDocumentVersion` (line ~222), `DocumentVersionSource` type
- `workers/src/services/site-service.ts` — `updateSite` (line ~331), `UpdateSiteParams`

Create `workers/src/routes/site-import-api.ts` with this structure:

```typescript
/**
 * Site Import Route Handler (PCC-3249 / PROPOSAL-013)
 *
 * POST /api/admin/sites/{siteId}/import
 *
 * Accepts multipart/form-data with a 'file' field (ZIP bundle).
 * Validates SHA-256 manifest, then processes in dependency order:
 *   site → branches → documents → versions → checkpoints
 *
 * Idempotent: re-running resumes from KV progress manifest.
 * Target site must be empty (no non-registry documents, no non-main branches).
 *
 * Version numbers on target are sequential (1, 2, 3...) ordered by createdAt;
 * source version numbers are stored in import_id_maps for traceability.
 */
import { unzipSync } from 'fflate';
import type { AuthenticatedPrincipal } from '../types';
import { getSite, updateSite } from '../services/site-service';
import { getMainBranch, createBranch, listBranches } from '../services/branch-service';
import { createDocument, listDocuments } from '../services/document-service';
import { createDocumentVersion } from '../services/document-version-service';
import {
  validateBundleManifest,
  buildImportKey,
  getImportProgress,
  saveImportProgress,
  hasCompletedPhase,
  resolveCreatedByRefToId,
  type BundleManifest,
  type ImportProgress,
} from '../services/bundle-import-service';
import type { CreatedByRef } from '../services/bundle-export-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { query } from '../db';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';
const REGISTRY_PREFIX = '_registry/';

export interface SiteImportRouteContext {
  siteId?: string;
  principal: AuthenticatedPrincipal;
}

export interface SiteImportEnv {
  CONFIG_KV: KVNamespace;
}

export async function handleSiteImportRoute(
  request: Request,
  context: SiteImportRouteContext,
  env: SiteImportEnv,
): Promise<Response> {
  const { siteId, principal } = context;

  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('Site ID is required', 400);
  }
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) return errorResponse('Site not found', 404);

    await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');

    const site = await getSite(siteId);
    if (site === null) return errorResponse('Site not found', 404);

    // Empty-site check: no non-registry documents, no non-main branches
    const [existingDocs, existingBranches] = await Promise.all([
      listDocuments(siteId),
      listBranches(siteId),
    ]);
    const hasNonRegistryDocs = existingDocs.some((d) => !d.path.startsWith(REGISTRY_PREFIX));
    const hasNonMainBranches = existingBranches.some((b) => !b.isMain);
    if (hasNonRegistryDocs || hasNonMainBranches) {
      return errorResponse(
        'Target site is not empty. Import only supports empty sites.',
        409,
      );
    }

    // Parse multipart upload
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return errorResponse('Expected multipart/form-data with a "file" field', 400);
    }
    const formData = await request.formData();
    const fileField = formData.get('file');
    if (!(fileField instanceof Blob)) {
      return errorResponse('Missing or invalid "file" field', 400);
    }
    const zipBytes = new Uint8Array(await fileField.arrayBuffer());

    // Decompress ZIP
    let zipContents: Record<string, Uint8Array>;
    try {
      zipContents = unzipSync(zipBytes);
    } catch {
      return errorResponse('Failed to decompress ZIP bundle', 400);
    }

    // Read bundle.json (manifest container — NOT in manifest.files)
    const bundleJsonBytes = zipContents['bundle.json'];
    if (bundleJsonBytes === undefined) {
      return errorResponse('bundle.json not found in ZIP', 422);
    }
    const manifest = JSON.parse(new TextDecoder().decode(bundleJsonBytes)) as BundleManifest;

    // Validate all files listed in manifest.files (bundle.json itself is excluded by design)
    const validation = await validateBundleManifest(manifest, zipContents);
    if (!validation.valid) {
      return errorResponse('Bundle manifest validation failed', 422, validation.errors);
    }

    const importKey = buildImportKey(siteId, manifest.exportedAt);
    let progress = await getImportProgress(env.CONFIG_KV, importKey);

    // --- Phase: site ---
    if (!hasCompletedPhase(progress, 'site')) {
      const siteData = JSON.parse(new TextDecoder().decode(zipContents['site.json'])) as {
        name: string;
        workflowSettings: Record<string, unknown>;
      };
      await updateSite(siteId, {
        name: siteData.name,
        workflowSettings: siteData.workflowSettings as never,
      });
      progress = markPhaseComplete(progress, 'site');
      await saveImportProgress(env.CONFIG_KV, importKey, progress);
    }

    // --- Phase: branches ---
    // Build source→target branch name map. Main branch always exists on target.
    const sourceBranches = JSON.parse(new TextDecoder().decode(zipContents['branches.json'])) as Array<{
      id: string;
      name: string;
      isMain: boolean;
      status: string;
      sourceBranchId?: string;
      createdAt: string;
    }>;

    const branchNameToTargetId = new Map<string, string>();
    branchNameToTargetId.set('main', mainBranch.id); // target main branch already exists

    if (!hasCompletedPhase(progress, 'branches')) {
      for (const srcBranch of sourceBranches) {
        if (srcBranch.isMain) continue; // target main already exists
        // CreateBranchParams.createdByType only accepts 'user' | 'agent' — not 'system'
        const newBranch = await createBranch({
          siteId,
          name: srcBranch.name,
          sourceBranchId: mainBranch.id, // all non-main branches branch from main on target
          createdById: SYSTEM_UUID,
          createdByType: 'user', // fallback for system-originated branches
        });
        branchNameToTargetId.set(srcBranch.name, newBranch.id);
        // Store source→target branch mapping
        await query(
          `INSERT INTO app.import_id_maps (import_key, source_id, target_id, entity_type)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [importKey, srcBranch.id, newBranch.id, 'branch'],
        );
      }
      progress = markPhaseComplete(progress, 'branches');
      await saveImportProgress(env.CONFIG_KV, importKey, progress);
    } else {
      // Re-run: reload branch name→target mapping from the target's current branches.
      // import_id_maps records the source→target UUID mapping for traceability, but
      // branchNameToTargetId is keyed by name, which is stable across runs and more
      // reliable than reloading from import_id_maps (which stores UUIDs only).
      const currentBranches = await listBranches(siteId);
      for (const b of currentBranches) {
        branchNameToTargetId.set(b.name, b.id);
      }
    }

    // --- Phase: documents ---
    // Enumerate document paths from ZIP: keys matching documents/{path}/meta.json
    const documentPaths = Object.keys(zipContents)
      .filter((k) => k.match(/^documents\/(.+)\/meta\.json$/))
      .map((k) => k.replace(/^documents\//, '').replace(/\/meta\.json$/, ''));

    for (const docPath of documentPaths) {
      const phaseKey = `document:${docPath}`;
      if (hasCompletedPhase(progress, phaseKey)) continue;

      // Create document on target
      const newDoc = await createDocument({ siteId, path: docPath });

      // Store source→target document mapping
      const metaBytes = zipContents[`documents/${docPath}/meta.json`];
      if (metaBytes !== undefined) {
        const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as { id: string };
        await query(
          `INSERT INTO app.import_id_maps (import_key, source_id, target_id, entity_type)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [importKey, meta.id, newDoc.id, 'document'],
        );
      }

      // Parse versions.jsonl — lines sorted by createdAt ASC
      const versionsKey = `documents/${docPath}/versions.jsonl`;
      const versionsBytes = zipContents[versionsKey];
      if (versionsBytes !== undefined && versionsBytes.length > 0) {
        const lines = new TextDecoder().decode(versionsBytes)
          .split('\n')
          .filter((l) => l.trim() !== '');

        // Group by branchName, maintaining createdAt order within each group
        const byBranch = new Map<string, Array<{
          branchName: string;
          versionNumber: number;
          isPublished: boolean;
          snapshot: Record<string, unknown>;
          createdAt: string;
          createdByRef: CreatedByRef;
        }>>();

        for (const line of lines) {
          const entry = JSON.parse(line) as {
            branchName: string;
            versionNumber: number;
            isPublished: boolean;
            snapshot: Record<string, unknown>;
            createdAt: string;
            createdByRef: CreatedByRef;
          };
          const group = byBranch.get(entry.branchName) ?? [];
          group.push(entry);
          byBranch.set(entry.branchName, group);
        }

        for (const [branchName, entries] of byBranch) {
          const targetBranchId = branchNameToTargetId.get(branchName);
          if (targetBranchId === undefined) {
            console.warn(`[bundle-import] Branch "${branchName}" not found in target — skipping ${entries.length} version(s) for doc ${docPath}`);
            continue;
          }

          // Insert versions sequentially (1, 2, 3...) in createdAt order.
          // createDocumentVersion assigns version numbers automatically starting from 1
          // for each document+branch; do NOT declare or track a targetVersionNumber.
          for (const entry of entries) {
            const createdById = await resolveCreatedByRefToId(entry.createdByRef);
            const createdByType = entry.createdByRef.type === 'system' ? 'system' : entry.createdByRef.type;

            const newVersion = await createDocumentVersion({
              documentId: newDoc.id,
              branchId: targetBranchId,
              snapshot: entry.snapshot,
              source: 'edit', // 'import' is not a valid DocumentVersionSource; use 'edit'
              createdById,
              createdByType,
              skipDuplicateCheck: true,
            });

            // Store source version number mapping
            await query(
              `INSERT INTO app.import_id_maps (import_key, source_id, target_id, entity_type)
               VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [importKey, `${entry.branchName}:${String(entry.versionNumber)}`, String(newVersion.versionNumber), 'version'],
            );

            // Create publish checkpoint if this version was published.
            // NOTE: app.checkpoints has NO site_id column. Columns are:
            //   branch_id, name, checkpoint_type, created_by_id, created_by_type, status
            // Match the pattern used in checkpoint-publish.ts.
            if (entry.isPublished) {
              const cpResult = await query<{ id: string }>(
                `INSERT INTO app.checkpoints (branch_id, name, checkpoint_type, created_by_id, created_by_type, status)
                 VALUES ($1, $2, 'publish', $3, $4, 'completed')
                 RETURNING id`,
                [targetBranchId, 'Import: document', createdById, createdByType],
              );
              const cpId = cpResult.rows[0]?.id;
              if (cpId !== undefined) {
                await query(
                  `INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
                   VALUES ($1, $2, $3)`,
                  [cpId, newDoc.id, newVersion.id],
                );
              }
            }

          }
        }
      }

      progress = markPhaseComplete(progress, phaseKey);
      await saveImportProgress(env.CONFIG_KV, importKey, progress);
    }

    return jsonResponse({
      importKey,
      completedPhases: progress.completedPhases,
      documentCount: documentPaths.length,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return errorResponse(error.message, 403);
    console.error('[site-import] Error processing import bundle:', error);
    return errorResponse('Internal server error', 500);
  }
}

function markPhaseComplete(progress: ImportProgress | null, phase: string): ImportProgress {
  const now = new Date().toISOString();
  if (progress === null) {
    return {
      completedPhases: [phase],
      errors: [],
      startedAt: now,
      lastUpdatedAt: now,
    };
  }
  return {
    ...progress,
    completedPhases: [...new Set([...progress.completedPhases, phase])],
    lastUpdatedAt: now,
  };
}
```

**IMPORTANT:** After writing the file, verify that `DocumentVersionSource` in `document-version-service.ts` includes `'edit'`. If it has `'import'`, use that instead. Search: `grep -n "DocumentVersionSource" workers/src/services/document-version-service.ts`

**Step 5: Wire the dispatch case in route-dispatch.ts**

Add import:
```typescript
import { handleSiteImportRoute } from './site-import-api';
```

Add case (near `site-export`):
```typescript
case 'site-import':
  return await handleSiteImportRoute(request, {
    siteId: route.params.siteId,
    principal,
  }, { CONFIG_KV: env.CONFIG_KV });
```

**Step 6: Run tests**

```bash
cd workers && pnpm test -- tests/routes/site-import-api.spec.ts
```

Expected: all PASS.

**Step 7: Run full suite**

```bash
cd workers && pnpm test
```

Expected: all PASS.

**Step 8: Run lint**

```bash
cd workers && pnpm lint
```

Expected: 0 errors.

**Step 9: Commit**

```bash
git add workers/src/routes/site-import-api.ts workers/src/routes/route-dispatch.ts
git commit -m "feat(PCC-3249): site import handler — full bundle processing pipeline"
```

---

## Task 6: Apply DB Migration and Integration Smoke Test

**Step 1: Apply migration 038**

```bash
docker exec -i css-postgres psql -U cssuser -d cssdb < workers/src/db/migrations/038_import_id_maps.sql
```

Expected output: `CREATE TABLE`, `CREATE INDEX`.

**Step 2: Verify table exists**

```bash
docker exec css-postgres psql -U cssuser -d cssdb -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'import_id_maps';"
```

Expected: 1 row returned.

**Step 3: Write integration tests**

Create `workers/tests/integration/site-export-import.integration.spec.ts`:

```typescript
/**
 * Site Export/Import Integration Tests (PCC-3249)
 *
 * Run with: cd workers && pnpm test:integration -- tests/integration/site-export-import.integration.spec.ts
 * Prerequisites: Docker Postgres running, migration 038 applied.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { setDatabaseInstance } from '../../src/db';
import type { DatabaseConnection, QueryResult } from '../../src/db';
import { createSite } from '../../src/services/site-service';
import { getMainBranch } from '../../src/services/branch-service';
import { createDocument } from '../../src/services/document-service';
import { createDocumentVersion } from '../../src/services/document-version-service';
import { selectVersionsForDocument } from '../../src/services/bundle-export-service';
import { validateBundleManifest, resolveCreatedByRefToId, buildImportKey } from '../../src/services/bundle-import-service';

const CONNECTION_STRING = 'postgresql://cssuser:csspass@localhost:5432/cssdb';
const createdSiteIds: string[] = [];

/**
 * Creates a real DB connection using the same pattern as all other integration tests in this repo.
 * See agent-auth-flow.integration.spec.ts and soft-delete.integration.spec.ts for reference.
 * Key details:
 *   - `transform: { undefined: null }` so undefined JS values map to SQL NULL
 *   - rowCount extracted from `result.count` (postgres.js Result object), fallback to rows.length
 */
function createRealDatabaseConnection(connectionString: string): {
  connection: DatabaseConnection;
  sql: postgres.Sql;
} {
  const sql = postgres(connectionString, {
    transform: { undefined: null },
    max: 1,
  });

  const connection: DatabaseConnection = {
    async query<T = Record<string, unknown>>(
      sqlQuery: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await sql.unsafe<T[]>(sqlQuery, params as unknown as postgres.ParameterOrJSON<never>[]);
      const rows = [...result] as T[];
      const resultWithCount = result as unknown as { count?: number };
      const rowCount = resultWithCount.count ?? rows.length;
      return { rows, rowCount };
    },
  };

  return { connection, sql };
}

let sql: postgres.Sql;

beforeAll(async () => {
  const { connection, sql: pgSql } = createRealDatabaseConnection(CONNECTION_STRING);
  sql = pgSql;
  setDatabaseInstance(connection);
});

afterAll(async () => {
  for (const siteId of createdSiteIds) {
    await sql.unsafe('DELETE FROM app.sites WHERE id = $1', [siteId as never]);
  }
  setDatabaseInstance(null);
  await sql.end();
});

describe('selectVersionsForDocument integration', () => {
  it('returns the latest version for a document with one version on main branch', async () => {
    // createSite also creates the main branch internally.
    // Do NOT pass creatorId here — creatorId triggers a role grant that requires the UUID
    // to exist in app.users or app.agents, and the system UUID (all-zeros) may not be seeded.
    // Omitting creatorId is safe: the site is created without a creator grant, which is
    // valid for test purposes.
    const site = await createSite({
      name: `Export Test ${Date.now()}`,
      pantheonSiteId: `export-${Date.now()}`,
    });
    createdSiteIds.push(site.id);

    const branch = await getMainBranch(site.id);
    if (branch === null) throw new Error('Main branch not found');

    const doc = await createDocument({ siteId: site.id, path: 'home' });

    await createDocumentVersion({
      documentId: doc.id,
      branchId: branch.id,
      snapshot: { root: { type: 'Root', props: {} } },
      source: 'edit',
      createdById: '00000000-0000-0000-0000-000000000000',
      createdByType: 'system',
      skipDuplicateCheck: true,
    });

    const selected = await selectVersionsForDocument(doc.id, branch.id, true);
    expect(selected).toHaveLength(1);
    expect(selected[0].snapshot).toEqual({ root: { type: 'Root', props: {} } });
  });
});

describe('resolveCreatedByRefToId integration', () => {
  it('returns system UUID for type=system', async () => {
    const id = await resolveCreatedByRefToId({ type: 'system' });
    expect(id).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('returns system UUID for unknown user email', async () => {
    const id = await resolveCreatedByRefToId({ type: 'user', email: 'nobody@noreply.invalid' });
    expect(id).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('import_id_maps table integration', () => {
  it('accepts writes and reads correctly', async () => {
    const importKey = buildImportKey('test-site-imap', '2026-05-27T00:00:00Z');
    await sql.unsafe(
      'INSERT INTO app.import_id_maps (import_key, source_id, target_id, entity_type) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [importKey, 'src-99', 'tgt-99', 'document'],
    );
    const result = await sql.unsafe<{ target_id: string }[]>(
      'SELECT target_id FROM app.import_id_maps WHERE import_key = $1 AND source_id = $2',
      [importKey, 'src-99'],
    );
    expect(result[0]?.target_id).toBe('tgt-99');
    await sql.unsafe('DELETE FROM app.import_id_maps WHERE import_key = $1', [importKey]);
  });
});

describe('validateBundleManifest integration', () => {
  it('passes for valid content computed with crypto.subtle', async () => {
    const content = new TextEncoder().encode('{"hello":"world"}');
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashHex = 'sha256:' + Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const result = await validateBundleManifest(
      { bundleVersion: '1', exportedAt: '2026-05-27T00:00:00Z', sourceEnvironment: 'sbx1', sourceSiteId: 'site-1', files: { 'site.json': hashHex } },
      { 'site.json': content },
    );
    expect(result.valid).toBe(true);
  });
});
```

**Step 4: Run integration tests**

```bash
cd workers && pnpm test:integration -- tests/integration/site-export-import.integration.spec.ts
```

Expected: all PASS.

**Step 5: Run all unit tests**

```bash
cd workers && pnpm test
```

Expected: all PASS.

**Step 6: Commit**

```bash
git add workers/tests/integration/site-export-import.integration.spec.ts
git commit -m "test(PCC-3249): integration tests for export/import pipeline"
```

---

## Task 7: Final Verification and PROGRESS.md Update

**Step 1: Run full test suite one final time**

```bash
cd workers && pnpm test && pnpm lint
```

Expected: all PASS, 0 lint errors.

**Step 2: Update PROGRESS.md**

Add a new section documenting PCC-3249 completion. Include:
- What endpoints were added (`GET /api/admin/sites/{siteId}/export`, `POST /api/admin/sites/{siteId}/import`)
- What services were created (`bundle-export-service.ts`, `bundle-import-service.ts`)
- What was cleaned up (deleted `migrate-site.ts`, `tsconfig.scripts.json`)
- Key decisions: R2 storage, empty-site-only import, fflate ZIP, SYSTEM_UUID fallback, `canManageGrants` permission, `branchName` field in versions.jsonl, sequential version numbering on target
- Migration 038 applied

**Step 3: Commit**

```bash
git add PROGRESS.md
git commit -m "docs(PCC-3249): update PROGRESS.md with export/import implementation complete"
```

---

## File Index

| Path | Action | Purpose |
|------|--------|---------|
| `workers/scripts/migrate-site.ts` | DELETE | Old API-based migration, replaced by endpoints |
| `workers/tsconfig.scripts.json` | DELETE | Only needed for scripts/, no longer used |
| `workers/package.json` | MODIFY | Add fflate dependency |
| `workers/wrangler.jsonc` | MODIFY | Add R2_BUNDLES binding and R2_BUNDLES_BUCKET env var in all env blocks |
| `workers/src/index.ts` | MODIFY | Add R2_BUNDLES/R2_BUNDLES_BUCKET to Env interface |
| `workers/src/db/migrations/038_import_id_maps.sql` | CREATE | Source→target UUID traceability table |
| `workers/src/services/bundle-export-service.ts` | CREATE | Version selection, createdByRef resolution |
| `workers/src/services/bundle-import-service.ts` | CREATE | Manifest validation, createdByRef resolution, KV progress |
| `workers/src/routes/site-export-api.ts` | CREATE | Export route handler |
| `workers/src/routes/site-import-api.ts` | CREATE | Import route handler |
| `workers/src/routes/route-parser.ts` | MODIFY | Add site-export, site-import routes |
| `workers/src/routes/route-dispatch.ts` | MODIFY | Add site-export, site-import dispatch cases |
| `workers/tests/services/bundle-export-service.spec.ts` | CREATE | Unit tests |
| `workers/tests/services/bundle-import-service.spec.ts` | CREATE | Unit tests |
| `workers/tests/routes/site-export-api.spec.ts` | CREATE | Handler tests |
| `workers/tests/routes/site-import-api.spec.ts` | CREATE | Handler tests |
| `workers/tests/integration/site-export-import.integration.spec.ts` | CREATE | Integration tests |
| `PROGRESS.md` | MODIFY | Document completion |

---

## Critical Notes for Implementing Agent

1. **Do NOT modify MCP auth changes** in `workers/mcp-server/*`, `terraform/*`, or `docs/plans/2026-05-16-pcc-3191-*`. These are unrelated changes already in this branch.

2. **`canManageSite` does not exist.** Use `canManageGrants` in every `assertPermission` call. Verify by reading `workers/src/types/auth.ts` — the `RolePermissions` interface has exactly 10 keys and `canManageSite` is not one of them.

3. **Read service signatures before calling** `createBranch`, `createDocument`, `createDocumentVersion`, and `updateSite`. Especially note: `createBranch.createdByType` is `'user' | 'agent'` only — not `'system'`.

4. **fflate imports:** `import { zipSync, unzipSync, strToU8 } from 'fflate';`

5. **`crypto.subtle.digest`** is available natively in both Workers and Vitest. No polyfill needed.

6. **bundle.json is NOT in manifest.files** by design. The import handler reads `bundle.json` first to get the manifest, then validates all other files.

7. **Version numbers on target are sequential** (1, 2, 3...) per document+branch pair. Do NOT replicate source version numbers — they may collide across branches.

8. **`versions.jsonl` includes `branchName` field** on each line. The import handler uses this to route versions to the correct target branch.

9. **`DocumentVersionSource`:** Before calling `createDocumentVersion`, check if `'import'` is a valid `DocumentVersionSource` value. If not, use `'edit'`. Run: `grep -n "DocumentVersionSource\|source:" workers/src/services/document-version-service.ts | head -20`

10. **Integration test createSite signature:** `createSite` requires `pantheonSiteId` and `name`. It also accepts `createdById` and `createdByType`. It internally calls `createMainBranch` — do NOT call `createMainBranch` separately in tests.
