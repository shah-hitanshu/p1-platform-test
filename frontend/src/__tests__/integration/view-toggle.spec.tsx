/**
 * Phase 1 Deferred: View Toggle Tests (TDD)
 *
 * Tests for the JSON/Content view toggle on ExpandableDiffRow
 * and ExpandableConflictRow.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpandableDiffRow } from '../../components/ExpandableDiffRow';
import { ExpandableConflictRow } from '../../components/ExpandableConflictRow';
import type { DocumentConflict, DocumentDiff } from '../../types';

// Mock the design toolkit Button
vi.mock('@pantheon-systems/design-toolkit-react', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as string}</button>
  ),
}));

const conflict: DocumentConflict = {
  documentId: 'doc-1',
  documentPath: '/pages/home',
  conflictType: 'both-modified',
  sourceVersion: 3,
  targetVersion: 2,
};

const diff: DocumentDiff = {
  documentId: 'doc-1',
  documentPath: '/pages/home',
  sourceSnapshot: { title: 'Source Title', body: 'Source Body' },
  targetSnapshot: { title: 'Target Title', body: 'Target Body' },
  diffOperations: [
    { op: 'replace', path: '/title', value: 'Source Title' },
  ],
};

describe('ExpandableDiffRow - view toggle', () => {
  it('should show a toggle button when expanded with diff data', () => {
    render(
      <ExpandableDiffRow
        conflict={conflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Content view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JSON view' })).toBeInTheDocument();
  });

  it('should switch to content view when toggle is clicked', () => {
    render(
      <ExpandableDiffRow
        conflict={conflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
      />
    );

    // Click the view toggle
    const toggleBtn = screen.getByRole('button', { name: /content view/i });
    fireEvent.click(toggleBtn);

    // Should now show content-oriented diff (sections with field labels)
    expect(screen.getByText(/title/i, { selector: '.section-label' })).toBeInTheDocument();
  });
});

describe('ExpandableConflictRow - view toggle', () => {
  it('should show a toggle button when expanded with diff data', () => {
    render(
      <ExpandableConflictRow
        conflict={conflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="take-source"
        onResolutionChange={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Content view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JSON view' })).toBeInTheDocument();
  });
});
