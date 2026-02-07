/**
 * Phase 3b Integration: ConflictResolutionPanel Tests (TDD)
 *
 * Tests for supporting the manual strategy with resolvedSnapshot
 * in the conflict resolution panel submission.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConflictResolutionPanel } from '../../components/ConflictResolutionPanel';
import type { DocumentConflict, DocumentDiff } from '../../types';

// Mock the design toolkit Button
vi.mock('@pantheon-systems/design-toolkit-react', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    ...props
  }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      disabled={(disabled as boolean) || (isLoading as boolean)}
      {...props}
    >
      {children as string}
    </button>
  ),
}));

const conflicts: DocumentConflict[] = [
  {
    documentId: 'doc-1',
    documentPath: '/pages/home',
    conflictType: 'both-modified',
    sourceVersion: 3,
    targetVersion: 2,
  },
];

const diffs: DocumentDiff[] = [
  {
    documentId: 'doc-1',
    documentPath: '/pages/home',
    sourceSnapshot: { title: 'Source Title', body: 'Shared Body' },
    targetSnapshot: { title: 'Target Title', body: 'Shared Body' },
    diffOperations: [
      { op: 'replace', path: '/title', value: 'Source Title' },
    ],
  },
];

describe('ConflictResolutionPanel - manual strategy', () => {
  it('should include resolvedSnapshot when strategy is manual', () => {
    const onResolve = vi.fn();

    render(
      <ConflictResolutionPanel
        conflicts={conflicts}
        documentDiffs={diffs}
        onResolve={onResolve}
        isResolving={false}
        sourceBranchName="feature"
        targetBranchName="main"
      />
    );

    // Select "Choose field by field" for the conflict
    const fieldByFieldOption = screen.getByText(/field by field/i);
    const radio = fieldByFieldOption.closest('label')?.querySelector('input');
    if (radio) {
      fireEvent.click(radio);
    }

    // Resolve the field conflicts - find field-level radios
    const allRadios = screen.getAllByRole('radio');
    const fieldRadios = allRadios.filter(
      (r) => (r as HTMLInputElement).name.startsWith('field-')
    );
    if (fieldRadios.length > 0) {
      fireEvent.click(fieldRadios[0]);
    }

    // Click apply in the FieldResolutionPanel
    const applyResolutionBtn = screen.getByRole('button', { name: /apply resolution/i });
    fireEvent.click(applyResolutionBtn);

    // Now submit the overall resolutions
    const submitBtn = screen.getByRole('button', { name: /apply resolutions and merge/i });
    fireEvent.click(submitBtn);

    expect(onResolve).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: 'doc-1',
          strategy: 'manual',
          resolvedSnapshot: expect.any(Object),
        }),
      ]),
    );
  });

  it('should pass branch names to conflict rows', () => {
    render(
      <ConflictResolutionPanel
        conflicts={conflicts}
        documentDiffs={diffs}
        onResolve={vi.fn()}
        isResolving={false}
        sourceBranchName="my-feature"
        targetBranchName="main"
      />
    );

    // Select field-by-field to see branch names in FieldResolutionPanel
    const fieldByFieldOption = screen.getByText(/field by field/i);
    const radio = fieldByFieldOption.closest('label')?.querySelector('input');
    if (radio) {
      fireEvent.click(radio);
    }

    // Branch names should appear in the field resolution UI
    expect(screen.getByText(/my-feature/)).toBeInTheDocument();
  });
});
