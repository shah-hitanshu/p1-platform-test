/**
 * A viewer must not reach the prop inspector on any path, including the pinned
 * one, which is the only path where a restricted role otherwise keeps edit.
 */
import { describe, it, expect } from 'vitest';
import { createPuckPermissions } from '../../../features/content-type-templates/permissions/createPuckPermissions.js';

const PINNED_ID = 'slot-pinned';
const templateWithPin = {
  id: 'tpl-1',
  content: [{ type: 'Hero', props: { id: PINNED_ID } }],
  zones: {},
  root: { props: { _pinMap: { [PINNED_ID]: true } } },
} as never;
const pinnedItem = { type: 'Hero', props: { id: PINNED_ID } };
const looseItem = { type: 'Hero', props: { id: 'slot-loose' } };

describe('createPuckPermissions canEditProps override', () => {
  it('keeps edit true on every path when the override is omitted', () => {
    const resolve = createPuckPermissions(templateWithPin, 'junior-editor', false);
    expect(resolve(pinnedItem, null).edit).toBe(true);
    expect(resolve(looseItem, null).edit).toBe(true);
    expect(createPuckPermissions(templateWithPin, 'junior-editor', true)(looseItem, null).edit).toBe(true);
  });

  it('denies edit on the default path when the override is false', () => {
    expect(createPuckPermissions(templateWithPin, 'junior-editor', false, false, false)(looseItem, null).edit).toBe(false);
  });

  it('denies edit on the pinned-slot path when the override is false', () => {
    expect(createPuckPermissions(templateWithPin, 'junior-editor', false, false, false)(pinnedItem, null).edit).toBe(false);
  });

  it('denies edit on the historical-version path when the override is false', () => {
    const resolve = createPuckPermissions(templateWithPin, 'junior-editor', true, false, false);
    expect(resolve(looseItem, null).edit).toBe(false);
    expect(resolve(pinnedItem, null).edit).toBe(false);
  });

  it('leaves the structural flags untouched by the override', () => {
    const perms = createPuckPermissions(null, 'editor', false, false, false)(looseItem, null);
    expect(perms.edit).toBe(false);
    expect(perms.drag).toBe(true);
    expect(perms.delete).toBe(true);
    expect(perms.insert).toBe(true);
    expect(perms.duplicate).toBe(true);
  });
});
