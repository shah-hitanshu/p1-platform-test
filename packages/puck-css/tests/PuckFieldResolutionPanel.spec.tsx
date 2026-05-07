/**
 * PuckFieldResolutionPanel Component Tests (TDD - Phase 3c)
 *
 * Tests for the Puck-aware field resolution panel that groups conflicts
 * by component and shows readable prop names.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PuckData } from '@pantheon-systems/css-client';
import { PuckFieldResolutionPanel } from '../src/merge/components/conflict-resolution/PuckFieldResolutionPanel.js';
import { ComponentConflictGroup } from '../src/merge/components/conflict-resolution/ComponentConflictGroup.js';

describe('PuckFieldResolutionPanel', () => {
  const base: PuckData = {
    content: [
      { type: 'Heading', props: { id: 'h1', text: 'Original Title', size: 'large' } },
      { type: 'Text', props: { id: 't1', body: 'Original body' } },
    ],
    root: { props: {} },
  };

  const source: PuckData = {
    content: [
      { type: 'Heading', props: { id: 'h1', text: 'Source Title', size: 'large' } },
      { type: 'Text', props: { id: 't1', body: 'Source body' } },
    ],
    root: { props: {} },
  };

  const target: PuckData = {
    content: [
      { type: 'Heading', props: { id: 'h1', text: 'Target Title', size: 'small' } },
      { type: 'Text', props: { id: 't1', body: 'Original body' } },
    ],
    root: { props: {} },
  };

  it('should group conflicts by component', () => {
    render(
      <PuckFieldResolutionPanel
        sourceSnapshot={source}
        targetSnapshot={target}
        baseSnapshot={base}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    // Should show component type names as group headers
    expect(screen.getByText(/Heading/)).toBeInTheDocument();
  });

  it('should show readable prop names instead of JSON paths', () => {
    render(
      <PuckFieldResolutionPanel
        sourceSnapshot={source}
        targetSnapshot={target}
        baseSnapshot={base}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    // Should show prop name "text" not "/content/0/props/text"
    expect(screen.getByText(/text/)).toBeInTheDocument();
  });

  it('should show source and target values for conflicting fields', () => {
    render(
      <PuckFieldResolutionPanel
        sourceSnapshot={source}
        targetSnapshot={target}
        baseSnapshot={base}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    expect(screen.getByText('Source Title')).toBeInTheDocument();
    expect(screen.getByText('Target Title')).toBeInTheDocument();
  });

  it('should show auto-merged fields for non-conflicting changes', () => {
    render(
      <PuckFieldResolutionPanel
        sourceSnapshot={source}
        targetSnapshot={target}
        baseSnapshot={base}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    // 'body' was only changed in source -> auto-merged
    // 'size' was only changed in target -> auto-merged
    // Either should appear as auto-merged
    expect(screen.getByText(/auto/i)).toBeInTheDocument();
  });

  it('should call onResolve with merged snapshot when all conflicts resolved', () => {
    const onResolve = vi.fn();

    render(
      <PuckFieldResolutionPanel
        sourceSnapshot={source}
        targetSnapshot={target}
        baseSnapshot={base}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={onResolve}
      />
    );

    // Resolve conflicts by selecting source for each
    const sourceRadios = screen.getAllByRole('radio').filter(
      (r) => (r as HTMLInputElement).value === 'source'
    );
    for (const radio of sourceRadios) {
      fireEvent.click(radio);
    }

    // Click apply
    const applyBtn = screen.getByRole('button', { name: /apply/i });
    fireEvent.click(applyBtn);

    expect(onResolve).toHaveBeenCalledTimes(1);
    const resolvedSnapshot = onResolve.mock.calls[0][0];
    expect(resolvedSnapshot).toBeDefined();
    // The resolved snapshot should be a valid PuckData structure
    expect(resolvedSnapshot.content).toBeDefined();
    expect(resolvedSnapshot.root).toBeDefined();
  });

  it('should disable apply button until all conflicts are resolved', () => {
    render(
      <PuckFieldResolutionPanel
        sourceSnapshot={source}
        targetSnapshot={target}
        baseSnapshot={base}
        sourceBranchName="feature"
        targetBranchName="main"
        onResolve={vi.fn()}
      />
    );

    const applyBtn = screen.getByRole('button', { name: /apply/i });
    expect(applyBtn).toBeDisabled();
  });
});

describe('ComponentConflictGroup', () => {
  it('should display component type as header', () => {
    render(
      <ComponentConflictGroup
        componentType="Heading"
        componentId="h1"
        fields={[
          {
            classification: 'conflicting',
            componentId: 'h1',
            componentType: 'Heading',
            propName: 'text',
            sourceValue: 'Source',
            targetValue: 'Target',
            path: 'content',
          },
        ]}
        sourceBranchName="feature"
        targetBranchName="main"
        resolutions={{}}
        onResolutionChange={vi.fn()}
      />
    );

    expect(screen.getByText('Heading')).toBeInTheDocument();
  });

  it('should display prop name and values for each field', () => {
    render(
      <ComponentConflictGroup
        componentType="Heading"
        componentId="h1"
        fields={[
          {
            classification: 'conflicting',
            componentId: 'h1',
            componentType: 'Heading',
            propName: 'text',
            sourceValue: 'Source text',
            targetValue: 'Target text',
            path: 'content',
          },
        ]}
        sourceBranchName="feature"
        targetBranchName="main"
        resolutions={{}}
        onResolutionChange={vi.fn()}
      />
    );

    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getByText('Source text')).toBeInTheDocument();
    expect(screen.getByText('Target text')).toBeInTheDocument();
  });

  it('should call onResolutionChange when a radio button is selected', () => {
    const onChange = vi.fn();

    render(
      <ComponentConflictGroup
        componentType="Heading"
        componentId="h1"
        fields={[
          {
            classification: 'conflicting',
            componentId: 'h1',
            componentType: 'Heading',
            propName: 'text',
            sourceValue: 'Source',
            targetValue: 'Target',
            path: 'content',
          },
        ]}
        sourceBranchName="feature"
        targetBranchName="main"
        resolutions={{}}
        onResolutionChange={onChange}
      />
    );

    const sourceRadio = screen.getAllByRole('radio').find(
      (r) => (r as HTMLInputElement).value === 'source'
    );
    expect(sourceRadio).toBeDefined();
    fireEvent.click(sourceRadio!);

    expect(onChange).toHaveBeenCalledWith('h1', 'text', 'source');
  });

  it('should show conflict indicator badge', () => {
    const { container } = render(
      <ComponentConflictGroup
        componentType="Heading"
        componentId="h1"
        fields={[
          {
            classification: 'conflicting',
            componentId: 'h1',
            componentType: 'Heading',
            propName: 'text',
            sourceValue: 'Source',
            targetValue: 'Target',
            path: 'content',
          },
        ]}
        sourceBranchName="feature"
        targetBranchName="main"
        resolutions={{}}
        onResolutionChange={vi.fn()}
      />
    );

    // Should show a count or indicator of conflicts
    expect(container.querySelector('.component-conflict-group__conflict-count')).toBeInTheDocument();
  });
});
