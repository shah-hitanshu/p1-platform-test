import { describe, it, expect } from 'vitest';
import { attributionFromMetadata, isVersionAttribution } from '../../src/services/version-attribution';

const attribution = {
  agent: { id: 'agent-1', name: 'Copy Editor' },
  onBehalfOf: { id: 'user-1', name: 'Ada' },
  description: 'Shorten the headline',
};

describe('isVersionAttribution', () => {
  it('accepts an agent, a person, and a description', () => {
    expect(isVersionAttribution(attribution)).toBe(true);
  });

  it('accepts an empty description', () => {
    expect(isVersionAttribution({ ...attribution, description: '' })).toBe(true);
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'Copy Editor'],
    ['no agent', { onBehalfOf: attribution.onBehalfOf, description: 'x' }],
    ['an agent without an id', { ...attribution, agent: { id: '', name: 'Copy Editor' } }],
    ['a person without a name', { ...attribution, onBehalfOf: { id: 'user-1' } }],
    ['no description', { agent: attribution.agent, onBehalfOf: attribution.onBehalfOf }],
  ])('rejects %s', (_label, value) => {
    expect(isVersionAttribution(value)).toBe(false);
  });
});

describe('attributionFromMetadata', () => {
  it('reads a stored attribution back out of the metadata', () => {
    expect(attributionFromMetadata({ structural: true, attribution })).toEqual(attribution);
  });

  it('ignores metadata without one, or with a malformed one', () => {
    expect(attributionFromMetadata(null)).toBeUndefined();
    expect(attributionFromMetadata({ structural: true })).toBeUndefined();
    expect(attributionFromMetadata({ attribution: { agent: 'Copy Editor' } })).toBeUndefined();
  });
});
