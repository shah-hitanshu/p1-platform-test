import { describe, it, expect } from 'vitest';
import { flattenOutline, resolveDrop, ROOT_ZONE } from './outlineTree.js';

const config = {
  components: {
    HeadingBlock: { label: 'Heading' },
    ParagraphBlock: {},
    GridBlock: { fields: { items: { type: 'slot' }, title: { type: 'text' } } },
  },
};

const content = [
  { type: 'HeadingBlock', props: { id: 'h1' } },
  { type: 'ParagraphBlock', props: { id: 'p1' } },
];

describe('flattenOutline', () => {
  it('returns one row per top-level item, in order', () => {
    const rows = flattenOutline(content, config);
    expect(rows.map((r) => r.id)).toEqual(['h1', 'p1']);
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
  });

  it('puts top-level rows in the root zone at depth 0', () => {
    const rows = flattenOutline(content, config);
    expect(rows.every((r) => r.zone === ROOT_ZONE)).toBe(true);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it("prefers the config's explicit label", () => {
    const rows = flattenOutline(content, config);
    expect(rows[0].label).toBe('Heading');
  });

  it('falls back to the humanized component type when no label is set', () => {
    const rows = flattenOutline(content, config);
    expect(rows[1].label).toBe('Paragraph');
  });

  it('recurses into slot fields, indenting and re-zoning the children', () => {
    const nested = [
      {
        type: 'GridBlock',
        props: { id: 'g1', items: [{ type: 'HeadingBlock', props: { id: 'gh1' } }] },
      },
    ];
    const rows = flattenOutline(nested, config);
    expect(rows.map((r) => r.id)).toEqual(['g1', 'gh1']);
    expect(rows[1].depth).toBe(1);
    expect(rows[1].zone).toBe('g1:items');
    expect(rows[1].index).toBe(0);
  });

  it('ignores non-slot fields even when their value is an array', () => {
    const nested = [{ type: 'GridBlock', props: { id: 'g1', title: ['not', 'a', 'slot'] } }];
    expect(flattenOutline(nested, config)).toHaveLength(1);
  });

  it('returns an empty array for empty or missing content', () => {
    expect(flattenOutline([], config)).toEqual([]);
    expect(flattenOutline(undefined, config)).toEqual([]);
  });
});

describe('resolveDrop', () => {
  const row = (index: number, zone = ROOT_ZONE) => ({
    id: `id${index}`,
    type: 'HeadingBlock',
    label: 'Heading',
    zone,
    index,
    depth: 0,
  });

  it('moves the dragged row to the index it was dropped on', () => {
    expect(resolveDrop(row(0), row(2))).toEqual({
      zone: ROOT_ZONE,
      sourceIndex: 0,
      destinationIndex: 2,
    });
  });

  it('works dragging upward too', () => {
    expect(resolveDrop(row(3), row(1))).toEqual({
      zone: ROOT_ZONE,
      sourceIndex: 3,
      destinationIndex: 1,
    });
  });

  it('rejects a drop on itself', () => {
    expect(resolveDrop(row(1), row(1))).toBeNull();
  });

  it('rejects a drop into a different zone', () => {
    expect(resolveDrop(row(0), row(1, 'g1:items'))).toBeNull();
  });
});
