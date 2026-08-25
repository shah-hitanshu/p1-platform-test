import { describe, it, expect } from 'vitest';
import { pinnedSlotIds } from './pinned-slots.js';

const template = (
  content: unknown[],
  pinMap: Record<string, boolean>,
  zones?: Record<string, unknown[]>,
): unknown => ({ content, root: { props: { _pinMap: pinMap } }, ...(zones ? { zones } : {}) });

const component = (id: string, type = 'HeadingBlock'): unknown => ({ type, props: { id } });

describe('pinnedSlotIds', () => {
  it('returns the pinned ids in the order the template places them', () => {
    expect(pinnedSlotIds(template(
      [component('hero'), component('body'), component('footer')],
      { hero: true, footer: true },
    ))).toEqual(['hero', 'footer']);
  });

  it('reads zone components too', () => {
    expect(pinnedSlotIds(template(
      [component('hero')],
      { hero: true, aside: true },
      { 'sidebar:zone': [component('aside')] },
    ))).toEqual(['hero', 'aside']);
  });

  // A template whose components are all unpinned protects nothing on the pages bound to it.
  it('pins nothing when every entry in the map is false', () => {
    expect(pinnedSlotIds(template(
      [component('hero'), component('body')],
      { hero: false, body: false },
    ))).toEqual([]);
  });

  // The editor ignores these too, so a stale map entry cannot lock a same-id component on a page.
  it('ignores a pinned id the template does not place', () => {
    expect(pinnedSlotIds(template([component('hero')], { hero: true, gone: true }))).toEqual(['hero']);
  });

  it('pins nothing for a legacy manifest, which carries no content array', () => {
    expect(pinnedSlotIds({ id: 't1', components: [{ type: 'HeadingBlock', pinned: true }] })).toEqual([]);
  });

  it('pins nothing when the snapshot carries no pin map', () => {
    expect(pinnedSlotIds({ content: [component('hero')], root: { props: {} } })).toEqual([]);
  });

  it('survives anything the endpoint might return', () => {
    for (const value of [null, undefined, 'template', 42, [], {}, { content: 'nope' }]) {
      expect(pinnedSlotIds(value)).toEqual([]);
    }
  });
});
