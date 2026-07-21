/**
 * Tests for deriveLiveDocState — the Live-only publish-state mapping.
 *
 * The publish-state badge is shown ONLY on the Live (main) branch. On any
 * other branch (or while the published status is still unknown) the badge is
 * hidden, signalled by returning `undefined`.
 *
 * On Live, it maps useP1Editor's `publishedStatus` to a DocState:
 *   'published'          → 'live'        ("Live")
 *   'unpublished-changes'→ 'unpublished' ("Changes pending publishing")
 *   'draft'              → 'unpublished' ("Changes pending publishing")
 */

import { describe, it, expect } from 'vitest';
import { deriveLiveDocState } from './deriveLiveDocState.js';

describe('deriveLiveDocState — off the Live branch', () => {
  it('returns undefined (hidden) regardless of publishedStatus', () => {
    expect(deriveLiveDocState('published', false)).toBeUndefined();
    expect(deriveLiveDocState('unpublished-changes', false)).toBeUndefined();
    expect(deriveLiveDocState('draft', false)).toBeUndefined();
    expect(deriveLiveDocState(undefined, false)).toBeUndefined();
  });
});

describe('deriveLiveDocState — on Live, status unknown', () => {
  it('returns undefined (hidden) while publishedStatus is not yet known', () => {
    expect(deriveLiveDocState(undefined, true)).toBeUndefined();
  });
});

describe('deriveLiveDocState — on Live', () => {
  it('maps "published" to "live"', () => {
    expect(deriveLiveDocState('published', true)).toBe('live');
  });

  it('maps "unpublished-changes" to "unpublished"', () => {
    expect(deriveLiveDocState('unpublished-changes', true)).toBe('unpublished');
  });

  it('maps "draft" to "unpublished"', () => {
    expect(deriveLiveDocState('draft', true)).toBe('unpublished');
  });
});
