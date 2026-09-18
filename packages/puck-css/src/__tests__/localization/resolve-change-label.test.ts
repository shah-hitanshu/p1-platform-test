// @vitest-environment node
/**
 * Resolve change label
 *
 * A drift entry addresses its change by slot id and JSON Pointer, neither of
 * which an editor has seen. These turn that address into the words on the
 * canvas: the component's configured label, or a label derived from its type
 * when the config names none. A structural addition exists only upstream, so
 * there is no component in this document to read a type off and the type comes
 * from the slot id instead.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveComponentLabel,
  resolveFieldLabel,
  type ChangeLabelConfig,
} from '../../features/localization/resolve-change-label.js';
import { ROOT_SLOT_ID } from '../../features/localization/prop-target.js';

const config: ChangeLabelConfig = {
  components: {
    PlayerSpotlight: {
      label: 'Player spotlight',
      fields: { playerName: { label: 'Name on the shirt' } },
    },
  },
  root: { fields: { title: { label: 'Page title' } } },
};

describe('resolveComponentLabel', () => {
  it('prefers the label the component config gives its type', () => {
    expect(resolveComponentLabel(config, 'PlayerSpotlight-4dd499be', 'PlayerSpotlight')).toBe(
      'Player spotlight',
    );
  });

  it('derives a label from the type when the config names none', () => {
    expect(resolveComponentLabel({}, 'PlayerSpotlight-4dd499be', 'PlayerSpotlight')).toBe('Player Spotlight');
  });

  it('prefers the live component type over the type inferred from its id', () => {
    expect(resolveComponentLabel({}, 'Cta-ab9e85f7-edea-43d2-8370-41abc3e301d7', 'CardGrid')).toBe('Card Grid');
  });

  it('recovers the type from the slot id for a component only the source has', () => {
    // A structural addition is absent here by definition, so the id is the only
    // place its type can be read from.
    expect(
      resolveComponentLabel({}, 'Cta-ab9e85f7-edea-43d2-8370-41abc3e301d7'),
    ).toBe('CTA');
  });

  it('names the root slot for a change to the page itself', () => {
    expect(resolveComponentLabel(config, ROOT_SLOT_ID)).toBe('Page settings');
  });

  it('falls back to the raw id when it carries no recoverable type', () => {
    expect(resolveComponentLabel({}, 'legacy-block')).toBe('legacy-block');
  });
});

describe('resolveFieldLabel', () => {
  it('prefers the label the component config gives the field', () => {
    expect(resolveFieldLabel(config, 'PlayerSpotlight-4dd499be', '/playerName', 'PlayerSpotlight')).toBe(
      'Name on the shirt',
    );
  });

  it('derives a label from the field name when the config names none', () => {
    expect(resolveFieldLabel(config, 'PlayerSpotlight-4dd499be', '/position', 'PlayerSpotlight')).toBe(
      'Position',
    );
  });

  it('distinguishes nested changes within the same field', () => {
    expect(resolveFieldLabel({}, 'PlayerSpotlight-4dd499be', '/badge/color')).toBe('Badge → Color');
    expect(resolveFieldLabel({}, 'PlayerSpotlight-4dd499be', '/badge/label')).toBe('Badge → Label');
  });

  it('uses labels for nested object and array fields', () => {
    const nestedConfig = { root: { fields: { items: { label: 'Cards', arrayFields: {
      badge: { label: 'Badge', objectFields: { color: { label: 'Background' } } },
    } } } } };
    expect(resolveFieldLabel(nestedConfig, ROOT_SLOT_ID, '/items/1/badge/color')).toBe('Cards → Item 2 → Badge → Background');
  });

  it('decodes pointer escapes before looking up a field label', () => {
    const escaped = { root: { fields: { 'a/b': { label: 'Heading' } } } };
    expect(resolveFieldLabel(escaped, ROOT_SLOT_ID, '/a~1b')).toBe('Heading');
  });

  it('reads a root field from the root config', () => {
    expect(resolveFieldLabel(config, ROOT_SLOT_ID, '/title')).toBe('Page title');
  });

  it('derives a root field label when the root config names none', () => {
    expect(resolveFieldLabel(config, ROOT_SLOT_ID, '/socialImage')).toBe('Social Image');
  });

  it('still labels the field when the component type cannot be resolved', () => {
    expect(resolveFieldLabel(config, 'legacy-block', '/headline')).toBe('Headline');
  });
});
