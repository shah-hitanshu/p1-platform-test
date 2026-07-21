import { describe, expect, it } from 'vitest';

import {
  buildRemoteDatasourceRegistry,
  type RemoteDatasourceDefinition,
} from '../../data/remote-datasources/remote-datasource-registry';

const BUILTIN: RemoteDatasourceDefinition[] = [
  {
    id: 'swapi',
    label: 'Star Wars API',
    description: 'Test builtin',
    resolution: 'Query string',
    fields: [{ path: 'name', description: 'Character name' }],
  },
];

describe('buildRemoteDatasourceRegistry', () => {
  it('returns builtins when no user datasources', () => {
    const result = buildRemoteDatasourceRegistry(BUILTIN);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('swapi');
  });

  it('merges global and page user datasources after builtins', () => {
    const result = buildRemoteDatasourceRegistry(
      BUILTIN,
      [{ id: 'global_ds', label: 'Global DS', description: 'g', urlTemplate: 'http://a', fields: [] }],
      [{ id: 'page_ds', label: 'Page DS', description: 'p', urlTemplate: 'http://b', fields: [] }]
    );
    expect(result).toHaveLength(3);
    expect(result.map((d) => d.id)).toEqual(['swapi', 'global_ds', 'page_ds']);
  });

  it('maps user datasources to standard definition shape', () => {
    const result = buildRemoteDatasourceRegistry([], [
      {
        id: 'test',
        label: 'Test',
        description: 'A test',
        urlTemplate: 'http://example.com/{{ urlParams.id }}',
        fields: [{ path: 'title', description: 'Title' }],
      },
    ]);
    expect(result[0].id).toBe('test');
    expect(result[0].resolution).toContain('HTTP JSON');
    expect(result[0].fields).toHaveLength(1);
  });

  it('returns empty array when no datasources at all', () => {
    expect(buildRemoteDatasourceRegistry([])).toEqual([]);
  });
});
