// @vitest-environment node
/**
 * Translatability Storage Tests
 *
 * Per-prop translatability lives on the CANONICAL page snapshot at
 * root.props._localeTranslatable, shape { [slotId]: { [propName]: boolean } }.
 * Absence means translatable (true); only an explicit false is non-translatable.
 */

import { describe, it, expect } from 'vitest';
import {
  isPropTranslatable,
  applyTranslatable,
} from '../../features/localization/translatable.js';

describe('isPropTranslatable', () => {
  it('defaults to true when nothing is stored', () => {
    expect(isPropTranslatable(undefined, 'comp-1', 'title')).toBe(true);
    expect(isPropTranslatable({}, 'comp-1', 'title')).toBe(true);
  });

  it('returns false when an explicit false is stored', () => {
    expect(isPropTranslatable({ 'comp-1': { sku: false } }, 'comp-1', 'sku')).toBe(false);
  });

  it('returns true for a sibling prop that is not marked', () => {
    expect(isPropTranslatable({ 'comp-1': { sku: false } }, 'comp-1', 'title')).toBe(true);
  });
});

describe('applyTranslatable', () => {
  it('writes an explicit false without mutating the input snapshot', () => {
    const snapshot = { content: [], root: { props: { title: 'Home' } } };
    const next = applyTranslatable(snapshot, 'comp-1', 'sku', false);

    const nextProps = (next.root as { props: Record<string, unknown> }).props;
    const map = nextProps._localeTranslatable as Record<string, Record<string, boolean>>;
    expect(map['comp-1'].sku).toBe(false);
    // input untouched
    expect((snapshot.root.props as Record<string, unknown>)._localeTranslatable).toBeUndefined();
    // other props preserved
    expect(nextProps.title).toBe('Home');
  });

  it('prunes the entry when toggling back to translatable (true)', () => {
    const snapshot = {
      root: { props: { _localeTranslatable: { 'comp-1': { sku: false, title: false } } } },
    };
    const next = applyTranslatable(snapshot, 'comp-1', 'sku', true);
    const map = (next.root as { props: Record<string, unknown> }).props
      ._localeTranslatable as Record<string, Record<string, boolean>>;
    expect(map['comp-1'].sku).toBeUndefined();
    expect(map['comp-1'].title).toBe(false);
  });

  it('prunes an emptied slot', () => {
    const snapshot = {
      root: { props: { _localeTranslatable: { 'comp-1': { sku: false } } } },
    };
    const next = applyTranslatable(snapshot, 'comp-1', 'sku', true);
    const map = (next.root as { props: Record<string, unknown> }).props
      ._localeTranslatable as Record<string, Record<string, boolean>> | undefined;
    expect(map?.['comp-1']).toBeUndefined();
  });

  it('removes the map entirely once no slot holds a setting', () => {
    const snapshot = {
      root: { props: { title: 'Home', _localeTranslatable: { 'comp-1': { sku: false } } } },
    };
    const next = applyTranslatable(snapshot, 'comp-1', 'sku', true);
    const props = (next.root as { props: Record<string, unknown> }).props;

    // Returning every prop to translatable leaves the document as it was found.
    expect('_localeTranslatable' in props).toBe(false);
    expect(props.title).toBe('Home');
  });
});
