/**
 * Phase 1: Content-Oriented Diff Viewer - ContentDiffViewer Tests (TDD)
 *
 * Tests for the main ContentDiffViewer component that displays
 * grouped content sections with human-readable field changes.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentDiffViewer } from '../../components/content-diff/ContentDiffViewer';
import type { DiffOperation } from '../../types';

describe('ContentDiffViewer', () => {
  it('should render grouped sections for diff operations', () => {
    const sourceData = {
      title: 'Old Title',
      description: 'Old Description',
    };
    const targetData = {
      title: 'New Title',
      description: 'New Description',
    };
    const diffOperations: DiffOperation[] = [
      { op: 'replace', path: '/title', value: 'New Title' },
      { op: 'replace', path: '/description', value: 'New Description' },
    ];

    render(
      <ContentDiffViewer
        sourceData={sourceData}
        targetData={targetData}
        diffOperations={diffOperations}
      />
    );

    expect(screen.getByText('Old Title')).toBeInTheDocument();
    expect(screen.getByText('New Title')).toBeInTheDocument();
    expect(screen.getByText('Old Description')).toBeInTheDocument();
    expect(screen.getByText('New Description')).toBeInTheDocument();
  });

  it('should show old -> new format for replaced values', () => {
    const sourceData = { headline: 'Before' };
    const targetData = { headline: 'After' };
    const diffOperations: DiffOperation[] = [
      { op: 'replace', path: '/headline', value: 'After' },
    ];

    render(
      <ContentDiffViewer
        sourceData={sourceData}
        targetData={targetData}
        diffOperations={diffOperations}
      />
    );

    // Both old and new values should be visible
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('should handle empty diff operations', () => {
    const sourceData = { title: 'Same' };
    const targetData = { title: 'Same' };

    const { container } = render(
      <ContentDiffViewer
        sourceData={sourceData}
        targetData={targetData}
        diffOperations={[]}
      />
    );

    // Should render a "no changes" message or empty state
    const viewer = container.querySelector('.content-diff-viewer');
    expect(viewer).toBeInTheDocument();
    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });

  it('should accept same props interface as JsonDiffViewer', () => {
    // ContentDiffViewer should accept sourceData, targetData, diffOperations,
    // sourceLabel, and targetLabel
    const sourceData = { title: 'Test' };
    const targetData = { title: 'Test Changed' };
    const diffOperations: DiffOperation[] = [
      { op: 'replace', path: '/title', value: 'Test Changed' },
    ];

    // Should not throw
    render(
      <ContentDiffViewer
        sourceData={sourceData}
        targetData={targetData}
        diffOperations={diffOperations}
        sourceLabel="Branch A"
        targetLabel="Branch B"
      />
    );
  });

  it('should display change count summary', () => {
    const sourceData = { a: '1', b: '2', c: '3' };
    const targetData = { a: '1', b: 'changed', c: 'changed' };
    const diffOperations: DiffOperation[] = [
      { op: 'replace', path: '/b', value: 'changed' },
      { op: 'replace', path: '/c', value: 'changed' },
    ];

    render(
      <ContentDiffViewer
        sourceData={sourceData}
        targetData={targetData}
        diffOperations={diffOperations}
      />
    );

    // Should show a summary with the count of changes
    expect(screen.getByText(/2 change/i)).toBeInTheDocument();
  });

  it('should handle null source data (new document)', () => {
    const targetData = { title: 'New Document', body: 'Content' };
    const diffOperations: DiffOperation[] = [
      { op: 'add', path: '/title', value: 'New Document' },
      { op: 'add', path: '/body', value: 'Content' },
    ];

    render(
      <ContentDiffViewer
        sourceData={null}
        targetData={targetData}
        diffOperations={diffOperations}
      />
    );

    expect(screen.getByText('New Document')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should handle null target data (deleted document)', () => {
    const sourceData = { title: 'Deleted Document' };
    const diffOperations: DiffOperation[] = [
      { op: 'remove', path: '/title' },
    ];

    render(
      <ContentDiffViewer
        sourceData={sourceData}
        targetData={null}
        diffOperations={diffOperations}
      />
    );

    expect(screen.getByText('Deleted Document')).toBeInTheDocument();
  });

  it('should group Puck data by component when detected', () => {
    const sourceData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Old Heading' } },
        { type: 'Text', props: { id: 't1', body: 'Paragraph' } },
      ],
      root: { props: { title: 'Page' } },
    };
    const targetData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'New Heading' } },
        { type: 'Text', props: { id: 't1', body: 'Paragraph' } },
      ],
      root: { props: { title: 'Page' } },
    };
    const diffOperations: DiffOperation[] = [
      { op: 'replace', path: '/content/0/props/text', value: 'New Heading' },
    ];

    render(
      <ContentDiffViewer
        sourceData={sourceData}
        targetData={targetData}
        diffOperations={diffOperations}
      />
    );

    // Should show the component type name as section heading
    expect(screen.getByText(/Heading/)).toBeInTheDocument();
    // Should show the field change
    expect(screen.getByText('Old Heading')).toBeInTheDocument();
    expect(screen.getByText('New Heading')).toBeInTheDocument();
  });

  it('should render legend with add/remove/change indicators', () => {
    const sourceData = { title: 'Test' };
    const targetData = { title: 'Changed' };
    const diffOperations: DiffOperation[] = [
      { op: 'replace', path: '/title', value: 'Changed' },
    ];

    render(
      <ContentDiffViewer
        sourceData={sourceData}
        targetData={targetData}
        diffOperations={diffOperations}
      />
    );

    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.getByText('Changed')).toBeInTheDocument();
  });
});
