/**
 * Phase 2: Document-Level Change Summary - DocumentChangeSummary Component Tests (TDD)
 *
 * Tests for the component that renders categorized document changes
 * with icons/badges per category.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocumentChangeSummary } from '../../components/document-change-summary/DocumentChangeSummary';
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

describe('DocumentChangeSummary', () => {
  it('should render source-only changes category', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'doc-1', documentPath: '/pages/home' }),
      makeModifiedDoc({ documentId: 'doc-2', documentPath: '/pages/about' }),
    ];

    render(
      <DocumentChangeSummary
        sourceChanges={sourceChanges}
        targetChanges={[]}
        conflicts={[]}
        sourceBranchName="feature-branch"
        targetBranchName="main"
      />
    );

    // Should show source branch changes with count
    expect(screen.getByText(/feature-branch/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should render target-only changes category', () => {
    const targetChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'doc-3', documentPath: '/pages/contact' }),
    ];

    render(
      <DocumentChangeSummary
        sourceChanges={[]}
        targetChanges={targetChanges}
        conflicts={[]}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText(/main/)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('should render conflicting documents category', () => {
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

    render(
      <DocumentChangeSummary
        sourceChanges={sourceChanges}
        targetChanges={targetChanges}
        conflicts={conflicts}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
  });

  it('should hide empty categories', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'doc-1', documentPath: '/pages/home' }),
    ];

    const { container } = render(
      <DocumentChangeSummary
        sourceChanges={sourceChanges}
        targetChanges={[]}
        conflicts={[]}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Should not show conflict section when there are no conflicts
    const sections = container.querySelectorAll('.change-category');
    // Only source category should be present
    expect(sections.length).toBe(1);
  });

  it('should display document paths in each category', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'doc-1', documentPath: '/pages/home' }),
    ];

    render(
      <DocumentChangeSummary
        sourceChanges={sourceChanges}
        targetChanges={[]}
        conflicts={[]}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText('/pages/home')).toBeInTheDocument();
  });

  it('should render empty state when no changes exist', () => {
    render(
      <DocumentChangeSummary
        sourceChanges={[]}
        targetChanges={[]}
        conflicts={[]}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText(/no document changes/i)).toBeInTheDocument();
  });

  it('should show total change count', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'a', documentPath: '/a' }),
    ];
    const targetChanges: ModifiedDocument[] = [
      makeModifiedDoc({ documentId: 'b', documentPath: '/b' }),
    ];

    render(
      <DocumentChangeSummary
        sourceChanges={sourceChanges}
        targetChanges={targetChanges}
        conflicts={[]}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Should show total somewhere
    expect(screen.getByText(/2 document/i)).toBeInTheDocument();
  });

  it('should indicate deleted documents', () => {
    const sourceChanges: ModifiedDocument[] = [
      makeModifiedDoc({
        documentId: 'del-1',
        documentPath: '/pages/old',
        isDeleted: true,
        latestVersionId: null,
        latestVersionNumber: null,
      }),
    ];

    render(
      <DocumentChangeSummary
        sourceChanges={sourceChanges}
        targetChanges={[]}
        conflicts={[]}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    expect(screen.getByText(/deleted/i)).toBeInTheDocument();
  });
});
