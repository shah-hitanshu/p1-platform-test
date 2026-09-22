import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { puckSelectorMock, held } = vi.hoisted(() => ({
  puckSelectorMock: vi.fn(),
  held: { value: new Set<string>() },
}));

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => puckSelectorMock,
  ActionBar: ({ label, children }: { label?: string; children: React.ReactNode }) => (
    <div data-testid="action-bar" aria-label={label}>
      {children}
    </div>
  ),
}));

vi.mock('../src/features/content-type-templates/ui/ActionBarPinButton.js', () => ({
  ActionBarPinButton: () => <button type="button">Pin</button>,
}));

vi.mock('../src/collaboration/useAgentHeldBlocks.js', () => ({
  useAgentHeldBlocks: () => held.value,
}));

import { P1ActionBar } from '../src/editor/plugin/P1ActionBar.js';

function selected(componentId: string | null): void {
  puckSelectorMock.mockImplementation((select: (s: unknown) => unknown) =>
    select({ selectedItem: componentId === null ? null : { props: { id: componentId } } }),
  );
}

beforeEach(() => {
  held.value = new Set<string>();
  selected('hero-1');
});

describe('P1ActionBar', () => {
  it('offers the controls on a block nobody else has', () => {
    render(
      <P1ActionBar label="Hero">
        <button type="button">Delete</button>
      </P1ActionBar>,
    );

    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('withholds them on a block an agent holds', () => {
    held.value = new Set(['hero-1']);

    render(
      <P1ActionBar label="Hero">
        <button type="button">Delete</button>
      </P1ActionBar>,
    );

    expect(screen.queryByTestId('action-bar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('leaves a neighbouring block the agent does not hold alone', () => {
    held.value = new Set(['text-1']);

    render(
      <P1ActionBar label="Hero">
        <button type="button">Delete</button>
      </P1ActionBar>,
    );

    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
  });

  it('offers the controls when nothing is picked out', () => {
    selected(null);
    held.value = new Set(['hero-1']);

    render(
      <P1ActionBar label="Hero">
        <button type="button">Delete</button>
      </P1ActionBar>,
    );

    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
  });
});
