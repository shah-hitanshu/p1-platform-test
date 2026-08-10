import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const { dispatchSpy, state } = vi.hoisted(() => {
  const spy = vi.fn();
  return {
    dispatchSpy: spy,
    state: {
      current: {
        appState: {
          data: {
            content: [
              { type: 'HeadingBlock', props: { id: 'h1' } },
              { type: 'ParagraphBlock', props: { id: 'p1' } },
            ],
          },
          ui: { itemSelector: null as null | { index: number; zone: string } },
        },
        config: { components: { HeadingBlock: { label: 'Heading' }, ParagraphBlock: {} } },
        dispatch: spy,
      },
    },
  };
});

vi.mock('@puckeditor/core', () => ({
  // Selector-aware, unlike the global stub — the panel reads slices of state.
  createUsePuck: () => (selector: (s: unknown) => unknown) => selector(state.current),
  usePuck: () => state.current,
}));

vi.mock('@pantheon-systems/pds-toolkit-react', async () => {
  const ReactMod = await import('react');
  return {
    Icon: () => null,
    IconButton: ({ onClick, ariaLabel }: any) =>
      ReactMod.createElement('button', { onClick, 'aria-label': ariaLabel }),
  };
});

vi.mock('../../core/P1PuckContext.js', () => ({
  useP1PuckOptional: () => ({
    isViewingHistoricalVersion: false,
    viewingVersion: null,
    returnToLatest: vi.fn(),
  }),
}));

import { OutlinePanel } from './OutlinePanel.js';

beforeEach(() => {
  dispatchSpy.mockReset();
  state.current.appState.ui.itemSelector = null;
  state.current.appState.data.content = [
    { type: 'HeadingBlock', props: { id: 'h1' } },
    { type: 'ParagraphBlock', props: { id: 'p1' } },
  ];
});

describe('OutlinePanel', () => {
  it('renders the panel header', () => {
    render(<OutlinePanel />);
    expect(screen.getByText('Outline')).toBeInTheDocument();
  });

  it('renders the "Page structure" eyebrow', () => {
    render(<OutlinePanel />);
    expect(screen.getByText('Page structure')).toBeInTheDocument();
  });

  it('renders one row per block, labelled from the config', () => {
    render(<OutlinePanel />);
    expect(screen.getByText('Heading')).toBeInTheDocument();
    expect(screen.getByText('Paragraph')).toBeInTheDocument();
  });

  it('selects a block when its row is clicked', () => {
    render(<OutlinePanel />);
    fireEvent.click(screen.getByText('Paragraph'));
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'setUi',
      ui: { itemSelector: { index: 1, zone: 'root:default-zone' } },
    });
  });

  it('marks the row matching Puck selection as selected', () => {
    state.current.appState.ui.itemSelector = { index: 0, zone: 'root:default-zone' };
    render(<OutlinePanel />);
    const headingRow = screen.getByRole('button', { name: 'Heading' });
    const paragraphRow = screen.getByRole('button', { name: 'Paragraph' });
    expect(headingRow).toHaveAttribute('aria-current', 'true');
    expect(paragraphRow).not.toHaveAttribute('aria-current', 'true');
  });

  it('shows an empty state when there are no blocks', () => {
    state.current.appState.data.content = [];
    render(<OutlinePanel />);
    expect(screen.getByText('No blocks yet. Add one from the Blocks panel.')).toBeInTheDocument();
  });

  // ── Reorder ───────────────────────────────────────────────────────────────

  function dragRow(fromLabel: string, toLabel: string) {
    const from = screen.getByText(fromLabel).closest('[draggable]') as HTMLElement;
    const to = screen.getByText(toLabel).closest('[draggable]') as HTMLElement;
    fireEvent.dragStart(from, { dataTransfer: { effectAllowed: 'move', setData: vi.fn() } });
    fireEvent.dragOver(to);
    fireEvent.drop(to);
  }

  it('rows are draggable', () => {
    render(<OutlinePanel />);
    const row = screen.getByText('Heading').closest('[draggable]');
    expect(row).toHaveAttribute('draggable', 'true');
  });

  it('dropping a row on a later row reorders to that index', () => {
    render(<OutlinePanel />);
    dragRow('Heading', 'Paragraph');
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'reorder',
      sourceIndex: 0,
      destinationIndex: 1,
      destinationZone: 'root:default-zone',
    });
  });

  it('dropping a row on an earlier row reorders to that index', () => {
    render(<OutlinePanel />);
    dragRow('Paragraph', 'Heading');
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'reorder',
      sourceIndex: 1,
      destinationIndex: 0,
      destinationZone: 'root:default-zone',
    });
  });

  it('dropping a row on itself dispatches nothing', () => {
    render(<OutlinePanel />);
    dragRow('Heading', 'Heading');
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reorder' }),
    );
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  it('every row has a delete button naming its block', () => {
    render(<OutlinePanel />);
    expect(screen.getByRole('button', { name: 'Delete Heading' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Paragraph' })).toBeInTheDocument();
  });

  it('delete dispatches remove for that row', () => {
    render(<OutlinePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Paragraph' }));
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'remove',
      index: 1,
      zone: 'root:default-zone',
    });
  });

  it('delete does not also select the row', () => {
    render(<OutlinePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Heading' }));
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setUi' }),
    );
  });
});
