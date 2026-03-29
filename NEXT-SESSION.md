# Next Session: Handoff Notes

## What Was Completed

### Phase 1: Realtime sync flicker fix (committed)
### Phase 2: JSON diff version storage + gap fixes (committed)
- Action metadata forwarding through DO sync pipeline
- Content API & Document API snapshot reconstruction for diff-only versions

### Phase 3: CRDT merge removal (committed)
- 3b: Deleted crdt-merge-service, CRDT preview routes/tests
- 3c: Removed Auto merge UI from puck-css-integration
- 3d: Migration 030 to drop crdt_state column
- 3e: Removed crdt_state from all SQL queries, types, and tests (~30 files)

### Vendored to my-app (committed on feature/merge-comparison-overlay)

### PRs Created
- collaborative-state-system: https://github.com/pantheon-systems/collaborative-state-system/pull/49
- puck-css-integration: https://github.com/pantheon-systems/puck-css-integration/pull/18
- my-app: NOT pushed yet (on feature/merge-comparison-overlay branch)

## Bug Found & Fixed During Testing

### Migrations 029 & 030 were not applied
The database was missing the `patch`, `action_type`, `action_metadata` columns (migration 029) and still had `crdt_state` (migration 030). All writes were silently failing with `DatabaseError: Failed to create document version`. Fixed by running `pnpm db:migrate` in workers/.

### Corrupted rs6-avant document
During debugging, test snapshots were written to document `926902a9-8fef-4319-88ca-b43a27557cc7` (rs6-avant on "new model launch" branch `03b5407e-d3f9-4495-9091-65193c069fcd`). Versions 15-20 have corrupt/test data and return 500 when loaded. Other documents work fine.

**Fix**: Delete corrupt versions from Postgres:
```sql
DELETE FROM app.document_versions
WHERE document_id = '926902a9-8fef-4319-88ca-b43a27557cc7'
  AND branch_id = '03b5407e-d3f9-4495-9091-65193c069fcd'
  AND version_number BETWEEN 15 AND 20;
```

### String parsing fix in reconstructVersionSnapshot
Added defensive `typeof === 'string'` checks for `baseline.snapshot` and `diffRow.patch` in `reconstructVersionSnapshot()` in case Postgres returns JSONB as strings. File: `workers/src/services/document-version-service.ts` ~line 594.

### Debug logging added (should be removed)
- `document-api.ts`: try/catch with `console.error` around `reconstructVersionSnapshot` call — can keep this or remove

## Test Results
- collaborative-state-system: 138 files, 2653 tests pass, no type errors
- puck-css-integration: 413 tests pass (1 pre-existing failure in realtime-delta-encoding.spec.ts)
- Verified: editing persists across page navigations after migrations applied
- Verified: version reconstruction works for diff-only versions (tested on rs6-new)

## Remaining Notes
- `/internal/crdt-state` endpoint name is historical — returns JSON snapshots now. Could rename to `/internal/document-state` later.
- `src/types/domain.ts` retains `crdtState?: string` as `@deprecated` for API compat
- Pre-existing: 4 async cleanup warnings in `document-session-ws-publish.spec.ts`
- Pre-existing: `realtime-delta-encoding.spec.ts` "should include stateVector on reconnect" test failure

## Build & Vendor (if puck-css-integration packages change)
```bash
cd ~/src/puck-css-integration && pnpm build
cd packages/css-client && npm pack && cp *.tgz ~/src/my-app/vendor/pantheon-css-client-0.2.0.tgz && rm *.tgz
cd ../puck-css && npm pack && cp *.tgz ~/src/my-app/vendor/pantheon-puck-css-0.2.0.tgz && rm *.tgz
cd ~/src/my-app && rm -rf node_modules/@pantheon/puck-css node_modules/@pantheon/css-client && npm install
```
