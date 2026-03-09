# Copy-on-Write Branching Plan

## Overview

Refactor branching to use true copy-on-write semantics: branches store only edits and inherit main's published content. Enforce main-only branching (no nested branches). Unify deletion around tombstone versions.

## Constraints

- Branches only from main (no nested branches)
- Tombstone versions are the single deletion mechanism (deprecate archive)
- Copy-on-write: branches store only edits, inherit main's published content

## Phase 1: Enforce Main-Only Branching (Backend)

**branch-service.ts**
- `createBranch()`: Validate `sourceBranchId` is the main branch. New `MainBranchOnlyError`.
- Keep `sourceCheckpointId` support (but only for checkpoints on main)

**merge-request-service.ts**
- `createMergeRequest()`: Validate `targetBranchId` is the main branch

**merge-base-service.ts**
- Simplify: merge base is always the checkpoint/state of main at branch creation time. Remove recursive CTE.

**Migration 022**
- Add CHECK constraint: non-main branches must have `source_branch_id` referencing a main branch

**Tests**: Enforce main-only in branch-service, merge-request, merge-base tests

## Phase 2: Enforce Main-Only Branching (Frontend)

- Remove parent branch selector — always branches from main
- Merge request target is always main — make read-only or remove selector
- Update labels: "Create branch from main"
- Update tests

## Phase 3: Copy-on-Write Branch Creation (Backend)

**branch-service.ts — `createBranch()`**
- Stop copying document versions (remove `INSERT INTO document_versions ... SELECT`)
- Stop copying `branch_document_metadata`
- Keep copying `branch_structure_state` (navigation tree must be independent per branch)
- Record `source_checkpoint_id` (latest checkpoint on main) as the branch point reference

## Phase 4: Version Fallback to Main (Backend)

**document-version-service.ts**
- New: `getLatestDocumentVersionWithFallback(documentId, branchId, mainBranchId)`
  - Query for version on the branch
  - If null and branch is not main, query latest published version on main
  - Return version + `inherited: boolean` flag

**content-api.ts**
- Non-main branches: use fallback function
- Main branch: no change (published only)

**document-service.ts — `listDocumentsOnBranch()`**
- For non-main branches: union of documents with local versions on the branch + documents with published versions on main
- Exclude documents where the branch has a tombstone version (local tombstone overrides main)

## Phase 5: Merge Execution Changes (Backend)

**merge-execution-service.ts**
- Only merge documents that have local versions on the source branch (unedited docs are already on main)
- Tombstone handling at merge: when a tombstoned document is merged to main, create the tombstone version on main and exclude it from the post-merge checkpoint (unpublishes it). Document record stays intact, all history preserved. To restore: create a new version with content on a new branch and merge.

**Conflict detection**
- Only check documents actually modified on the branch (have local versions)

**Deprecate archive**
- Remove `archiveDocument()` / `restoreDocument()` from service exports, or mark deprecated
- Tombstone versions are the single mechanism for "document is gone"

## Phase 6: Data Migration

For existing branches (e.g., 'new product launch'):
1. Identify version 1 rows on non-main branches that match the snapshot they were copied from on main
2. Delete those duplicate rows (fallback to main serves same or newer content)
3. Keep versions where snapshot has diverged (actual edits)
4. Re-parent any branches with non-main `source_branch_id` to point to main

After migration, existing branches keep their edited pages and inherit everything else from main's published content.

## Phase 7: Publish-Propagation Foundation (Future)

When a checkpoint is created on main:
- For each document in the checkpoint, check active branches for local edits on the same document
- If conflict detected: emit event to queue with `{ branchId, documentId, mainVersionId, branchVersionId }`
- Consumer (future): notify users, trigger conflict resolution UX

This phase is detection/notification plumbing only. Resolution UX is a separate effort using existing merge tools.

## Deletion Lifecycle (Unified)

```
Branch: user deletes page -> tombstone version on branch
  - Branch view: page gone (tombstone blocks fallback to main)
  - Main view: page still published (unaffected)
  - Undo on branch: create new version with content

Merge: tombstone merges to main
  - Tombstone version created on main
  - Excluded from post-merge checkpoint (unpublished)
  - Content delivery: 404
  - Document record + history: intact

Restore: new branch, create version with content, merge to main
  - Re-published via new checkpoint
```

## Version Fallback Behavior

| Branch has local version? | Main has published version? | What's served |
|---|---|---|
| Yes | Any | Branch's local version |
| No | Yes | Main's published version (inherited) |
| No | No | 404 |
