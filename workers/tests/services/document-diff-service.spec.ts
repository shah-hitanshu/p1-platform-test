/**
 * Phase 10.1: Document Diff Service Tests (TDD)
 *
 * Tests for computing JSON diffs between document versions for merge visualization.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock document-version-service
vi.mock('../../src/services/document-version-service', () => ({
  getDocumentVersion: vi.fn(),
}));

describe('Phase 10.1: Document Diff Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('computeJsonDiff', () => {
    it('should return empty operations array when objects are identical', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = { title: 'Hello', content: 'World' };
      const target = { title: 'Hello', content: 'World' };

      const result = computeJsonDiff(source, target);

      expect(result).toEqual([]);
    });

    it('should detect property additions', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = { title: 'Hello' };
      const target = { title: 'Hello', content: 'World' };

      const result = computeJsonDiff(source, target);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        op: 'add',
        path: '/content',
        value: 'World',
      });
    });

    it('should detect property removals', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = { title: 'Hello', content: 'World' };
      const target = { title: 'Hello' };

      const result = computeJsonDiff(source, target);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        op: 'remove',
        path: '/content',
      });
    });

    it('should detect property replacements', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = { title: 'Hello' };
      const target = { title: 'Goodbye' };

      const result = computeJsonDiff(source, target);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        op: 'replace',
        path: '/title',
        value: 'Goodbye',
      });
    });

    it('should detect nested property changes', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = { meta: { author: 'Alice', version: 1 } };
      const target = { meta: { author: 'Bob', version: 1 } };

      const result = computeJsonDiff(source, target);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        op: 'replace',
        path: '/meta/author',
        value: 'Bob',
      });
    });

    it('should detect array element additions', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = { items: ['a', 'b'] };
      const target = { items: ['a', 'b', 'c'] };

      const result = computeJsonDiff(source, target);

      expect(result.length).toBeGreaterThan(0);
      // Should have an add operation for the new element
      const addOp = result.find((op) => op.op === 'add' && op.path.startsWith('/items'));
      expect(addOp).toBeDefined();
    });

    it('should detect array element removals', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = { items: ['a', 'b', 'c'] };
      const target = { items: ['a', 'b'] };

      const result = computeJsonDiff(source, target);

      expect(result.length).toBeGreaterThan(0);
      // Should have a remove operation
      const removeOp = result.find((op) => op.op === 'remove' && op.path.startsWith('/items'));
      expect(removeOp).toBeDefined();
    });

    it('should handle empty source object', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = {};
      const target = { title: 'Hello' };

      const result = computeJsonDiff(source, target);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        op: 'add',
        path: '/title',
        value: 'Hello',
      });
    });

    it('should handle empty target object', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = { title: 'Hello' };
      const target = {};

      const result = computeJsonDiff(source, target);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        op: 'remove',
        path: '/title',
      });
    });

    it('should handle complex nested structures', async () => {
      const { computeJsonDiff } = await import('../../src/services/document-diff-service');

      const source = {
        page: {
          header: { title: 'Home', nav: ['about', 'contact'] },
          body: { sections: [{ id: 1, content: 'Hello' }] },
        },
      };
      const target = {
        page: {
          header: { title: 'Welcome', nav: ['about', 'contact', 'blog'] },
          body: { sections: [{ id: 1, content: 'Hello' }] },
        },
      };

      const result = computeJsonDiff(source, target);

      // Should detect title change and nav addition
      expect(result.length).toBeGreaterThan(0);
      const titleChange = result.find((op) => op.path === '/page/header/title');
      expect(titleChange).toBeDefined();
      expect(titleChange?.op).toBe('replace');
      expect(titleChange?.value).toBe('Welcome');
    });
  });

  describe('computeDocumentDiff', () => {
    it('should fetch versions and compute diff', async () => {
      const { computeDocumentDiff } = await import('../../src/services/document-diff-service');
      const { getDocumentVersion } = await import('../../src/services/document-version-service');

      vi.mocked(getDocumentVersion)
        .mockResolvedValueOnce({
          id: 'source-version-id',
          documentId: 'doc-1',
          branchId: 'source-branch',
          versionNumber: 2,
          snapshot: { title: 'Source Title', content: 'Hello' },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-20T10:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'target-version-id',
          documentId: 'doc-1',
          branchId: 'target-branch',
          versionNumber: 3,
          snapshot: { title: 'Target Title', content: 'Hello' },
          source: 'edit',
          createdById: 'user-2',
          createdByType: 'user',
          createdAt: '2026-01-20T11:00:00.000Z',
        });

      const result = await computeDocumentDiff('source-version-id', 'target-version-id');

      expect(result).toBeDefined();
      expect(result.sourceSnapshot).toEqual({ title: 'Source Title', content: 'Hello' });
      expect(result.targetSnapshot).toEqual({ title: 'Target Title', content: 'Hello' });
      expect(result.diffOperations).toHaveLength(1);
      expect(result.diffOperations[0]).toEqual({
        op: 'replace',
        path: '/title',
        value: 'Target Title',
      });
    });

    it('should throw error when source version not found', async () => {
      const { computeDocumentDiff, DocumentVersionNotFoundError } = await import(
        '../../src/services/document-diff-service'
      );
      const { getDocumentVersion } = await import('../../src/services/document-version-service');

      vi.mocked(getDocumentVersion).mockResolvedValueOnce(null);

      await expect(computeDocumentDiff('missing-id', 'target-id')).rejects.toThrow(
        DocumentVersionNotFoundError,
      );
    });

    it('should throw error when target version not found', async () => {
      const { computeDocumentDiff, DocumentVersionNotFoundError } = await import(
        '../../src/services/document-diff-service'
      );
      const { getDocumentVersion } = await import('../../src/services/document-version-service');

      vi.mocked(getDocumentVersion)
        .mockResolvedValueOnce({
          id: 'source-version-id',
          documentId: 'doc-1',
          branchId: 'source-branch',
          versionNumber: 2,
          snapshot: { title: 'Source' },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-20T10:00:00.000Z',
        })
        .mockResolvedValueOnce(null);

      await expect(computeDocumentDiff('source-id', 'missing-id')).rejects.toThrow(
        DocumentVersionNotFoundError,
      );
    });
  });

  describe('computeDocumentDiffs', () => {
    it('should compute diffs for multiple conflicting documents', async () => {
      const { computeDocumentDiffs } = await import('../../src/services/document-diff-service');
      const { getDocumentVersion } = await import('../../src/services/document-version-service');

      const conflicts = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          conflictType: 'both-modified' as const,
          sourceVersion: 2,
          targetVersion: 3,
        },
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          conflictType: 'both-modified' as const,
          sourceVersion: 1,
          targetVersion: 2,
        },
      ];

      const sourceChanges = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'v1-source',
          latestVersionNumber: 2,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
        },
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          latestVersionId: 'v2-source',
          latestVersionNumber: 1,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
        },
      ];

      const targetChanges = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'v1-target',
          latestVersionNumber: 3,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
        },
        {
          documentId: 'doc-2',
          documentPath: 'pages/about',
          latestVersionId: 'v2-target',
          latestVersionNumber: 2,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
        },
      ];

      // Mock version fetches (4 calls total - 2 docs x 2 versions each)
      vi.mocked(getDocumentVersion)
        .mockResolvedValueOnce({
          id: 'v1-source',
          documentId: 'doc-1',
          branchId: 'source-branch',
          versionNumber: 2,
          snapshot: { title: 'Home Source' },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-20T10:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'v1-target',
          documentId: 'doc-1',
          branchId: 'target-branch',
          versionNumber: 3,
          snapshot: { title: 'Home Target' },
          source: 'edit',
          createdById: 'user-2',
          createdByType: 'user',
          createdAt: '2026-01-20T11:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'v2-source',
          documentId: 'doc-2',
          branchId: 'source-branch',
          versionNumber: 1,
          snapshot: { title: 'About Source' },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-20T10:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'v2-target',
          documentId: 'doc-2',
          branchId: 'target-branch',
          versionNumber: 2,
          snapshot: { title: 'About Target' },
          source: 'edit',
          createdById: 'user-2',
          createdByType: 'user',
          createdAt: '2026-01-20T11:00:00.000Z',
        });

      const result = await computeDocumentDiffs(conflicts, sourceChanges, targetChanges);

      expect(result).toHaveLength(2);

      // First document diff
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].documentPath).toBe('pages/home');
      expect(result[0].sourceSnapshot).toEqual({ title: 'Home Source' });
      expect(result[0].targetSnapshot).toEqual({ title: 'Home Target' });
      expect(result[0].diffOperations).toHaveLength(1);

      // Second document diff
      expect(result[1].documentId).toBe('doc-2');
      expect(result[1].documentPath).toBe('pages/about');
      expect(result[1].sourceSnapshot).toEqual({ title: 'About Source' });
      expect(result[1].targetSnapshot).toEqual({ title: 'About Target' });
    });

    it('should return empty array when no conflicts', async () => {
      const { computeDocumentDiffs } = await import('../../src/services/document-diff-service');

      const result = await computeDocumentDiffs([], [], []);

      expect(result).toEqual([]);
    });

    it('should handle deleted-in-source conflicts with null source snapshot', async () => {
      const { computeDocumentDiffs } = await import('../../src/services/document-diff-service');
      const { getDocumentVersion } = await import('../../src/services/document-version-service');

      const conflicts = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          conflictType: 'deleted-in-source' as const,
          targetVersion: 2,
        },
      ];

      const sourceChanges = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: null as unknown as string, // Deleted
          latestVersionNumber: 0,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
          isDeleted: true,
        },
      ];

      const targetChanges = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'v1-target',
          latestVersionNumber: 2,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
        },
      ];

      vi.mocked(getDocumentVersion).mockResolvedValueOnce({
        id: 'v1-target',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 2,
        snapshot: { title: 'Target Content' },
        source: 'edit',
        createdById: 'user-2',
        createdByType: 'user',
        createdAt: '2026-01-20T11:00:00.000Z',
      });

      const result = await computeDocumentDiffs(conflicts, sourceChanges, targetChanges);

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].sourceSnapshot).toBeNull();
      expect(result[0].targetSnapshot).toEqual({ title: 'Target Content' });
    });

    it('should handle deleted-in-target conflicts with null target snapshot', async () => {
      const { computeDocumentDiffs } = await import('../../src/services/document-diff-service');
      const { getDocumentVersion } = await import('../../src/services/document-version-service');

      const conflicts = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          conflictType: 'deleted-in-target' as const,
          sourceVersion: 2,
        },
      ];

      const sourceChanges = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: 'v1-source',
          latestVersionNumber: 2,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
        },
      ];

      const targetChanges = [
        {
          documentId: 'doc-1',
          documentPath: 'pages/home',
          latestVersionId: null as unknown as string, // Deleted
          latestVersionNumber: 0,
          baseVersionId: 'v0',
          baseVersionNumber: 1,
          isDeleted: true,
        },
      ];

      vi.mocked(getDocumentVersion).mockResolvedValueOnce({
        id: 'v1-source',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 2,
        snapshot: { title: 'Source Content' },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      const result = await computeDocumentDiffs(conflicts, sourceChanges, targetChanges);

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].sourceSnapshot).toEqual({ title: 'Source Content' });
      expect(result[0].targetSnapshot).toBeNull();
    });
  });

  describe('DocumentDiff type structure', () => {
    it('should have correct structure for DocumentDiff', async () => {
      const { computeDocumentDiff } = await import('../../src/services/document-diff-service');
      const { getDocumentVersion } = await import('../../src/services/document-version-service');

      vi.mocked(getDocumentVersion)
        .mockResolvedValueOnce({
          id: 'source-version-id',
          documentId: 'doc-1',
          branchId: 'source-branch',
          versionNumber: 2,
          snapshot: { title: 'Source' },
          source: 'edit',
          createdById: 'user-1',
          createdByType: 'user',
          createdAt: '2026-01-20T10:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'target-version-id',
          documentId: 'doc-1',
          branchId: 'target-branch',
          versionNumber: 3,
          snapshot: { title: 'Target' },
          source: 'edit',
          createdById: 'user-2',
          createdByType: 'user',
          createdAt: '2026-01-20T11:00:00.000Z',
        });

      const result = await computeDocumentDiff('source-version-id', 'target-version-id');

      // Verify structure
      expect(result).toHaveProperty('sourceSnapshot');
      expect(result).toHaveProperty('targetSnapshot');
      expect(result).toHaveProperty('diffOperations');
      expect(Array.isArray(result.diffOperations)).toBe(true);

      // Each operation should have op and path
      for (const op of result.diffOperations) {
        expect(op).toHaveProperty('op');
        expect(op).toHaveProperty('path');
        expect(['add', 'remove', 'replace', 'move', 'copy']).toContain(op.op);
        expect(typeof op.path).toBe('string');
      }
    });
  });
});
