import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// The global @puckeditor/core stub returns a fresh vi.fn() per call, so a local
// mock is the only way to assert on what was dispatched.
const { dispatchSpy } = vi.hoisted(() => ({ dispatchSpy: vi.fn() }));

vi.mock('@puckeditor/core', () => ({
  usePuck: () => ({ dispatch: dispatchSpy }),
}));

vi.mock('@pantheon-systems/pds-toolkit-react', async () => {
  const ReactMod = await import('react');
  return {
    IconButton: ({ onClick, ariaLabel }: any) =>
      ReactMod.createElement('button', { onClick, 'aria-label': ariaLabel }),
  };
});

import { PanelHeader } from './PanelHeader.js';

beforeEach(() => {
  dispatchSpy.mockReset();
});

describe('PanelHeader', () => {
  it('renders the title', () => {
    render(<PanelHeader title="Outline" />);
    expect(screen.getByText('Outline')).toBeInTheDocument();
  });

  it('renders a collapse button with an accessible label', () => {
    render(<PanelHeader title="Outline" />);
    expect(screen.getByRole('button', { name: 'Collapse panel' })).toBeInTheDocument();
  });

  it('collapse dispatches setUi leftSideBarVisible:false', () => {
    render(<PanelHeader title="Outline" />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'setUi',
      ui: { leftSideBarVisible: false },
    });
  });

  it('runs onCollapse in addition to the built-in collapse', () => {
    const onCollapse = vi.fn();
    render(<PanelHeader title="Outline" onCollapse={onCollapse} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the actions slot', () => {
    render(<PanelHeader title="Outline" actions={<span>extra</span>} />);
    expect(screen.getByText('extra')).toBeInTheDocument();
  });
});
