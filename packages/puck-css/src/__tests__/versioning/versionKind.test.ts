import { describe, it, expect } from 'vitest';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { versionKinds, isMilestone } from '../../versioning/utils/versionKind.js';

const base: DocumentVersion = {
  id: 'v-1',
  documentId: 'doc-1',
  branchId: 'branch-1',
  versionNumber: 1,
  createdAt: '2024-06-15T10:00:00Z',
  snapshot: {},
  source: 'edit',
  createdById: 'user-1',
  createdByType: 'user',
};

// ---------------------------------------------------------------------------
// versionKind — returns VersionKind[] (independent labels)
// ---------------------------------------------------------------------------

describe('versionKind — current', () => {
  it('returns ["current"] when id matches currentVersionId', () => {
    expect(versionKinds({ ...base, id: 'v-current' }, 'v-current')).toEqual(['current']);
  });

  it('returns ["current", "published"] when both apply', () => {
    expect(versionKinds({ ...base, id: 'v-c', isPublished: true }, 'v-c')).toEqual(['current', 'published']);
  });

  it('returns ["current", "reverted"] when version is current and a revert', () => {
    expect(versionKinds({ ...base, id: 'v-c', source: 'revert' }, 'v-c')).toEqual(['current', 'reverted']);
  });

  it('returns ["current", "published", "reverted"] when all three apply', () => {
    expect(versionKinds({ ...base, id: 'v-c', isPublished: true, source: 'revert' }, 'v-c')).toEqual(['current', 'published', 'reverted']);
  });
});

describe('versionKind — published (not current)', () => {
  it('returns ["published"] for isPublished=true when not current', () => {
    expect(versionKinds({ ...base, isPublished: true }, 'v-other')).toEqual(['published']);
  });

  it('returns ["published", "reverted"] when both apply and not current', () => {
    expect(versionKinds({ ...base, isPublished: true, source: 'revert' }, 'v-other')).toEqual(['published', 'reverted']);
  });
});

describe('versionKind — reverted (not current, not published)', () => {
  it('returns ["reverted"] when source is "revert" and not current or published', () => {
    expect(versionKinds({ ...base, source: 'revert' }, 'v-other')).toEqual(['reverted']);
  });
});

describe('versionKind — autosave (fallback)', () => {
  it('returns ["autosave"] for a plain edit version', () => {
    expect(versionKinds(base, 'v-other')).toEqual(['autosave']);
  });

  it('returns ["autosave"] for source="merge"', () => {
    expect(versionKinds({ ...base, source: 'merge' }, 'v-other')).toEqual(['autosave']);
  });

  it('returns ["autosave"] for source="initial"', () => {
    expect(versionKinds({ ...base, source: 'initial' }, 'v-other')).toEqual(['autosave']);
  });

  it('returns ["autosave"] when currentVersionId is undefined', () => {
    expect(versionKinds(base, undefined)).toEqual(['autosave']);
  });

  it('returns ["autosave"] when isPublished is false', () => {
    expect(versionKinds({ ...base, isPublished: false }, 'v-other')).toEqual(['autosave']);
  });
});

// ---------------------------------------------------------------------------
// isMilestone
// ---------------------------------------------------------------------------

describe('isMilestone', () => {
  it('returns true when isPublished is true', () => {
    expect(isMilestone({ ...base, isPublished: true })).toBe(true);
  });

  it('returns true when source is "revert"', () => {
    expect(isMilestone({ ...base, source: 'revert' })).toBe(true);
  });

  it('returns true when both isPublished and source="revert"', () => {
    expect(isMilestone({ ...base, isPublished: true, source: 'revert' })).toBe(true);
  });

  it('returns false for a plain edit version', () => {
    expect(isMilestone(base)).toBe(false);
  });

  it('returns false when isPublished is false', () => {
    expect(isMilestone({ ...base, isPublished: false })).toBe(false);
  });

  it('returns false when isPublished is undefined', () => {
    expect(isMilestone({ ...base, isPublished: undefined })).toBe(false);
  });

  it('returns false for source="merge"', () => {
    expect(isMilestone({ ...base, source: 'merge' })).toBe(false);
  });

  it('returns false for source="initial"', () => {
    expect(isMilestone({ ...base, source: 'initial' })).toBe(false);
  });
});
