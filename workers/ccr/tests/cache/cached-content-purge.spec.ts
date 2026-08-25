/**
 * The purge shim on the CachedContent entrypoint (PCC-3715).
 *
 * Workers Caching scopes purge() to the entrypoint that calls it, and every
 * cached content response belongs to CachedContent — so cache.purge() must
 * execute inside this class. Every purge issued from the default entrypoint
 * before this shim reported success while evicting nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cache } from 'cloudflare:workers';
import { CachedContent } from '../../src/entrypoints/cached-content';

const purgeSpy = vi.spyOn(cache, 'purge');

describe('CachedContent.purgeTags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs cache.purge with the given tags inside this entrypoint', async () => {
    purgeSpy.mockResolvedValue({ success: true, errors: [] });
    const entrypoint = new CachedContent({} as never, {} as never);

    const result = await entrypoint.purgeTags(['doc:doc-1', 'list:site-1']);

    expect(purgeSpy).toHaveBeenCalledWith({ tags: ['doc:doc-1', 'list:site-1'] });
    expect(result.success).toBe(true);
  });

  it('returns the purge result untransformed so the caller can log failures', async () => {
    purgeSpy.mockResolvedValue({
      success: false,
      errors: [{ code: 1234, message: 'tag limit exceeded' }],
    });
    const entrypoint = new CachedContent({} as never, {} as never);

    const result = await entrypoint.purgeTags(['doc:doc-1']);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toBe('tag limit exceeded');
  });
});
