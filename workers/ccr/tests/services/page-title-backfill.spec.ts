/**
 * Backfill that moves a legacy top-level snapshot title to root.props.title.
 *
 * These tests cover the decision of what to convert; the database wiring is
 * covered by the integration spec.
 */

import { describe, it, expect } from 'vitest';
import { classifyTitleBackfill } from '../../src/services/page-title-backfill';

describe('classifyTitleBackfill', () => {
  it('converts a snapshot carrying only a legacy top-level title', () => {
    const outcome = classifyTitleBackfill({ title: 'Legacy Page', content: [] });

    expect(outcome.action).toBe('convert');
    expect(outcome.snapshot).toEqual({
      content: [],
      root: { props: { title: 'Legacy Page' } },
    });
  });

  it('drops the legacy key rather than leaving both behind', () => {
    const outcome = classifyTitleBackfill({ title: 'Legacy Page' });

    expect(outcome.snapshot).not.toHaveProperty('title');
  });

  it('preserves the rest of root.props while moving the title', () => {
    const outcome = classifyTitleBackfill({
      title: 'Legacy',
      root: { props: { description: 'Kept.', _meta: { ogTitle: 'Social' } } },
    });

    expect(outcome.snapshot?.root).toEqual({
      props: { description: 'Kept.', _meta: { ogTitle: 'Social' }, title: 'Legacy' },
    });
  });

  it('skips a snapshot that already has only the canonical title', () => {
    const outcome = classifyTitleBackfill({ root: { props: { title: 'Canonical' } } });

    expect(outcome.action).toBe('skip');
    expect(outcome.reason).toBe('already-canonical');
  });

  it('drops the stale legacy copy when a snapshot carries both', () => {
    // The canonical value wins — it is what the editor has been autosaving, so
    // the top-level copy is the stale one.
    const outcome = classifyTitleBackfill({
      title: 'Stale top level',
      root: { props: { title: 'Authored' } },
    });

    expect(outcome.action).toBe('convert');
    expect(outcome.snapshot).not.toHaveProperty('title');
    expect(outcome.snapshot?.root.props.title).toBe('Authored');
  });

  it('skips a snapshot with no title in either location', () => {
    const outcome = classifyTitleBackfill({ content: [], zones: {} });

    expect(outcome.action).toBe('skip');
    expect(outcome.reason).toBe('no-title');
  });

  it('skips a non-object snapshot instead of throwing', () => {
    expect(classifyTitleBackfill(null).action).toBe('skip');
    expect(classifyTitleBackfill(undefined).action).toBe('skip');
    expect(classifyTitleBackfill('nonsense').action).toBe('skip');
  });

  it('skips a non-string legacy title rather than moving junk', () => {
    const outcome = classifyTitleBackfill({ title: { nested: true } });

    expect(outcome.action).toBe('skip');
    expect(outcome.reason).toBe('no-title');
  });

  it('is idempotent — converting twice is a no-op the second time', () => {
    const first = classifyTitleBackfill({ title: 'Legacy', content: [] });
    expect(first.action).toBe('convert');

    const second = classifyTitleBackfill(first.snapshot);
    expect(second.action).toBe('skip');
    expect(second.reason).toBe('already-canonical');
  });
});
