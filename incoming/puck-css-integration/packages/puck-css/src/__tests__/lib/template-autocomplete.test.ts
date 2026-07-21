import { describe, expect, it } from 'vitest';

import type { RemoteDatasourceDefinition } from '../../data/remote-datasources/remote-datasource-registry';
import {
  remoteDatasourceTemplateSuggestions,
  getActiveRemoteDatasourceInterpolation,
} from '../../data/template-autocomplete';

const TEST_REGISTRY: RemoteDatasourceDefinition[] = [
  {
    id: 'swapi',
    label: 'Star Wars API (person)',
    description: 'Test datasource',
    resolution: 'Test',
    fields: [
      { path: 'name', description: 'Character name' },
      { path: 'height', description: 'Height' },
      { path: 'hair_color', description: 'Hair color' },
    ],
  },
];

describe('getActiveRemoteDatasourceInterpolation', () => {
  it('detects open token before caret', () => {
    expect(getActiveRemoteDatasourceInterpolation('Hi {{ swa', 9)).toEqual({
      openIdx: 3,
      query: 'swa',
    });
  });

  it('returns null when segment is closed', () => {
    expect(getActiveRemoteDatasourceInterpolation('{{ swapi.name }}', 18)).toBeNull();
  });

  it('returns null when caret is before any {{', () => {
    expect(getActiveRemoteDatasourceInterpolation('swapi', 5)).toBeNull();
  });
});

describe('remoteDatasourceTemplateSuggestions', () => {
  it('filters by source id prefix', () => {
    const s = remoteDatasourceTemplateSuggestions('swa', TEST_REGISTRY);
    expect(s.some((x) => x.label === 'swapi.name')).toBe(true);
    expect(s.some((x) => x.label.startsWith('swapi.'))).toBe(true);
  });

  it('filters by dotted path', () => {
    const s = remoteDatasourceTemplateSuggestions('swapi.h', TEST_REGISTRY);
    expect(s.map((x) => x.label)).toContain('swapi.height');
    expect(s.map((x) => x.label)).toContain('swapi.hair_color');
  });

  it('returns many options for empty query', () => {
    const s = remoteDatasourceTemplateSuggestions('', TEST_REGISTRY);
    expect(s.length).toBeGreaterThan(5);
  });

  it('includes function template suggestions with example from registry', () => {
    const s = remoteDatasourceTemplateSuggestions('toupper', TEST_REGISTRY);
    expect(s.map((x) => x.label)).toContain('toUpperCase(swapi.name)');
  });

  it('uses generic placeholder for function suggestions when registry is empty', () => {
    const s = remoteDatasourceTemplateSuggestions('toupper', []);
    expect(s.map((x) => x.label)).toContain('toUpperCase(source.field)');
  });
});
