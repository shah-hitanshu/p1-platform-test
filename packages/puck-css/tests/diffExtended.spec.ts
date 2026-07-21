/**
 * Extended Diff Utility Tests
 *
 * Tests for reorder detection, prop-level diffing, and position tracking.
 */

import { describe, it, expect } from 'vitest';
import {
  diffPuckDataWithPositions,
  diffProps,
  getReorderedComponents,
} from '../src/versioning/utils/diff.js';
import type { PuckData } from '@pantheon-systems/css-client';

describe('diffPuckDataWithPositions', () => {
  const createPuckData = (
    content: Array<{ type: string; id: string; props?: Record<string, unknown> }>
  ): PuckData => ({
    content: content.map((c) => ({
      type: c.type,
      props: { id: c.id, ...c.props },
    })),
    root: { props: {} },
  });

  it('should include position information in diffs', () => {
    const before = createPuckData([
      { type: 'Heading', id: 'h1' },
      { type: 'Text', id: 't1' },
    ]);
    const after = createPuckData([
      { type: 'Heading', id: 'h1' },
      { type: 'Text', id: 't1' },
    ]);

    const diffs = diffPuckDataWithPositions(before, after);

    expect(diffs).toHaveLength(2);
    expect(diffs[0].beforeIndex).toBe(0);
    expect(diffs[0].afterIndex).toBe(0);
    expect(diffs[1].beforeIndex).toBe(1);
    expect(diffs[1].afterIndex).toBe(1);
  });

  it('should detect reordered components', () => {
    const before = createPuckData([
      { type: 'Heading', id: 'h1' },
      { type: 'Text', id: 't1' },
      { type: 'Image', id: 'i1' },
    ]);
    const after = createPuckData([
      { type: 'Text', id: 't1' },
      { type: 'Heading', id: 'h1' },
      { type: 'Image', id: 'i1' },
    ]);

    const diffs = diffPuckDataWithPositions(before, after);

    // Find heading diff
    const headingDiff = diffs.find((d) => d.componentId === 'h1');
    expect(headingDiff?.type).toBe('reordered');
    expect(headingDiff?.beforeIndex).toBe(0);
    expect(headingDiff?.afterIndex).toBe(1);

    // Find text diff
    const textDiff = diffs.find((d) => d.componentId === 't1');
    expect(textDiff?.type).toBe('reordered');
    expect(textDiff?.beforeIndex).toBe(1);
    expect(textDiff?.afterIndex).toBe(0);

    // Image stayed in same relative position (last)
    const imageDiff = diffs.find((d) => d.componentId === 'i1');
    expect(imageDiff?.type).toBe('unchanged');
  });

  it('should detect modified and reordered together', () => {
    const before = createPuckData([
      { type: 'Heading', id: 'h1', props: { text: 'Hello' } },
      { type: 'Text', id: 't1' },
    ]);
    const after = createPuckData([
      { type: 'Text', id: 't1' },
      { type: 'Heading', id: 'h1', props: { text: 'World' } },
    ]);

    const diffs = diffPuckDataWithPositions(before, after);

    const headingDiff = diffs.find((d) => d.componentId === 'h1');
    expect(headingDiff?.type).toBe('modified');
    expect(headingDiff?.beforeIndex).toBe(0);
    expect(headingDiff?.afterIndex).toBe(1);
    expect(headingDiff?.reordered).toBe(true);
  });

  it('should handle added components with position', () => {
    const before = createPuckData([{ type: 'Heading', id: 'h1' }]);
    const after = createPuckData([
      { type: 'Heading', id: 'h1' },
      { type: 'Text', id: 't1' },
    ]);

    const diffs = diffPuckDataWithPositions(before, after);

    const textDiff = diffs.find((d) => d.componentId === 't1');
    expect(textDiff?.type).toBe('added');
    expect(textDiff?.beforeIndex).toBeUndefined();
    expect(textDiff?.afterIndex).toBe(1);
  });

  it('should handle removed components with position', () => {
    const before = createPuckData([
      { type: 'Heading', id: 'h1' },
      { type: 'Text', id: 't1' },
    ]);
    const after = createPuckData([{ type: 'Heading', id: 'h1' }]);

    const diffs = diffPuckDataWithPositions(before, after);

    const textDiff = diffs.find((d) => d.componentId === 't1');
    expect(textDiff?.type).toBe('removed');
    expect(textDiff?.beforeIndex).toBe(1);
    expect(textDiff?.afterIndex).toBeUndefined();
  });
});

describe('diffProps', () => {
  it('should detect added props', () => {
    const before = { id: 'c1', text: 'Hello' };
    const after = { id: 'c1', text: 'Hello', color: '#ff0000' };

    const propDiffs = diffProps(before, after);

    expect(propDiffs).toHaveLength(1);
    expect(propDiffs[0]).toEqual({
      propName: 'color',
      type: 'added',
      before: undefined,
      after: '#ff0000',
    });
  });

  it('should detect removed props', () => {
    const before = { id: 'c1', text: 'Hello', color: '#ff0000' };
    const after = { id: 'c1', text: 'Hello' };

    const propDiffs = diffProps(before, after);

    expect(propDiffs).toHaveLength(1);
    expect(propDiffs[0]).toEqual({
      propName: 'color',
      type: 'removed',
      before: '#ff0000',
      after: undefined,
    });
  });

  it('should detect modified props', () => {
    const before = { id: 'c1', text: 'Hello', color: '#ff0000' };
    const after = { id: 'c1', text: 'World', color: '#ff0000' };

    const propDiffs = diffProps(before, after);

    expect(propDiffs).toHaveLength(1);
    expect(propDiffs[0]).toEqual({
      propName: 'text',
      type: 'modified',
      before: 'Hello',
      after: 'World',
    });
  });

  it('should detect multiple prop changes', () => {
    const before = { id: 'c1', text: 'Hello', color: '#ff0000', size: 'small' };
    const after = { id: 'c1', text: 'World', color: '#0000ff', align: 'center' };

    const propDiffs = diffProps(before, after);

    expect(propDiffs).toHaveLength(4);

    const textDiff = propDiffs.find((d) => d.propName === 'text');
    expect(textDiff?.type).toBe('modified');

    const colorDiff = propDiffs.find((d) => d.propName === 'color');
    expect(colorDiff?.type).toBe('modified');

    const sizeDiff = propDiffs.find((d) => d.propName === 'size');
    expect(sizeDiff?.type).toBe('removed');

    const alignDiff = propDiffs.find((d) => d.propName === 'align');
    expect(alignDiff?.type).toBe('added');
  });

  it('should ignore id prop changes', () => {
    const before = { id: 'c1', text: 'Hello' };
    const after = { id: 'c1', text: 'Hello' };

    const propDiffs = diffProps(before, after);

    expect(propDiffs).toHaveLength(0);
  });

  it('should handle nested object prop changes', () => {
    const before = { id: 'c1', style: { padding: 10, margin: 5 } };
    const after = { id: 'c1', style: { padding: 20, margin: 5 } };

    const propDiffs = diffProps(before, after);

    expect(propDiffs).toHaveLength(1);
    expect(propDiffs[0].propName).toBe('style');
    expect(propDiffs[0].type).toBe('modified');
  });

  it('should handle array prop changes', () => {
    const before = { id: 'c1', items: ['a', 'b'] };
    const after = { id: 'c1', items: ['a', 'b', 'c'] };

    const propDiffs = diffProps(before, after);

    expect(propDiffs).toHaveLength(1);
    expect(propDiffs[0].propName).toBe('items');
    expect(propDiffs[0].type).toBe('modified');
  });
});

describe('getReorderedComponents', () => {
  const createPuckData = (
    content: Array<{ type: string; id: string }>
  ): PuckData => ({
    content: content.map((c) => ({
      type: c.type,
      props: { id: c.id },
    })),
    root: { props: {} },
  });

  it('should return only reordered components', () => {
    const before = createPuckData([
      { type: 'A', id: 'a1' },
      { type: 'B', id: 'b1' },
      { type: 'C', id: 'c1' },
    ]);
    const after = createPuckData([
      { type: 'B', id: 'b1' },
      { type: 'A', id: 'a1' },
      { type: 'C', id: 'c1' },
    ]);

    const diffs = diffPuckDataWithPositions(before, after);
    const reordered = getReorderedComponents(diffs);

    expect(reordered).toHaveLength(2);
    expect(reordered.map((d) => d.componentId).sort()).toEqual(['a1', 'b1']);
  });

  it('should return empty array when no reordering', () => {
    const data = createPuckData([
      { type: 'A', id: 'a1' },
      { type: 'B', id: 'b1' },
    ]);

    const diffs = diffPuckDataWithPositions(data, data);
    const reordered = getReorderedComponents(diffs);

    expect(reordered).toHaveLength(0);
  });
});
