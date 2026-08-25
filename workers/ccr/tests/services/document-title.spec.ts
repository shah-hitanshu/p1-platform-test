/**
 * Page titles live at one place in the snapshot: `root.props.title`.
 *
 * Document creation used to write the title at the snapshot's top level, while
 * template-created documents got it from the skeleton at `root.props.title`.
 * Dashboard listings only read the top level, so template-created pages showed
 * no title at all.
 */

import { describe, it, expect } from 'vitest';
import { applyTitleToSnapshot } from '../../src/services/document-title';

describe('applyTitleToSnapshot', () => {
  it('writes the title to root.props.title', () => {
    const snapshot = applyTitleToSnapshot({ content: [], zones: {} }, 'Q3 Launch Recap');

    expect(snapshot).toMatchObject({
      content: [],
      zones: {},
      root: { props: { title: 'Q3 Launch Recap' } },
    });
  });

  it('does not write the title at the top level', () => {
    const snapshot = applyTitleToSnapshot({ content: [] }, 'Q3 Launch Recap');

    expect(snapshot).not.toHaveProperty('title');
  });

  it('preserves the rest of an existing root.props', () => {
    const snapshot = applyTitleToSnapshot(
      { root: { props: { description: 'Existing.', _meta: { ogTitle: 'Social' } } } },
      'Q3',
    );

    expect(snapshot.root).toEqual({
      props: { description: 'Existing.', _meta: { ogTitle: 'Social' }, title: 'Q3' },
    });
  });

  it('leaves a title the snapshot already carries alone', () => {
    // The snapshot is the authored source of truth; an explicit title argument
    // seeds a new document rather than overwriting authored content.
    const snapshot = applyTitleToSnapshot(
      { root: { props: { title: 'From the snapshot' } } },
      'From the argument',
    );

    expect(snapshot.root?.props.title).toBe('From the snapshot');
  });

  it('returns the snapshot untouched when no title is supplied', () => {
    const input = { content: [], root: { props: { description: 'Hi' } } };

    expect(applyTitleToSnapshot(input, undefined)).toEqual(input);
  });

  it('creates the snapshot shape when there is none', () => {
    expect(applyTitleToSnapshot(undefined, 'Fresh page')).toEqual({
      root: { props: { title: 'Fresh page' } },
    });
  });

  it('ignores a non-object snapshot rather than throwing', () => {
    expect(applyTitleToSnapshot('nonsense' as unknown as Record<string, unknown>, 'Fresh')).toEqual({
      root: { props: { title: 'Fresh' } },
    });
  });

  it('repairs a snapshot whose root is not an object', () => {
    const snapshot = applyTitleToSnapshot({ root: 'broken' }, 'Fresh');

    expect(snapshot.root).toEqual({ props: { title: 'Fresh' } });
  });
});

describe('readSnapshotTitle', () => {
  it('reads root.props.title', async () => {
    const { readSnapshotTitle } = await import('../../src/services/document-title');

    expect(readSnapshotTitle({ root: { props: { title: 'Canonical' } } })).toBe('Canonical');
  });

  it('falls back to a legacy top-level title', async () => {
    const { readSnapshotTitle } = await import('../../src/services/document-title');

    // Documents created before the canonicalization still carry it there, and
    // are not rewritten until the backfill runs.
    expect(readSnapshotTitle({ title: 'Legacy' })).toBe('Legacy');
  });

  it('prefers the canonical location when both are present', async () => {
    const { readSnapshotTitle } = await import('../../src/services/document-title');

    expect(
      readSnapshotTitle({ title: 'Legacy', root: { props: { title: 'Canonical' } } }),
    ).toBe('Canonical');
  });

  it('returns undefined when neither is present', async () => {
    const { readSnapshotTitle } = await import('../../src/services/document-title');

    expect(readSnapshotTitle({ content: [] })).toBeUndefined();
    expect(readSnapshotTitle(undefined)).toBeUndefined();
  });
});
