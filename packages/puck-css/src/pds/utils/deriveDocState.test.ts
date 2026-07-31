/**
 * Tests for the deriveDocState pure function.
 *
 * deriveDocState(doc, isOnMainBranch) maps a Document-like object (or null)
 * plus a branch flag to one of four display states:
 *   'modified' | 'unpublished' | 'live' | 'liveOnly'
 *
 * State semantics:
 *   modified    — on a branch, document has changes relative to Live
 *   unpublished — on main, document has auto-saved changes not yet published
 *   live        — document is current and published (main with no changes,
 *                 or branch where document is unmodified/inherited)
 *   liveOnly    — on a branch, document exists on Live but hasn't been
 *                 forked into this branch yet
 */

import { describe, it, expect } from 'vitest';
import { deriveDocState } from './deriveDocState.js';

interface DocFixture {
  inherited?: boolean;
  isPublished?: boolean;
}

// ---------------------------------------------------------------------------
// Null document
// ---------------------------------------------------------------------------

describe('deriveDocState — null document', () => {
  it('returns "liveOnly" when doc is null and not on main branch', () => {
    expect(deriveDocState(null, false)).toBe('liveOnly');
  });

  it('returns "liveOnly" when doc is null and on main branch', () => {
    expect(deriveDocState(null, true)).toBe('liveOnly');
  });
});

// ---------------------------------------------------------------------------
// Main branch — live when no pending changes, unpublished when edited
// ---------------------------------------------------------------------------

describe('deriveDocState — isOnMainBranch === true', () => {
  it('returns "live" when on main branch with an inherited, published doc', () => {
    const doc: DocFixture = { inherited: true, isPublished: true };
    expect(deriveDocState(doc, true)).toBe('live');
  });

  it('returns "live" when on main branch with a published doc (no pending changes)', () => {
    const doc: DocFixture = { inherited: false, isPublished: true };
    expect(deriveDocState(doc, true)).toBe('live');
  });

  it('returns "unpublished" when on main branch with an unpublished doc', () => {
    const doc: DocFixture = { inherited: false, isPublished: false };
    expect(deriveDocState(doc, true)).toBe('unpublished');
  });

  it('returns "unpublished" when on main branch with a doc that has no isPublished field', () => {
    const doc: DocFixture = { inherited: true };
    expect(deriveDocState(doc, true)).toBe('unpublished');
  });
});

// ---------------------------------------------------------------------------
// Off main branch — non-inherited documents (edited on this branch)
// ---------------------------------------------------------------------------

describe('deriveDocState — off main branch, inherited: false', () => {
  it('returns "modified" when doc was edited on this branch and isPublished is true', () => {
    const doc: DocFixture = { inherited: false, isPublished: true };
    expect(deriveDocState(doc, false)).toBe('modified');
  });

  it('returns "modified" when doc was edited on this branch and isPublished is false', () => {
    const doc: DocFixture = { inherited: false, isPublished: false };
    expect(deriveDocState(doc, false)).toBe('modified');
  });

  it('returns "modified" when doc was edited on this branch and isPublished is undefined', () => {
    const doc: DocFixture = { inherited: false };
    expect(deriveDocState(doc, false)).toBe('modified');
  });
});

// ---------------------------------------------------------------------------
// Off main branch — inherited documents (unmodified from Live)
// ---------------------------------------------------------------------------

describe('deriveDocState — off main branch, inherited: true', () => {
  it('returns "live" when doc is inherited from main and isPublished is true', () => {
    const doc: DocFixture = { inherited: true, isPublished: true };
    expect(deriveDocState(doc, false)).toBe('live');
  });

  it('returns "liveOnly" when doc is inherited from main and isPublished is false', () => {
    const doc: DocFixture = { inherited: true, isPublished: false };
    expect(deriveDocState(doc, false)).toBe('liveOnly');
  });

  it('returns "liveOnly" when doc is inherited from main and isPublished is undefined', () => {
    const doc: DocFixture = { inherited: true };
    expect(deriveDocState(doc, false)).toBe('liveOnly');
  });
});
