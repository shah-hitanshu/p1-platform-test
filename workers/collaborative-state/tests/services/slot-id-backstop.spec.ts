/**
 * Pin-state continuity across the uniqueness backstop.
 *
 * Template documents carry pin state in root.props._pinMap, keyed by component
 * id. When the backstop re-mints a duplicated id, the re-minted component
 * inherits the pin state its id carried, and the first occurrence keeps its id
 * and its pin state. A re-minted component whose id was not pinned gains no pin
 * entry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enforceUniqueSlotIds } from '../../src/services/slot-id-backstop';

interface Comp {
  type: string;
  props: { id: string; [key: string]: unknown };
}

function comp(type: string, id: string): Comp {
  return { type, props: { id } };
}

function contentIds(snapshot: Record<string, unknown>): string[] {
  const content = (snapshot as { content?: Comp[] }).content ?? [];
  return content.map((c) => c.props.id);
}

function pinMap(snapshot: Record<string, unknown>): Record<string, unknown> {
  const root = snapshot.root as { props?: { _pinMap?: Record<string, unknown> } } | undefined;
  return root?.props?._pinMap ?? {};
}

describe('enforceUniqueSlotIds pin-state continuity', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('copies a re-minted component pin state to its new id and keeps the original', () => {
    const snapshot = {
      content: [comp('HeroBlock', 'HeroBlock-dup'), comp('BodyBlock', 'HeroBlock-dup')],
      zones: {},
      root: { props: { _pinMap: { 'HeroBlock-dup': true } } },
    };

    const result = enforceUniqueSlotIds('doc-1', snapshot);
    const reMintedId = contentIds(result)[1];
    const map = pinMap(result);

    expect(reMintedId).not.toBe('HeroBlock-dup');
    expect(map['HeroBlock-dup']).toBe(true);
    expect(map[reMintedId]).toBe(true);
  });

  it('does not create a pin entry for a re-minted component whose id was not pinned', () => {
    const snapshot = {
      content: [comp('HeroBlock', 'HeroBlock-dup'), comp('BodyBlock', 'HeroBlock-dup')],
      zones: {},
      root: { props: { _pinMap: { 'SomethingElse-1': true } } },
    };

    const result = enforceUniqueSlotIds('doc-1', snapshot);
    const reMintedId = contentIds(result)[1];
    const map = pinMap(result);

    expect(map[reMintedId]).toBeUndefined();
    expect(map['SomethingElse-1']).toBe(true);
  });

  it('leaves the snapshot and its pin map untouched when there are no duplicates', () => {
    const snapshot = {
      content: [comp('HeroBlock', 'HeroBlock-1'), comp('BodyBlock', 'BodyBlock-1')],
      zones: {},
      root: { props: { _pinMap: { 'HeroBlock-1': true } } },
    };

    const result = enforceUniqueSlotIds('doc-1', snapshot);

    expect(result).toBe(snapshot);
    expect(pinMap(result)).toEqual({ 'HeroBlock-1': true });
  });

  it('re-mints duplicates on a document with no pin map without error', () => {
    const snapshot = {
      content: [comp('HeroBlock', 'HeroBlock-dup'), comp('BodyBlock', 'HeroBlock-dup')],
      zones: {},
      root: { props: {} },
    };

    const result = enforceUniqueSlotIds('doc-1', snapshot);
    const ids = contentIds(result);

    expect(ids[0]).toBe('HeroBlock-dup');
    expect(ids[1]).not.toBe('HeroBlock-dup');
  });
});
