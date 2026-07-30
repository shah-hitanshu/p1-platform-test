import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  makeThumbnailKey,
  getCachedThumbnail,
  setCachedThumbnail,
  clearThumbnailCache,
  getThumbnailCacheKey,
} from './thumbnailCache.js';

const LS_PREFIX = 'p1-thumb:';

/** Minimal in-memory Storage — the test env does not reliably provide one. */
function createMockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMockStorage());
  clearThumbnailCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('makeThumbnailKey', () => {
  it('is deterministic for the same inputs', () => {
    expect(makeThumbnailKey('HeroBlock', { a: 1 })).toBe(makeThumbnailKey('HeroBlock', { a: 1 }));
  });

  it('differs when defaultProps differ (invalidation)', () => {
    expect(makeThumbnailKey('HeroBlock', { a: 1 })).not.toBe(makeThumbnailKey('HeroBlock', { a: 2 }));
  });

  it('differs when the version differs (invalidation)', () => {
    expect(makeThumbnailKey('HeroBlock', { a: 1 }, 'v1')).not.toBe(
      makeThumbnailKey('HeroBlock', { a: 1 }, 'v2'),
    );
  });

  it('differs by component name', () => {
    expect(makeThumbnailKey('HeroBlock', {})).not.toBe(makeThumbnailKey('OtherBlock', {}));
  });
});

describe('thumbnail cache store', () => {
  it('round-trips through the in-memory cache', () => {
    setCachedThumbnail('k1', '<p>hi</p>');
    expect(getCachedThumbnail('k1')).toBe('<p>hi</p>');
  });

  it('returns undefined for an unknown key', () => {
    expect(getCachedThumbnail('nope')).toBeUndefined();
  });

  it('clearThumbnailCache empties the in-memory cache', () => {
    setCachedThumbnail('k4', '<p>y</p>');
    clearThumbnailCache();
    expect(getCachedThumbnail('k4')).toBeUndefined();
  });

  // Security regression (PCC-3350 review): the cached HTML is later injected
  // via dangerouslySetInnerHTML, and localStorage is writable by any
  // same-origin script — persisting to it would let a same-origin write to a
  // `p1-thumb:*` key plant markup that gets trusted on a future page load.
  it('never writes or reads through localStorage', () => {
    setCachedThumbnail('k2', '<p>x</p>');
    expect(localStorage.getItem(LS_PREFIX + 'k2')).toBeNull();

    localStorage.setItem(LS_PREFIX + 'k3', '<script>alert(1)</script>');
    expect(getCachedThumbnail('k3')).toBeUndefined();
  });

  it('clearThumbnailCache purges stray entries left by the old localStorage-backed cache', () => {
    // Simulates a leftover key from a prior version of this cache that did
    // persist to localStorage — clearThumbnailCache still cleans these up.
    localStorage.setItem(LS_PREFIX + 'legacy', '<p>stale</p>');
    clearThumbnailCache();
    expect(localStorage.getItem(LS_PREFIX + 'legacy')).toBeNull();
  });

  it('degrades gracefully when localStorage is unavailable (e.g. private mode)', () => {
    const throwing = createMockStorage();
    vi.spyOn(throwing, 'key').mockImplementation(() => {
      throw new Error('unavailable');
    });
    vi.stubGlobal('localStorage', throwing);

    expect(() => clearThumbnailCache()).not.toThrow();
    setCachedThumbnail('k5', '<p>z</p>');
    expect(getCachedThumbnail('k5')).toBe('<p>z</p>');
  });
});

describe('getThumbnailCacheKey', () => {
  it('matches makeThumbnailKey with the component\'s resolved defaultProps', () => {
    const config = { components: { HeroBlock: { defaultProps: { a: 1 } } } };
    expect(getThumbnailCacheKey(config, 'HeroBlock')).toBe(
      makeThumbnailKey('HeroBlock', { a: 1 }),
    );
  });

  it('defaults to an empty object when the component has no defaultProps', () => {
    const config = { components: { BareBlock: {} } };
    expect(getThumbnailCacheKey(config, 'BareBlock')).toBe(makeThumbnailKey('BareBlock', {}));
  });
});
