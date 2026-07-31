import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const { renderSpy, dispatchSpy } = vi.hoisted(() => ({
  renderSpy: vi.fn((_props: unknown) => null),
  dispatchSpy: vi.fn(),
}));

// Local mock provides Puck's Drawer/Drawer.Item primitives, Render, and usePuck.
vi.mock('@puckeditor/core', async () => {
  const ReactMod = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Item = ({ name, children }: any) =>
    ReactMod.createElement(
      'div',
      { 'data-testid': 'drawer-item', 'data-name': name },
      typeof children === 'function' ? children({ children: null, name }) : children,
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Drawer = Object.assign(
    ({ children }: any) => ReactMod.createElement('div', { 'data-testid': 'drawer' }, children),
    { Item },
  );
  return {
    Render: (props: unknown) => renderSpy(props),
    Drawer,
    usePuck: () => ({ dispatch: dispatchSpy }),
  };
});

// P1 context — drawer reads live version state from here.
vi.mock('../../core/P1PuckContext.js', () => ({
  useP1Puck: () => ({
    isViewingHistoricalVersion: false,
    viewingVersion: null,
    returnToLatest: vi.fn(),
  }),
}));

// PDS primitives used by the drawer header and category headers.
vi.mock('@pantheon-systems/pds-toolkit-react', async () => {
  const ReactMod = await import('react');
  return {
    Icon: () => null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    IconButton: ({ onClick, ariaLabel }: any) =>
      ReactMod.createElement('button', { onClick, 'aria-label': ariaLabel }),
  };
});

import { buildLiveThumbnailDrawer } from './buildLiveThumbnailDrawer.js';
import type { LiveThumbnailDrawerOptions } from './buildLiveThumbnailDrawer.js';

const config = {
  categories: {
    typography: { title: 'Typography', components: ['HeadingBlock', 'ParagraphBlock'] },
    media: { title: 'Media', components: ['ImageBlock'] },
  },
  components: {
    HeadingBlock: { render: () => null },
    ParagraphBlock: { render: () => null },
    ImageBlock: { render: () => null },
    LonelyBlock: { render: () => null },
  },
};

function renderDrawer(options: LiveThumbnailDrawerOptions = {}) {
  const overrides = buildLiveThumbnailDrawer(config, options);
  const DrawerOverride = overrides.drawer as React.ComponentType<{ children?: React.ReactNode }>;
  return render(<DrawerOverride>{null}</DrawerOverride>);
}

beforeEach(() => {
  renderSpy.mockReset();
  renderSpy.mockImplementation(() => null);
  dispatchSpy.mockReset();
});

describe('buildLiveThumbnailDrawer', () => {
  it('returns a drawer override', () => {
    const overrides = buildLiveThumbnailDrawer(config);
    expect(typeof overrides.drawer).toBe('function');
  });

  it('renders a header for every category plus an "Other" bucket', () => {
    renderDrawer();
    expect(screen.getByText('Typography')).toBeInTheDocument();
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('expands the first category by default and leaves the rest collapsed', () => {
    renderDrawer();
    // Typography (first) is open: its cards are mounted.
    expect(screen.getByText('Heading')).toBeInTheDocument();
    expect(screen.getByText('Paragraph')).toBeInTheDocument();
    // Media is collapsed: its card is not mounted.
    expect(screen.queryByText('Image')).not.toBeInTheDocument();
  });

  it('toggles a category open and closed on header click', () => {
    renderDrawer();
    const mediaHeader = screen.getByText('Media');

    fireEvent.click(mediaHeader);
    expect(screen.getByText('Image')).toBeInTheDocument();

    fireEvent.click(mediaHeader);
    expect(screen.queryByText('Image')).not.toBeInTheDocument();
  });

  it('shows a component count for each category header', () => {
    renderDrawer();
    // Previews are mocked out, so the only bare numbers are the header counts.
    expect(screen.getByText('2')).toBeInTheDocument(); // Typography (2)
    expect(screen.getAllByText('1')).toHaveLength(2); // Media (1) + Other (1)
  });

  it('places uncategorized components under "Other"', () => {
    renderDrawer();
    // Other starts collapsed; expand it.
    fireEvent.click(screen.getByText('Other'));
    expect(screen.getByText('Lonely')).toBeInTheDocument();
  });

  it('wraps each card in a draggable Drawer.Item named for the component', () => {
    renderDrawer();
    const items = screen.getAllByTestId('drawer-item').map((el) => el.getAttribute('data-name'));
    expect(items).toContain('HeadingBlock');
    expect(items).toContain('ParagraphBlock');
    // Collapsed categories contribute no items.
    expect(items).not.toContain('ImageBlock');
  });

  // ── Panel header (added in commit 24b8b16) ────────────────────────────────

  it('renders the panel header with "Blocks" title', () => {
    renderDrawer();
    expect(screen.getByText('Blocks')).toBeInTheDocument();
  });

  it('renders the close button with its accessible label', () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: 'Collapse panel' })).toBeInTheDocument();
  });

  it('close button dispatches setUi leftSideBarVisible:false', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'setUi',
      ui: { leftSideBarVisible: false },
    });
  });

  it('close button calls the onClose callback when provided', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Expand/collapse-all toolbar (added in commit 24b8b16) ─────────────────

  it('expand all opens every section and switches button to "Collapse all categories"', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all categories' }));
    // All sections now open — Image (Media) and Lonely (Other) become visible.
    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByText('Lonely')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse all categories' })).toBeInTheDocument();
  });

  it('collapse all closes every section including the default-open one', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all categories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all categories' }));
    // Typography was open by default; it must now be collapsed.
    expect(screen.queryByText('Heading')).not.toBeInTheDocument();
    expect(screen.queryByText('Image')).not.toBeInTheDocument();
  });
});
