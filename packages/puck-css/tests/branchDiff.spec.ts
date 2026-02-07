/**
 * Branch Diff Utility Tests (TDD - Phase 4)
 *
 * Tests for utilities that bridge the merge preview API data
 * with the existing Puck diff utilities for branch-level comparison.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import type { PuckData } from '@pantheon/css-client';
import {
  isPuckData,
  createBranchDocumentComparison,
  createBranchMergeComparison,
} from '../src/utils/branchDiff.js';
import type {
  BranchDocumentComparison,
  BranchMergeComparison,
  DocumentDiffSummary,
} from '../src/utils/branchDiff.js';

describe('isPuckData (branchDiff)', () => {
  it('should return true for valid Puck data', () => {
    const data: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1', text: 'Hello' } },
      ],
      root: { props: {} },
    };
    expect(isPuckData(data)).toBe(true);
  });

  it('should return false for non-Puck JSON', () => {
    const data = { title: 'hello', body: 'world' };
    expect(isPuckData(data)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isPuckData(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isPuckData(undefined)).toBe(false);
  });

  it('should return false for primitives', () => {
    expect(isPuckData('hello')).toBe(false);
    expect(isPuckData(42)).toBe(false);
    expect(isPuckData(true)).toBe(false);
  });
});

describe('createBranchDocumentComparison', () => {
  it('should create comparison for two Puck data snapshots', () => {
    const source: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Source Title' } },
        { type: 'Text', props: { id: 't1', text: 'Hello' } },
      ],
      root: { props: {} },
    };
    const target: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Target Title' } },
      ],
      root: { props: {} },
    };

    const comparison = createBranchDocumentComparison(
      'doc-1',
      '/pages/home',
      source,
      target
    );

    expect(comparison.documentId).toBe('doc-1');
    expect(comparison.documentPath).toBe('/pages/home');
    expect(comparison.isPuckData).toBe(true);
    expect(comparison.diffs.length).toBeGreaterThan(0);
    expect(comparison.counts.modified).toBeGreaterThanOrEqual(1);
  });

  it('should handle null source snapshot (document only in target)', () => {
    const target: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1', text: 'Hello' } },
      ],
      root: { props: {} },
    };

    const comparison = createBranchDocumentComparison(
      'doc-1',
      '/pages/about',
      null,
      target
    );

    expect(comparison.documentId).toBe('doc-1');
    expect(comparison.isPuckData).toBe(true);
    expect(comparison.diffs.length).toBeGreaterThan(0);
    expect(comparison.counts.added).toBe(1);
  });

  it('should handle null target snapshot (document only in source)', () => {
    const source: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1', text: 'Hello' } },
      ],
      root: { props: {} },
    };

    const comparison = createBranchDocumentComparison(
      'doc-1',
      '/pages/removed',
      source,
      null
    );

    expect(comparison.documentId).toBe('doc-1');
    expect(comparison.isPuckData).toBe(true);
    expect(comparison.diffs.length).toBeGreaterThan(0);
    expect(comparison.counts.removed).toBe(1);
  });

  it('should handle non-Puck data gracefully', () => {
    const source = { title: 'Source', body: 'text' };
    const target = { title: 'Target', body: 'text' };

    const comparison = createBranchDocumentComparison(
      'doc-1',
      '/data/config',
      source as unknown as PuckData,
      target as unknown as PuckData
    );

    expect(comparison.isPuckData).toBe(false);
    expect(comparison.diffs).toHaveLength(0);
  });

  it('should handle both snapshots being null', () => {
    const comparison = createBranchDocumentComparison(
      'doc-1',
      '/pages/empty',
      null,
      null
    );

    expect(comparison.isPuckData).toBe(false);
    expect(comparison.diffs).toHaveLength(0);
  });

  it('should detect identical Puck data as unchanged', () => {
    const data: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1', text: 'Same' } },
      ],
      root: { props: {} },
    };

    const comparison = createBranchDocumentComparison(
      'doc-1',
      '/pages/same',
      data,
      data
    );

    expect(comparison.counts.added).toBe(0);
    expect(comparison.counts.removed).toBe(0);
    expect(comparison.counts.modified).toBe(0);
  });
});

describe('createBranchMergeComparison', () => {
  const documents: Array<{
    documentId: string;
    documentPath: string;
    sourceSnapshot: unknown;
    targetSnapshot: unknown;
  }> = [
    {
      documentId: 'doc-1',
      documentPath: '/pages/home',
      sourceSnapshot: {
        content: [
          { type: 'Heading', props: { id: 'h1', text: 'Home Source' } },
        ],
        root: { props: {} },
      },
      targetSnapshot: {
        content: [
          { type: 'Heading', props: { id: 'h1', text: 'Home Target' } },
        ],
        root: { props: {} },
      },
    },
    {
      documentId: 'doc-2',
      documentPath: '/pages/about',
      sourceSnapshot: {
        content: [
          { type: 'Text', props: { id: 't1', text: 'About Source' } },
        ],
        root: { props: {} },
      },
      targetSnapshot: {
        content: [
          { type: 'Text', props: { id: 't1', text: 'About Source' } },
        ],
        root: { props: {} },
      },
    },
  ];

  it('should create comparisons for multiple documents', () => {
    const result = createBranchMergeComparison(documents);

    expect(result.documents).toHaveLength(2);
    expect(result.documents[0].documentId).toBe('doc-1');
    expect(result.documents[1].documentId).toBe('doc-2');
  });

  it('should aggregate total change counts across documents', () => {
    const result = createBranchMergeComparison(documents);

    expect(result.totalCounts).toBeDefined();
    // doc-1 has modified content, doc-2 is unchanged
    expect(result.totalCounts.modified).toBeGreaterThanOrEqual(1);
  });

  it('should track total document count', () => {
    const result = createBranchMergeComparison(documents);
    expect(result.documentCount).toBe(2);
  });

  it('should track count of documents with changes', () => {
    const result = createBranchMergeComparison(documents);
    expect(result.changedDocumentCount).toBe(1); // Only doc-1 has changes
  });

  it('should handle empty document list', () => {
    const result = createBranchMergeComparison([]);

    expect(result.documents).toHaveLength(0);
    expect(result.documentCount).toBe(0);
    expect(result.changedDocumentCount).toBe(0);
  });

  it('should handle mixed Puck and non-Puck documents', () => {
    const mixed = [
      ...documents,
      {
        documentId: 'doc-3',
        documentPath: '/data/config',
        sourceSnapshot: { key: 'source-value' },
        targetSnapshot: { key: 'target-value' },
      },
    ];

    const result = createBranchMergeComparison(mixed);

    expect(result.documents).toHaveLength(3);
    const puckDocs = result.documents.filter((d) => d.isPuckData);
    const nonPuckDocs = result.documents.filter((d) => !d.isPuckData);
    expect(puckDocs).toHaveLength(2);
    expect(nonPuckDocs).toHaveLength(1);
  });
});
