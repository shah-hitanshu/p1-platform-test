# Test Plan: Pull-Based DO Invalidation After Merge

## Strategy Reconciliation

The agreed testing strategy proposed three test files (~23 tests) across three harnesses: direct service tests, DO mock tests, and integration (route-level) tests. The finalized implementation plan confirms this structure exactly:

- **Harnesses match.** The plan uses the same mock patterns as `document-session-reload.spec.ts` for DO tests, direct import for the service, and vi.mock for route-level integration. No new harnesses need to be built.
- **Interfaces match.** The plan defines `writeBranchInvalidation(kv, branchId)` and `getBranchVersion(kv, branchId)` as the service API, `MergeRouteContext.configKV` as the route threading mechanism, and `checkBranchInvalidation()` as the DO internal method. All are testable through the agreed harnesses.
- **Signal format changed.** The strategy assumed an integer counter; the plan uses a timestamp (`Date.now().toString()`). This is a simplification (no read-before-write) and does not change test structure -- only expected values in assertions.
- **No external dependencies.** KV is mocked in all test layers. No paid APIs or infrastructure access needed.
- **No scope increase.** The plan stays within the agreed feature boundary.

No strategy changes require user approval.

---

## Harness Requirements

All three harnesses already exist in the codebase. No new harnesses need to be built.

| Harness | What it does | Existing reference | Tests that depend on it |
|---|---|---|---|
| **Direct service import** | Import functions from `branch-invalidation-service.ts`, pass a mock `KVNamespace` | Pattern used throughout `tests/services/` | Tests 1-6 |
| **DO mock harness** | Mock `DurableObject` base class, `DurableObjectState`, `KVNamespace`, and global `fetch`; instantiate `DocumentSession` directly | `document-session-reload.spec.ts` | Tests 7-14 |
| **Route mock harness** | Mock service modules and `branch-invalidation-service` via `vi.mock`; call `handleMergeRoutes` directly | `merge-api.spec.ts`, `post-publish-do-reload.spec.ts` | Tests 15-20 |

---

## Test Plan

### Scenario Tests

#### Test 1: Full merge-to-reload lifecycle

- **Name**: After a merge writes new documents, an active DO on the target branch detects the KV signal and reloads its state from PostgreSQL
- **Type**: scenario
- **Harness**: DO mock harness + direct service import
- **Preconditions**: A `DocumentSession` DO is initialized with snapshot `{ title: "Original" }` on `branch-1`. KV has no entry for `branch-version:branch-1`.
- **Actions**:
  1. Call `session.fetch(new Request('http://localhost/snapshot'))` -- returns `{ title: "Original" }`.
  2. Call `writeBranchInvalidation(mockKV, 'branch-1')` to simulate a merge writing the KV signal.
  3. Update `mockFetch` to return `{ title: "Merged Content" }` for the next PostgreSQL init call.
  4. Call `session.fetch(new Request('http://localhost/snapshot'))` again.
- **Expected outcome**: The second snapshot response contains `{ title: "Merged Content" }`. The DO detected the KV timestamp was newer than its last-seen value (0) and reloaded. Source of truth: implementation plan architecture description ("if the KV value is newer than the last-seen value, the DO calls its existing reload logic").
- **Interactions**: KV read, internal HTTP fetch to PostgreSQL (mocked).

#### Test 2: Merge followed by alarm-triggered reload for idle DO

- **Name**: An idle DO with no HTTP requests detects the merge via alarm and reloads
- **Type**: scenario
- **Harness**: DO mock harness + direct service import
- **Preconditions**: A `DocumentSession` DO is initialized on `branch-1`. KV has no entry.
- **Actions**:
  1. Call `session.fetch(new Request('http://localhost/snapshot'))` to initialize.
  2. Call `writeBranchInvalidation(mockKV, 'branch-1')`.
  3. Update `mockFetch` to return new content.
  4. Call `session.alarm()`.
  5. Call `session.fetch(new Request('http://localhost/snapshot'))`.
- **Expected outcome**: The snapshot after the alarm contains the new content. The alarm handler checked KV, found a newer timestamp, and reloaded. Source of truth: plan decision 3 ("The alarm runs every 60 seconds, providing a reasonable upper bound on staleness for idle connections").
- **Interactions**: KV read in alarm, internal HTTP fetch (mocked).

#### Test 3: WebSocket clients receive broadcast after invalidation reload

- **Name**: Connected WebSocket clients receive a Yjs diff when a merge invalidation triggers a reload
- **Type**: scenario
- **Harness**: DO mock harness
- **Preconditions**: DO initialized with content. One mock WebSocket connection in `OPEN` state attached via `getWebSockets()`.
- **Actions**:
  1. Initialize DO via `/snapshot`.
  2. Set KV timestamp newer than last-seen.
  3. Update mock fetch to return different content.
  4. Call `session.fetch(new Request('http://localhost/snapshot'))`.
- **Expected outcome**: `mockWs.send` was called at least once with a `Uint8Array` (Yjs update). Source of truth: plan Task 3 step 3c ("Broadcast diff to all connected WebSocket clients").
- **Interactions**: WebSocket broadcast (mocked).

---

### Integration Tests

#### Test 4: Direct merge execute writes KV invalidation for target branch

- **Name**: A successful direct merge execute writes a branch invalidation signal to CONFIG_KV for the target branch
- **Type**: integration
- **Harness**: Route mock harness
- **Preconditions**: `executeMerge` is mocked to return success. `writeBranchInvalidation` is mocked.
- **Actions**:
  1. Call `handleMergeRoutes` with operation `execute`, body `{ sourceBranchId: 'branch-source', targetBranchId: 'branch-target' }`, and `configKV` set to a mock KV.
- **Expected outcome**: Response status is 200. `writeBranchInvalidation` was called once with `(mockKV, 'branch-target')`. Source of truth: plan Task 2 ("After a successful merge execute, write the invalidation signal for the target branch").
- **Interactions**: Route handler -> service layer (mocked) -> KV write (mocked).

#### Test 5: Merge request execute writes KV invalidation for target branch

- **Name**: Executing a merge request writes a branch invalidation signal for the target branch
- **Type**: integration
- **Harness**: Route mock harness
- **Preconditions**: `getMergeRequest` returns a merge request with `targetBranchId: 'branch-target'`. `executeMerge` returns success.
- **Actions**:
  1. Call `handleMergeRoutes` with `executeRequest: true`, `mergeRequestId: 'mr-1'`.
- **Expected outcome**: Response status is 200. `writeBranchInvalidation` was called with `(mockKV, 'branch-target')`. Source of truth: plan Task 2 step 3d.
- **Interactions**: Route handler -> merge request lookup (mocked) -> merge execute (mocked) -> KV write (mocked).

#### Test 6: Merge with conflict resolution writes KV invalidation

- **Name**: A merge with conflict resolutions writes a branch invalidation signal after success
- **Type**: integration
- **Harness**: Route mock harness
- **Preconditions**: `executeMergeWithResolution` mocked to return success.
- **Actions**:
  1. Call `handleMergeRoutes` with operation `execute`, body including `conflictResolutions: [{ documentId: 'doc-1', strategy: 'take-source' }]`.
- **Expected outcome**: Response status is 200. `writeBranchInvalidation` was called with `(mockKV, 'branch-target')`. Source of truth: plan Task 2 ("After a successful merge execute...either direct or via merge request").
- **Interactions**: Route handler -> resolution service (mocked) -> KV write (mocked).

#### Test 7: Failed merge does not write KV invalidation

- **Name**: When a merge fails, no KV invalidation signal is written
- **Type**: integration
- **Harness**: Route mock harness
- **Preconditions**: `executeMerge` mocked to throw `MergeConflictsError`.
- **Actions**:
  1. Call `handleMergeRoutes` with operation `execute`.
- **Expected outcome**: Response status is 409 (or appropriate error code). `writeBranchInvalidation` was NOT called. Source of truth: plan Task 2 step 1 test ("should NOT write invalidation signal when merge fails").
- **Interactions**: Route handler -> service throws -> no KV write.

#### Test 8: KV write error is swallowed without failing the merge response

- **Name**: If the KV write fails after a successful merge, the merge response still returns 200
- **Type**: integration
- **Harness**: Route mock harness
- **Preconditions**: `executeMerge` returns success. `writeBranchInvalidation` mocked to throw.
- **Actions**:
  1. Call `handleMergeRoutes` with operation `execute`.
- **Expected outcome**: Response status is 200. The merge result is returned despite the KV failure. Source of truth: plan Task 2 step 3c ("errors swallowed") and decision ("KV unavailability should never break normal DO operation").
- **Interactions**: Route handler -> merge succeeds -> KV write fails -> error swallowed.

#### Test 9: configKV is passed from index.ts to merge route context

- **Name**: The worker's fetch handler passes env.CONFIG_KV to the merge route context
- **Type**: integration
- **Harness**: Route mock harness (index.ts level)
- **Preconditions**: Worker env includes `CONFIG_KV` binding.
- **Actions**:
  1. Verify that the `handleMergeRoutes` call in `index.ts` line 1488 includes `configKV: env.CONFIG_KV` in the context object. (This can be verified by inspecting the mock call arguments when `handleMergeRoutes` is mocked at the index.ts level, or by a focused assertion on the route context shape.)
- **Expected outcome**: The `configKV` property on the context passed to `handleMergeRoutes` is the `CONFIG_KV` binding from env. Source of truth: plan Task 2 step 3e ("Pass configKV from index.ts into the merge route context").
- **Interactions**: Worker fetch -> route dispatch -> context threading.

---

### Invariant Tests

#### Test 10: DO never reloads twice for the same KV timestamp

- **Name**: After detecting and processing a KV timestamp, the DO does not reload again on the next request with the same timestamp
- **Type**: invariant
- **Harness**: DO mock harness
- **Preconditions**: KV has `branch-version:branch-1` set to a fixed timestamp. DO is initialized.
- **Actions**:
  1. Call `session.fetch(new Request('http://localhost/snapshot'))` -- triggers initial KV check and reload.
  2. Record mock fetch call count.
  3. Call `session.fetch(new Request('http://localhost/snapshot'))` again with the same KV timestamp.
- **Expected outcome**: Mock fetch call count does not increase on the second request. The DO stored the last-seen timestamp and skipped the reload. Source of truth: plan decision 2 ("the DO reads its branch's KV timestamp; if the KV value is newer...").
- **Interactions**: KV read only (no reload on second call).

#### Test 11: Reload endpoint does NOT trigger KV invalidation check

- **Name**: The `/reload` endpoint does not check KV for branch invalidation (avoids circular reload)
- **Type**: invariant
- **Harness**: DO mock harness
- **Preconditions**: KV has a newer timestamp. DO is initialized.
- **Actions**:
  1. Set KV to a newer timestamp.
  2. Call `session.fetch(new Request('http://localhost/reload', { method: 'POST' }))`.
- **Expected outcome**: The reload executes via its own path. KV.get is NOT called during this request (only the direct reload logic runs). Source of truth: plan Task 3 step 3f ("NOT /reload -- that would be circular").
- **Interactions**: Direct reload only, no KV interaction.

#### Test 12: writeBranchInvalidation never reads before writing

- **Name**: The KV write operation is a pure `put()` with no preceding `get()` call
- **Type**: invariant
- **Harness**: Direct service import
- **Preconditions**: Mock KV namespace.
- **Actions**:
  1. Call `writeBranchInvalidation(mockKV, 'branch-1')`.
- **Expected outcome**: `mockKV.get` was NOT called. `mockKV.put` was called exactly once. Source of truth: plan decision 2 ("A timestamp requires no read-before-write -- just put(Date.now().toString())").
- **Interactions**: None beyond the KV mock.

---

### Boundary and Edge-Case Tests

#### Test 13: KV read error during DO invalidation check does not disrupt normal operation

- **Name**: When KV.get throws during the invalidation check, the DO continues serving the request normally
- **Type**: boundary
- **Harness**: DO mock harness
- **Preconditions**: `mockKV.get` is mocked to throw `new Error('KV read failed')`. DO is initialized.
- **Actions**:
  1. Call `session.fetch(new Request('http://localhost/snapshot'))`.
- **Expected outcome**: Response status is 200. The snapshot is returned from the DO's existing in-memory state. Source of truth: plan Task 3 step 3e ("Errors are swallowed -- KV unavailability should never break normal DO operation").
- **Interactions**: KV read fails, error swallowed.

#### Test 14: CONFIG_KV not bound -- DO operates without invalidation

- **Name**: When CONFIG_KV is not in the environment, the DO functions normally without KV checks
- **Type**: boundary
- **Harness**: DO mock harness
- **Preconditions**: `mockEnv.CONFIG_KV` is `undefined`.
- **Actions**:
  1. Call `session.fetch(new Request('http://localhost/snapshot'))`.
- **Expected outcome**: Response status is 200. No KV interaction occurs. Source of truth: plan Task 3 step 3e ("if (kv === undefined) return").
- **Interactions**: None.

#### Test 15: getBranchVersion returns 0 for non-numeric stored values

- **Name**: If KV contains a non-numeric value for a branch version, getBranchVersion returns 0 (safe default)
- **Type**: boundary
- **Harness**: Direct service import
- **Preconditions**: Mock KV has `branch-version:branch-1` set to `'garbage'`.
- **Actions**:
  1. Call `getBranchVersion(mockKV, 'branch-1')`.
- **Expected outcome**: Returns `0`. Source of truth: plan Task 1 implementation ("Number.isNaN(parsed) ? 0 : parsed").
- **Interactions**: KV read only.

#### Test 16: getBranchVersion returns 0 when no key exists

- **Name**: When no KV entry exists for a branch, getBranchVersion returns 0
- **Type**: boundary
- **Harness**: Direct service import
- **Preconditions**: Mock KV is empty.
- **Actions**:
  1. Call `getBranchVersion(mockKV, 'nonexistent-branch')`.
- **Expected outcome**: Returns `0`. Source of truth: plan Task 1 implementation ("if (value === null) return 0").
- **Interactions**: KV read only.

#### Test 17: configKV is optional on MergeRouteContext

- **Name**: When configKV is undefined on the merge route context, the merge succeeds without writing invalidation
- **Type**: boundary
- **Harness**: Route mock harness
- **Preconditions**: `executeMerge` returns success. `configKV` is not provided in context.
- **Actions**:
  1. Call `handleMergeRoutes` without `configKV` in the context.
- **Expected outcome**: Response status is 200. `writeBranchInvalidation` is NOT called. Source of truth: plan Task 2 step 3c ("if (context.configKV !== undefined)").
- **Interactions**: Route handler -> merge succeeds -> no KV write attempted.

---

### Unit Tests

#### Test 18: writeBranchInvalidation writes correct key format

- **Name**: writeBranchInvalidation writes to KV key `branch-version:{branchId}` with a numeric timestamp value
- **Type**: unit
- **Harness**: Direct service import
- **Preconditions**: Mock KV namespace.
- **Actions**:
  1. Call `writeBranchInvalidation(mockKV, 'branch-abc-123')`.
- **Expected outcome**: `mockKV.put` was called with key `'branch-version:branch-abc-123'` and a numeric string value close to `Date.now()`. Source of truth: plan Task 1 ("Key format: branch-version:{branchId}, Value format: numeric timestamp string").
- **Interactions**: KV put only.

#### Test 19: writeBranchInvalidation timestamp is close to Date.now()

- **Name**: The timestamp written by writeBranchInvalidation is within a small window around the current time
- **Type**: unit
- **Harness**: Direct service import
- **Preconditions**: Mock KV namespace.
- **Actions**:
  1. Record `Date.now()` before.
  2. Call `writeBranchInvalidation(mockKV, 'branch-1')`.
  3. Record `Date.now()` after.
- **Expected outcome**: The written value (parsed as number) is >= before and <= after. Source of truth: plan Task 1 implementation ("Date.now().toString()").
- **Interactions**: KV put only.

#### Test 20: Independent KV keys per branch

- **Name**: writeBranchInvalidation and getBranchVersion use independent keys per branch ID
- **Type**: unit
- **Harness**: Direct service import
- **Preconditions**: Mock KV namespace.
- **Actions**:
  1. Call `writeBranchInvalidation(mockKV, 'branch-a')`.
  2. Call `writeBranchInvalidation(mockKV, 'branch-b')`.
  3. Call `getBranchVersion(mockKV, 'branch-a')`, `getBranchVersion(mockKV, 'branch-b')`, `getBranchVersion(mockKV, 'branch-c')`.
- **Expected outcome**: branch-a and branch-b return values > 0. branch-c returns 0. Source of truth: plan Task 1 test ("should use independent keys per branch").
- **Interactions**: KV put + get.

---

## Coverage Summary

### Areas Covered

| Area | Tests | Coverage |
|---|---|---|
| **Branch invalidation service** (KV read/write) | 12, 15, 16, 18, 19, 20 | Full: write, read, key format, edge cases (null, garbage), independence |
| **Merge route KV integration** (post-merge signal) | 4, 5, 6, 7, 8, 9, 17 | Full: direct merge, merge request, conflict resolution, failure, KV error, missing configKV, configKV threading |
| **DO invalidation check** (pull-based reload) | 1, 2, 3, 10, 11, 13, 14 | Full: fetch-triggered, alarm-triggered, WebSocket broadcast, idempotency, /reload exclusion, KV errors, missing CONFIG_KV |
| **End-to-end scenario** (merge -> KV -> DO -> reload -> broadcast) | 1, 2, 3 | Covered via composed mocks |

### Areas Explicitly Excluded

| Area | Reason | Risk |
|---|---|---|
| **webSocketMessage() invalidation check** | Plan decision 3 explicitly defers this ("not in this initial implementation"). Tests do not cover per-keystroke KV checks. | Low -- alarm provides 60s upper bound; HTTP fetch covers active requests. |
| **Real KV latency / eventual consistency** | KV is mocked. Real KV has ~60s global propagation delay. | Low -- the feature is designed to tolerate this (pull-based, best-effort). |
| **Concurrent merge race conditions** | Plan decision 2 explains timestamps eliminate the race. Mocked tests cannot reproduce true concurrency. | Low -- timestamp approach is inherently idempotent. |
| **Performance benchmarks** | No performance-critical path introduced. KV read is one additional async call per fetch/alarm. | Low -- KV reads are fast (<1ms in-region). If latency becomes an issue, throttling is a planned follow-up. |
| **Terraform / wrangler.jsonc changes** | Plan decision 1 reuses existing `CONFIG_KV` binding. No infra changes needed. | None. |
