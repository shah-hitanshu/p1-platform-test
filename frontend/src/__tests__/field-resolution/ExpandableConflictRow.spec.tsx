/**
 * Phase 3b Integration: ExpandableConflictRow Tests (TDD)
 *
 * Tests for adding "Choose field by field" option to the conflict
 * resolution radio buttons and showing FieldResolutionPanel.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpandableConflictRow } from '../../components/ExpandableConflictRow';
import type { DocumentConflict, DocumentDiff } from '../../types';

// Mock the design toolkit Button
vi.mock('@pantheon-systems/design-toolkit-react', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as string}</button>
  ),
}));

const bothModifiedConflict: DocumentConflict = {
  documentId: 'doc-1',
  documentPath: '/pages/home',
  conflictType: 'both-modified',
  sourceVersion: 3,
  targetVersion: 2,
};

const deletedConflict: DocumentConflict = {
  documentId: 'doc-2',
  documentPath: '/pages/about',
  conflictType: 'deleted-in-source',
  sourceVersion: undefined,
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

describe('ExpandableConflictRow - field-by-field option', () => {
  it('should show "Choose field by field" option for both-modified conflicts', () => {
    render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        isExpanded={false}
        onToggle={vi.fn()}
        resolution="take-source"
        onResolutionChange={vi.fn()}
      />
    );

    expect(screen.getByText(/field by field/i)).toBeInTheDocument();
  });

  it('should not show "Choose field by field" option for deleted conflicts', () => {
    render(
      <ExpandableConflictRow
        conflict={deletedConflict}
        isExpanded={false}
        onToggle={vi.fn()}
        resolution="take-source"
        onResolutionChange={vi.fn()}
      />
    );

    expect(screen.queryByText(/field by field/i)).not.toBeInTheDocument();
  });

  it('should show FieldResolutionPanel when manual is selected and diff is available', () => {
    render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="manual"
        onResolutionChange={vi.fn()}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // FieldResolutionPanel renders with conflicts section and apply button
    expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
  });

  it('should call onResolvedSnapshot when field resolution is applied', () => {
    const onResolvedSnapshot = vi.fn();

    render(
      <ExpandableConflictRow
        conflict={bothModifiedConflict}
        diff={diff}
        isExpanded={true}
        onToggle={vi.fn()}
        resolution="manual"
        onResolutionChange={vi.fn()}
        onResolvedSnapshot={onResolvedSnapshot}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Select a resolution for ALL conflicting fields (title and body both differ)
    const radioButtons = screen.getAllByRole('radio');
    // Find field-level radio buttons (not the strategy radios)
    const fieldRadios = radioButtons.filter(
      (r) => (r as HTMLInputElement).name.startsWith('field-')
    );
    // Click the first radio option for each conflict (one per field pair)
    for (let i = 0; i < fieldRadios.length; i += 2) {
      fireEvent.click(fieldRadios[i]);
    }

    // Click apply resolution (exact match to avoid matching strategy radios)
    const applyButton = screen.getByRole('button', { name: 'Apply resolution' });
    fireEvent.click(applyButton);

    expect(onResolvedSnapshot).toHaveBeenCalledWith(
      expect.any(Object),
    );
  });
});
