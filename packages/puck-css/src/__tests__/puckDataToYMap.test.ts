/**
 * Tests for puckDataToYMap()
 *
 * The write path must tolerate partial page data the same way the read path
 * (yMapToPuckData) already does. During a document switch the persistent
 * editor recreates the Yjs binding with a fresh Y.Doc and seeds it from
 * whatever data is current — which can momentarily be a page object without a
 * `content` array. Seeding must not throw.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { puckDataToYMap, yMapToPuckData, type PuckData } from '../editor/utils/puckYjsBinding';

function seed(data: unknown): Y.Map<unknown> {
  const doc = new Y.Doc();
  const root = doc.getMap('root');
  puckDataToYMap(data as PuckData, root);
  return root;
}

describe('puckDataToYMap full creation', () => {
  it('populates a fresh map from complete page data', () => {
    const data: PuckData = {
      content: [{ type: 'Heading', props: { id: 'a', text: 'Hi' } }],
      root: { props: { title: 'Page' } },
    };
    const result = yMapToPuckData(seed(data));
    expect(result.content).toHaveLength(1);
    expect(result.root.props.title).toBe('Page');
  });

  it('does not throw when content is missing', () => {
    const partial = { root: { props: { title: 'New page' } } };
    expect(() => seed(partial)).not.toThrow();
    const result = yMapToPuckData(seed(partial));
    expect(result.content).toEqual([]);
    expect(result.root.props.title).toBe('New page');
  });

  it('does not throw when root is missing', () => {
    const partial = { content: [] };
    expect(() => seed(partial)).not.toThrow();
    const result = yMapToPuckData(seed(partial));
    expect(result.content).toEqual([]);
    expect(result.root.props).toEqual({});
  });

  it('does not throw when seeding an empty object', () => {
    expect(() => seed({})).not.toThrow();
    const result = yMapToPuckData(seed({}));
    expect(result.content).toEqual([]);
  });
});
