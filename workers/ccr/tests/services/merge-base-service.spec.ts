/**
 * Phase 5.1b: Merge Base Service Tests
 *
 * Tests for finding the common ancestor checkpoint between branches.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * `getModifiedDocumentsSince` and `getBranchLineage` run raw CTE statements, and
 * a stub keyed by table cannot answer a query whose outer FROM is a CTE name.
 * What those two return for a given fixture is pinned against a real Postgres in
 * tests/db/merge-base-modified-documents.spec.ts; what is pinned here is the SQL
 * `getModifiedDocumentsSince` builds, which varies with `options.publishedOnly`.
 */

import { describe, it, expect } from 'vitest';
import {
  findMergeBase,
  getDocumentsAtCheckpoint,
  getModifiedDocumentsSince,
} from '../../src/services/merge-base-service';
import { branches, checkpointDocuments, checkpoints } from '../../src/db/schema';
import { stubDatabase } from '../__stubs__/database';
import {
  SourceBranchNotFoundError,
  TargetBranchNotFoundError,
} from '../../src/services/errors';

/**
 * The body of the `current_versions` CTE, from `current_versions AS (` to the
 * close-paren before the `Find documents that differ` marker. Throws when the
 * shape is unrecognizable, which itself catches drift.
 */
function extractCurrentVersionsCte(statement: string): string {
  const start = statement.indexOf('current_versions AS (');
  if (start === -1) throw new Error('current_versions CTE not found');
  const bodyStart = statement.indexOf('(', start) + 1;
  const sentinel = statement.indexOf('Find documents that differ', bodyStart);
  if (sentinel === -1) throw new Error('Find-documents-that-differ marker not found');
  const closingParen = statement.lastIndexOf(')', sentinel);
  if (closingParen === -1) throw new Error('current_versions CTE close-paren not found');
  return statement.slice(bodyStart, closingParen);
}

describe('Phase 5.1b: Merge Base Service', () => {
  describe('findMergeBase', () => {
    it('should find merge base when source branch was created from target branch', async () => {
      const { on, calls } = stubDatabase();
      on(branches).select.returns([
        { id: 'source-branch', sourceBranchId: 'target-branch', sourceCheckpointId: 'checkpoint-123' },
      ]);
      on(checkpoints).select.returns([
        { createdAt: new Date('2026-01-20T10:00:00.000Z'), name: null, message: null },
      ]);

      const result = await findMergeBase('source-branch', 'target-branch');

      expect(result).toBeDefined();
      expect(result?.checkpointId).toBe('checkpoint-123');
      // The source branch is looked up before the target branch.
      expect(calls(branches).select.map((call) => call.params)).toEqual([
        ['source-branch'],
        ['target-branch'],
      ]);
    });

    it('should find merge base when branches share common ancestor through branch lineage', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([
        { id: 'branch-a', sourceBranchId: 'main-branch', sourceCheckpointId: 'checkpoint-1' },
      ]);
      on(checkpoints).select.returns([
        { createdAt: new Date('2026-01-15T10:00:00.000Z'), name: null, message: null },
      ]);

      const result = await findMergeBase('branch-a', 'branch-b');

      expect(result).toBeDefined();
      expect(result?.checkpointId).toBe('checkpoint-1');
    });

    it('should return null when branches have no common ancestor', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([
        { id: 'branch-a', sourceBranchId: null, sourceCheckpointId: null },
      ]);

      const result = await findMergeBase('branch-a', 'branch-b');

      expect(result).toBeNull();
    });

    it('should return null when source branch equals target branch', async () => {
      const { statements } = stubDatabase();

      const result = await findMergeBase('same-branch', 'same-branch');

      expect(result).toBeNull();
      expect(statements).toHaveLength(0);
    });

    it('should throw SourceBranchNotFoundError when source branch does not exist', async () => {
      stubDatabase();

      await expect(findMergeBase('nonexistent', 'target-branch')).rejects.toThrow(
        SourceBranchNotFoundError,
      );
    });

    it('should include checkpoint metadata in result', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([
        { id: 'feature-branch', sourceBranchId: 'main-branch', sourceCheckpointId: 'checkpoint-123' },
      ]);
      on(checkpoints).select.returns([
        {
          createdAt: new Date('2026-01-20T10:00:00.000Z'),
          name: 'Release v1.0',
          message: 'Initial release checkpoint',
        },
      ]);

      const result = await findMergeBase('feature-branch', 'main-branch');

      expect(result).toEqual({
        checkpointId: 'checkpoint-123',
        branchId: 'main-branch',
        createdAt: new Date('2026-01-20T10:00:00.000Z'),
        name: 'Release v1.0',
        message: 'Initial release checkpoint',
      });
    });
  });

  describe('getModifiedDocumentsSince with publishedOnly option', () => {
    it('should use checkpoint_documents for current state when publishedOnly is true', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('main-branch', 'checkpoint-id', {
        publishedOnly: true,
      });

      const cteBody = extractCurrentVersionsCte(statements[0].sql);
      expect(cteBody).toContain('checkpoint_documents');
      expect(cteBody).toContain('checkpoints');
    });

    it('should use raw document_versions when publishedOnly is false', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('branch-id', 'checkpoint-id', {
        publishedOnly: false,
      });

      const cteBody = extractCurrentVersionsCte(statements[0].sql);
      expect(cteBody).toContain('FROM app.document_versions dv');
      expect(cteBody).not.toContain('checkpoint_documents');
    });

    it('should default to publishedOnly false when no options provided', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('branch-id', 'checkpoint-id');

      const cteBody = extractCurrentVersionsCte(statements[0].sql);
      expect(cteBody).toContain('FROM app.document_versions dv');
      expect(cteBody).not.toContain('checkpoint_documents');
    });
  });

  describe('getDocumentsAtCheckpoint', () => {
    it('should return all document versions at checkpoint', async () => {
      const { on } = stubDatabase();
      on(checkpointDocuments).select.returnsRaw([
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          versionId: 'version-1',
          versionNumber: 2,
          snapshot: { title: 'Home Page' },
        },
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          versionId: 'version-2',
          versionNumber: 1,
          snapshot: { title: 'About Us' },
        },
      ]);

      const result = await getDocumentsAtCheckpoint('checkpoint-id');

      expect(result).toHaveLength(2);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].snapshot).toEqual({ title: 'Home Page' });
    });

    it('should return empty array for checkpoint with no documents', async () => {
      stubDatabase();

      const result = await getDocumentsAtCheckpoint('checkpoint-id');

      expect(result).toEqual([]);
    });
  });

  describe('Error Classes', () => {
    it('should export SourceBranchNotFoundError with correct properties', () => {
      const error = new SourceBranchNotFoundError('branch-uuid');

      expect(error.name).toBe('SourceBranchNotFoundError');
      expect(error.branchId).toBe('branch-uuid');
    });

    it('should export TargetBranchNotFoundError with correct properties', () => {
      const error = new TargetBranchNotFoundError('branch-uuid');

      expect(error.name).toBe('TargetBranchNotFoundError');
      expect(error.branchId).toBe('branch-uuid');
    });
  });

  describe('MergeBase type', () => {
    it('should have correct structure', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([
        { id: 'source', sourceBranchId: 'target', sourceCheckpointId: 'cp-123' },
      ]);
      on(checkpoints).select.returns([
        { createdAt: new Date('2026-01-20T10:00:00.000Z'), name: null, message: null },
      ]);

      const result = await findMergeBase('source', 'target');

      expect(result).toHaveProperty('checkpointId');
      expect(result).toHaveProperty('branchId');
      expect(result).toHaveProperty('createdAt');
    });
  });

  describe('Simplified Merge Base (Main-Only Branching)', () => {
    it('should find merge base using source branch source_checkpoint_id directly', async () => {
      const { on } = stubDatabase();
      on(branches).select.returns([
        { id: 'feature-branch', sourceBranchId: 'main-branch', sourceCheckpointId: 'checkpoint-123' },
      ]);
      on(checkpoints).select.returns([
        { createdAt: new Date('2026-01-20T10:00:00.000Z'), name: null, message: null },
      ]);

      const result = await findMergeBase('feature-branch', 'main-branch');

      expect(result).toBeDefined();
      expect(result?.checkpointId).toBe('checkpoint-123');
      expect(result?.branchId).toBe('main-branch');
    });

    it('should return null when source branch has no source_checkpoint_id', async () => {
      const { on, calls } = stubDatabase();
      on(branches).select.returns([
        { id: 'feature-branch', sourceBranchId: 'main-branch', sourceCheckpointId: null },
      ]);

      const result = await findMergeBase('feature-branch', 'main-branch');

      expect(result).toBeNull();
      expect(calls(checkpoints).select).toHaveLength(0);
    });

    it('should not use recursive CTE for merge base calculation', async () => {
      const { on, statements } = stubDatabase();
      on(branches).select.returns([
        { id: 'feature-branch', sourceBranchId: 'main-branch', sourceCheckpointId: 'cp-1' },
      ]);
      on(checkpoints).select.returns([
        { createdAt: new Date('2026-01-20T10:00:00.000Z'), name: null, message: null },
      ]);

      await findMergeBase('feature-branch', 'main-branch');

      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement.sql).not.toContain('WITH RECURSIVE');
      }
    });
  });

  describe('getModifiedDocumentsSince — publishedOnly publish-type filter', () => {
    // Every prior post_merge checkpoint references the docs it touched. Joining
    // any checkpoint type in publishedOnly mode reads those references as "the
    // published version" and reports a phantom target change for every
    // previously-merged doc, so both CTEs scope to checkpoint_type = 'publish'.

    it('adds checkpoint_type = \'publish\' filter to current_versions CTE when publishedOnly is true', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('main-branch', 'merge-base-cp', { publishedOnly: true });

      expect(extractCurrentVersionsCte(statements[0].sql)).toMatch(
        /cp\.checkpoint_type\s*=\s*'publish'/,
      );
    });

    it('adds checkpoint_type = \'publish\' filter to checkpoint_docs (merge-base) CTE when publishedOnly is true', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('main-branch', 'merge-base-cp', { publishedOnly: true });

      // The base state is publish-scoped too, or it picks up spurious
      // post_merge / auto / pre_merge references: one occurrence for the current
      // state, one for the base.
      const matches = statements[0].sql.match(/cp\.checkpoint_type\s*=\s*'publish'/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('does NOT add the publish-type filter when publishedOnly is false (source-side semantics)', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('source-branch', 'merge-base-cp', { publishedOnly: false });

      expect(statements[0].sql).not.toMatch(/cp\.checkpoint_type\s*=\s*'publish'/);
    });

    it('does NOT add the publish-type filter when publishedOnly is omitted (default)', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('source-branch', 'merge-base-cp');

      expect(statements[0].sql).not.toMatch(/cp\.checkpoint_type\s*=\s*'publish'/);
    });

    it('does not break the existing source-side query shape', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('source-branch', 'merge-base-cp');

      // Source-side reads document_versions for the current state and joins
      // checkpoint_documents only for the merge-base resolution.
      expect(statements[0].sql).toContain('FROM app.document_versions dv');
      expect(statements[0].sql).toContain('checkpoint_docs');
      expect(statements[0].sql).toContain('current_versions');
    });
  });

  describe('getModifiedDocumentsSince — tombstone overlay on publishedOnly', () => {
    // A delete written straight to document_versions never reaches a publish
    // checkpoint, so in publishedOnly mode the last published version would
    // otherwise leak back as a phantom both-modified conflict instead of the doc
    // disappearing from the target view. Source-side semantics differ on purpose:
    // tombstones surface there as isDeleted so merges propagate deletes.

    it('emits a NOT EXISTS subquery against document_versions with is_tombstone in the publishedOnly current_versions CTE', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('main-branch', 'merge-base-cp', { publishedOnly: true });

      const cteBody = extractCurrentVersionsCte(statements[0].sql);

      expect(cteBody).toMatch(/NOT\s+EXISTS\s*\(/i);
      expect(cteBody).toMatch(/app\.document_versions/);
      expect(cteBody).toMatch(/is_tombstone\s*=\s*true/);
      // A strictly greater version_number keeps a captured tombstone from
      // excluding itself.
      expect(cteBody).toMatch(/version_number\s*>/);
    });

    it('does NOT add the tombstone NOT EXISTS clause when publishedOnly is false (source-side unchanged)', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('source-branch', 'merge-base-cp', { publishedOnly: false });

      expect(extractCurrentVersionsCte(statements[0].sql)).not.toMatch(/NOT\s+EXISTS/i);
    });

    it('does NOT add the tombstone NOT EXISTS clause when publishedOnly is omitted (default)', async () => {
      const { statements } = stubDatabase();

      await getModifiedDocumentsSince('source-branch', 'merge-base-cp');

      expect(extractCurrentVersionsCte(statements[0].sql)).not.toMatch(/NOT\s+EXISTS/i);
    });
  });
});
