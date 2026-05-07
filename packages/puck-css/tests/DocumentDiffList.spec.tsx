/**
 * DocumentDiffList Component Tests (TDD - Phase 4)
 *
 * Tests for the multi-document wrapper component that shows
 * a list of documents with change summaries, expandable to
 * show per-document comparison.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentDiffList } from '../src/versioning/components/version-compare/DocumentDiffList.js';
import type { BranchDocumentComparison } from '../src/versioning/utils/branchDiff.js';
import type { ComponentDiffWithPosition } from '../src/core/types.js';

const createComparison = (
  id: string,
  path: string,
  isPuck: boolean,
  diffs: ComponentDiffWithPosition[] = []
): BranchDocumentComparison => ({
  documentId: id,
  documentPath: path,
  isPuckData: isPuck,
  diffs,
  counts: {
    added: diffs.filter((d) => d.type === 'added').length,
    removed: diffs.filter((d) => d.type === 'removed').length,
    modified: diffs.filter((d) => d.type === 'modified').length,
    unchanged: diffs.filter((d) => d.type === 'unchanged').length,
  },
});

describe('DocumentDiffList', () => {
  const documents: BranchDocumentComparison[] = [
    createComparison('doc-1', '/pages/home', true, [
      {
        type: 'modified',
        componentId: 'h1',
        componentType: 'Heading',
        path: ['content'],
        beforeIndex: 0,
        afterIndex: 0,
      },
    ]),
    createComparison('doc-2', '/pages/about', true, [
      {
        type: 'added',
        componentId: 't1',
        componentType: 'Text',
        path: ['content'],
        afterIndex: 0,
      },
      {
        type: 'removed',
        componentId: 'i1',
        componentType: 'Image',
        path: ['content'],
        beforeIndex: 1,
      },
    ]),
    createComparison('doc-3', '/data/config', false),
  ];

  it('should render document paths for all documents', () => {
    render(
      <DocumentDiffList
        documents={documents}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText('/pages/home')).toBeInTheDocument();
    expect(screen.getByText('/pages/about')).toBeInTheDocument();
    expect(screen.getByText('/data/config')).toBeInTheDocument();
  });

  it('should show change count badges per document', () => {
    render(
      <DocumentDiffList
        documents={documents}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // doc-2 has +1 added, -1 removed
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('should expand document to show component diffs when clicked', () => {
    render(
      <DocumentDiffList
        documents={documents}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Click on home page row
    fireEvent.click(screen.getByText('/pages/home'));

    // Should now show the component type in the expanded diff view
    expect(screen.getByText('Heading')).toBeInTheDocument();
  });

  it('should collapse expanded document when clicked again', () => {
    render(
      <DocumentDiffList
        documents={documents}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Click to expand
    fireEvent.click(screen.getByText('/pages/home'));
    expect(screen.getByText('Heading')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(screen.getByText('/pages/home'));
    expect(screen.queryByText('Heading')).not.toBeInTheDocument();
  });

  it('should show non-Puck fallback for non-Puck documents', () => {
    render(
      <DocumentDiffList
        documents={documents}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Click non-Puck document
    fireEvent.click(screen.getByText('/data/config'));

    // Should show a message about non-Puck data
    expect(screen.getByText(/not a Puck document/i)).toBeInTheDocument();
  });

  it('should show empty state when no documents', () => {
    render(
      <DocumentDiffList
        documents={[]}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText(/no documents/i)).toBeInTheDocument();
  });

  it('should show total summary header', () => {
    render(
      <DocumentDiffList
        documents={documents}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Should show how many documents and how many have changes
    expect(screen.getByText(/3 documents/i)).toBeInTheDocument();
  });

  it('should indicate which documents have changes vs unchanged', () => {
    const withUnchanged: BranchDocumentComparison[] = [
      ...documents,
      createComparison('doc-4', '/pages/unchanged', true, [
        {
          type: 'unchanged',
          componentId: 'u1',
          componentType: 'Text',
          path: ['content'],
          beforeIndex: 0,
          afterIndex: 0,
        },
      ]),
    ];

    render(
      <DocumentDiffList
        documents={withUnchanged}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText(/4 documents/i)).toBeInTheDocument();
  });
});
