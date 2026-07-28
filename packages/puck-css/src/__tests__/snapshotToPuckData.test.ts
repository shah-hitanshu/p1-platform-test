/**
 * Version snapshots are typed as objects but the backend sometimes returns
 * them as a JSON string. If that string reaches currentData/safeData unparsed,
 * downstream consumers spread it character-by-character and Puck crashes. This
 * helper coerces a snapshot to real PuckData.
 */
import { describe, it, expect } from 'vitest';
import { snapshotToPuckData } from '../editor/utils/snapshotToPuckData';

describe('snapshotToPuckData', () => {
  it('returns an object snapshot unchanged', () => {
    const snapshot = {
      content: [{ type: 'Heading', props: { id: 'a' } }],
      root: { props: { title: 'Page' } },
    };
    expect(snapshotToPuckData(snapshot)).toBe(snapshot);
  });

  it('parses a JSON-string snapshot into PuckData', () => {
    const puck = {
      content: [{ type: 'ParagraphBlock', props: { id: 'p1', text: 'Hi' } }],
      root: { props: { title: 'Page 2' } },
    };
    const result = snapshotToPuckData(JSON.stringify(puck));
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('ParagraphBlock');
    expect(result.root.props.title).toBe('Page 2');
  });

  it('returns blank data for an unparseable string', () => {
    expect(snapshotToPuckData('{not valid json')).toEqual({
      content: [],
      root: { props: {} },
    });
  });

  it('returns blank data for null/undefined', () => {
    expect(snapshotToPuckData(null)).toEqual({ content: [], root: { props: {} } });
    expect(snapshotToPuckData(undefined)).toEqual({ content: [], root: { props: {} } });
  });

  it('returns blank data for an empty/invalid snapshot object', () => {
    expect(snapshotToPuckData({})).toEqual({ content: [], root: { props: {} } });
  });

  it('does not spread a string into indexed character keys', () => {
    const result = snapshotToPuckData('{"content":[],"root":{"props":{}}}');
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['content', 'root']));
    expect(result).not.toHaveProperty('0');
  });
});
