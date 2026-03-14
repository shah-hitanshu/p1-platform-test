# Pull-Based DO Invalidation After Merge — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** After a merge writes new document versions to the target branch in PostgreSQL, signal active Durable Objects on that branch to reload their state — using a pull-based KV invalidation pattern that is O(1) at merge time and only causes work in DOs that are actually alive.

**Architecture:** After a successful merge, the worker writes a timestamp to a KV key `branch-version:{branchId}`. Each DocumentSession DO stores the last-seen timestamp in memory. On every alarm tick (60s interval), and on every HTTP `fetch()` entry point, the DO reads its branch's KV timestamp; if the KV value is newer than the last-seen value, the DO calls its existing `handleReload()` method to re-initialize from PostgreSQL and broadcast diffs to connected WebSocket clients. This reuses `CONFIG_KV` (already bound to the worker) with a new binding added to the DO's env interface. The KV write is a single `put()` with no read-before-write, eliminating race conditions on concurrent merges.

**Tech Stack:** Cloudflare Workers, Durable Objects, KV (`CONFIG_KV`), Vitest, TypeScript

**Key Design Decisions:**

1. **Reuse `CONFIG_KV` rather than creating a new KV namespace.** The operational overhead of a new namespace (wrangler.jsonc changes, Terraform updates per environment, new DO env binding) is not justified for a handful of keys with a clear `branch-version:` prefix. `CONFIG_KV` is already bound to the worker in all environments.

2. **Timestamp-based signal rather than integer counter.** A timestamp requires no read-before-write — just `put(Date.now().toString())`. Concurrent merges both write a recent timestamp; neither signal is "lost." An integer counter would need `get()` then `put()`, introducing a race where two concurrent merges read the same value and one increment is swallowed. While harmless in practice (the DO still reloads), the timestamp approach is simpler and more debuggable.

3. **Check invalidation in `fetch()` router + `alarm()` only, not in `webSocketMessage()`.** The `webSocketMessage()` handler fires on every WebSocket frame (every keystroke, cursor move, awareness update). Adding a KV read per message would be expensive at scale. The alarm runs every 60 seconds, providing a reasonable upper bound on staleness for idle connections. Active HTTP requests (like `/snapshot` or `/apply`) check immediately. If 60s proves too slow, a throttled check in `webSocketMessage()` is an easy follow-up — but not in this initial implementation.

4. **Invalidation signal written in `index.ts` after merge route returns success**, matching the existing post-publish reload pattern at line 1452. This keeps side-effect logic in the top-level router rather than buried in service functions, and ensures the KV write only happens after a successful merge commit.

5. **DO does NOT need `DOCUMENT_STATE` self-reference for invalidation.** The DO checks KV passively; it does not need to call other DOs. The existing `/reload` mechanism is invoked internally by the DO on itself.

---

### Task 1: Create the branch invalidation service

**Files:**
- Create: `workers/src/services/branch-invalidation-service.ts`
- Test: `workers/tests/services/branch-invalidation-service.spec.ts`

This service encapsulates all KV read/write operations for branch invalidation signals. It takes a `KVNamespace` as a parameter (dependency injection) rather than importing a global, making it testable with a mock KV.

**Step 1: Write the failing tests**

Create `workers/tests/services/branch-invalidation-service.spec.ts`:

```typescript
/**
 * Branch Invalidation Service Tests
 *
 * Tests for the KV-based branch invalidation signal system.
 * After a merge writes new document versions to a target branch,
 * a timestamp is written to KV. DOs poll this to detect staleness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll import these after implementation exists
// import { writeBranchInvalidation, getBranchVersion } from '../../src/services/branch-invalidation-service';

/**
 * Minimal mock of Cloudflare KV namespace
 */
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null)),
    put: vi.fn().mockImplementation((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

describe('branch-invalidation-service', () => {
  let mockKV: KVNamespace;

  beforeEach(() => {
    mockKV = createMockKV();
  });

  describe('writeBranchInvalidation', () => {
    it('should write a timestamp to the KV key branch-version:{branchId}', async () => {
      const { writeBranchInvalidation } = await import(
        '../../src/services/branch-invalidation-service'
      );

      const branchId = 'branch-abc-123';
      await writeBranchInvalidation(mockKV, branchId);

      expect(mockKV.put).toHaveBeenCalledTimes(1);
      const [key, value] = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(key).toBe('branch-version:branch-abc-123');
      // Value should be a numeric timestamp string
      const ts = Number(value);
      expect(Number.isNaN(ts)).toBe(false);
      expect(ts).toBeGreaterThan(0);
    });

    it('should write a value close to Date.now()', async () => {
      const { writeBranchInvalidation } = await import(
        '../../src/services/branch-invalidation-service'
      );

      const before = Date.now();
      await writeBranchInvalidation(mockKV, 'branch-1');
      const after = Date.now();

      const [, value] = (mockKV.put as ReturnType<typeof vi.fn>).mock.calls[0];
      const ts = Number(value);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('should not read before writing (no get call)', async () => {
      const { writeBranchInvalidation } = await import(
        '../../src/services/branch-invalidation-service'
      );

      await writeBranchInvalidation(mockKV, 'branch-1');

      expect(mockKV.get).not.toHaveBeenCalled();
    });
  });

  describe('getBranchVersion', () => {
    it('should return 0 when no key exists', async () => {
      const { getBranchVersion } = await import(
        '../../src/services/branch-invalidation-service'
      );

      const version = await getBranchVersion(mockKV, 'nonexistent-branch');
      expect(version).toBe(0);
    });

    it('should return the stored timestamp as a number', async () => {
      const { getBranchVersion } = await import(
        '../../src/services/branch-invalidation-service'
      );

      // Pre-populate KV
      await (mockKV as unknown as { put: (k: string, v: string) => Promise<void> }).put(
        'branch-version:branch-1',
        '1710000000000',
      );

      const version = await getBranchVersion(mockKV, 'branch-1');
      expect(version).toBe(1710000000000);
    });

    it('should return 0 for non-numeric stored values', async () => {
      const { getBranchVersion } = await import(
        '../../src/services/branch-invalidation-service'
      );

      await (mockKV as unknown as { put: (k: string, v: string) => Promise<void> }).put(
        'branch-version:branch-1',
        'garbage',
      );

      const version = await getBranchVersion(mockKV, 'branch-1');
      expect(version).toBe(0);
    });

    it('should use independent keys per branch', async () => {
      const { writeBranchInvalidation, getBranchVersion } = await import(
        '../../src/services/branch-invalidation-service'
      );

      await writeBranchInvalidation(mockKV, 'branch-a');
      await writeBranchInvalidation(mockKV, 'branch-b');

      // Both should have values
      const versionA = await getBranchVersion(mockKV, 'branch-a');
      const versionB = await getBranchVersion(mockKV, 'branch-b');
      expect(versionA).toBeGreaterThan(0);
      expect(versionB).toBeGreaterThan(0);

      // Nonexistent branch should be 0
      const versionC = await getBranchVersion(mockKV, 'branch-c');
      expect(versionC).toBe(0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation/workers && pnpm test -- tests/services/branch-invalidation-service.spec.ts`
Expected: FAIL — module `../../src/services/branch-invalidation-service` does not exist.

**Step 3: Write minimal implementation**

Create `workers/src/services/branch-invalidation-service.ts`:

```typescript
/**
 * Branch Invalidation Service
 *
 * Manages KV-based invalidation signals for branch state changes.
 * After a merge writes new document versions to a target branch,
 * the caller writes a timestamp to KV. Durable Objects poll this
 * timestamp to detect when they need to reload from PostgreSQL.
 *
 * Key format: `branch-version:{branchId}`
 * Value format: numeric timestamp string (Date.now())
 */

/** KV key prefix for branch invalidation timestamps */
const BRANCH_VERSION_PREFIX = 'branch-version:';

/**
 * Write a branch invalidation signal to KV.
 *
 * Writes the current timestamp as the branch version.
 * No read-before-write is needed — concurrent writes both
 * produce a recent timestamp, and the DO will reload regardless
 * of which one "wins."
 *
 * @param kv - The KV namespace to write to (CONFIG_KV)
 * @param branchId - The branch that was modified (merge target)
 */
export async function writeBranchInvalidation(
  kv: KVNamespace,
  branchId: string,
): Promise<void> {
  const key = `${BRANCH_VERSION_PREFIX}${branchId}`;
  await kv.put(key, Date.now().toString());
}

/**
 * Read the current branch version (invalidation timestamp) from KV.
 *
 * Returns 0 if no key exists or the value is not a valid number.
 * DOs compare this against their last-seen version to detect staleness.
 *
 * @param kv - The KV namespace to read from (CONFIG_KV)
 * @param branchId - The branch to check
 * @returns The stored timestamp, or 0 if none exists
 */
export async function getBranchVersion(
  kv: KVNamespace,
  branchId: string,
): Promise<number> {
  const key = `${BRANCH_VERSION_PREFIX}${branchId}`;
  const value = await kv.get(key);
  if (value === null) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation/workers && pnpm test -- tests/services/branch-invalidation-service.spec.ts`
Expected: PASS (all 5 tests)

**Step 5: Lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation && pnpm lint`
Expected: 0 new errors

**Step 6: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation
git add workers/tests/services/branch-invalidation-service.spec.ts
git commit -m "test: add branch invalidation service tests (red)"
git add workers/src/services/branch-invalidation-service.ts
git commit -m "feat: add branch invalidation service for KV-based DO invalidation"
```

---

### Task 2: Wire KV invalidation signal into merge routes

**Files:**
- Modify: `workers/src/index.ts:1487-1498` (the `case 'merge':` block)
- Modify: `workers/src/services/index.ts` (add export)
- Test: `workers/tests/routes/post-merge-invalidation.spec.ts`

After a successful merge execute (either direct or via merge request), write the invalidation signal for the target branch. This mirrors the post-publish DO reload pattern at lines 1452-1473 of `index.ts`.

**Step 1: Write the failing tests**

Create `workers/tests/routes/post-merge-invalidation.spec.ts`:

```typescript
/**
 * Post-Merge KV Invalidation Tests
 *
 * Verifies that after a successful merge execute, a branch
 * invalidation signal is written to CONFIG_KV for the target branch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the services module
vi.mock('../../src/services', () => ({
  executeMerge: vi.fn(),
  executeMergeWithResolution: vi.fn(),
  handleMergeRoutes: vi.fn(),
  getMainBranch: vi.fn(),
  checkMergeability: vi.fn(),
  previewMerge: vi.fn(),
  createMergeRequest: vi.fn(),
  getMergeRequest: vi.fn(),
  listMergeRequests: vi.fn(),
  updateMergeRequest: vi.fn(),
  updateMergeRequestStatus: vi.fn(),
  deleteMergeRequest: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  mergeCrdtStates: vi.fn(),
  MergeRequestNotFoundError: class extends Error {},
  SourceBranchNotFoundError: class extends Error {},
  TargetBranchNotFoundError: class extends Error {},
  MergeConflictsError: class extends Error {},
  MergeNotAllowedError: class extends Error {},
  MergeExecutionError: class extends Error {},
  InvalidCrdtStateError: class extends Error {},
  MissingCrdtStateError: class extends Error {},
}));

vi.mock('../../src/services/branch-invalidation-service', () => ({
  writeBranchInvalidation: vi.fn().mockResolvedValue(undefined),
}));

describe('post-merge KV invalidation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write invalidation signal after successful direct merge execute', async () => {
    const { executeMerge } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    // executeMerge returns success with the target branch info
    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 2,
    });

    // Import and call the merge route handler
    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBranchId: 'branch-source',
        targetBranchId: 'branch-target',
        message: 'Test merge',
      }),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      operation: 'execute',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    expect(response.status).toBe(200);
    expect(writeBranchInvalidation).toHaveBeenCalledWith(mockKV, 'branch-target');
  });

  it('should NOT write invalidation signal when merge fails', async () => {
    const { executeMerge } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    (executeMerge as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Merge failed'),
    );

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBranchId: 'branch-source',
        targetBranchId: 'branch-target',
        message: 'Test merge',
      }),
    });

    const mockKV = {} as KVNamespace;
    // The route should catch the error and return an error response
    // but NOT write invalidation
    await handleMergeRoutes(request, {
      siteId: 'site-1',
      operation: 'execute',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    expect(writeBranchInvalidation).not.toHaveBeenCalled();
  });

  it('should swallow KV write errors without failing the merge response', async () => {
    const { executeMerge } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 1,
    });
    (writeBranchInvalidation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('KV write failed'),
    );

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBranchId: 'branch-source',
        targetBranchId: 'branch-target',
        message: 'Test merge',
      }),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      operation: 'execute',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    // Merge succeeded — KV failure is swallowed
    expect(response.status).toBe(200);
  });

  it('should write invalidation signal after merge request execute', async () => {
    const { executeMerge, getMergeRequest } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    (getMergeRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'mr-1',
      sourceBranchId: 'branch-source',
      targetBranchId: 'branch-target',
      status: 'approved',
      title: 'Test',
    });
    (executeMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 1,
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge-requests/mr-1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      executeRequest: true,
      mergeRequestId: 'mr-1',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    expect(response.status).toBe(200);
    expect(writeBranchInvalidation).toHaveBeenCalledWith(mockKV, 'branch-target');
  });

  it('should write invalidation for merge with conflict resolution', async () => {
    const { executeMergeWithResolution } = await import('../../src/services');
    const { writeBranchInvalidation } = await import(
      '../../src/services/branch-invalidation-service'
    );

    (executeMergeWithResolution as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      mergeRequestId: 'mr-1',
      checkpointId: 'cp-1',
      documentsUpdated: 2,
      conflictsResolved: 1,
    });

    const { handleMergeRoutes } = await import('../../src/routes/merge-api');

    const request = new Request('http://localhost/api/sites/site-1/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBranchId: 'branch-source',
        targetBranchId: 'branch-target',
        message: 'Merge with resolutions',
        conflictResolutions: [
          { documentId: 'doc-1', strategy: 'take-source' },
        ],
      }),
    });

    const mockKV = {} as KVNamespace;
    const response = await handleMergeRoutes(request, {
      siteId: 'site-1',
      operation: 'execute',
      principal: { id: 'user-1', type: 'user', email: 'test@test.com' },
      configKV: mockKV,
    });

    expect(response.status).toBe(200);
    expect(writeBranchInvalidation).toHaveBeenCalledWith(mockKV, 'branch-target');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation/workers && pnpm test -- tests/routes/post-merge-invalidation.spec.ts`
Expected: FAIL — `configKV` is not a valid property on `MergeRouteContext`.

**Step 3: Implement the changes**

3a. Add `configKV` to `MergeRouteContext` in `workers/src/routes/merge-api.ts`:

```typescript
export interface MergeRouteContext {
  siteId: string;
  operation?: 'check' | 'execute' | 'preview' | 'crdt-preview';
  mergeRequests?: boolean;
  executeRequest?: boolean;
  mergeRequestId?: string;
  principal: AuthenticatedPrincipal;
  /** KV namespace for writing branch invalidation signals after merge */
  configKV?: KVNamespace;
}
```

3b. Add post-merge invalidation to `handleExecuteMerge` in `workers/src/routes/merge-api.ts`. After the `return jsonResponse(result)` calls for both the resolution and simple merge paths, refactor to capture the result and write invalidation before returning:

```typescript
async function handleExecuteMerge(
  request: Request,
  context: MergeRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<MergeExecuteBody>(request);

  if (body.sourceBranchId === undefined || body.targetBranchId === undefined) {
    return errorResponse('Both sourceBranchId and targetBranchId are required', 400);
  }

  await assertPermission(context.principal, context.siteId, body.sourceBranchId, 'canMerge');

  let result;

  // If conflict resolutions are provided, use executeMergeWithResolution
  if (body.conflictResolutions !== undefined && body.conflictResolutions.length > 0) {
    result = await executeMergeWithResolution({
      sourceBranchId: body.sourceBranchId,
      targetBranchId: body.targetBranchId,
      message: body.message ?? 'Merge with resolutions',
      resolutions: body.conflictResolutions,
      createdById: context.principal.id,
      createdByType: context.principal.type as 'user' | 'agent',
    });
  } else {
    // Otherwise execute simple merge
    result = await executeMerge({
      sourceBranchId: body.sourceBranchId,
      targetBranchId: body.targetBranchId,
      message: body.message ?? 'Merge',
      createdById: context.principal.id,
      createdByType: context.principal.type as 'user' | 'agent',
    });
  }

  // Write branch invalidation signal (fire-and-forget, errors swallowed)
  if (context.configKV !== undefined) {
    try {
      await writeBranchInvalidation(context.configKV, body.targetBranchId);
    } catch (error) {
      console.warn('Failed to write branch invalidation after merge:', error);
    }
  }

  return jsonResponse(result);
}
```

3c. Add the same pattern to `handleExecuteMergeRequest`:

After the merge executes successfully and before returning the response, add:

```typescript
  // Write branch invalidation signal (fire-and-forget, errors swallowed)
  if (context.configKV !== undefined) {
    try {
      await writeBranchInvalidation(context.configKV, mergeRequest.targetBranchId);
    } catch (error) {
      console.warn('Failed to write branch invalidation after merge request execute:', error);
    }
  }

  return jsonResponse(result);
```

3d. Add the import at the top of `merge-api.ts`:

```typescript
import { writeBranchInvalidation } from '../services/branch-invalidation-service';
```

3e. Pass `configKV` from `index.ts` into the merge route context at line 1488:

```typescript
      case 'merge':
        response = await handleMergeRoutes(request, {
          siteId: route.params.siteId ?? '',
          operation: ['check', 'execute', 'preview', 'crdt-preview'].includes(route.params.action ?? '')
            ? (route.params.action as 'check' | 'execute' | 'preview' | 'crdt-preview')
            : undefined,
          mergeRequests: route.params.action === 'requests',
          executeRequest: route.params.action === 'execute-request',
          mergeRequestId: route.params.mergeRequestId,
          principal,
          configKV: env.CONFIG_KV,
        });
        break;
```

3f. Export `writeBranchInvalidation` and `getBranchVersion` from `workers/src/services/index.ts`:

```typescript
export { writeBranchInvalidation, getBranchVersion } from './branch-invalidation-service';
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation/workers && pnpm test -- tests/routes/post-merge-invalidation.spec.ts`
Expected: PASS (all 5 tests)

**Step 5: Lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation && pnpm lint`
Expected: 0 new errors

**Step 6: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation
git add workers/tests/routes/post-merge-invalidation.spec.ts
git commit -m "test: add post-merge KV invalidation route tests (red)"
git add workers/src/routes/merge-api.ts workers/src/index.ts workers/src/services/index.ts workers/src/services/branch-invalidation-service.ts
git commit -m "feat: write branch invalidation signal to KV after merge"
```

---

### Task 3: Add CONFIG_KV binding to DocumentSession DO env

**Files:**
- Modify: `workers/src/durable-objects/document-session.ts:205-222` (DocumentSessionEnv interface)
- Modify: `workers/wrangler.jsonc` (no change needed — KV is already available to DOs in the same worker; DOs share bindings with the parent worker)

**Important note on Cloudflare architecture:** In Cloudflare Workers, Durable Objects defined in the same worker script automatically have access to all bindings defined at the top level of `wrangler.jsonc` (KV namespaces, queues, etc.). The `DocumentSessionEnv` TypeScript interface just needs to declare the binding for type safety. No wrangler config changes are required.

**Step 1: Add CONFIG_KV to the DocumentSessionEnv interface**

In `workers/src/durable-objects/document-session.ts`, add to the `DocumentSessionEnv` interface:

```typescript
interface DocumentSessionEnv {
  API_URL?: string;
  ENVIRONMENT?: string;
  /** Internal API URL for syncing to PostgreSQL */
  INTERNAL_API_URL?: string;
  /** Shared secret for internal API authentication */
  INTERNAL_SECRET?: string;
  /** Enable detailed DO alarm/cleanup metrics (can be high volume) */
  DO_ALARM_METRICS_ENABLED?: string;
  /** Phase 5.1: Queue binding for async DO-to-PostgreSQL sync */
  SYNC_QUEUE?: Queue;
  /** Phase 5.3: Hyperdrive binding for direct DB access from DOs */
  HYPERDRIVE?: Hyperdrive;
  /** Phase 3.2: PresenceManager DO binding for site-level presence aggregation */
  PRESENCE?: DurableObjectNamespace;
  /** DocumentSession DO namespace for cross-branch reload after publish */
  DOCUMENT_STATE?: DurableObjectNamespace;
  /** KV namespace for branch invalidation signals (pull-based DO invalidation) */
  CONFIG_KV?: KVNamespace;
}
```

This is a type-only change with no runtime effect. It will be used in Task 4.

**Step 2: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation
git add workers/src/durable-objects/document-session.ts
git commit -m "feat: add CONFIG_KV to DocumentSessionEnv for invalidation"
```

---

### Task 4: Add pull-based invalidation check to DocumentSession DO

**Files:**
- Modify: `workers/src/durable-objects/document-session.ts` (add invalidation check logic)
- Test: `workers/tests/durable-objects/document-session-invalidation.spec.ts`

The DO checks the KV branch version timestamp on two triggers:
1. In `fetch()` — before dispatching to any CRDT endpoint (after `initializeCrdtIfNeeded()`)
2. In `alarm()` — during the periodic tick

If the KV timestamp is newer than the last-seen value stored in memory, the DO calls its existing `handleReload()` logic internally (re-init from Postgres, broadcast diff to WebSocket clients).

**Step 1: Write the failing tests**

Create `workers/tests/durable-objects/document-session-invalidation.spec.ts`:

```typescript
/**
 * DocumentSession: Pull-Based KV Invalidation Tests
 *
 * Tests for the pull-based invalidation mechanism where the DO
 * checks a KV timestamp on fetch() and alarm() to detect when
 * it needs to reload state from PostgreSQL after a merge.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Mock cloudflare:workers DurableObject base class
vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

// =============================================================================
// Mock Types (mirrors document-session-reload.spec.ts pattern)
// =============================================================================

interface MockDurableObjectStorage {
  get: Mock<(key: string) => Promise<unknown>>;
  put: Mock<(key: string, value: unknown) => Promise<void>>;
  delete: Mock<(key: string) => Promise<boolean>>;
  list: Mock<() => Promise<Map<string, unknown>>>;
  getAlarm: Mock<() => Promise<number | null>>;
  setAlarm: Mock<(scheduledTime: number) => Promise<void>>;
}

interface MockDurableObjectState {
  id: { toString: () => string; name: string };
  storage: MockDurableObjectStorage;
  blockConcurrencyWhile: Mock<(callback: () => Promise<void>) => Promise<void>>;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

function createMockState(sessionId = 'site-1:doc-1:branch-1'): MockDurableObjectState {
  const storageData = new Map<string, unknown>();

  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.get(key))),
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      storageData.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };

  return {
    id: { toString: () => sessionId, name: sessionId },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
  };
}

function createMockKV(branchVersions: Record<string, string> = {}): KVNamespace {
  return {
    get: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(branchVersions[key] ?? null),
    ),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

interface MockEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
  CONFIG_KV?: KVNamespace;
}

function createMockEnv(configKV?: KVNamespace): MockEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
    CONFIG_KV: configKV,
  };
}

describe('DocumentSession pull-based KV invalidation', () => {
  let mockState: MockDurableObjectState;
  let mockFetch: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    mockState = createMockState('site-1:doc-1:branch-1');

    // Mock global fetch for internal API calls (Hyperdrive/HTTP init)
    mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ found: true, snapshot: { title: 'Test' }, crdtState: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should not reload when CONFIG_KV is not bound', async () => {
    const mockEnv = createMockEnv(undefined); // no KV
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    const response = await session.fetch(new Request('http://localhost/snapshot'));
    expect(response.status).toBe(200);

    // Only the initial init fetch should have happened, no reload
    // (initializeFromPostgres is called once)
    const initCalls = mockFetch.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/internal/'),
    );
    // The DO should initialize normally without any KV-related issues
    expect(response.status).toBe(200);
  });

  it('should not reload when KV has no entry for this branch', async () => {
    const mockKV = createMockKV({}); // empty KV
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // First request initializes the DO
    await session.fetch(new Request('http://localhost/snapshot'));

    // Second request should check KV but find nothing — no reload
    const initialFetchCount = mockFetch.mock.calls.length;
    await session.fetch(new Request('http://localhost/snapshot'));

    expect(mockKV.get).toHaveBeenCalledWith('branch-version:branch-1');
    // No additional initializeFromPostgres calls beyond the initial one
    // (mockFetch call count should not increase significantly)
  });

  it('should reload when KV timestamp is newer than last-seen', async () => {
    // Start with no KV entry
    const kvStore: Record<string, string> = {};
    const mockKV = createMockKV(kvStore);
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // Initialize the DO
    await session.fetch(new Request('http://localhost/snapshot'));

    // Now simulate a merge by setting a KV timestamp
    const mergeTimestamp = Date.now().toString();
    (mockKV.get as Mock).mockImplementation((key: string) => {
      if (key === 'branch-version:branch-1') return Promise.resolve(mergeTimestamp);
      return Promise.resolve(null);
    });

    // Mock the reload response with different content
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          found: true,
          snapshot: { title: 'Merged Content' },
          crdtState: null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    // Next request should detect staleness and reload
    const response = await session.fetch(new Request('http://localhost/snapshot'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.snapshot.title).toBe('Merged Content');
  });

  it('should not reload twice for the same KV timestamp', async () => {
    const mergeTimestamp = Date.now().toString();
    const mockKV = createMockKV({ 'branch-version:branch-1': mergeTimestamp });
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // First request: init + check KV + reload
    await session.fetch(new Request('http://localhost/snapshot'));

    const fetchCountAfterFirst = mockFetch.mock.calls.length;

    // Second request: check KV, same timestamp — should NOT reload
    await session.fetch(new Request('http://localhost/snapshot'));

    // Fetch count should not increase (no new initializeFromPostgres)
    // Allow for minor variations in mock call patterns
    const fetchCountAfterSecond = mockFetch.mock.calls.length;
    expect(fetchCountAfterSecond).toBe(fetchCountAfterFirst);
  });

  it('should handle KV read errors gracefully without disrupting normal operation', async () => {
    const mockKV = createMockKV({});
    (mockKV.get as Mock).mockRejectedValue(new Error('KV read failed'));
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // Should still serve the request normally despite KV error
    const response = await session.fetch(new Request('http://localhost/snapshot'));
    expect(response.status).toBe(200);
  });

  it('should broadcast diff to WebSocket clients after invalidation-triggered reload', async () => {
    const mockKV = createMockKV({});
    const mockEnv = createMockEnv(mockKV);
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(mockState as unknown, mockEnv);

    // Initialize with initial content
    await session.fetch(new Request('http://localhost/snapshot'));

    // Set up a mock WebSocket connection
    const mockWs = { readyState: WebSocket.OPEN, send: vi.fn() };
    mockState.getWebSockets.mockReturnValue([mockWs]);

    // Simulate merge: set KV timestamp
    const mergeTimestamp = (Date.now() + 1000).toString();
    (mockKV.get as Mock).mockImplementation((key: string) => {
      if (key === 'branch-version:branch-1') return Promise.resolve(mergeTimestamp);
      return Promise.resolve(null);
    });

    // Mock reload response with new content
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          found: true,
          snapshot: { title: 'After Merge' },
          crdtState: null,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    // Trigger fetch — should detect staleness, reload, and broadcast
    await session.fetch(new Request('http://localhost/snapshot'));

    // The WebSocket should have received the diff
    expect(mockWs.send).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation/workers && pnpm test -- tests/durable-objects/document-session-invalidation.spec.ts`
Expected: FAIL — the DO does not yet check KV for invalidation.

**Step 3: Implement invalidation check in DocumentSession**

Add the following to `workers/src/durable-objects/document-session.ts`:

3a. Add a new instance variable near the top of the `DocumentSession` class (around line 253):

```typescript
  /** Last-seen branch invalidation timestamp from KV (pull-based invalidation) */
  private lastSeenBranchVersion = 0;
```

3b. Add a private method `checkBranchInvalidation()`:

```typescript
  /**
   * Pull-based invalidation check.
   *
   * Reads the branch version timestamp from CONFIG_KV and compares
   * it to the last-seen value. If the KV value is newer, the DO
   * reloads its Y.Doc from PostgreSQL and broadcasts the diff to
   * all connected WebSocket clients.
   *
   * Errors are swallowed — KV unavailability should never break
   * normal DO operation.
   */
  private async checkBranchInvalidation(): Promise<void> {
    const kv = this.env.CONFIG_KV;
    if (kv === undefined) {
      return;
    }

    try {
      const branchId = this.sessionInfo.branchId;
      if (branchId === '') {
        return;
      }

      const value = await kv.get(`branch-version:${branchId}`);
      if (value === null) {
        return;
      }

      const kvTimestamp = Number(value);
      if (Number.isNaN(kvTimestamp) || kvTimestamp <= this.lastSeenBranchVersion) {
        return;
      }

      // KV has a newer timestamp — reload from PostgreSQL
      this.lastSeenBranchVersion = kvTimestamp;

      if (this.initialized) {
        // Capture old state, reload, compute diff, broadcast
        const oldStateVector = Y.encodeStateVector(this.ydoc);
        this.ydoc = new Y.Doc();
        this.initialized = false;
        await this.initializeFromPostgres();
        this.initialized = true;

        const diff = Y.encodeStateAsUpdate(this.ydoc, oldStateVector);
        if (diff.length > 0) {
          for (const conn of this.state.getWebSockets()) {
            if (conn.readyState === WebSocket.OPEN) {
              conn.send(diff);
            }
          }
        }

        await this.persist();
        this.lastSyncedStateVectorHash = this.computeStateVectorHash();
      }
    } catch (error) {
      console.warn('Branch invalidation check failed:', error);
    }
  }
```

3c. Call `checkBranchInvalidation()` in the `fetch()` router, after `initializeCrdtIfNeeded()` returns for CRDT endpoints. Add a single call right after the switch statement's CRDT block initialization, before the handler runs. The cleanest approach is to add the check after `initializeCrdtIfNeeded()` completes but before returning the handler result.

Modify the fetch handler at the top of the switch, by adding the invalidation check as a helper call inside each CRDT case. A cleaner approach: extract the invalidation check to run once before the switch for all CRDT paths. Restructure the CRDT cases:

```typescript
      switch (path) {
        // CRDT endpoints — need full Y.Doc initialization
        case '/snapshot':
        case '/apply':
        case '/connect':
        case '/sync':
        case '/flush':
        case '/initialize':
        case '/reload':
          await this.initializeCrdtIfNeeded();
          await this.checkBranchInvalidation();
          break;

        // ... metadata endpoints stay unchanged
      }

      // Now dispatch to the specific handler
      switch (path) {
        case '/snapshot':
          return this.handleSnapshot();
        case '/apply':
          return await this.handleApplyOperations(request);
        // ... etc
      }
```

Alternatively, to minimize diff size, add the invalidation check as a single line after each `initializeCrdtIfNeeded()` call in the existing switch. Since the pattern is consistent, add it only once by refactoring the switch into two passes.

The simplest minimal-diff approach: add `await this.checkBranchInvalidation();` after each `await this.initializeCrdtIfNeeded();` line in the CRDT cases. But this is repetitive. Instead, extract a helper:

```typescript
  /** Initialize CRDT and check for branch invalidation */
  private async initializeAndCheckInvalidation(): Promise<void> {
    await this.initializeCrdtIfNeeded();
    await this.checkBranchInvalidation();
  }
```

Then replace `await this.initializeCrdtIfNeeded();` with `await this.initializeAndCheckInvalidation();` for the CRDT endpoints `/snapshot`, `/apply`, `/connect`, `/sync`, `/flush`, `/initialize` (but NOT `/reload` — that would be circular).

3d. Call `checkBranchInvalidation()` in `alarm()`, after `initializeCrdtIfNeeded()` at line 2517:

```typescript
  async alarm(): Promise<void> {
    await this.restoreSessionInfoFromStorage();
    await this.initializeCrdtIfNeeded();
    await this.checkBranchInvalidation(); // <-- add this line
    // ... rest of alarm handler
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation/workers && pnpm test -- tests/durable-objects/document-session-invalidation.spec.ts`
Expected: PASS (all 6 tests)

**Step 5: Run the full test suite**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation/workers && pnpm test`
Expected: All existing tests still pass; no regressions.

**Step 6: Lint**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation && pnpm lint`
Expected: 0 new errors

**Step 7: Commit**

```bash
cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation
git add workers/tests/durable-objects/document-session-invalidation.spec.ts
git commit -m "test: add DO pull-based KV invalidation tests (red)"
git add workers/src/durable-objects/document-session.ts
git commit -m "feat: add pull-based KV invalidation check to DocumentSession DO"
```

---

### Task 5: Full integration verification and cleanup

**Files:** (no new files — verification and final cleanup only)

**Step 1: Run the complete test suite**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation/workers && pnpm test`
Expected: All tests pass, including the new tests from Tasks 1-4.

**Step 2: Run linting**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation && pnpm lint`
Expected: 0 new lint errors.

**Step 3: Verify the complete file change list**

Run: `cd /Users/chris.yates/src/collaborative-state-system/.worktrees/pull-based-do-invalidation && git diff --name-only main...HEAD`

Expected changed files:
```
docs/plans/2026-03-14-pull-based-do-invalidation.md
workers/src/durable-objects/document-session.ts
workers/src/index.ts
workers/src/routes/merge-api.ts
workers/src/services/branch-invalidation-service.ts
workers/src/services/index.ts
workers/tests/durable-objects/document-session-invalidation.spec.ts
workers/tests/routes/post-merge-invalidation.spec.ts
workers/tests/services/branch-invalidation-service.spec.ts
```

**Step 4: Update PROGRESS.md**

Add an entry documenting the pull-based DO invalidation feature, the design decisions (timestamp over counter, CONFIG_KV reuse, fetch+alarm check points), and the test coverage.
