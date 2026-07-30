import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the decision logic from the drawer's internals (tested separately).
const { buildSpy } = vi.hoisted(() => ({
  buildSpy: vi.fn(() => ({ drawer: () => null })),
}));
vi.mock('./buildLiveThumbnailDrawer.js', () => ({
  buildLiveThumbnailDrawer: buildSpy,
}));

import { resolveLiveThumbnailDrawer } from './resolveLiveThumbnailDrawer.js';

const config = { components: { A: { render: () => null } } };

beforeEach(() => {
  buildSpy.mockClear();
});

describe('resolveLiveThumbnailDrawer', () => {
  it('builds the drawer by default when the option is undefined (default ON)', () => {
    const layer = resolveLiveThumbnailDrawer(config, undefined);
    expect(buildSpy).toHaveBeenCalledWith(config, undefined);
    expect(layer).toHaveProperty('drawer');
  });

  it('builds the drawer when the option is explicitly true', () => {
    resolveLiveThumbnailDrawer(config, true);
    expect(buildSpy).toHaveBeenCalledWith(config, undefined);
  });

  it('returns null and does not build when the option is false (opt-out)', () => {
    const layer = resolveLiveThumbnailDrawer(config, false);
    expect(layer).toBeNull();
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('forwards an options object to the builder', () => {
    const opts = { scale: 0.3, cardHeight: 50 };
    resolveLiveThumbnailDrawer(config, opts);
    expect(buildSpy).toHaveBeenCalledWith(config, opts);
  });
});
