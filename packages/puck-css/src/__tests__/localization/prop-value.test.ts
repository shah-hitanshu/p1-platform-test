import { describe, expect, it } from 'vitest';
import { readPropValue, writePropValue } from '../../features/localization/prop-value.js';

describe('Prop values', () => {
  it('decodes escaped pointer segments', () => {
    const props = { 'a/b': { '~title': 'Hello' } };

    expect(readPropValue(props, '/a~1b/~0title')).toEqual({ exists: true, value: 'Hello' });
  });

  it('distinguishes an absent field from an undefined value', () => {
    expect(readPropValue({}, '/title')).toEqual({ exists: false });
    expect(readPropValue({ title: undefined }, '/title')).toEqual({ exists: true, value: undefined });
  });

  it('restores an absent field without disturbing its siblings', () => {
    const props = { badge: { label: 'Hello', color: 'red' } };

    expect(writePropValue(props, '/badge/label', { exists: false })).toEqual({ badge: { color: 'red' } });
    expect(props.badge.label).toBe('Hello');
  });

  it('updates one array item immutably', () => {
    const props = { items: [{ label: 'One' }, { label: 'Two' }] };
    const updated = writePropValue(props, '/items/1/label', { exists: true, value: 'Deux' });

    expect(updated).toEqual({ items: [{ label: 'One' }, { label: 'Deux' }] });
    expect(props.items[1]?.label).toBe('Two');
  });
});
