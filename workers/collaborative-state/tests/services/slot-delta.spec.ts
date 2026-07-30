/**
 * Slot-id-keyed template deltas.
 *
 * A template delta is an id-keyed diff of two template snapshots: components
 * added (carried with their full props), removed, and moved, each placed by
 * its destination list and the slot ids that precede it there. Applying a
 * delta to a document matches components by slot id, so document-local
 * components are never disturbed and anchors degrade to the nearest
 * preceding surviving slot.
 *
 * PROPOSAL-015 Design 5, 8.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSlotDelta,
  applySlotDelta,
  touchedSlotIds,
  isSlotDelta,
} from '../../src/services/slot-delta';

interface Comp {
  type: string;
  props: { id?: string; [key: string]: unknown };
}

function comp(type: string, id: string, extra: Record<string, unknown> = {}): Comp {
  return { type, props: { id, ...extra } };
}

function snapshot(
  content: unknown[],
  zones: Record<string, unknown[]> = {},
): Record<string, unknown> {
  return { content, zones, root: { props: { title: 'T' } } };
}

const A = comp('HeroBlock', 'HeroBlock-aaaa', { title: 'Hero' });
const B = comp('BodyBlock', 'BodyBlock-bbbb', { text: 'Body' });
const C = comp('CtaBlock', 'CtaBlock-cccc', { label: 'Go' });
const D = comp('FooterBlock', 'FooterBlock-dddd', {});

function contentIds(result: Record<string, unknown>): (string | undefined)[] {
  return (result.content as Comp[]).map((c) => c.props.id);
}

describe('buildSlotDelta', () => {
  it('returns an empty delta for identical snapshots', () => {
    const delta = buildSlotDelta(snapshot([A, B]), snapshot([A, B]));

    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.moved).toEqual([]);
  });

  it('records every slot id of both versions as a template id', () => {
    const delta = buildSlotDelta(snapshot([A, B]), snapshot([B, C]));

    expect([...delta.templateIds].sort()).toEqual(
      ['BodyBlock-bbbb', 'CtaBlock-cccc', 'HeroBlock-aaaa'].sort(),
    );
  });

  describe('added components', () => {
    it('detects a component appended at the end, carrying its full props', () => {
      const delta = buildSlotDelta(snapshot([A]), snapshot([A, B]));

      expect(delta.added).toHaveLength(1);
      expect(delta.added[0].component).toEqual(B);
      expect(delta.added[0].placement.zone).toBeNull();
      expect(delta.added[0].placement.precedingIds).toEqual(['HeroBlock-aaaa']);
      expect(delta.removed).toEqual([]);
      expect(delta.moved).toEqual([]);
    });

    it('places a component added at the head with no preceding ids', () => {
      const delta = buildSlotDelta(snapshot([A]), snapshot([B, A]));

      expect(delta.added[0].component.props.id).toBe('BodyBlock-bbbb');
      expect(delta.added[0].placement.precedingIds).toEqual([]);
    });

    it('lists preceding slot ids nearest first', () => {
      const delta = buildSlotDelta(snapshot([A]), snapshot([A, B, C]));

      const cAdd = delta.added.find((a) => a.component.props.id === 'CtaBlock-cccc');
      expect(cAdd?.placement.precedingIds).toEqual(['BodyBlock-bbbb', 'HeroBlock-aaaa']);
    });

    it('does not mark a pushed-down survivor as moved when a component is inserted before it', () => {
      const delta = buildSlotDelta(snapshot([B]), snapshot([A, B]));

      expect(delta.added.map((a) => a.component.props.id)).toEqual(['HeroBlock-aaaa']);
      expect(delta.moved).toEqual([]);
    });

    it('deep-copies added components from the target snapshot', () => {
      const to = snapshot([A, B]);
      const delta = buildSlotDelta(snapshot([A]), to);

      (delta.added[0].component.props).text = 'mutated';

      expect((to.content as Comp[])[1].props.text).toBe('Body');
    });

    it('detects a component added inside a zone with its zone placement', () => {
      const delta = buildSlotDelta(
        snapshot([A]),
        snapshot([A], { 'HeroBlock-aaaa:cta': [C] }),
      );

      expect(delta.added).toHaveLength(1);
      expect(delta.added[0].component.props.id).toBe('CtaBlock-cccc');
      expect(delta.added[0].placement.zone).toBe('HeroBlock-aaaa:cta');
      expect(delta.added[0].placement.precedingIds).toEqual([]);
    });

    it('scopes zone preceding ids to the same zone list', () => {
      const delta = buildSlotDelta(
        snapshot([A], { 'HeroBlock-aaaa:cta': [C] }),
        snapshot([A], { 'HeroBlock-aaaa:cta': [C, D] }),
      );

      expect(delta.added[0].placement.zone).toBe('HeroBlock-aaaa:cta');
      expect(delta.added[0].placement.precedingIds).toEqual(['CtaBlock-cccc']);
    });
  });

  describe('removed components', () => {
    it('detects a removed component by slot id', () => {
      const delta = buildSlotDelta(snapshot([A, B]), snapshot([A]));

      expect(delta.removed).toEqual(['BodyBlock-bbbb']);
      expect(delta.added).toEqual([]);
    });

    it('does not mark survivors as moved when an earlier component is removed', () => {
      const delta = buildSlotDelta(snapshot([A, B, C]), snapshot([B, C]));

      expect(delta.removed).toEqual(['HeroBlock-aaaa']);
      expect(delta.moved).toEqual([]);
    });

    it('detects removal from a zone', () => {
      const delta = buildSlotDelta(
        snapshot([A], { 'HeroBlock-aaaa:cta': [C] }),
        snapshot([A], { 'HeroBlock-aaaa:cta': [] }),
      );

      expect(delta.removed).toEqual(['CtaBlock-cccc']);
    });
  });

  describe('moved components', () => {
    it('emits a single move when one component jumps to the head', () => {
      const delta = buildSlotDelta(snapshot([A, B, C]), snapshot([C, A, B]));

      expect(delta.moved).toHaveLength(1);
      expect(delta.moved[0].id).toBe('CtaBlock-cccc');
      expect(delta.moved[0].placement.zone).toBeNull();
      expect(delta.moved[0].placement.precedingIds).toEqual([]);
      expect(delta.added).toEqual([]);
      expect(delta.removed).toEqual([]);
    });

    it('emits a single move for a swap of two components', () => {
      const delta = buildSlotDelta(snapshot([A, B]), snapshot([B, A]));

      expect(delta.moved).toHaveLength(1);
    });

    it('emits a single move for an adjacent transposition in the middle', () => {
      const delta = buildSlotDelta(snapshot([A, B, C, D]), snapshot([A, C, B, D]));

      expect(delta.moved).toHaveLength(1);
    });

    it('detects a move from content into a zone', () => {
      const delta = buildSlotDelta(
        snapshot([A, C]),
        snapshot([A], { 'HeroBlock-aaaa:cta': [C] }),
      );

      expect(delta.moved).toHaveLength(1);
      expect(delta.moved[0].id).toBe('CtaBlock-cccc');
      expect(delta.moved[0].placement.zone).toBe('HeroBlock-aaaa:cta');
      expect(delta.added).toEqual([]);
      expect(delta.removed).toEqual([]);
    });
  });

  it('produces an empty structural delta when only props changed', () => {
    const changed = comp('HeroBlock', 'HeroBlock-aaaa', { title: 'New title' });
    const delta = buildSlotDelta(snapshot([A, B]), snapshot([changed, B]));

    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.moved).toEqual([]);
  });

  it('ignores components without a string id', () => {
    const anonymous = { type: 'Stray', props: { text: 'no id' } };
    const delta = buildSlotDelta(snapshot([A]), snapshot([A, anonymous]));

    expect(delta.added).toEqual([]);
    expect(delta.templateIds).toEqual(['HeroBlock-aaaa']);
  });

  it('tolerates snapshots that are not content-shaped', () => {
    const delta = buildSlotDelta({ components: [] }, null);

    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.moved).toEqual([]);
    expect(delta.templateIds).toEqual([]);
  });
});

describe('applySlotDelta', () => {
  it('round-trips a reorder onto a document holding the same slots', () => {
    const delta = buildSlotDelta(snapshot([A, B, C]), snapshot([C, A, B]));
    const doc = snapshot([A, B, C]);

    const result = applySlotDelta(doc, delta);

    expect(contentIds(result)).toEqual(['CtaBlock-cccc', 'HeroBlock-aaaa', 'BodyBlock-bbbb']);
  });

  it('round-trips a swap', () => {
    const delta = buildSlotDelta(snapshot([A, B]), snapshot([B, A]));

    const result = applySlotDelta(snapshot([A, B]), delta);

    expect(contentIds(result)).toEqual(['BodyBlock-bbbb', 'HeroBlock-aaaa']);
  });

  it('round-trips a middle transposition', () => {
    const delta = buildSlotDelta(snapshot([A, B, C, D]), snapshot([A, C, B, D]));

    const result = applySlotDelta(snapshot([A, B, C, D]), delta);

    expect(contentIds(result)).toEqual([
      'HeroBlock-aaaa', 'CtaBlock-cccc', 'BodyBlock-bbbb', 'FooterBlock-dddd',
    ]);
  });

  describe('adds', () => {
    it('inserts an added component after its anchor with full props', () => {
      const delta = buildSlotDelta(snapshot([A, C]), snapshot([A, B, C]));

      const result = applySlotDelta(snapshot([A, C]), delta);

      expect(contentIds(result)).toEqual(['HeroBlock-aaaa', 'BodyBlock-bbbb', 'CtaBlock-cccc']);
      expect((result.content as Comp[])[1].props.text).toBe('Body');
    });

    it('falls back to the nearest preceding surviving slot when the anchor is absent', () => {
      const delta = buildSlotDelta(snapshot([A, B]), snapshot([A, B, C]));
      const docWithoutAnchor = snapshot([A]);

      const result = applySlotDelta(docWithoutAnchor, delta);

      expect(contentIds(result)).toEqual(['HeroBlock-aaaa', 'CtaBlock-cccc']);
    });

    it('inserts after the local components that follow the anchor', () => {
      const local = comp('LocalBlock', 'LocalBlock-1111', {});
      const delta = buildSlotDelta(snapshot([A, C]), snapshot([A, B, C]));
      const doc = snapshot([A, local, C]);

      const result = applySlotDelta(doc, delta);

      expect(contentIds(result)).toEqual([
        'HeroBlock-aaaa', 'LocalBlock-1111', 'BodyBlock-bbbb', 'CtaBlock-cccc',
      ]);
    });

    it('inserts a head-anchored component after leading local components', () => {
      const local = comp('LocalBlock', 'LocalBlock-1111', {});
      const delta = buildSlotDelta(snapshot([A]), snapshot([B, A]));
      const doc = snapshot([local, A]);

      const result = applySlotDelta(doc, delta);

      expect(contentIds(result)).toEqual(['LocalBlock-1111', 'BodyBlock-bbbb', 'HeroBlock-aaaa']);
    });

    it('skips an add whose id is already present in the document', () => {
      const delta = buildSlotDelta(snapshot([A]), snapshot([A, B]));
      const doc = snapshot([A, B]);

      const result = applySlotDelta(doc, delta);

      expect(contentIds(result)).toEqual(['HeroBlock-aaaa', 'BodyBlock-bbbb']);
    });

    it('creates the destination zone when the document does not have it', () => {
      const delta = buildSlotDelta(
        snapshot([A]),
        snapshot([A], { 'HeroBlock-aaaa:cta': [C] }),
      );
      const doc = snapshot([A]);

      const result = applySlotDelta(doc, delta);

      const zone = (result.zones as Record<string, Comp[]>)['HeroBlock-aaaa:cta'];
      expect(zone.map((z) => z.props.id)).toEqual(['CtaBlock-cccc']);
    });
  });

  describe('removes', () => {
    it('removes matching components from content', () => {
      const delta = buildSlotDelta(snapshot([A, B]), snapshot([A]));

      const result = applySlotDelta(snapshot([A, B]), delta);

      expect(contentIds(result)).toEqual(['HeroBlock-aaaa']);
    });

    it('removes matching components from zones', () => {
      const delta = buildSlotDelta(
        snapshot([A], { 'HeroBlock-aaaa:cta': [C] }),
        snapshot([A], { 'HeroBlock-aaaa:cta': [] }),
      );
      const doc = snapshot([A], { 'HeroBlock-aaaa:cta': [C] });

      const result = applySlotDelta(doc, delta);

      expect((result.zones as Record<string, Comp[]>)['HeroBlock-aaaa:cta']).toEqual([]);
    });

    it('leaves document-local components untouched by removes', () => {
      const local = comp('LocalBlock', 'LocalBlock-1111', {});
      const delta = buildSlotDelta(snapshot([A, B]), snapshot([A]));
      const doc = snapshot([A, local, B]);

      const result = applySlotDelta(doc, delta);

      expect(contentIds(result)).toEqual(['HeroBlock-aaaa', 'LocalBlock-1111']);
    });
  });

  describe('moves', () => {
    it('moves a component across lists into its destination zone', () => {
      const delta = buildSlotDelta(
        snapshot([A, C]),
        snapshot([A], { 'HeroBlock-aaaa:cta': [C] }),
      );
      const doc = snapshot([A, C]);

      const result = applySlotDelta(doc, delta);

      expect(contentIds(result)).toEqual(['HeroBlock-aaaa']);
      const zone = (result.zones as Record<string, Comp[]>)['HeroBlock-aaaa:cta'];
      expect(zone.map((z) => z.props.id)).toEqual(['CtaBlock-cccc']);
    });

    it('skips a move whose component is absent from the document', () => {
      const delta = buildSlotDelta(snapshot([A, B, C]), snapshot([C, A, B]));
      const doc = snapshot([A, B]);

      const result = applySlotDelta(doc, delta);

      expect(contentIds(result)).toEqual(['HeroBlock-aaaa', 'BodyBlock-bbbb']);
    });

    it('keeps the moved component the document instance, not the template copy', () => {
      const customized = comp('CtaBlock', 'CtaBlock-cccc', { label: 'Customized' });
      const delta = buildSlotDelta(snapshot([A, B, C]), snapshot([C, A, B]));
      const doc = snapshot([A, B, customized]);

      const result = applySlotDelta(doc, delta);

      expect((result.content as Comp[])[0].props.label).toBe('Customized');
    });
  });

  it('does not mutate the input snapshot', () => {
    const delta = buildSlotDelta(snapshot([A]), snapshot([A, B]));
    const doc = snapshot([A]);
    const before = structuredClone(doc);

    applySlotDelta(doc, delta);

    expect(doc).toEqual(before);
  });

  it('preserves root and unrelated snapshot keys', () => {
    const delta = buildSlotDelta(snapshot([A]), snapshot([A, B]));
    const doc = { ...snapshot([A]), extra: 'kept' };

    const result = applySlotDelta(doc, delta);

    expect(result.root).toEqual({ props: { title: 'T' } });
    expect(result.extra).toBe('kept');
  });
});

describe('touchedSlotIds', () => {
  it('collects added, removed, and moved slot ids', () => {
    const delta = buildSlotDelta(snapshot([A, B, C]), snapshot([C, A, D]));

    expect([...touchedSlotIds(delta)].sort()).toEqual(
      ['BodyBlock-bbbb', 'CtaBlock-cccc', 'FooterBlock-dddd'].sort(),
    );
  });

  it('is empty for an empty delta', () => {
    const delta = buildSlotDelta(snapshot([A]), snapshot([A]));

    expect(touchedSlotIds(delta)).toEqual([]);
  });
});

describe('isSlotDelta', () => {
  it('accepts a built delta', () => {
    expect(isSlotDelta(buildSlotDelta(snapshot([A]), snapshot([A, B])))).toBe(true);
  });

  it('rejects a legacy action array payload', () => {
    expect(isSlotDelta([{ type: 'insert', componentType: 'HeroBlock', destinationIndex: 0 }])).toBe(false);
  });

  it('rejects null and malformed objects', () => {
    expect(isSlotDelta(null)).toBe(false);
    expect(isSlotDelta({ added: [], removed: [] })).toBe(false);
  });
});
