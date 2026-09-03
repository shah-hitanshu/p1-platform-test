/**
 * Prop Addressing Tests
 *
 * Authority and translatability are stored per (slotId, propName) of a top-level
 * prop, so a fields-panel field resolves to that pair or to nothing. Puck builds
 * a field id as `${slotId}_${fieldType}_${propName}`, spells a root prop's slot
 * `root`, and appends a segment per level of nesting while `name` becomes a path.
 */

import { describe, it, expect } from 'vitest';
import { resolvePropTarget, ROOT_SLOT_ID } from '../../features/localization/prop-target.js';

describe('resolvePropTarget', () => {
  it('reads the slot id and prop name off a component field', () => {
    expect(resolvePropTarget('Hero-1_text_title', 'text', 'title')).toEqual({
      slotId: 'Hero-1',
      propName: 'title',
    });
    expect(resolvePropTarget('Hero-1_textarea_body', 'textarea', 'body')).toEqual({
      slotId: 'Hero-1',
      propName: 'body',
    });
  });

  it('keeps underscores in the slot id and the prop name', () => {
    expect(resolvePropTarget('Hero_Block-1_text_sub_title', 'text', 'sub_title')).toEqual({
      slotId: 'Hero_Block-1',
      propName: 'sub_title',
    });
  });

  it('keys a root prop by the root slot id', () => {
    expect(resolvePropTarget('root_text_title', 'text', 'title')).toEqual({
      slotId: ROOT_SLOT_ID,
      propName: 'title',
    });
    expect(ROOT_SLOT_ID).toBe('__root__');
  });

  it('resolves nothing for a subfield of an object prop', () => {
    expect(resolvePropTarget('Hero-1_object_meta_title', 'text', 'meta.title')).toBeNull();
  });

  it('resolves nothing for a subfield of an array item', () => {
    expect(resolvePropTarget('Cards-1_array_items_title', 'text', 'items[0].title')).toBeNull();
  });

  it('resolves nothing without an id, or when the id does not name the prop', () => {
    expect(resolvePropTarget(undefined, 'text', 'title')).toBeNull();
    expect(resolvePropTarget('Hero-1_text_headline', 'text', 'title')).toBeNull();
    expect(resolvePropTarget('Hero-1_text_title', 'textarea', 'title')).toBeNull();
  });

  it('resolves nothing when the id carries no slot before the prop', () => {
    expect(resolvePropTarget('_text_title', 'text', 'title')).toBeNull();
  });
});
