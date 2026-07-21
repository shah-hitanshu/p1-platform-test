/**
 * Phase 2: Document-Level Change Summary - categorizeChanges Tests (TDD)
 *
 * Tests for the pure function that categorizes document-level changes
 * from merge preview data into added, removed, and modified groups.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import {
  categorizeChanges,
} from '../../components/document-change-summary/categorizeChanges';
import type { ModifiedDocument, DocumentConflict } from '../../types';

function makeModifiedDoc(overrides: Partial<ModifiedDocument> = {}): ModifiedDocument {
  return {
    documentId: 'doc-1',
    documentPath: '/pages/home',
    latestVersionId: 'v-1',
    latestVersionNumber: 2,
    baseVersionId: 'v-0',
    baseVersionNumber: 1,
    ...overrides,
  };
}

describe('categorizeChanges', () => {
  it('should categorize source-only changes as source-modified', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'doc-1', documentPath: '/pages/home' }),
    ];
    const targetChanges: ModifiedDocument[] = [];
    const conflicts: DocumentConflict[] = [];

    const result = categorizeChanges(sourceChanges, targetChanges, conflicts);

    expect(result.sourceOnly).toHaveLength(1);
    expect(result.sourceOnly[0].documentId).toBe('doc-1');
    expect(result.targetOnly).toHaveLength(0);
    expect(result.conflicting).toHaveLength(0);
  });

  it('should categorize target-only changes as target-modified', () => {
    const sourceChanges: ModifiedDocument[] = [];
    const targetChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'doc-2', documentPath: '/pages/about' }),
    ];
    const conflicts: DocumentConflict[] = [];

    const result = categorizeChanges(sourceChanges, targetChanges, conflicts);

    expect(result.targetOnly).toHaveLength(1);
    expect(result.targetOnly[0].documentId).toBe('doc-2');
    expect(result.sourceOnly).toHaveLength(0);
    expect(result.conflicting).toHaveLength(0);
  });

  it('should categorize documents in both branches with conflicts as conflicting', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'doc-1', documentPath: '/pages/home' }),
    ];
    const targetChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'doc-1', documentPath: '/pages/home' }),
    ];
    const conflicts: DocumentConflict[] = [
      {
        documentId: 'doc-1',
        documentPath: '/pages/home',
        conflictType: 'both-modified',
        sourceVersion: 3,
        targetVersion: 2,
      },
    ];

    const result = categorizeChanges(sourceChanges, targetChanges, conflicts);

    expect(result.conflicting).toHaveLength(1);
    expect(result.conflicting[0].documentId).toBe('doc-1');
    // Conflicting docs should NOT appear in sourceOnly or targetOnly
    expect(result.sourceOnly).toHaveLength(0);
    expect(result.targetOnly).toHaveLength(0);
  });

  it('should categorize deleted documents', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({
        documentId: 'doc-deleted',
        documentPath: '/pages/old',
        isDeleted: true,
        latestVersionId: null,
        latestVersionNumber: null,
      }),
    ];
    const targetChanges: ModifiedDocument[] = [];
    const conflicts: DocumentConflict[] = [];

    const result = categorizeChanges(sourceChanges, targetChanges, conflicts);

    expect(result.sourceOnly).toHaveLength(1);
    expect(result.sourceOnly[0].isDeleted).toBe(true);
  });

  it('should handle mixed changes across all categories', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'src-only', documentPath: '/pages/new' }),
      makeModifiedDoc({ documentId: 'conflict-doc', documentPath: '/pages/shared' }),
    ];
    const targetChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'tgt-only', documentPath: '/pages/other' }),
      makeModifiedDoc({ documentId: 'conflict-doc', documentPath: '/pages/shared' }),
    ];
    const conflicts: DocumentConflict[] = [
      {
        documentId: 'conflict-doc',
        documentPath: '/pages/shared',
        conflictType: 'both-modified',
        sourceVersion: 3,
        targetVersion: 2,
      },
    ];

    const result = categorizeChanges(sourceChanges, targetChanges, conflicts);

    expect(result.sourceOnly).toHaveLength(1);
    expect(result.sourceOnly[0].documentId).toBe('src-only');
    expect(result.targetOnly).toHaveLength(1);
    expect(result.targetOnly[0].documentId).toBe('tgt-only');
    expect(result.conflicting).toHaveLength(1);
    expect(result.conflicting[0].documentId).toBe('conflict-doc');
  });

  it('should handle empty inputs', () => {
    const result = categorizeChanges([], [], []);

    expect(result.sourceOnly).toHaveLength(0);
    expect(result.targetOnly).toHaveLength(0);
    expect(result.conflicting).toHaveLength(0);
    expect(result.totalChanges).toBe(0);
  });

  it('should compute totalChanges correctly', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'a', documentPath: '/a' }),
      makeModifiedDoc({ documentId: 'b', documentPath: '/b' }),
    ];
    const targetChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'c', documentPath: '/c' }),
    ];
    const conflicts: DocumentConflict[] = [];

    const result = categorizeChanges(sourceChanges, targetChanges, conflicts);

    expect(result.totalChanges).toBe(3);
  });

  it('should not double-count conflicting documents in totalChanges', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'shared', documentPath: '/shared' }),
    ];
    const targetChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'shared', documentPath: '/shared' }),
    ];
    const conflicts: DocumentConflict[] = [
      {
        documentId: 'shared',
        documentPath: '/shared',
        conflictType: 'both-modified',
        sourceVersion: 2,
        targetVersion: 3,
      },
    ];

    const result = categorizeChanges(sourceChanges, targetChanges, conflicts);

    // 1 conflicting doc, not counted as source-only or target-only
    expect(result.totalChanges).toBe(1);
  });

  it('should handle deleted-in-source conflict type', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'del-src', documentPath: '/deleted', isDeleted: true }),
    ];
    const targetChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'del-src', documentPath: '/deleted' }),
    ];
    const conflicts: DocumentConflict[] = [
      {
        documentId: 'del-src',
        documentPath: '/deleted',
        conflictType: 'deleted-in-source',
        targetVersion: 2,
      },
    ];

    const result = categorizeChanges(sourceChanges, targetChanges, conflicts);

    expect(result.conflicting).toHaveLength(1);
    expect(result.conflicting[0].conflictType).toBe('deleted-in-source');
  });
});
