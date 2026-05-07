/**
 * createStablePluginArray Tests (TDD)
 *
 * Tests for the stable plugin array utility.
 */

import { describe, it, expect } from 'vitest';
import { createStablePluginArray } from '../../src/editor/utils/createStablePluginArray.js';
import type { PuckPlugin } from '../../src/editor/plugin/CSSPlugin.js';

function makePlugin(name: string): PuckPlugin {
  return {
    name,
    label: name,
    icon: null as unknown as React.ReactNode,
    render: () => null as unknown as React.ReactElement,
  };
}

describe('createStablePluginArray', () => {
  it('should return an array containing all passed plugins', () => {
    const p1 = makePlugin('a');
    const p2 = makePlugin('b');
    const result = createStablePluginArray(p1, p2);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(p1);
    expect(result[1]).toBe(p2);
  });

  it('should return the same array reference when called with the same plugins', () => {
    const p1 = makePlugin('a');
    const p2 = makePlugin('b');

    const result1 = createStablePluginArray(p1, p2);
    const result2 = createStablePluginArray(p1, p2);

    expect(result1).toBe(result2);
  });

  it('should return a different array when plugins change', () => {
    const p1 = makePlugin('a');
    const p2 = makePlugin('b');
    const p3 = makePlugin('c');

    const result1 = createStablePluginArray(p1, p2);
    const result2 = createStablePluginArray(p1, p3);

    expect(result1).not.toBe(result2);
  });

  it('should handle single plugin', () => {
    const p1 = makePlugin('only');
    const result = createStablePluginArray(p1);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(p1);
  });

  it('should handle empty call', () => {
    const result = createStablePluginArray();

    expect(result).toHaveLength(0);
  });

  it('should filter out null/undefined plugins', () => {
    const p1 = makePlugin('a');
    const result = createStablePluginArray(
      p1,
      null as unknown as PuckPlugin,
      undefined as unknown as PuckPlugin,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(p1);
  });
});
