/**
 * highlightConfig Utility Tests
 */

import { describe, it, expect } from 'vitest';
import {
  createDiffMap,
  createHighlightedConfig,
  createHistoricalVersionConfig,
} from '../src/utils/highlightConfig.js';
import type { ComponentDiffWithPosition } from '../src/types.js';

describe('highlightConfig utilities', () => {
  describe('createDiffMap', () => {
    it('should create a map of component IDs to diff types', () => {
      const diffs: ComponentDiffWithPosition[] = [
        { type: 'added', componentId: 'c1', componentType: 'Text', path: [] },
        { type: 'removed', componentId: 'c2', componentType: 'Text', path: [] },
        { type: 'modified', componentId: 'c3', componentType: 'Text', path: [] },
        { type: 'unchanged', componentId: 'c4', componentType: 'Text', path: [] },
      ];

      const map = createDiffMap(diffs);

      expect(map.get('c1')).toBe('added');
      expect(map.get('c2')).toBe('removed');
      expect(map.get('c3')).toBe('modified');
      expect(map.has('c4')).toBe(false); // unchanged not included
    });

    it('should return empty map for empty diffs', () => {
      const map = createDiffMap([]);
      expect(map.size).toBe(0);
    });
  });

  describe('createHighlightedConfig', () => {
    const mockConfig = {
      components: {
        Text: {
          render: (props: { id: string; text: string }) => props.text,
        },
        Image: {
          render: (props: { id: string; src: string }) => props.src,
        },
      },
    };

    it('should wrap component renders with highlighting for before side', () => {
      const diffMap = new Map([
        ['c1', 'removed' as const],
        ['c2', 'modified' as const],
      ]);

      const highlightedConfig = createHighlightedConfig(mockConfig, diffMap, 'before');

      // Verify components are still present
      expect(highlightedConfig.components).toBeDefined();
      expect(highlightedConfig.components.Text).toBeDefined();
      expect(highlightedConfig.components.Image).toBeDefined();
    });

    it('should wrap component renders with highlighting for after side', () => {
      const diffMap = new Map([
        ['c1', 'added' as const],
        ['c2', 'modified' as const],
      ]);

      const highlightedConfig = createHighlightedConfig(mockConfig, diffMap, 'after');

      expect(highlightedConfig.components).toBeDefined();
      expect(highlightedConfig.components.Text).toBeDefined();
    });

    it('should preserve other config properties', () => {
      const configWithExtras = {
        ...mockConfig,
        root: { render: () => 'root' },
      };

      const diffMap = new Map<string, ComponentDiffWithPosition['type']>();
      const highlightedConfig = createHighlightedConfig(configWithExtras, diffMap, 'before');

      expect(highlightedConfig.root).toBeDefined();
    });
  });

  describe('createHistoricalVersionConfig', () => {
    const mockConfig = {
      components: {
        Text: {
          render: (props: { id: string }) => props.id,
        },
      },
    };

    it('should create a config for the before side', () => {
      const diffs: ComponentDiffWithPosition[] = [
        { type: 'removed', componentId: 'c1', componentType: 'Text', path: [] },
        { type: 'modified', componentId: 'c2', componentType: 'Text', path: [] },
      ];

      const highlightedConfig = createHistoricalVersionConfig(mockConfig, diffs);

      expect(highlightedConfig.components).toBeDefined();
      expect(highlightedConfig.components.Text).toBeDefined();
    });

    it('should handle empty diffs', () => {
      const highlightedConfig = createHistoricalVersionConfig(mockConfig, []);

      expect(highlightedConfig.components).toBeDefined();
      expect(highlightedConfig.components.Text).toBeDefined();
    });
  });
});
