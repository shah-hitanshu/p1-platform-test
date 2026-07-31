import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Spy on Puck's <Render> so we can tell exactly when the live preview mounts.
const { renderSpy } = vi.hoisted(() => ({
  renderSpy: vi.fn((_props: unknown) => null),
}));
vi.mock('@puckeditor/core', () => ({
  Render: (props: unknown) => renderSpy(props),
}));

import { ThumbnailCard } from './ThumbnailCard.js';
import { setCachedThumbnail, getThumbnailCacheKey, clearThumbnailCache } from './thumbnailCache.js';

const config = {
  components: {
    HeroBlock: { defaultProps: { heading: 'Hi' }, render: () => null },
    CardGridBlock: { defaultProps: {}, render: () => null },
  },
};

beforeEach(() => {
  renderSpy.mockReset();
  renderSpy.mockImplementation(() => null);
  clearThumbnailCache();
});

describe('ThumbnailCard', () => {
  it('shows a skeleton before the preview mounts, deferring the live render', () => {
    render(<ThumbnailCard config={config} name="HeroBlock" />);

    // Skeleton is visible immediately and the expensive <Render> has not run yet.
    expect(screen.getByLabelText(/loading preview/i)).toBeInTheDocument();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('mounts the live preview after deferral and removes the skeleton', async () => {
    render(<ThumbnailCard config={config} name="HeroBlock" />);

    await waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText(/loading preview/i)).not.toBeInTheDocument();
  });

  it('skips the skeleton entirely when a preview is already cached', () => {
    // Simulates a remount of an already-rendered card — e.g. Puck's own
    // <Drawer> remounting on unrelated editor state changes (PCC-3350
    // flicker bug). A cache hit must show up ready on the very first paint,
    // not flash the skeleton again before swapping in.
    const key = getThumbnailCacheKey(config, 'HeroBlock');
    setCachedThumbnail(key, '<span>CACHED</span>');

    const { container } = render(<ThumbnailCard config={config} name="HeroBlock" />);

    expect(screen.queryByLabelText(/loading preview/i)).not.toBeInTheDocument();
    // The cache hit is served straight from LiveThumbnail's own cache, so the
    // expensive live <Render> never runs at all — not even once.
    expect(renderSpy).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('CACHED');
  });

  it('shows the humanized component name', () => {
    render(<ThumbnailCard config={config} name="CardGridBlock" />);
    expect(screen.getByText('Card Grid')).toBeInTheDocument();
  });

  it('prefers an explicit label when provided', () => {
    render(<ThumbnailCard config={config} name="HeroBlock" label="Big Banner" />);
    expect(screen.getByText('Big Banner')).toBeInTheDocument();
  });

  it('renders a fallback when the preview throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderSpy.mockImplementation(() => {
      throw new Error('boom');
    });

    render(<ThumbnailCard config={config} name="HeroBlock" />);

    await waitFor(() =>
      expect(screen.getByLabelText(/preview unavailable/i)).toBeInTheDocument(),
    );
    // Name still renders even when the preview fails.
    expect(screen.getByText('Hero')).toBeInTheDocument();
    spy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
