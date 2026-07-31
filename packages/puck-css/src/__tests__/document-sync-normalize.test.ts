/**
 * The document-sync plugin pushes freshly loaded document data into Puck via
 * setHistories, which runs walkAppState and reads data.root.props. During a
 * page switch the published data can momentarily lack a root (or content), so
 * it must be normalized to a complete PuckData shape before it reaches Puck —
 * otherwise walkAppState throws "Cannot read properties of undefined
 * (reading 'props')".
 */
import { describe, it, expect } from 'vitest';
import { normalizeSyncData } from '../editor/plugin/document-sync-plugin';

describe('normalizeSyncData', () => {
  it('preserves complete data', () => {
    const data = {
      content: [{ type: 'Heading', props: { id: 'a' } }],
      root: { props: { title: 'Page' } },
      zones: { 'a:zone': [] },
    };
    expect(normalizeSyncData(data)).toEqual(data);
  });

  it('supplies a root when missing so walkAppState can read root.props', () => {
    const result = normalizeSyncData({ content: [] } as never);
    expect(result.root).toEqual({ props: {} });
  });

  it('supplies content when missing', () => {
    const result = normalizeSyncData({ root: { props: { title: 'X' } } } as never);
    expect(result.content).toEqual([]);
    expect(result.root.props.title).toBe('X');
  });

  it('supplies root.props when root has none', () => {
    const result = normalizeSyncData({ content: [], root: {} } as never);
    expect(result.root.props).toEqual({});
  });

  it('returns a complete shape for an empty object', () => {
    const result = normalizeSyncData({} as never);
    expect(result).toEqual({ content: [], root: { props: {} } });
  });

  it('collapses a non-object (e.g. an unparsed JSON string) to blank data instead of spreading it', () => {
    const result = normalizeSyncData('{"content":[]}' as never);
    expect(result).toEqual({ content: [], root: { props: {} } });
    expect(result).not.toHaveProperty('0');
  });
});
