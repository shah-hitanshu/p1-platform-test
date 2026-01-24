/**
 * Phase 5.2c: CRDT Merge Service Tests (TDD)
 *
 * Tests for resolving document conflicts using Yjs CRDT merge.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock document version service
vi.mock('../../src/services/document-version-service', () => ({
  getDocumentVersion: vi.fn(),
  createDocumentVersion: vi.fn(),
}));

/**
 * Helper to create a Yjs document with content and return its state as base64
 */
function createYjsState(content: Record<string, unknown>): string {
  const doc = new Y.Doc();
  const root = doc.getMap('root');

  function setNestedValue(map: Y.Map<unknown>, obj: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const nestedMap = new Y.Map<unknown>();
        map.set(key, nestedMap);
        setNestedValue(nestedMap, value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        const arr = new Y.Array<unknown>();
        arr.push(value);
        map.set(key, arr);
      } else {
        map.set(key, value);
      }
    }
  }

  setNestedValue(root, content);
  const state = Y.encodeStateAsUpdate(doc);
  return Buffer.from(state).toString('base64');
}

describe('Phase 5.2c: CRDT Merge Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('mergeCrdtStates', () => {
    it('should merge two CRDT states with non-conflicting changes', async () => {
      const { mergeCrdtStates } = await import('../../src/services/crdt-merge-service');

      // Source added field 'author', target added field 'date'
      const sourceState = createYjsState({ title: 'Hello', author: 'Alice' });
      const targetState = createYjsState({ title: 'Hello', date: '2026-01-20' });
      const baseState = createYjsState({ title: 'Hello' });

      const result = mergeCrdtStates({
        sourceState,
        targetState,
        baseState,
      });

      expect(result.success).toBe(true);
      expect(result.mergedSnapshot).toBeDefined();
      // The merged result should contain changes from both
      expect(result.mergedSnapshot?.title).toBe('Hello');
    });

    it('should merge CRDT states when same field modified differently', async () => {
      const { mergeCrdtStates } = await import('../../src/services/crdt-merge-service');

      // Both modified 'title' - CRDT will use last-writer-wins or merge
      const sourceState = createYjsState({ title: 'Source Title' });
      const targetState = createYjsState({ title: 'Target Title' });
      const baseState = createYjsState({ title: 'Original' });

      const result = mergeCrdtStates({
        sourceState,
        targetState,
        baseState,
      });

      expect(result.success).toBe(true);
      expect(result.mergedState).toBeDefined();
      // CRDT merge produces a deterministic result
      expect(typeof result.mergedSnapshot?.title).toBe('string');
    });

    it('should return merged state as base64', async () => {
      const { mergeCrdtStates } = await import('../../src/services/crdt-merge-service');

      const sourceState = createYjsState({ content: 'Source content' });
      const targetState = createYjsState({ content: 'Target content' });

      const result = mergeCrdtStates({
        sourceState,
        targetState,
      });

      expect(result.success).toBe(true);
      expect(result.mergedState).toBeDefined();
      // Should be valid base64 - mergedState is guaranteed to be defined when success is true
      if (result.mergedState !== undefined) {
        expect(() => Buffer.from(result.mergedState, 'base64')).not.toThrow();
      }
    });

    it('should handle empty base state (new document)', async () => {
      const { mergeCrdtStates } = await import('../../src/services/crdt-merge-service');

      const sourceState = createYjsState({ title: 'New Doc' });
      const targetState = createYjsState({ content: 'Some content' });

      const result = mergeCrdtStates({
        sourceState,
        targetState,
        // No base state
      });

      expect(result.success).toBe(true);
    });

    it('should throw InvalidCrdtStateError for invalid base64', async () => {
      const { mergeCrdtStates, InvalidCrdtStateError } = await import(
        '../../src/services/crdt-merge-service'
      );

      expect(() =>
        mergeCrdtStates({
          sourceState: 'not-valid-base64!!!',
          targetState: createYjsState({ title: 'Valid' }),
        }),
      ).toThrow(InvalidCrdtStateError);
    });
  });

  describe('resolveWithCrdtMerge', () => {
    it('should fetch versions, merge CRDT states, and create new version', async () => {
      const { resolveWithCrdtMerge } = await import('../../src/services/crdt-merge-service');
      const docVersionService = await import('../../src/services/document-version-service');

      const sourceState = createYjsState({ title: 'Source', author: 'Alice' });
      const targetState = createYjsState({ title: 'Target', reviewer: 'Bob' });

      // Mock source version with CRDT state
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'source-version-id',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 3,
        snapshot: { title: 'Source', author: 'Alice' },
        crdtState: sourceState,
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      // Mock target version with CRDT state
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'target-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 2,
        snapshot: { title: 'Target', reviewer: 'Bob' },
        crdtState: targetState,
        createdAt: '2026-01-20T09:00:00.000Z',
        createdById: 'user-2',
        createdByType: 'user',
        source: 'edit',
      });

      // Mock version creation
      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'merged-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 4,
        snapshot: { title: 'Merged' },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'resolver-user',
        createdByType: 'user',
        source: 'merge',
      });

      const result = await resolveWithCrdtMerge({
        documentId: 'doc-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        sourceVersionId: 'source-version-id',
        targetVersionId: 'target-version-id',
        resolvedById: 'resolver-user',
        resolvedByType: 'user',
      });

      expect(result.resolved).toBe(true);
      expect(result.strategy).toBe('merge-crdt');
      expect(result.resultVersionId).toBe('merged-version-id');

      // Verify createDocumentVersion was called with merged state
      expect(docVersionService.createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          branchId: 'target-branch',
          source: 'merge',
        }),
      );
    });

    it('should throw MissingCrdtStateError when source has no CRDT state', async () => {
      const { resolveWithCrdtMerge, MissingCrdtStateError } = await import(
        '../../src/services/crdt-merge-service'
      );
      const docVersionService = await import('../../src/services/document-version-service');

      // Source version without CRDT state
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'source-version-id',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 3,
        snapshot: { title: 'Source' },
        // No crdtState
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      await expect(
        resolveWithCrdtMerge({
          documentId: 'doc-1',
          sourceBranchId: 'source-branch',
          targetBranchId: 'target-branch',
          sourceVersionId: 'source-version-id',
          targetVersionId: 'target-version-id',
          resolvedById: 'resolver-user',
          resolvedByType: 'user',
        }),
      ).rejects.toThrow(MissingCrdtStateError);
    });

    it('should throw MissingCrdtStateError when target has no CRDT state', async () => {
      const { resolveWithCrdtMerge, MissingCrdtStateError } = await import(
        '../../src/services/crdt-merge-service'
      );
      const docVersionService = await import('../../src/services/document-version-service');

      const sourceState = createYjsState({ title: 'Source' });

      // Source version with CRDT state
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'source-version-id',
        documentId: 'doc-1',
        branchId: 'source-branch',
        versionNumber: 3,
        snapshot: { title: 'Source' },
        crdtState: sourceState,
        createdAt: '2026-01-20T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
        source: 'edit',
      });

      // Target version without CRDT state
      vi.mocked(docVersionService.getDocumentVersion).mockResolvedValueOnce({
        id: 'target-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 2,
        snapshot: { title: 'Target' },
        // No crdtState
        createdAt: '2026-01-20T09:00:00.000Z',
        createdById: 'user-2',
        createdByType: 'user',
        source: 'edit',
      });

      await expect(
        resolveWithCrdtMerge({
          documentId: 'doc-1',
          sourceBranchId: 'source-branch',
          targetBranchId: 'target-branch',
          sourceVersionId: 'source-version-id',
          targetVersionId: 'target-version-id',
          resolvedById: 'resolver-user',
          resolvedByType: 'user',
        }),
      ).rejects.toThrow(MissingCrdtStateError);
    });

    it('should include resolution metadata in result', async () => {
      const { resolveWithCrdtMerge } = await import('../../src/services/crdt-merge-service');
      const docVersionService = await import('../../src/services/document-version-service');

      const sourceState = createYjsState({ title: 'Source' });
      const targetState = createYjsState({ title: 'Target' });

      vi.mocked(docVersionService.getDocumentVersion)
        .mockResolvedValueOnce({
          id: 'source-version-id',
          documentId: 'doc-1',
          branchId: 'source-branch',
          versionNumber: 3,
          snapshot: { title: 'Source' },
          crdtState: sourceState,
          createdAt: '2026-01-20T10:00:00.000Z',
          createdById: 'user-1',
          createdByType: 'user',
          source: 'edit',
        })
        .mockResolvedValueOnce({
          id: 'target-version-id',
          documentId: 'doc-1',
          branchId: 'target-branch',
          versionNumber: 2,
          snapshot: { title: 'Target' },
          crdtState: targetState,
          createdAt: '2026-01-20T09:00:00.000Z',
          createdById: 'user-2',
          createdByType: 'user',
          source: 'edit',
        });

      vi.mocked(docVersionService.createDocumentVersion).mockResolvedValueOnce({
        id: 'merged-version-id',
        documentId: 'doc-1',
        branchId: 'target-branch',
        versionNumber: 4,
        snapshot: { title: 'Merged' },
        createdAt: '2026-01-20T11:00:00.000Z',
        createdById: 'resolver-user',
        createdByType: 'user',
        source: 'merge',
      });

      const result = await resolveWithCrdtMerge({
        documentId: 'doc-1',
        sourceBranchId: 'source-branch',
        targetBranchId: 'target-branch',
        sourceVersionId: 'source-version-id',
        targetVersionId: 'target-version-id',
        resolvedById: 'resolver-user',
        resolvedByType: 'user',
      });

      expect(result.resolvedById).toBe('resolver-user');
      expect(result.resolvedByType).toBe('user');
      expect(result.documentId).toBe('doc-1');
    });
  });

  describe('extractSnapshotFromYDoc', () => {
    it('should convert Yjs document to plain JavaScript object', async () => {
      const { extractSnapshotFromYDoc } = await import('../../src/services/crdt-merge-service');

      const doc = new Y.Doc();
      const root = doc.getMap('root');
      root.set('title', 'Test Title');
      root.set('count', 42);

      const snapshot = extractSnapshotFromYDoc(doc);

      expect(snapshot.title).toBe('Test Title');
      expect(snapshot.count).toBe(42);
    });

    it('should handle nested objects', async () => {
      const { extractSnapshotFromYDoc } = await import('../../src/services/crdt-merge-service');

      const doc = new Y.Doc();
      const root = doc.getMap('root');
      const nested = new Y.Map<unknown>();
      nested.set('name', 'Nested');
      root.set('child', nested);

      const snapshot = extractSnapshotFromYDoc(doc);

      expect(snapshot.child).toBeDefined();
      expect((snapshot.child as Record<string, unknown>).name).toBe('Nested');
    });

    it('should handle arrays', async () => {
      const { extractSnapshotFromYDoc } = await import('../../src/services/crdt-merge-service');

      const doc = new Y.Doc();
      const root = doc.getMap('root');
      const arr = new Y.Array<unknown>();
      arr.push(['item1', 'item2']);
      root.set('items', arr);

      const snapshot = extractSnapshotFromYDoc(doc);

      expect(Array.isArray(snapshot.items)).toBe(true);
      expect((snapshot.items as string[])).toContain('item1');
    });
  });

  describe('Error Classes', () => {
    it('should export InvalidCrdtStateError with correct properties', async () => {
      const { InvalidCrdtStateError } = await import('../../src/services/crdt-merge-service');

      const error = new InvalidCrdtStateError('source', 'Invalid base64');

      expect(error.name).toBe('InvalidCrdtStateError');
      expect(error.source).toBe('source');
      expect(error.message).toContain('source');
    });

    it('should export MissingCrdtStateError with correct properties', async () => {
      const { MissingCrdtStateError } = await import('../../src/services/crdt-merge-service');

      const error = new MissingCrdtStateError('version-123');

      expect(error.name).toBe('MissingCrdtStateError');
      expect(error.versionId).toBe('version-123');
      expect(error.message).toContain('version-123');
    });
  });
});
