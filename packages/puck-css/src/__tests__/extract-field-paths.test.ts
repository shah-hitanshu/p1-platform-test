import { describe, it, expect } from 'vitest';
import { extractFieldPaths } from '../data/fields/schema-select-field.js';

describe('extractFieldPaths', () => {
  it('extracts flat field paths from a simple object', () => {
    const result = extractFieldPaths({ name: 'Luke', height: '172' });
    expect(result).toEqual([
      { path: 'name', description: 'Luke' },
      { path: 'height', description: '172' },
    ]);
  });

  it('recurses into nested objects with dot notation', () => {
    const result = extractFieldPaths({
      name: 'Bulbasaur',
      stats: { hp: 45, attack: 49 },
    });
    expect(result).toEqual([
      { path: 'name', description: 'Bulbasaur' },
      { path: 'stats.hp', description: '45' },
      { path: 'stats.attack', description: '49' },
    ]);
  });

  it('treats arrays as leaf values', () => {
    const result = extractFieldPaths({
      name: 'Bulbasaur',
      types: ['grass', 'poison'],
    });
    expect(result).toEqual([
      { path: 'name', description: 'Bulbasaur' },
      { path: 'types', description: 'Array (2 items)' },
    ]);
  });

  it('handles null and undefined values', () => {
    const result = extractFieldPaths({
      name: 'Luke',
      homeworld: null,
      species: undefined,
    });
    expect(result).toEqual([
      { path: 'name', description: 'Luke' },
      { path: 'homeworld', description: '' },
      { path: 'species', description: '' },
    ]);
  });

  it('respects maxDepth parameter', () => {
    const result = extractFieldPaths(
      { a: { b: { c: { d: 'deep' } } } },
      '',
      2,
    );
    expect(result).toEqual([]);
  });

  it('handles deeply nested objects up to default maxDepth of 4', () => {
    const result = extractFieldPaths({
      a: { b: { c: { d: 'found' } } },
    });
    expect(result).toEqual([
      { path: 'a.b.c.d', description: 'found' },
    ]);
  });

  it('truncates long string descriptions', () => {
    const longStr = 'A'.repeat(50);
    const result = extractFieldPaths({ field: longStr });
    expect(result[0].description).toContain('chars');
  });

  it('returns empty array for empty object', () => {
    const result = extractFieldPaths({});
    expect(result).toEqual([]);
  });

  it('handles numeric values', () => {
    const result = extractFieldPaths({ count: 42, ratio: 3.14 });
    expect(result).toEqual([
      { path: 'count', description: '42' },
      { path: 'ratio', description: '3.14' },
    ]);
  });

  it('handles boolean values', () => {
    const result = extractFieldPaths({ active: true, deleted: false });
    expect(result).toEqual([
      { path: 'active', description: 'true' },
      { path: 'deleted', description: 'false' },
    ]);
  });
});
