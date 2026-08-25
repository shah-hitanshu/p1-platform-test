/**
 * Tests for the shared component-identity walker and id toolkit.
 *
 * PROPOSAL-015 Design 1, 3, 8: components are identified by their
 * `props.id`. This module is the single shared walker over `content[]`
 * and `zones[*][]` used to extract, mint, and dedupe those ids.
 */

import { describe, it, expect } from 'vitest';
import {
  walkComponents,
  extractComponentIds,
  mintComponentId,
  dedupeComponentIds,
  remintComponentIdsInValue,
  type DocumentComponent,
} from '../../src/services/component-identity';

function component(type: string, id?: string, extraProps: Record<string, unknown> = {}): DocumentComponent {
  const props: Record<string, unknown> = { ...extraProps };
  if (id !== undefined) props.id = id;
  return { type, props };
}

function makeSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content: [
      component('HeroBlock', 'HeroBlock-1'),
      component('BodyBlock', 'BodyBlock-1'),
    ],
    zones: {
      'sidebar:left': [component('NavBlock', 'NavBlock-1')],
    },
    root: { props: {} },
    ...overrides,
  };
}

const UUID_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('walkComponents', () => {
  it('walks content in index order before any zone', () => {
    const snapshot = makeSnapshot();

    const refs = walkComponents(snapshot);

    expect(refs.map((ref) => ref.component.props.id)).toEqual([
      'HeroBlock-1',
      'BodyBlock-1',
      'NavBlock-1',
    ]);
  });

  it('tags content entries with location "content" and their index', () => {
    const snapshot = makeSnapshot();

    const refs = walkComponents(snapshot);

    expect(refs[0]).toMatchObject({ location: 'content', index: 0 });
    expect(refs[1]).toMatchObject({ location: 'content', index: 1 });
  });

  it('tags zone entries with location "zone", the zone key, and their index within the zone', () => {
    const snapshot = makeSnapshot();

    const refs = walkComponents(snapshot);
    const zoneRef = refs[2];

    expect(zoneRef.location).toBe('zone');
    expect(zoneRef.zoneKey).toBe('sidebar:left');
    expect(zoneRef.index).toBe(0);
  });

  it('walks multiple zones in Object.keys insertion order, each in index order', () => {
    const snapshot = makeSnapshot({
      content: [],
      zones: {
        footer: [component('FooterBlock', 'FooterBlock-1')],
        header: [
          component('LogoBlock', 'LogoBlock-1'),
          component('MenuBlock', 'MenuBlock-1'),
        ],
      },
    });

    const refs = walkComponents(snapshot);

    expect(refs.map((ref) => [ref.zoneKey, ref.index])).toEqual([
      ['footer', 0],
      ['header', 0],
      ['header', 1],
    ]);
  });

  it('skips array entries that are not non-null objects', () => {
    const snapshot = makeSnapshot({
      content: [null, 'not-a-component', 42, component('HeroBlock', 'HeroBlock-1')],
      zones: {},
    });

    const refs = walkComponents(snapshot);

    expect(refs).toHaveLength(1);
    expect(refs[0].component.props.id).toBe('HeroBlock-1');
  });

  it('skips objects missing a string type', () => {
    const snapshot = makeSnapshot({
      content: [{ props: { id: 'no-type-1' } }, { type: 42, props: { id: 'no-type-2' } }],
      zones: {},
    });

    const refs = walkComponents(snapshot);

    expect(refs).toHaveLength(0);
  });

  it('skips objects whose props is missing, null, or not an object', () => {
    const snapshot = makeSnapshot({
      content: [
        { type: 'HeroBlock' },
        { type: 'HeroBlock', props: null },
        { type: 'HeroBlock', props: 'not-an-object' },
      ],
      zones: {},
    });

    const refs = walkComponents(snapshot);

    expect(refs).toHaveLength(0);
  });

  it('returns an empty array for a non-object snapshot', () => {
    expect(walkComponents(null)).toEqual([]);
    expect(walkComponents(undefined)).toEqual([]);
    expect(walkComponents('a string')).toEqual([]);
    expect(walkComponents(42)).toEqual([]);
  });

  it('returns an empty array for an object with neither content nor zones', () => {
    expect(walkComponents({ root: { props: {} } })).toEqual([]);
  });

  it('walks zones on a snapshot with no content', () => {
    const snapshot = {
      zones: { sidebar: [component('NavBlock', 'NavBlock-1')] },
    };

    const refs = walkComponents(snapshot);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ location: 'zone', zoneKey: 'sidebar', index: 0 });
  });
});

describe('extractComponentIds', () => {
  it('returns ids in walk order', () => {
    const snapshot = makeSnapshot();

    expect(extractComponentIds(snapshot)).toEqual(['HeroBlock-1', 'BodyBlock-1', 'NavBlock-1']);
  });

  it('includes duplicate ids verbatim', () => {
    const snapshot = makeSnapshot({
      content: [component('HeroBlock', 'dup-1'), component('BodyBlock', 'dup-1')],
      zones: {},
    });

    expect(extractComponentIds(snapshot)).toEqual(['dup-1', 'dup-1']);
  });

  it('skips components with a missing id', () => {
    const snapshot = makeSnapshot({
      content: [component('HeroBlock', undefined), component('BodyBlock', 'BodyBlock-1')],
      zones: {},
    });

    expect(extractComponentIds(snapshot)).toEqual(['BodyBlock-1']);
  });

  it('skips components whose id is not a string', () => {
    const snapshot = makeSnapshot({
      content: [
        { type: 'HeroBlock', props: { id: 42 } },
        component('BodyBlock', 'BodyBlock-1'),
      ],
      zones: {},
    });

    expect(extractComponentIds(snapshot)).toEqual(['BodyBlock-1']);
  });

  it('returns an empty array for a snapshot with no components', () => {
    expect(extractComponentIds({ content: [], zones: {} })).toEqual([]);
  });
});

describe('mintComponentId', () => {
  it('returns an id of the form Type-uuid', () => {
    const id = mintComponentId('HeroBlock');

    expect(id).toMatch(
      /^HeroBlock-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('uses the given type as the prefix', () => {
    const id = mintComponentId('BodyBlock');

    expect(id.startsWith('BodyBlock-')).toBe(true);
    expect(id.slice('BodyBlock-'.length)).toMatch(UUID_ID_PATTERN);
  });

  it('returns distinct values on successive calls', () => {
    const first = mintComponentId('HeroBlock');
    const second = mintComponentId('HeroBlock');

    expect(first).not.toBe(second);
  });
});

describe('dedupeComponentIds', () => {
  it('leaves a snapshot with no duplicate ids untouched, returning the same reference', () => {
    const snapshot = makeSnapshot();

    const result = dedupeComponentIds(snapshot);

    expect(result.snapshot).toBe(snapshot);
    expect(result.reminted).toEqual([]);
  });

  it('keeps the first occurrence of a duplicated id and re-mints every later one', () => {
    const snapshot = makeSnapshot({
      content: [component('HeroBlock', 'dup-1'), component('BodyBlock', 'dup-1')],
      zones: {},
    });

    const result = dedupeComponentIds(snapshot);
    const ids = extractComponentIds(result.snapshot);

    expect(ids[0]).toBe('dup-1');
    expect(ids[1]).not.toBe('dup-1');
  });

  it('mints the replacement id from the re-minted component\'s own type', () => {
    const snapshot = makeSnapshot({
      content: [component('HeroBlock', 'dup-1'), component('BodyBlock', 'dup-1')],
      zones: {},
    });

    const result = dedupeComponentIds(snapshot);
    const ids = extractComponentIds(result.snapshot);

    expect(ids[1]).toMatch(/^BodyBlock-/);
  });

  it('records one reminted entry per re-minted component with previous and new id', () => {
    const snapshot = makeSnapshot({
      content: [
        component('HeroBlock', 'dup-1'),
        component('BodyBlock', 'dup-1'),
        component('CtaBlock', 'dup-1'),
      ],
      zones: {},
    });

    const result = dedupeComponentIds(snapshot);

    expect(result.reminted).toHaveLength(2);
    expect(result.reminted[0]).toMatchObject({ type: 'BodyBlock', previousId: 'dup-1' });
    expect(result.reminted[1]).toMatchObject({ type: 'CtaBlock', previousId: 'dup-1' });
    expect(result.reminted[0].newId).not.toBe('dup-1');
    expect(result.reminted[1].newId).not.toBe(result.reminted[0].newId);
  });

  it('never re-mints a component that has no string props.id', () => {
    const snapshot = makeSnapshot({
      content: [component('HeroBlock', undefined), component('BodyBlock', undefined)],
      zones: {},
    });

    const result = dedupeComponentIds(snapshot);

    expect(result.reminted).toEqual([]);
    for (const ref of walkComponents(result.snapshot)) {
      expect(ref.component.props.id).toBeUndefined();
    }
  });

  it('does not mutate the input snapshot', () => {
    const snapshot = makeSnapshot({
      content: [component('HeroBlock', 'dup-1'), component('BodyBlock', 'dup-1')],
      zones: {},
    });
    const before = structuredClone(snapshot);

    dedupeComponentIds(snapshot);

    expect(snapshot).toEqual(before);
  });

  it('keeps the content occurrence when the same id is duplicated in content and a zone', () => {
    const snapshot = makeSnapshot({
      content: [component('HeroBlock', 'dup-1')],
      zones: { sidebar: [component('NavBlock', 'dup-1')] },
    });

    const result = dedupeComponentIds(snapshot);
    const refs = walkComponents(result.snapshot);

    const contentRef = refs.find((ref) => ref.location === 'content');
    const zoneRef = refs.find((ref) => ref.location === 'zone');

    expect(contentRef?.component.props.id).toBe('dup-1');
    expect(zoneRef?.component.props.id).not.toBe('dup-1');
    expect(result.reminted).toHaveLength(1);
    expect(result.reminted[0]).toMatchObject({ type: 'NavBlock', previousId: 'dup-1' });
  });

  it('re-mints a duplicate to the same id on repeated calls with the same input', () => {
    const makeInput = () => makeSnapshot({
      content: [component('HeroBlock', 'dup-1'), component('BodyBlock', 'dup-1')],
      zones: {},
    });

    const first = dedupeComponentIds(makeInput());
    const second = dedupeComponentIds(makeInput());

    expect(first.reminted[0].newId).toBe(second.reminted[0].newId);
    expect(extractComponentIds(first.snapshot)).toEqual(extractComponentIds(second.snapshot));
  });

  it('re-mints a duplicate to a Type-uuid shaped id', () => {
    const snapshot = makeSnapshot({
      content: [component('HeroBlock', 'dup-1'), component('BodyBlock', 'dup-1')],
      zones: {},
    });

    const { reminted } = dedupeComponentIds(snapshot);

    expect(reminted[0].newId.startsWith('BodyBlock-')).toBe(true);
    expect(reminted[0].newId.slice('BodyBlock-'.length)).toMatch(UUID_ID_PATTERN);
  });
});

describe('remintComponentIdsInValue', () => {
  it('mints a fresh props.id for a top-level component-shaped value', () => {
    const value = component('HeroBlock', 'old-id');

    const result = remintComponentIdsInValue(value) as DocumentComponent;

    expect(result.props.id).not.toBe('old-id');
    expect(result.props.id).toMatch(/^HeroBlock-/);
  });

  it('mints a fresh props.id for a component that had none', () => {
    const value = component('HeroBlock', undefined);

    const result = remintComponentIdsInValue(value) as DocumentComponent;

    expect(typeof result.props.id).toBe('string');
    expect(result.props.id).toMatch(/^HeroBlock-/);
  });

  it('recurses into arrays, re-minting every component element', () => {
    const value = [component('HeroBlock', 'a'), component('BodyBlock', 'b')];

    const result = remintComponentIdsInValue(value) as DocumentComponent[];

    expect(result[0].props.id).not.toBe('a');
    expect(result[1].props.id).not.toBe('b');
  });

  it('recurses into a snapshot-shaped object, re-minting components under content and zones', () => {
    const snapshot = makeSnapshot();

    const result = remintComponentIdsInValue(snapshot) as Record<string, unknown>;
    const newIds = extractComponentIds(result);
    const oldIds = extractComponentIds(snapshot);

    expect(newIds).toHaveLength(oldIds.length);
    for (let i = 0; i < newIds.length; i++) {
      expect(newIds[i]).not.toBe(oldIds[i]);
    }
  });

  it('recurses into a component nested inside another component\'s props', () => {
    const inner = component('IconBlock', 'inner-id');
    const outer = component('CardBlock', 'outer-id', { icon: inner });

    const result = remintComponentIdsInValue(outer) as DocumentComponent;
    const nested = result.props.icon as DocumentComponent;

    expect(result.props.id).not.toBe('outer-id');
    expect(nested.props.id).not.toBe('inner-id');
    expect(nested.type).toBe('IconBlock');
  });

  it('leaves non-component values structurally and value equal', () => {
    expect(remintComponentIdsInValue('a string')).toBe('a string');
    expect(remintComponentIdsInValue(42)).toBe(42);
    expect(remintComponentIdsInValue(null)).toBeNull();
    expect(remintComponentIdsInValue(undefined)).toBeUndefined();
    expect(remintComponentIdsInValue({ title: 'hello', count: 3 })).toEqual({
      title: 'hello',
      count: 3,
    });
  });

  it('does not mutate the input value', () => {
    const value = component('HeroBlock', 'old-id');
    const before = structuredClone(value);

    remintComponentIdsInValue(value);

    expect(value).toEqual(before);
  });
});
