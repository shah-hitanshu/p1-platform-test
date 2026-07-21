import { describe, expect, it } from 'vitest';

import {
  toLines,
  parseRecordLines,
  parseFieldLines,
} from '../../p1/editor/remote-datasources/remote-datasource-form-helpers';

describe('toLines', () => {
  it('converts a record to key=value lines', () => {
    expect(toLines({ a: '1', b: '2' })).toBe('a=1\nb=2');
  });

  it('returns empty string for empty or undefined input', () => {
    expect(toLines({})).toBe('');
    expect(toLines(undefined)).toBe('');
  });
});

describe('parseRecordLines', () => {
  it('parses key=value lines into a record', () => {
    expect(parseRecordLines('a=1\nb=2')).toEqual({ a: '1', b: '2' });
  });

  it('skips blank lines and lines without =', () => {
    expect(parseRecordLines('a=1\n\njunk\nb=2')).toEqual({ a: '1', b: '2' });
  });

  it('returns empty for empty string', () => {
    expect(parseRecordLines('')).toEqual({});
  });
});

describe('parseFieldLines', () => {
  it('parses path|description lines', () => {
    expect(parseFieldLines('title|Display title\nid|Identifier')).toEqual([
      { path: 'title', description: 'Display title' },
      { path: 'id', description: 'Identifier' },
    ]);
  });

  it('skips blank lines and lines without |', () => {
    expect(parseFieldLines('title|Title\n\nbad\nid|ID')).toEqual([
      { path: 'title', description: 'Title' },
      { path: 'id', description: 'ID' },
    ]);
  });

  it('returns empty for empty string', () => {
    expect(parseFieldLines('')).toEqual([]);
  });
});
