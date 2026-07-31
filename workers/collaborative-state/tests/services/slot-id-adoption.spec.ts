/**
 * One-time slot-id adoption for documents created before durable slot ids.
 *
 * Adoption matches document components to template slots by type and
 * relative order among occurrences of that type. Top-level content matches
 * against template content; a zone matches through its parent component's
 * correspondence plus the zone name, and a rewritten parent's zone keys are
 * re-keyed to the parent's slot id. Matched components' props.id are
 * rewritten to the slot id; unmatched document components stay untouched as
 * local components. A document that cannot satisfy the template's pinned
 * slots is recorded and skipped rather than guessed at, and adoption of an
 * already-adopted document is a no-op.
 *
 * PROPOSAL-015 Design 7.
 */

import { describe, it, expect } from 'vitest';
import { adoptSlotIds } from '../../src/services/slot-id-adoption';

interface Comp {
  type: string;
  props: { id: string; [key: string]: unknown };
}

function comp(type: string, id: string, extra: Record<string, unknown> = {}): Comp {
  return { type, props: { id, ...extra } };
}

const TEMPLATE = {
  content: [
    comp('HeroBlock', 'HeroBlock-slot-1', { title: 'Default hero' }),
    comp('BodyBlock', 'BodyBlock-slot-1', { text: '' }),
    comp('BodyBlock', 'BodyBlock-slot-2', { text: '' }),
  ],
  root: { props: { _pinMap: { 'HeroBlock-slot-1': true } } },
  zones: {
    'HeroBlock-slot-1:cta': [comp('CtaBlock', 'CtaBlock-slot-1', { label: 'Go' })],
  },
};

function legacyDoc(): Record<string, unknown> {
  return {
    content: [
      comp('HeroBlock', 'comp_1700000000_hero', { title: 'My custom hero' }),
      comp('BodyBlock', 'comp_1700000000_body1', { text: 'First' }),
      comp('BodyBlock', 'comp_1700000000_body2', { text: 'Second' }),
    ],
    root: { props: { title: 'My page' } },
    zones: {
      'comp_1700000000_hero:cta': [comp('CtaBlock', 'comp_1700000000_cta', { label: 'Buy' })],
    },
  };
}

describe('adoptSlotIds', () => {
  it('rewrites matched component ids to their slot ids by type and order', () => {
    const outcome = adoptSlotIds(legacyDoc(), TEMPLATE);

    expect(outcome.status).toBe('adopted');
    const content = (outcome.snapshot?.content ?? []) as Comp[];
    expect(content.map((c) => c.props.id)).toEqual([
      'HeroBlock-slot-1', 'BodyBlock-slot-1', 'BodyBlock-slot-2',
    ]);
  });

  it('reports each rewrite with its previous id, slot id, and type', () => {
    const outcome = adoptSlotIds(legacyDoc(), TEMPLATE);

    expect(outcome.rewrites).toContainEqual({
      previousId: 'comp_1700000000_hero',
      slotId: 'HeroBlock-slot-1',
      type: 'HeroBlock',
    });
    expect(outcome.rewrites).toHaveLength(4);
  });

  it('preserves the document components own props through the rewrite', () => {
    const outcome = adoptSlotIds(legacyDoc(), TEMPLATE);

    const content = (outcome.snapshot?.content ?? []) as Comp[];
    expect(content[0].props.title).toBe('My custom hero');
    expect(content[1].props.text).toBe('First');
  });

  it('re-keys a rewritten parents zone to the parents slot id', () => {
    const outcome = adoptSlotIds(legacyDoc(), TEMPLATE);

    const zones = outcome.snapshot?.zones as Record<string, Comp[]>;
    expect(zones['HeroBlock-slot-1:cta']).toBeDefined();
    expect(zones['comp_1700000000_hero:cta']).toBeUndefined();
  });

  it('matches zone components through the parent correspondence and zone name', () => {
    const outcome = adoptSlotIds(legacyDoc(), TEMPLATE);

    const zones = outcome.snapshot?.zones as Record<string, Comp[]>;
    expect(zones['HeroBlock-slot-1:cta'][0].props.id).toBe('CtaBlock-slot-1');
    expect(zones['HeroBlock-slot-1:cta'][0].props.label).toBe('Buy');
  });

  it('leaves a zone belonging to an unmatched local parent untouched', () => {
    const doc = legacyDoc();
    (doc.content as Comp[]).push(comp('QuoteBlock', 'comp_1700000000_quote', {}));
    (doc.zones as Record<string, Comp[]>)['comp_1700000000_quote:body'] = [
      comp('BodyBlock', 'comp_1700000000_zoned', { text: 'Local zone' }),
    ];

    const outcome = adoptSlotIds(doc, TEMPLATE);

    const zones = outcome.snapshot?.zones as Record<string, Comp[]>;
    expect(zones['comp_1700000000_quote:body'][0].props.id).toBe('comp_1700000000_zoned');
  });

  it('leaves document components with no matching slot untouched as locals', () => {
    const doc = legacyDoc();
    (doc.content as Comp[]).push(comp('BodyBlock', 'comp_1700000000_body3', { text: 'Extra' }));
    (doc.content as Comp[]).push(comp('QuoteBlock', 'comp_1700000000_quote', {}));

    const outcome = adoptSlotIds(doc, TEMPLATE);

    expect(outcome.status).toBe('adopted');
    const content = (outcome.snapshot?.content ?? []) as Comp[];
    expect(content[3].props.id).toBe('comp_1700000000_body3');
    expect(content[4].props.id).toBe('comp_1700000000_quote');
  });

  it('tolerates unmatched unpinned slots', () => {
    const doc = legacyDoc();
    (doc.content as Comp[]).splice(2, 1);

    const outcome = adoptSlotIds(doc, TEMPLATE);

    expect(outcome.status).toBe('adopted');
    const content = (outcome.snapshot?.content ?? []) as Comp[];
    expect(content.map((c) => c.props.id)).toEqual(['HeroBlock-slot-1', 'BodyBlock-slot-1']);
  });

  it('returns already-adopted with no rewrites when ids already match the slots', () => {
    const adopted = adoptSlotIds(legacyDoc(), TEMPLATE);
    const outcome = adoptSlotIds(adopted.snapshot ?? {}, TEMPLATE);

    expect(outcome.status).toBe('already-adopted');
    expect(outcome.rewrites).toEqual([]);
    expect(outcome.snapshot).toBeUndefined();
  });

  it('rewrites only the components that still carry legacy ids', () => {
    const doc = legacyDoc();
    const content = doc.content as Comp[];
    content[0] = comp('HeroBlock', 'HeroBlock-slot-1', { title: 'Already adopted' });
    doc.zones = {
      'HeroBlock-slot-1:cta': [comp('CtaBlock', 'comp_1700000000_cta', { label: 'Buy' })],
    };

    const outcome = adoptSlotIds(doc, TEMPLATE);

    expect(outcome.status).toBe('adopted');
    expect(outcome.rewrites.map((r) => r.slotId)).not.toContain('HeroBlock-slot-1');
    expect(outcome.rewrites.map((r) => r.slotId)).toContain('BodyBlock-slot-1');
  });

  it('skips a document that is missing a pinned slot occurrence', () => {
    const doc = legacyDoc();
    (doc.content as Comp[]).splice(0, 1);

    const outcome = adoptSlotIds(doc, TEMPLATE);

    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toBe('missing-pinned-slot');
    expect(outcome.snapshot).toBeUndefined();
    expect(outcome.rewrites).toEqual([]);
  });

  it('skips a document whose rewrite would collide with an existing unrelated id', () => {
    const doc = legacyDoc();
    (doc.content as Comp[]).push(comp('QuoteBlock', 'BodyBlock-slot-1', {}));

    const outcome = adoptSlotIds(doc, TEMPLATE);

    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toBe('id-collision');
  });

  it('skips when the template is not content-shaped', () => {
    const manifest = {
      components: [{ type: 'HeroBlock', pinned: true, defaultProps: {} }],
    };

    const outcome = adoptSlotIds(legacyDoc(), manifest);

    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toBe('template-not-content-shaped');
  });

  it('treats an empty document against an unpinned template as a no-op', () => {
    const template = {
      content: [comp('BodyBlock', 'BodyBlock-slot-1', {})],
      root: { props: { _pinMap: {} } },
      zones: {},
    };

    const outcome = adoptSlotIds({ content: [], zones: {}, root: { props: {} } }, template);

    expect(outcome.status).toBe('already-adopted');
  });

  it('adopts occupants of slot ids swapped across occurrences without duplicating ids', () => {
    const doc = {
      content: [
        comp('HeroBlock', 'HeroBlock-slot-1', {}),
        comp('BodyBlock', 'BodyBlock-slot-2', { text: 'was second' }),
        comp('BodyBlock', 'comp_1700000000_body', { text: 'was third' }),
      ],
      root: { props: {} },
      zones: { 'HeroBlock-slot-1:cta': [comp('CtaBlock', 'CtaBlock-slot-1', {})] },
    };

    const outcome = adoptSlotIds(doc, TEMPLATE);

    expect(outcome.status).toBe('adopted');
    const content = (outcome.snapshot?.content ?? []) as Comp[];
    const ids = content.map((c) => c.props.id);
    expect(ids).toEqual(['HeroBlock-slot-1', 'BodyBlock-slot-1', 'BodyBlock-slot-2']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not mutate the input document or template', () => {
    const doc = legacyDoc();
    const docBefore = structuredClone(doc);
    const templateBefore = structuredClone(TEMPLATE);

    adoptSlotIds(doc, TEMPLATE);

    expect(doc).toEqual(docBefore);
    expect(TEMPLATE).toEqual(templateBefore);
  });
});
