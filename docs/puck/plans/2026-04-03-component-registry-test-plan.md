# Component Registry — Test Plan

**Implementation plan:** `docs/plans/2026-04-03-component-registry.md`  
**Agreed testing strategy:** Medium coverage — all LLM-facing surfaces, all field types, hash change detection, filtering, MCP tools (missing-registry case, registry-path guard).

---

## Harness Requirements

### Harness A — Direct API harness (vitest, puck-css-integration worktree)

**What it does:** Calls `serializeField`, `hashDescriptor`, `extractDescriptors`, `buildRegistryIndex` directly in vitest — no React, no CSS client, no network.

**Exposes:** Imported function signatures only. Tests call exported functions and assert on return values.

**Complexity:** Trivial — functions are pure. Harness is implicit (standard vitest).

**Tests that use it:** Tests 1–10 (all `componentRegistry.ts` unit and invariant tests).

---

### Harness B — Programmatic hook harness (`@testing-library/react`, puck-css-integration worktree)

**What it does:** Renders `useComponentRegistry` inside a `CSSPuckContext.Provider` whose `client` is a vitest mock. Asserts on hook return state and mock call arguments.

**Exposes:** `renderHook`, `waitFor`, `result.current` (status, error, result), mock spy assertions on `client.documents.list`, `client.documents.create`, `client.versions.getLatest`, `client.versions.create`.

**Complexity:** Low — identical pattern to existing `useAutoSave` tests in the repo.

**Tests that use it:** Tests 11–16 (`useComponentRegistry` integration tests).

---

### Harness C — Plugin render harness (`@testing-library/react`, puck-css-integration worktree)

**What it does:** Renders the Puck CSS plugin panel with a controlled document list. Asserts on DOM presence/absence.

**Exposes:** `screen.getByText`, `screen.queryByText` DOM assertions.

**Complexity:** Low — identical pattern to existing `tombstone-filtering.test.tsx`.

**Tests that use it:** Tests 17–18 (document-list filtering).

---

### Harness D — MCP tool handler harness (vitest, collaborative-state-system)

**What it does:** Stubs `fetch` globally, instantiates `McpApiClient` and `createToolHandlers`, calls handlers directly, inspects `ToolResult` and fetch call arguments.

**Exposes:** `result.isError`, `result.content[0].text`, `mockFetch.mock.calls` (URL strings, request bodies).

**Complexity:** Low — identical pattern to existing `api-client.spec.ts` and `tools.spec.ts`.

**Tests that use it:** Tests 19–30 (MCP api-client and MCP tool tests).

---

## Test Plan

### Scenario Tests

---

**Test 1 — Full registration flow: new site with two components writes registry to CSS**

- **Type:** scenario
- **Harness:** B (hook harness)
- **Preconditions:** `client.documents.list` returns `[]` (empty registry). `client.documents.create` returns a mock document with a stable UUID. `client.versions.create` resolves successfully.
- **Actions:** Render `useComponentRegistry({ puckConfig: twoComponentConfig })` inside a `CSSPuckContext.Provider`.
- **Expected outcome:**
  - Hook transitions through `'registering'` → `'registered'` (assert via `waitFor`).
  - `client.documents.create` called with `path: '/_registry/components/HeroBlock'` and `path: '/_registry/components/CardBlock'`.
  - `client.documents.create` called with `path: '/_registry/index'`.
  - `client.versions.create` called at least 3 times (one per component + index).
  - `result.current.result.total` equals 2.
  - `result.current.result.registered` equals 2.
  - `result.current.error` is null.
- **Source of truth:** Implementation plan §Task 6, §Hash-check algorithm.
- **Interactions:** `extractDescriptors`, `buildRegistryIndex`, CSS documents API (mocked).

---

**Test 2 — Re-open editor with unchanged config: no writes occur**

- **Type:** scenario
- **Harness:** B (hook harness)
- **Preconditions:** `client.documents.list` returns one existing component doc and one index doc. `client.versions.getLatest` returns a snapshot whose `descriptorHash` matches the hash produced by `extractDescriptors` for the same config.
- **Actions:** Render `useComponentRegistry({ puckConfig: singleComponentConfig })`.
- **Expected outcome:**
  - Hook reaches `'registered'`.
  - `client.versions.create` is **never** called (all hashes matched; index already exists).
  - `result.current.result.skipped` equals 1.
  - `result.current.result.registered` equals 0.
- **Source of truth:** Implementation plan §Decision Log ("Why is the index only written when something changed…"), §Hash-check algorithm step 3.
- **Interactions:** `hashDescriptor`, `extractDescriptors`, CSS versions API (mocked).

---

**Test 3 — Component field change triggers a new version write**

- **Type:** scenario
- **Harness:** B (hook harness)
- **Preconditions:** `client.documents.list` returns an existing component doc. `client.versions.getLatest` returns a snapshot with `descriptorHash: 'stale-hash'` (does not match current config hash).
- **Actions:** Render `useComponentRegistry({ puckConfig: configWithModifiedField })`.
- **Expected outcome:**
  - `client.versions.create` called with `documentId` matching the existing doc's UUID (not a new document create).
  - `client.documents.create` **not** called for the component (doc already exists).
  - `client.documents.create` called for index (registered > 0).
  - Hook reaches `'registered'`.
- **Source of truth:** Implementation plan §Task 6 step 3 ("if storedHash !== descriptor.descriptorHash → create new version on existing document").
- **Interactions:** CSS documents API, CSS versions API.

---

**Test 4 — Agent calls `list_components` then `create_page` with discovered components**

- **Type:** scenario
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** First fetch returns 1 component doc (`HeroBlock`). Second fetch returns that component's snapshot (valid `ComponentDescriptor`). Third fetch (for `create_page`) returns a 201 document-creation response.
- **Actions:**
  1. Call `handlers.list_components({ site_id: 'site-1', branch_id: 'branch-1' })`.
  2. Inspect output to confirm `HeroBlock` is discoverable.
  3. Call `handlers.create_page({ site_id: 'site-1', branch_id: 'branch-1', document_path: '/landing', components: [{ type: 'HeroBlock', props: { title: 'Welcome' } }] })`.
- **Expected outcome:**
  - `list_components` result: `isError` is falsy; text contains `'HeroBlock'`.
  - `create_page` result: `isError` is falsy; text contains `'/landing'`.
  - `create_page` POST body has `snapshot.content[0].type === 'HeroBlock'` and `snapshot.content[0].props.id` is a 26-character ULID string.
  - Only 3 total fetch calls (1 list + 1 version + 1 create).
- **Source of truth:** Implementation plan §Task 11, §Task 12, §Puck Data structure.
- **Interactions:** `McpApiClient.listDocuments`, `McpApiClient.getDocumentLatestVersion`, `McpApiClient.createDocument`.

---

**Test 5 — Branch switch re-registers components against new branch**

- **Type:** scenario
- **Harness:** B (hook harness)
- **Preconditions:** `client.documents.list` always returns `[]`. Hook initially rendered with `branchId: 'branch-main'`, then re-rendered with `branchId: 'branch-staging'` via context update.
- **Actions:** Render hook, wait for first registration, update context to new `branchId`, wait for second registration.
- **Expected outcome:**
  - `client.documents.list` called twice, the second time producing URLs/args for `'branch-staging'`.
  - Hook reaches `'registered'` both times without error.
- **Source of truth:** Implementation plan §Decision Log ("Why does `useComponentRegistry` depend on `[puckConfig, siteId, branchId]`?").
- **Interactions:** `useEffect` dependency array, CSS client mock.

---

### Integration Tests

---

**Test 6 — `extractDescriptors` → `useComponentRegistry` → CSS write: snapshot content is valid `ComponentDescriptor`**

- **Type:** integration
- **Harness:** B (hook harness)
- **Preconditions:** `client.documents.list` returns `[]`. Mock `client.versions.create` captures the `snapshot` argument.
- **Actions:** Render hook with a config containing one component with a `select` field, `defaultProps`, and `ai.instructions`.
- **Expected outcome:**
  - The `snapshot` argument passed to `client.versions.create` for the component is a valid `ComponentDescriptor`:
    - `name` matches the component key.
    - `fields` contains exactly one entry of type `'select'` with correct `options`.
    - `defaultProps` matches the config's `defaultProps`.
    - `ai.instructions` matches the config's `ai.instructions`.
    - `descriptorHash` is a non-empty hex string.
    - `provenance` is `'site'`.
    - `registeredAt` matches ISO 8601.
- **Source of truth:** Implementation plan §Data Model (`ComponentDescriptor`), §Task 3.
- **Interactions:** `serializeField`, `extractDescriptors`, `hashDescriptor`, `useComponentRegistry`.

---

**Test 7 — `list_components` fetches version by document UUID, not encoded path**

- **Type:** integration
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** `listDocuments` returns one doc with `id: 'doc-uuid-123'` and `path: '/_registry/components/HeroBlock'`. `getDocumentLatestVersion` returns a valid snapshot.
- **Actions:** Call `handlers.list_components(...)`.
- **Expected outcome:**
  - Second fetch URL contains `/documents/doc-uuid-123/versions/latest`.
  - Second fetch URL does **not** contain `%2F` (no encoded path used as document ID).
- **Source of truth:** Implementation plan §Task 10 "IMPORTANT: documentId must be a UUID".
- **Interactions:** `McpApiClient.listDocuments`, `McpApiClient.getDocumentLatestVersion`.

---

**Test 8 — `createDocument` sends a single atomic POST (document + version together)**

- **Type:** integration
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** Mock fetch returns a valid 201 response with `{ document: {...}, version: {...} }`.
- **Actions:** Call `handlers.create_page(...)` with two components.
- **Expected outcome:**
  - `fetch` called exactly once (not create-then-version separately).
  - POST URL is `/api/sites/{siteId}/branches/{branchId}/documents` (no extra path segments).
  - Request body contains both `path` and `snapshot` fields.
- **Source of truth:** Implementation plan §Task 10 "creates both the document and its first version atomically".
- **Interactions:** `McpApiClient.createDocument`, `create_page` tool handler.

---

**Test 9 — `/_registry/` documents excluded from `CSSPlugin` panel while normal docs remain visible**

- **Type:** integration
- **Harness:** C (plugin render harness)
- **Preconditions:** Document list contains `/home`, `/about`, `/_registry/index`, `/_registry/components/HeroBlock`.
- **Actions:** Render `createCSSPlugin(...)` with the mixed document list.
- **Expected outcome:**
  - `screen.getByText('/home')` succeeds.
  - `screen.getByText('/about')` succeeds.
  - `screen.queryByText('/_registry/index')` returns null.
  - `screen.queryByText('/_registry/components/HeroBlock')` returns null.
- **Source of truth:** Implementation plan §Task 7; user description ("hiding them from the list of documents").
- **Interactions:** `CSSPlugin.tsx` filter, `createCSSPlugin`.

---

**Test 10 — `CSSPlugin` still hides archived documents independently of registry filter**

- **Type:** integration
- **Harness:** C (plugin render harness)
- **Preconditions:** Document list: `/home` (live), `/old` (archived), `/_registry/index` (registry).
- **Actions:** Render plugin.
- **Expected outcome:**
  - `/home` visible.
  - `/old` not visible (archived).
  - `/_registry/index` not visible (registry).
- **Source of truth:** Implementation plan §Task 7 ("Before: `!doc.archived`; After: `!doc.archived && !doc.path.startsWith('/_registry/')`").
- **Interactions:** Compound filter in `CSSPlugin.tsx`.

---

**Test 11 — MCP handler registers `list_components` and `create_page` (tool count = 13)**

- **Type:** integration
- **Harness:** D (MCP tool handler harness, via `tools.spec.ts` and `mcp-handler.spec.ts`)
- **Preconditions:** Fresh import of `getToolDefinitions` and `createMcpServer`.
- **Actions:**
  1. Call `getToolDefinitions()` and assert length.
  2. Call `createMcpServer(...)` and assert registered tool names.
- **Expected outcome:**
  - `getToolDefinitions()` returns exactly 13 items.
  - The list includes `'list_components'` and `'create_page'`.
  - `createMcpServer` registers exactly 13 tools.
- **Source of truth:** Implementation plan §Task 13.
- **Interactions:** `tools.ts`, `mcp-handler.ts`, MCP SDK registration.

---

### Invariant Tests

---

**Test 12 — `hashDescriptor` always excludes `descriptorHash` and `registeredAt` from hash input**

- **Type:** invariant
- **Harness:** A (direct API harness)
- **Preconditions:** None.
- **Actions:** Hash a descriptor, then hash identical descriptor with different `descriptorHash` and `registeredAt` values.
- **Expected outcome:** Both calls return the same string. (Hashing is stable across re-registrations.)
- **Source of truth:** Implementation plan §Task 2 test "excludes descriptorHash and registeredAt".
- **Interactions:** `hashDescriptor`.

---

**Test 13 — `hashDescriptor` is stable across JSON key ordering**

- **Type:** invariant
- **Harness:** A (direct API harness)
- **Preconditions:** None.
- **Actions:** Hash two descriptors that are logically identical but whose `fields` array entries have keys in different insertion orders.
- **Expected outcome:** Both hashes are equal. (Key-sorting canonicalization works.)
- **Source of truth:** Implementation plan §Task 2 test "is stable across JSON key ordering", `sortKeys` implementation.
- **Interactions:** `hashDescriptor`, `sortKeys`.

---

**Test 14 — `extractDescriptors` always includes `__root__` when root is present, always omits it when root is absent**

- **Type:** invariant
- **Harness:** A (direct API harness)
- **Preconditions:** None.
- **Actions:** Call `extractDescriptors` with and without a `root` key in the config.
- **Expected outcome:**
  - With `root`: result contains exactly one entry with `name === '__root__'` and `label === 'Page Root'`.
  - Without `root`: result contains no entry with `name === '__root__'`.
- **Source of truth:** Implementation plan §Task 3, §Decision Log ("Why extract `root` as `__root__`?").
- **Interactions:** `extractDescriptors`.

---

**Test 15 — All `ComponentDescriptor` instances produced by `extractDescriptors` have valid `descriptorHash` and ISO `registeredAt`**

- **Type:** invariant
- **Harness:** A (direct API harness)
- **Preconditions:** A config with 3 different component types.
- **Actions:** Call `extractDescriptors`.
- **Expected outcome:** For every descriptor: `descriptorHash` is a non-empty hex string; `registeredAt` matches `/^\d{4}-\d{2}-\d{2}T/`.
- **Source of truth:** Implementation plan §Task 3 invariant test.
- **Interactions:** `extractDescriptors`, `hashDescriptor`.

---

**Test 16 — `create_page` always adds a 26-character ULID `id` to every component's props**

- **Type:** invariant
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** Mock fetch returns a valid 201 response.
- **Actions:** Call `handlers.create_page` with 3 components (all to content, none to zones).
- **Expected outcome:**
  - `snapshot.content` has 3 entries.
  - Every entry has `props.id` that is a string of exactly 26 characters.
  - All three IDs are distinct.
- **Source of truth:** Implementation plan §Task 12 intro ("Each component instance requires a unique `id` in props"), §ULID generation.
- **Interactions:** `generateULID`, `create_page` tool handler.

---

### Boundary and Edge-Case Tests

---

**Test 17 — `extractDescriptors` with zero components returns empty array**

- **Type:** boundary
- **Harness:** A (direct API harness)
- **Preconditions:** None.
- **Actions:** Call `extractDescriptors({ components: {} })`.
- **Expected outcome:** Returns `[]`.
- **Source of truth:** Implementation plan §Task 3 "handles empty components config gracefully".
- **Interactions:** `extractDescriptors`.

---

**Test 18 — `serializeField` covers all field types: text, textarea, number, select, radio, array (nested), object (nested), custom**

- **Type:** boundary
- **Harness:** A (direct API harness)
- **Preconditions:** None.
- **Actions:** Call `serializeField` once per field type. For `array` and `object`, use a nested sub-field.
- **Expected outcome:** Each call returns the correct `SerializedField` shape per the `Data Model` spec. `array` result has `arrayFields` as an array (not a record). `object` result has `objectFields` as an array. `custom` strips non-serializable keys. `number` includes `min`/`max` only when present.
- **Source of truth:** Implementation plan §Task 1 tests, §Data Model (`SerializedField`).
- **Interactions:** `serializeField`.

---

**Test 19 — `serializeField` preserves `ai` metadata on any field type**

- **Type:** boundary
- **Harness:** A (direct API harness)
- **Preconditions:** None.
- **Actions:** Call `serializeField` with a `text` field carrying `ai: { instructions: 'Keep short', required: true }`.
- **Expected outcome:** Result contains `ai: { instructions: 'Keep short', required: true }`.
- **Source of truth:** Implementation plan §Task 1 test "preserves ai metadata when present", §Data Model (`FieldAiMeta`).
- **Interactions:** `serializeField`.

---

**Test 20 — `extractDescriptors` with upstream: shared/site-only/overridden provenance classification**

- **Type:** boundary
- **Harness:** A (direct API harness)
- **Preconditions:** Site config has `SharedBlock` (matches upstream), `SiteOnlyBlock` (not in upstream), `ModifiedBlock` (in upstream but different schema).
- **Actions:** Call `extractDescriptors(siteConfig, upstreamConfig)`.
- **Expected outcome:**
  - `SharedBlock.provenance === 'upstream'`; `upstreamHash` is set.
  - `SiteOnlyBlock.provenance === 'site'`; `upstreamHash` is undefined.
  - `ModifiedBlock.provenance === 'overridden'`; `upstreamHash` is set and differs from `descriptorHash`.
- **Source of truth:** Implementation plan §Task 3 "extractDescriptors with upstream" tests.
- **Interactions:** `extractDescriptors`, `hashDescriptor`.

---

**Test 21 — `useComponentRegistry` returns `'error'` status and non-null `error` when CSS list call throws**

- **Type:** boundary
- **Harness:** B (hook harness)
- **Preconditions:** `client.documents.list` rejects with `new Error('Network error')`.
- **Actions:** Render hook.
- **Expected outcome:**
  - `result.current.status === 'error'`.
  - `result.current.error.message === 'Network error'`.
  - No unhandled promise rejection.
- **Source of truth:** Implementation plan §Task 6 error path ("fail silently (log warning, editor still opens)").
- **Interactions:** `useComponentRegistry` error branch.

---

**Test 22 — `list_components` with empty registry returns graceful message, not error**

- **Type:** boundary
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** `listDocuments` returns `{ documents: [] }`.
- **Actions:** Call `handlers.list_components(...)`.
- **Expected outcome:**
  - `result.isError` is falsy.
  - `result.content[0].text` contains `'No components registered'`.
- **Source of truth:** Implementation plan §Task 11 "returns a graceful message when no components are registered".
- **Interactions:** `list_components` empty-registry branch.

---

**Test 23 — `create_page` rejects `document_path` starting with `/_registry/`**

- **Type:** boundary
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** None (no fetch needed).
- **Actions:** Call `handlers.create_page({ document_path: '/_registry/components/Foo', ... })`.
- **Expected outcome:**
  - `result.isError === true`.
  - `result.content[0].text` contains `'_registry'`.
  - `fetch` is **never** called.
- **Source of truth:** Implementation plan §Task 12 validation guard.
- **Interactions:** `create_page` path guard.

---

**Test 24 — `create_page` places zone components in `zones` object keyed by `parentId:zone`**

- **Type:** boundary
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** Mock fetch returns a valid 201 response.
- **Actions:** Call `handlers.create_page` with a mix: one top-level component, one with `zone: 'mainSlot'` and `parentId: 'PARENT-123'`.
- **Expected outcome:**
  - `snapshot.content` has 1 entry (top-level only).
  - `snapshot.zones['PARENT-123:mainSlot']` has 1 entry.
  - Zone component has a 26-character ULID `id` in its props.
- **Source of truth:** Implementation plan §Task 12, §Puck Data structure.
- **Interactions:** `create_page` zone-routing logic, `generateULID`.

---

**Test 25 — `create_page` returns `isError: true` when backend returns 409 (path conflict)**

- **Type:** boundary
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** Mock fetch returns `{ ok: false, status: 409, json: ... }` with `{ error: 'Document already exists at this path' }`.
- **Actions:** Call `handlers.create_page(...)`.
- **Expected outcome:**
  - `result.isError === true`.
  - `result.content[0].text` contains `'already exists'` or a similar error message from the API.
- **Source of truth:** Implementation plan §Task 12 test "returns isError true when document creation fails".
- **Interactions:** `McpApiClient.createDocument`, `create_page` error path.

---

**Test 26 — `list_components` returns `isError: true` on API 500**

- **Type:** boundary
- **Harness:** D (MCP tool handler harness)
- **Preconditions:** First fetch returns `{ ok: false, status: 500 }`.
- **Actions:** Call `handlers.list_components(...)`.
- **Expected outcome:** `result.isError === true`.
- **Source of truth:** Implementation plan §Task 11 "returns isError true on API failure".
- **Interactions:** `McpApiClient.listDocuments` error path, `formatError`.

---

**Test 27 — `listDocuments` appends `pathPrefix` query parameter when provided; omits it when absent**

- **Type:** boundary
- **Harness:** D (MCP tool handler harness, via `api-client.spec.ts`)
- **Preconditions:** Mock fetch resolves successfully.
- **Actions:**
  1. Call `client.listDocuments('site-1', 'branch-1', { pathPrefix: '/_registry/components/' })`. Assert URL contains `pathPrefix=%2F_registry%2Fcomponents%2F`.
  2. Call `client.listDocuments('site-1', 'branch-1')` (no options). Assert URL does not contain `pathPrefix`.
- **Expected outcome:** URLs match assertions above.
- **Source of truth:** Implementation plan §Task 9 tests.
- **Interactions:** `McpApiClient.listDocuments`, URL construction.

---

**Test 28 — `buildRegistryIndex` produces correct `componentNames` and `provenance` map**

- **Type:** unit
- **Harness:** A (direct API harness)
- **Preconditions:** None.
- **Actions:** Call `buildRegistryIndex([heroDesc, cardDesc], 'site-1', 'branch-1')`.
- **Expected outcome:**
  - `index.siteId === 'site-1'`.
  - `index.branchId === 'branch-1'`.
  - `index.componentNames` equals `['HeroBlock', 'CardBlock']` (order preserved).
  - `index.provenance` equals `{ HeroBlock: 'site', CardBlock: 'upstream' }`.
  - `index.updatedAt` matches ISO 8601.
- **Source of truth:** Implementation plan §Task 4.
- **Interactions:** `buildRegistryIndex`.

---

### Regression Test

---

**Test 29 — Pre-existing puck-css tests all pass after `CSSPlugin.tsx` filter change**

- **Type:** regression
- **Harness:** A+C (vitest full suite)
- **Preconditions:** All pre-existing `packages/puck-css/src/__tests__/` tests passing on `main`.
- **Actions:** Run `npx vitest run packages/puck-css/src/__tests__/` in the worktree.
- **Expected outcome:** All pre-existing tests pass. No new failures introduced by the `!doc.path.startsWith('/_registry/')` addition to `CSSPlugin.tsx`.
- **Source of truth:** Implementation plan §Task 7 "Run full puck-css suite to confirm no regressions".
- **Interactions:** `CSSPlugin.tsx` filter, all existing document-list consumers.

---

**Test 30 — Pre-existing mcp-server tests all pass after tool registration changes**

- **Type:** regression
- **Harness:** D (vitest full suite, collaborative-state-system)
- **Preconditions:** All pre-existing `workers/mcp-server/tests/` tests passing on main.
- **Actions:** Run `npx vitest run workers/mcp-server/` from `collaborative-state-system`.
- **Expected outcome:** All pre-existing tests pass. Tool-count assertions updated to 13 pass. No other tests broken by the new tool additions.
- **Source of truth:** Implementation plan §Task 13 "Run all mcp-server tests".
- **Interactions:** `mcp-handler.ts`, `tools.ts`, all existing tool handlers.

---

## Coverage Summary

### Covered

| Area | Tests |
|------|-------|
| `serializeField` — all 8 field types | 18, 19 |
| `hashDescriptor` — determinism, mutation, key-order stability, self-exclusion | 12, 13 |
| `extractDescriptors` — root as `__root__`, label fallback, field serialization, defaultProps, hash/timestamp, provenance (site/upstream/overridden), empty config, absent root | 14, 15, 17, 20 |
| `buildRegistryIndex` — all output fields | 28 |
| `useComponentRegistry` — new-doc write, hash-match skip, hash-mismatch update, error handling, `onRegistered` callback, branch switch | 1, 2, 3, 5, 21 |
| `useComponentRegistry` — snapshot content correctness end-to-end | 6 |
| `CSSPlugin` registry filter — hides registry, preserves archived filter | 9, 10 |
| `McpApiClient.listDocuments` — pathPrefix/no-pathPrefix | 27 |
| `McpApiClient.getDocumentLatestVersion` — uses document UUID not encoded path | 7 |
| `McpApiClient.createDocument` — atomic single POST | 8 |
| `list_components` — normal result format, empty registry, API failure, UUID-based version fetch | 4 (step 1), 7, 22, 26 |
| `create_page` — component ID generation, zone routing, registry-path guard, path conflict error, atomic creation | 4 (step 3), 16, 23, 24, 25 |
| Tool registration count (13 tools) | 11 |
| End-to-end agent workflow (list → create) | 4 |
| Regressions — puck-css and mcp-server | 29, 30 |

### Explicitly Excluded

| Area | Reason |
|------|--------|
| Real HTTP calls against a running CSS backend | Strategy chose vitest mocks; network integration tests are out of scope for medium coverage. Risk: the `pathPrefix` query-parameter encoding may differ from what the backend actually accepts — low risk given the plan documents the existing `ListDocumentsOptions` support. |
| Admin UI registry filtering (if separate from `CSSPlugin`) | Plan limits filtering to `CSSPlugin.tsx`; no separate admin UI surface identified. |
| Hot-module-reload re-registration | Explicitly out of scope per plan §Out of Scope. |
| Registry cleanup / tombstoning of removed components | Explicitly out of scope per plan §Out of Scope. |
| Performance benchmarks | No performance-critical path identified; N+1 calls in `list_components` acknowledged in plan as acceptable. |
| Visual browser snapshots | No UI rendering beyond `@testing-library/react` DOM assertions needed; all surfaces are text-based or DOM-accessible. |
