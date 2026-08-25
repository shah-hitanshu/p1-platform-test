# Site Export/Import Test Plan (PROPOSAL-013, PCC-3249)

**Implementation plan:** `docs/plans/2026-05-27-site-export-import-bundle.md`
**Agreed strategy fidelity:** Medium

---

## Harness Requirements

### H1 — Vitest unit harness with service mocks (exists, used by all unit tests)

Standard Vitest harness already in use by the project. Each service and handler test file uses `vi.mock(...)` to replace database calls and service dependencies. The `query` function in `workers/src/db` is mocked; individual service functions are replaced with `vi.fn()` stubs. No new harness infrastructure needed.

- **Exposes:** Service function calls, HTTP response status and JSON body.
- **Complexity:** None — follows established patterns in `workers/tests/`.
- **Dependencies:** All unit tests (items 1–23 below).

### H2 — Integration harness with real PostgreSQL (exists, extend)

Already used by `soft-delete.integration.spec.ts`, `branch-service.integration.spec.ts`, and `agent-auth-flow.integration.spec.ts`. Creates a real `postgres.Sql` connection to the Docker container (`css-postgres`), wraps it in a `DatabaseConnection`, and calls `setDatabaseInstance`. Site cleanup via `afterAll`.

- **Exposes:** Real DB read-back of created rows (sites, branches, documents, versions, checkpoints, import_id_maps).
- **Complexity:** Low — follow existing patterns exactly.
- **Dependencies:** Items 24–31.

### H3 — ZIP content harness (new, low cost)

Uses `fflate`'s `unzipSync` inside test code to decompress a real ZIP produced by the export service (or a ZIP assembled inline in tests), then reads individual files as `Uint8Array` and decodes them to strings. This is 4–6 lines per test; no wrapper class needed.

- **Exposes:** `bundle.json`, `site.json`, `branches.json`, `documents/{path}/meta.json`, `documents/{path}/versions.jsonl`, `documents/{path}/publish_checkpoints.jsonl`.
- **Complexity:** Minimal — inline in integration tests using `fflate` (already a dependency after Task 1).
- **Dependencies:** Items 24, 25, 26, 27, 29.

---

## Test Plan

### Scenario Tests

---

**Test 1**

- **Name:** Full export-then-import round-trip preserves site name, branches, documents, and published version
- **Type:** scenario
- **Harness:** H2 + H3
- **Preconditions:** Docker PostgreSQL running, migration 038 applied. Two empty sites: `source-site` (with one document `home`, one published version on main) and `target-site` (empty). `CONFIG_KV` mock for import.
- **Actions:**
  1. Call `selectVersionsForDocument` for `source-site/home/main` — verify 1 version returned with `isPublished: true`.
  2. Assemble a ZIP bundle manually using `zipSync` following the bundle format spec (bundle.json, site.json, branches.json, documents/home/meta.json, versions.jsonl, publish_checkpoints.jsonl).
  3. Compute real SHA-256 hashes for all files; embed them in `bundle.json`.
  4. Call `handleSiteImportRoute` with the ZIP as multipart/form-data targeting `target-site`.
  5. Read back DB state: document exists on `target-site`, version exists, checkpoint exists (publish type).
- **Expected outcome:** Response 200 with `importKey` and `documentCount: 1`. DB read-back confirms: `app.documents` has 1 row for `target-site` with path `home`; `app.document_versions` has 1 row for that document; `app.checkpoints` has 1 row with `checkpoint_type = 'publish'`; `app.checkpoint_documents` links them. Source: PROPOSAL-013 import pipeline, task plan Task 5.
- **Interactions:** `bundle-import-service` → `document-service` → `document-version-service` → PostgreSQL.

---

**Test 2**

- **Name:** Import of a bundle with two non-main branches creates both branches on the target
- **Type:** scenario
- **Harness:** H2 + H3
- **Preconditions:** Empty target site. ZIP bundle with `branches.json` containing `main` + `feature-branch`.
- **Actions:**
  1. Build ZIP with two branches in `branches.json`, no documents.
  2. Call `handleSiteImportRoute` with a mocked `validateBundleManifest` that passes.
  3. Read `app.branches` for the target site.
- **Expected outcome:** 200 response. DB confirms 2 branches: `main` (pre-existing) and `feature-branch` (created by import). Source: plan Task 5 branch phase, `branchNameToTargetId` map.
- **Interactions:** `handleSiteImportRoute` → `createBranch` → PostgreSQL.

---

**Test 3**

- **Name:** Re-running import with a partially completed KV manifest resumes from where it left off without duplicating data
- **Type:** scenario
- **Harness:** H2 (real KV mock using in-memory map, real DB)
- **Preconditions:** Import partially completed: KV contains progress with `completedPhases: ['site', 'branches']`. Target site has branches but no documents.
- **Actions:**
  1. Pre-populate KV with a progress manifest showing site + branches complete.
  2. Call `handleSiteImportRoute` with a valid ZIP containing one document.
  3. Check that `updateSite` and `createBranch` were NOT called again.
  4. Check that the document was created.
- **Expected outcome:** 200. Only the document phase runs. No duplicate branches or site updates. Source: plan "Idempotency" / KV progress, `hasCompletedPhase` logic.
- **Interactions:** `getImportProgress` (KV) → phase skip logic → `createDocument`.

---

**Test 4**

- **Name:** Export of a site with three versions on main includes only the published version and the unpublished draft, not intermediate unpublished versions
- **Type:** scenario
- **Harness:** H2 + H3
- **Preconditions:** Real site with 3 versions on main: v1 (unpublished), v2 (published), v3 (unpublished draft).
- **Actions:**
  1. Create site, main branch, document.
  2. Create v1 via `createDocumentVersion`, v2 with a publish checkpoint via direct SQL, v3 via `createDocumentVersion`.
  3. Call `selectVersionsForDocument(docId, mainBranchId, true)`.
- **Expected outcome:** Returns 2 entries: v2 (isPublished=true) and v3 (isPublished=false). v1 is excluded. Source: PROPOSAL-013 version selection logic, plan Task 2.
- **Interactions:** `selectVersionsForDocument` → `query(document_versions + checkpoint_documents)` → `reconstructVersionSnapshot`.

---

**Test 5**

- **Name:** Export route writes ZIP to R2 and returns a presigned download URL
- **Type:** scenario
- **Harness:** H1 (mocked R2, mocked services)
- **Preconditions:** All service mocks set up. `R2_BUNDLES.put` spy. `signR2GetUrl` returns a fake presigned URL.
- **Actions:**
  1. Call `handleSiteExportRoute(GET, {siteId: 'site-1', principal}, env)`.
  2. Inspect `R2_BUNDLES.put` call args and the response body.
- **Expected outcome:** `R2_BUNDLES.put` called once with a key matching `site-1/{timestamp}.zip` and `contentType: 'application/zip'`. Response 200 with `{ downloadUrl, expiresAt, exportedAt, bundleKey, documentCount, branchCount }`. Source: plan Task 3 step 10 export handler.
- **Interactions:** `handleSiteExportRoute` → `zipSync` (fflate) → `R2_BUNDLES.put` → `signR2GetUrl`.

---

### Integration Tests

---

**Test 6**

- **Name:** `selectVersionsForDocument` returns the single version of a document that has only a draft on main
- **Type:** integration
- **Harness:** H2
- **Preconditions:** Real site, main branch, document with one version (no publish checkpoint).
- **Actions:** Call `selectVersionsForDocument(docId, mainBranchId, true)`.
- **Expected outcome:** Returns 1 entry, `isPublished: false`. Source: plan Task 2 version selection.
- **Interactions:** `query(document_versions)` (no checkpoint_documents hit because none exist).

---

**Test 7**

- **Name:** `selectVersionsForDocument` on non-main branch returns only the latest version regardless of publication status
- **Type:** integration
- **Harness:** H2
- **Preconditions:** Real site with a non-main branch. Document with 2 versions on that branch, first version has publish checkpoint.
- **Actions:** Call `selectVersionsForDocument(docId, nonMainBranchId, false)`.
- **Expected outcome:** Returns exactly 1 entry — the latest version. Source: plan Task 2 "non-main branch: latest version only".
- **Interactions:** `query(document_versions)`.

---

**Test 8**

- **Name:** `selectVersionsForDocument` excludes tombstone versions
- **Type:** integration
- **Harness:** H2
- **Preconditions:** Real site, main branch, document with 2 versions where the latest is tombstoned (via direct SQL `UPDATE app.document_versions SET is_tombstone = true`).
- **Actions:** Call `selectVersionsForDocument(docId, mainBranchId, true)`.
- **Expected outcome:** Returns the non-tombstone version only. Source: plan Task 2 "Tombstoned versions are excluded".
- **Interactions:** `query(document_versions WHERE is_tombstone = false)`.

---

**Test 9**

- **Name:** `validateBundleManifest` passes when SHA-256 hashes match using `crypto.subtle`
- **Type:** integration
- **Harness:** H2 (uses real `crypto.subtle`)
- **Preconditions:** None.
- **Actions:** Compute real SHA-256 of `{"hello":"world"}`, pass matching manifest and content to `validateBundleManifest`.
- **Expected outcome:** `{ valid: true, errors: [] }`. Source: plan Task 4 / PROPOSAL-013 SHA-256 validation requirement.
- **Interactions:** `crypto.subtle.digest`.

---

**Test 10**

- **Name:** `app.import_id_maps` table accepts inserts and enforces primary key uniqueness
- **Type:** integration
- **Harness:** H2 (direct SQL)
- **Preconditions:** Migration 038 applied.
- **Actions:** Insert `(import_key, source_id, entity_type)` twice with `ON CONFLICT DO NOTHING`; read back.
- **Expected outcome:** Exactly one row in table. Source: plan Task 4 migration 038, `PRIMARY KEY (import_key, source_id, entity_type)`.
- **Interactions:** PostgreSQL `app.import_id_maps`.

---

**Test 11**

- **Name:** `resolveCreatedByRefToId` returns system UUID for an email not present in the target environment's `app.users`
- **Type:** integration
- **Harness:** H2 (real DB query)
- **Preconditions:** No user with email `nobody@noreply.invalid` in DB.
- **Actions:** Call `resolveCreatedByRefToId({ type: 'user', email: 'nobody@noreply.invalid' })`.
- **Expected outcome:** Returns `'00000000-0000-0000-0000-000000000000'`. Source: plan Task 4 "fallback to system UUID".
- **Interactions:** `query(app.users WHERE email = ?)`.

---

**Test 12**

- **Name:** Import handler creates `import_id_maps` entries for created document
- **Type:** integration
- **Harness:** H2
- **Preconditions:** Empty target site. ZIP bundle with one document (path `home`), valid SHA-256 manifest.
- **Actions:** Call `handleSiteImportRoute` (with KV mock). After 200, query `app.import_id_maps WHERE import_key = ?`.
- **Expected outcome:** At least one row with `entity_type = 'document'` and correct `source_id` (from bundle meta.json `id` field). Source: plan Task 5 document phase, import_id_maps insert.
- **Interactions:** `createDocument` → `query(import_id_maps INSERT)`.

---

**Test 13**

- **Name:** Import handler creates a publish checkpoint when a version line has `isPublished: true`
- **Type:** integration
- **Harness:** H2
- **Preconditions:** Empty target site. ZIP bundle with one document, one version entry with `isPublished: true`.
- **Actions:** Call `handleSiteImportRoute`. Query `app.checkpoints` and `app.checkpoint_documents` for the target document.
- **Expected outcome:** 1 checkpoint row with `checkpoint_type = 'publish'`; 1 checkpoint_documents row linking it to the created version. Source: plan Task 5 "Create publish checkpoint after each isPublished=true version", PROPOSAL-013.
- **Interactions:** `createDocumentVersion` → `query(INSERT INTO app.checkpoints)` → `query(INSERT INTO app.checkpoint_documents)`.

---

**Test 14**

- **Name:** Export handler uses `branchName` field in `versions.jsonl` sorted by `createdAt` ascending
- **Type:** integration
- **Harness:** H1 (mock services, inspect R2 put argument via `fflate.unzipSync`)
- **Preconditions:** Site with 2 branches. Document with 1 version on main (earlier `createdAt`) and 1 version on feature-branch (later `createdAt`).
- **Actions:**
  1. Set up service mocks returning pre-defined versions with different `createdAt`.
  2. Call `handleSiteExportRoute`.
  3. Intercept `R2_BUNDLES.put` call; decompress ZIP with `unzipSync`; parse `documents/home/versions.jsonl` lines.
- **Expected outcome:** 2 lines in JSONL. Line 1 has `branchName: 'main'` (earlier); line 2 has `branchName: 'feature-branch'` (later). Source: plan Task 3 "Sort lines by createdAt ascending", "branchName field".
- **Interactions:** Export handler → ZIP assembly → R2 mock.

---

**Test 15**

- **Name:** Export `bundle.json` is NOT included in `manifest.files` (prevents circular self-hash)
- **Type:** integration
- **Harness:** H1 (intercept R2 put, decompress ZIP)
- **Preconditions:** Minimal site mock (empty documents list).
- **Actions:**
  1. Call `handleSiteExportRoute` with all mocks set up.
  2. Decompress ZIP from `R2_BUNDLES.put` call; parse `bundle.json`.
- **Expected outcome:** `bundle.json` key is absent from `manifest.files`. `site.json` and `branches.json` are present. Source: plan "bundle.json is NOT included in manifest.files — it is the manifest container."
- **Interactions:** Export handler → `zipSync` → R2 mock.

---

### Invariant Tests

---

**Test 16**

- **Name:** All files listed in `bundle.json` manifest have matching SHA-256 in the ZIP — export always produces a self-consistent bundle
- **Type:** invariant
- **Harness:** H1 (intercept R2 put, decompress + validate)
- **Preconditions:** Site with 1 branch, 1 document, 1 version.
- **Actions:**
  1. Call `handleSiteExportRoute`; capture `R2_BUNDLES.put` first arg (ZIP bytes).
  2. Run `validateBundleManifest(parsedManifest, unzippedContents)` on the result.
- **Expected outcome:** `validateBundleManifest` returns `{ valid: true, errors: [] }`. Source: PROPOSAL-013 SHA-256 validation, plan Task 3 manifest construction.
- **Interactions:** Export handler → import validator (cross-component validation).

---

**Test 17**

- **Name:** Import never inserts to a non-empty site — returns 409 if non-registry docs exist
- **Type:** invariant
- **Harness:** H1
- **Preconditions:** `listDocuments` mock returns `[{ path: 'home' }]`.
- **Actions:** Call `handleSiteImportRoute`.
- **Expected outcome:** 409 response. Source: plan Task 5 "Empty-site check", PROPOSAL-013 "Import targets empty sites only".
- **Interactions:** `handleSiteImportRoute` → `listDocuments` → early return.

---

**Test 18**

- **Name:** Import never inserts to a non-empty site — returns 409 if non-main branches exist
- **Type:** invariant
- **Harness:** H1
- **Preconditions:** `listDocuments` returns `[]`; `listBranches` returns `[main, feature-branch]`.
- **Actions:** Call `handleSiteImportRoute`.
- **Expected outcome:** 409 response. Source: plan Task 5 "hasNonMainBranches" check.
- **Interactions:** `handleSiteImportRoute` → `listBranches`.

---

**Test 19**

- **Name:** Import always re-validates SHA-256 on every call — partial KV progress does not skip manifest validation
- **Type:** invariant
- **Harness:** H1
- **Preconditions:** KV mock returns progress with `completedPhases: ['site', 'branches']`. `validateBundleManifest` spy returns `{ valid: false, errors: ['mismatch'] }`.
- **Actions:** Call `handleSiteImportRoute`.
- **Expected outcome:** 422 response. `validateBundleManifest` was called exactly once. Source: plan Task 5 "Validation is NOT tracked as a phase — it always re-runs on every call."
- **Interactions:** `handleSiteImportRoute` → `validateBundleManifest` (always) → phase-skipping (after).

---

### Boundary and Edge-Case Tests

---

**Test 20**

- **Name:** Export of a site with zero documents produces a valid ZIP containing only bundle.json, site.json, and branches.json
- **Type:** boundary
- **Harness:** H1 (intercept R2 put)
- **Preconditions:** `listDocuments` returns `[]`, `listBranches` returns `[main]`.
- **Actions:** Call `handleSiteExportRoute`; decompress ZIP.
- **Expected outcome:** ZIP contains exactly `bundle.json`, `site.json`, `branches.json`. No `documents/` keys. Response 200 with `documentCount: 0`. Source: plan bundle structure.
- **Interactions:** Export handler with empty document set.

---

**Test 21**

- **Name:** `resolveCreatedByRef` returns `{type: "user", email: null}` for a deleted user (UUID not in app.users)
- **Type:** boundary
- **Harness:** H1 (mock DB query returns 0 rows)
- **Preconditions:** `query` mock returns `{ rows: [], rowCount: 0 }`.
- **Actions:** Call `resolveCreatedByRef('missing-uuid', 'user')`.
- **Expected outcome:** `{ type: 'user', email: null }`. Source: plan Task 2 "If not found, return {type: 'user', email: null}".
- **Interactions:** `bundle-export-service.resolveCreatedByRef` → DB query → fallback.

---

**Test 22**

- **Name:** Import rejects a corrupt ZIP file (fails `unzipSync`) with 400
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** `getMainBranch` and `assertPermission` succeed; site is empty. Request body is `garbage` bytes, not a ZIP.
- **Actions:** Call `handleSiteImportRoute` with a non-ZIP `file` field.
- **Expected outcome:** 400 response with error indicating decompression failure. Source: plan Task 5 "try { unzipSync } catch { return 400 }".
- **Interactions:** `unzipSync` throws → caught → 400.

---

**Test 23**

- **Name:** Import rejects a ZIP missing `bundle.json` with 422
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** ZIP is valid but contains only `site.json`. Site is empty, auth passes.
- **Actions:** Call `handleSiteImportRoute`.
- **Expected outcome:** 422 response with error `bundle.json not found`. Source: plan Task 5 `bundleJsonBytes === undefined` check.
- **Interactions:** `unzipSync` → `bundle.json` key lookup → 422.

---

**Test 24**

- **Name:** Import rejects a bundle with `bundleVersion !== "1"` with 422
- **Type:** boundary
- **Harness:** H1 (validator unit) + H1 (handler integration)
- **Preconditions:** `validateBundleManifest` is called with `bundleVersion: '99'` (unit test); in handler test, `validateBundleManifest` spy returns `{ valid: false, errors: ['Unsupported bundleVersion...'] }`.
- **Actions (unit):** Call `validateBundleManifest({ bundleVersion: '99', ... }, {})`.
- **Expected outcome (unit):** `{ valid: false, errors: [error containing 'bundleVersion'] }`. Source: plan Task 4 bundleVersion check.
- **Interactions:** `validateBundleManifest` pure function.

---

**Test 25**

- **Name:** `resolveCreatedByRef` returns `{type: "system"}` without making any database queries
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** `query` spy is set up.
- **Actions:** Call `resolveCreatedByRef('any-id', 'system')`.
- **Expected outcome:** Returns `{ type: 'system' }`. `query` is NOT called. Source: plan Task 2.
- **Interactions:** None (early return).

---

**Test 26**

- **Name:** `resolveCreatedByRefToId` returns system UUID for `{type: "user", email: null}` without querying DB
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** `query` spy is set up.
- **Actions:** Call `resolveCreatedByRefToId({ type: 'user', email: null })`.
- **Expected outcome:** `'00000000-0000-0000-0000-000000000000'`. `query` NOT called. Source: plan Task 4 null-email branch.
- **Interactions:** None.

---

**Test 27**

- **Name:** Export route returns 503 when `R2_BUNDLES` binding is not configured
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** Auth and site fetch succeed. `env.R2_BUNDLES` is `undefined`.
- **Actions:** Call `handleSiteExportRoute`.
- **Expected outcome:** 503 with error `Bundle storage is not configured`. Source: plan Task 3 R2 binding check.
- **Interactions:** Handler → env check → 503.

---

**Test 28**

- **Name:** Export route returns 405 for non-GET requests
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** None.
- **Actions:** Call `handleSiteExportRoute` with `method: 'POST'`.
- **Expected outcome:** 405. Source: plan Task 3.
- **Interactions:** Handler → method check → 405.

---

**Test 29**

- **Name:** Import route returns 405 for GET requests
- **Type:** boundary
- **Harness:** H1
- **Preconditions:** None.
- **Actions:** Call `handleSiteImportRoute` with `method: 'GET'`.
- **Expected outcome:** 405. Source: plan Task 5.
- **Interactions:** Handler → method check → 405.

---

**Test 30**

- **Name:** Export skips `_registry/` documents — they are not included in the ZIP
- **Type:** boundary
- **Harness:** H1 (intercept `selectVersionsForDocument` call count)
- **Preconditions:** `listDocuments` returns `[{path: '_registry/schema'}, {path: 'home'}]`.
- **Actions:** Call `handleSiteExportRoute`.
- **Expected outcome:** `selectVersionsForDocument` called exactly once (for `home` only, not for `_registry/schema`). Source: plan Task 3 `REGISTRY_PREFIX` filter, PROPOSAL-013 "Excludes _registry/ documents".
- **Interactions:** Export handler → document filter → `selectVersionsForDocument`.

---

**Test 31**

- **Name:** `buildImportKey` produces a deterministic, stable key from siteId and exportedAt
- **Type:** unit
- **Harness:** H1 (pure function)
- **Preconditions:** None.
- **Actions:** Call `buildImportKey('site-abc', '2026-05-27T10:00:00.000Z')` twice.
- **Expected outcome:** Both calls return `'import:site-abc:2026-05-27T10:00:00.000Z'`. Source: plan Task 4 KV key format.
- **Interactions:** None.

---

**Test 32**

- **Name:** `hasCompletedPhase` returns false for null progress (first run) and true for a phase already in the list
- **Type:** unit
- **Harness:** H1 (pure function)
- **Preconditions:** None.
- **Actions:**
  1. Call `hasCompletedPhase(null, 'site')` — expect `false`.
  2. Call `hasCompletedPhase({ completedPhases: ['site'], errors: [], startedAt: '', lastUpdatedAt: '' }, 'site')` — expect `true`.
  3. Call `hasCompletedPhase({ completedPhases: ['site'] ... }, 'branches')` — expect `false`.
- **Expected outcome:** Correct boolean in all three cases. Source: plan Task 4.
- **Interactions:** None.

---

**Test 33**

- **Name:** Export route returns 403 when `assertPermission` throws `AuthorizationError`
- **Type:** unit
- **Harness:** H1
- **Preconditions:** `assertPermission` mock throws `new AuthorizationError('Forbidden')`.
- **Actions:** Call `handleSiteExportRoute`.
- **Expected outcome:** 403. Source: plan Task 3 error handling.
- **Interactions:** `assertPermission` → catch → 403.

---

**Test 34**

- **Name:** Import route returns 403 when `assertPermission` throws `AuthorizationError`
- **Type:** unit
- **Harness:** H1
- **Preconditions:** `assertPermission` mock throws `AuthorizationError`.
- **Actions:** Call `handleSiteImportRoute`.
- **Expected outcome:** 403. Source: plan Task 5 error handling.
- **Interactions:** `assertPermission` → catch → 403.

---

**Test 35**

- **Name:** `write:create` scoped SAT token is allowed by `isServicePrincipalAllowed` for both export and import handlers
- **Type:** unit
- **Harness:** H1 (existing `isServicePrincipalAllowed` unit — extend or verify)
- **Preconditions:** Service principal with `scopes: ['write:create']`, bound to `site-1`.
- **Actions:**
  1. Call `isServicePrincipalAllowed(principal, 'site-1', 'GET', 'site-export')`.
  2. Call `isServicePrincipalAllowed(principal, 'site-1', 'POST', 'site-import')`.
- **Expected outcome:** Both return `{ allowed: true }`. Source: `SCOPE_RULES['write:create'] = { methods: ['GET','POST'], allowedHandlers: '*' }`, plan Task 3/5 auth note.
- **Interactions:** `service-principal.isServicePrincipalAllowed` — handler name check.

---

**Test 36**

- **Name:** Scripts directory cleanup — `migrate-site.ts` and `tsconfig.scripts.json` do not exist in the worktree
- **Type:** regression
- **Harness:** Bash (run inside test suite as an assertion or verify pre-commit)
- **Preconditions:** Task 0 completed.
- **Actions:** Check `workers/scripts/migrate-site.ts` and `workers/tsconfig.scripts.json` are absent.
- **Expected outcome:** Both files are absent from the worktree. `git status` shows them as deleted. Source: plan Task 0, user requirement "clean up old approach".
- **Interactions:** Filesystem / git index.

---

### Performance

The risk is low: the endpoints process site data in memory (no streaming, plan explicitly accepted this). One assertion is warranted:

**Test 37**

- **Name:** ZIP assembly for a minimal bundle completes in under 500ms
- **Type:** unit (timing)
- **Harness:** H1
- **Preconditions:** Mocked services returning minimal data (1 branch, 1 document, 1 version).
- **Actions:** Call `handleSiteExportRoute`; measure wall time.
- **Expected outcome:** Total time under 500ms. A violation indicates a catastrophic regression (infinite loop, accidental `await` in a tight loop). Source: general Workers request latency expectation. Note: The 128MB memory limit is the documented constraint for very large sites — that is explicitly a manual smoke test on sbx1, not a unit test.
- **Interactions:** Full handler execution with mocked I/O.

---

## Coverage Summary

### Action space covered

| Area | Tests | Coverage |
|------|-------|----------|
| Export route: auth (SAT write:create, admin, 403) | 1, 33, 35 | Full |
| Export route: method enforcement (405) | 28 | Full |
| Export route: R2 binding check (503) | 27 | Full |
| Export route: R2 write + presigned URL (200) | 5, 15 | Full |
| Export route: `_registry/` exclusion | 30 | Full |
| Export route: bundle.json not in manifest.files | 15 | Full |
| Export route: bundle SHA-256 self-consistency | 16 | Full |
| Export route: `branchName` in versions.jsonl, sort by createdAt | 14 | Full |
| Version selection: main branch published + latest draft | 4, 6 | Full |
| Version selection: main branch only draft (nothing published) | 6 | Full |
| Version selection: latest already published (no duplication) | covered by unit test in plan Task 2 | Implicit |
| Version selection: non-main branch latest only | 7 | Full |
| Version selection: tombstone exclusion | 8 | Full |
| `resolveCreatedByRef`: user, agent, system, missing | 21, 25 | Full |
| `resolveCreatedByRefToId`: user, agent, system, null, missing | 11, 26 | Full |
| Import route: auth (403, SAT write:create) | 34, 35 | Full |
| Import route: method enforcement (405) | 29 | Full |
| Import route: empty-site check — docs (409) | 17, 1 scenario | Full |
| Import route: empty-site check — branches (409) | 18 | Full |
| Import route: ZIP decompression failure (400) | 22 | Full |
| Import route: missing bundle.json (422) | 23 | Full |
| Import route: manifest validation always re-runs | 19 | Full |
| Import route: SHA-256 manifest validation fail (422) | handler test in plan Task 5 + 24 | Full |
| Import route: bundleVersion !== '1' rejection | 24 | Full |
| Import route: branch creation from bundle | 2 | Full |
| Import route: document creation and import_id_maps | 12 | Full |
| Import route: version creation sequential numbering | 1, 13 | Partial (sequential numbering verified by DB read; count only) |
| Import route: publish checkpoint creation | 13 | Full |
| Import route: idempotent resume from KV | 3 | Full |
| `buildImportKey` determinism | 31 | Full |
| `hasCompletedPhase` null and list cases | 32 | Full |
| KV progress tracking: save/read | 3 (via mock) | Partial |
| `import_id_maps` table write/read | 10, 12 | Full |
| Scripts cleanup | 36 | Full |
| ZIP timing (catastrophic regression) | 37 | Full |

### Explicitly excluded per agreed strategy (Medium fidelity)

- **R2 unavailability during export (502/503 from R2 itself):** R2 is mocked in all tests; real R2 network failures are not simulated. Risk: rare in practice; known gap.
- **Import with a missing dependency in bundle (e.g. versions.jsonl referencing a branch that isn't in branches.json):** Covered conceptually (branchName not found → warn + skip), but no dedicated test for the warn-and-skip path. Risk: data loss for that document's versions on an unmatched branch.
- **Large-site memory timing smoke test on sbx1:** Deferred to manual post-deploy verification. Risk: a 50MB+ site may exceed 128MB Worker limit; not testable in unit/integration harness.
- **KV progress key collision across different imports of the same site:** Not tested. Key includes `exportedAt`, so collisions require two exports at the same millisecond. Risk: negligible.
- **`saveImportProgress` KV expiration TTL (7 days):** Not testable in unit harness. Accepted gap.
