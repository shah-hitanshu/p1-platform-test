/**
 * Phase 1: Content-Oriented Diff Viewer - transformDiffOperations Tests (TDD)
 *
 * Tests for transforming RFC 6902 DiffOperation[] + snapshots into
 * grouped ContentSection[] for human-readable display.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import type { DiffOperation } from '../../types';
import {
  transformDiffOperations,
  generateFieldLabel,
  isPuckData,
} from '../../components/content-diff/transformDiffOperations';

describe('transformDiffOperations', () => {
  describe('basic operations', () => {
    it('should transform a replace operation into a content change', () => {
      const sourceData = { title: 'Old Title', body: 'Content' };
      const targetData = { title: 'New Title', body: 'Content' };
      const operations: DiffOperation[] = [
        { op: 'replace', path: '/title', value: 'New Title' },
      ];

      const result = transformDiffOperations(sourceData, targetData, operations);

      expect(result).toHaveLength(1);
      expect(result[0].changes).toHaveLength(1);

      const change = result[0].changes[0];
      expect(change.type).toBe('replace');
      expect(change.path).toBe('/title');
      expect(change.oldValue).toBe('Old Title');
      expect(change.newValue).toBe('New Title');
    });

    it('should transform an add operation into a content change', () => {
      const sourceData = { title: 'Hello' };
      const targetData = { title: 'Hello', subtitle: 'World' };
      const operations: DiffOperation[] = [
        { op: 'add', path: '/subtitle', value: 'World' },
      ];

      const result = transformDiffOperations(sourceData, targetData, operations);

      const allChanges = result.flatMap((s) => s.changes);
      const addChange = allChanges.find((c) => c.path === '/subtitle');
      expect(addChange).toBeDefined();
      expect(addChange!.type).toBe('add');
      expect(addChange!.oldValue).toBeUndefined();
      expect(addChange!.newValue).toBe('World');
    });

    it('should transform a remove operation into a content change', () => {
      const sourceData = { title: 'Hello', subtitle: 'World' };
      const targetData = { title: 'Hello' };
      const operations: DiffOperation[] = [
        { op: 'remove', path: '/subtitle' },
      ];

      const result = transformDiffOperations(sourceData, targetData, operations);

      const allChanges = result.flatMap((s) => s.changes);
      const removeChange = allChanges.find((c) => c.path === '/subtitle');
      expect(removeChange).toBeDefined();
      expect(removeChange!.type).toBe('remove');
      expect(removeChange!.oldValue).toBe('World');
      expect(removeChange!.newValue).toBeUndefined();
    });

    it('should handle multiple operations across different fields', () => {
      const sourceData = { title: 'Old', description: 'Old desc', status: 'draft' };
      const targetData = { title: 'New', description: 'Old desc', status: 'published' };
      const operations: DiffOperation[] = [
        { op: 'replace', path: '/title', value: 'New' },
        { op: 'replace', path: '/status', value: 'published' },
      ];

      const result = transformDiffOperations(sourceData, targetData, operations);
      const allChanges = result.flatMap((s) => s.changes);

      expect(allChanges).toHaveLength(2);
    });

    it('should return empty sections for empty operations', () => {
      const result = transformDiffOperations({}, {}, []);
      const allChanges = result.flatMap((s) => s.changes);
      expect(allChanges).toHaveLength(0);
    });

    it('should handle null source data (document added)', () => {
      const targetData = { title: 'New Document' };
      const operations: DiffOperation[] = [
        { op: 'add', path: '/title', value: 'New Document' },
      ];

      const result = transformDiffOperations(null, targetData, operations);
      const allChanges = result.flatMap((s) => s.changes);
      expect(allChanges).toHaveLength(1);
      expect(allChanges[0].type).toBe('add');
    });

    it('should handle null target data (document removed)', () => {
      const sourceData = { title: 'Deleted Document' };
      const operations: DiffOperation[] = [
        { op: 'remove', path: '/title' },
      ];

      const result = transformDiffOperations(sourceData, null, operations);
      const allChanges = result.flatMap((s) => s.changes);
      expect(allChanges).toHaveLength(1);
      expect(allChanges[0].type).toBe('remove');
    });
  });

  describe('nested path handling', () => {
    it('should handle nested object paths', () => {
      const sourceData = { meta: { author: 'Alice', date: '2026-01-01' } };
      const targetData = { meta: { author: 'Bob', date: '2026-01-01' } };
      const operations: DiffOperation[] = [
        { op: 'replace', path: '/meta/author', value: 'Bob' },
      ];

      const result = transformDiffOperations(sourceData, targetData, operations);
      const allChanges = result.flatMap((s) => s.changes);

      expect(allChanges).toHaveLength(1);
      expect(allChanges[0].oldValue).toBe('Alice');
      expect(allChanges[0].newValue).toBe('Bob');
    });

    it('should handle array index paths', () => {
      const sourceData = { tags: ['react', 'typescript'] };
      const targetData = { tags: ['react', 'typescript', 'vitest'] };
      const operations: DiffOperation[] = [
        { op: 'add', path: '/tags/2', value: 'vitest' },
      ];

      const result = transformDiffOperations(sourceData, targetData, operations);
      const allChanges = result.flatMap((s) => s.changes);

      expect(allChanges).toHaveLength(1);
      expect(allChanges[0].type).toBe('add');
      expect(allChanges[0].newValue).toBe('vitest');
    });
  });

  describe('Puck data detection and grouping', () => {
    const puckSource = {
      content: [
        { type: 'Heading', props: { id: 'heading-1', text: 'Old Heading' } },
        { type: 'Paragraph', props: { id: 'para-1', content: 'Old paragraph' } },
      ],
      root: { props: { title: 'My Page' } },
    };

    const puckTarget = {
      content: [
        { type: 'Heading', props: { id: 'heading-1', text: 'New Heading' } },
        { type: 'Paragraph', props: { id: 'para-1', content: 'Old paragraph' } },
      ],
      root: { props: { title: 'My Page' } },
    };

    it('should detect Puck data structure', () => {
      expect(isPuckData(puckSource)).toBe(true);
    });

    it('should not detect non-Puck data as Puck', () => {
      expect(isPuckData({ title: 'Just a doc' })).toBe(false);
      expect(isPuckData({ content: 'string content' })).toBe(false);
      expect(isPuckData({ content: [{ noType: true }] })).toBe(false);
    });

    it('should group Puck changes by component', () => {
      const operations: DiffOperation[] = [
        { op: 'replace', path: '/content/0/props/text', value: 'New Heading' },
      ];

      const result = transformDiffOperations(puckSource, puckTarget, operations);

      // Should have a section for the Heading component
      const headingSection = result.find(
        (s) => s.label.includes('Heading') || s.componentType === 'Heading'
      );
      expect(headingSection).toBeDefined();
      expect(headingSection!.changes).toHaveLength(1);
      expect(headingSection!.changes[0].label.toLowerCase()).toContain('text');
    });

    it('should group multiple changes in the same component together', () => {
      const puckSourceMulti = {
        content: [
          { type: 'Card', props: { id: 'card-1', title: 'Old Title', description: 'Old Desc' } },
        ],
        root: { props: { title: 'Page' } },
      };
      const puckTargetMulti = {
        content: [
          { type: 'Card', props: { id: 'card-1', title: 'New Title', description: 'New Desc' } },
        ],
        root: { props: { title: 'Page' } },
      };
      const operations: DiffOperation[] = [
        { op: 'replace', path: '/content/0/props/title', value: 'New Title' },
        { op: 'replace', path: '/content/0/props/description', value: 'New Desc' },
      ];

      const result = transformDiffOperations(puckSourceMulti, puckTargetMulti, operations);

      const cardSection = result.find(
        (s) => s.label.includes('Card') || s.componentType === 'Card'
      );
      expect(cardSection).toBeDefined();
      expect(cardSection!.changes).toHaveLength(2);
    });

    it('should handle root-level Puck changes', () => {
      const operations: DiffOperation[] = [
        { op: 'replace', path: '/root/props/title', value: 'New Page Title' },
      ];

      const puckTargetRoot = {
        ...puckSource,
        root: { props: { title: 'New Page Title' } },
      };

      const result = transformDiffOperations(puckSource, puckTargetRoot, operations);

      const rootSection = result.find(
        (s) => s.label.toLowerCase().includes('page') || s.label.toLowerCase().includes('root')
      );
      expect(rootSection).toBeDefined();
      expect(rootSection!.changes).toHaveLength(1);
    });
  });

  describe('non-Puck data grouping', () => {
    it('should group by top-level key for non-Puck data', () => {
      const sourceData = {
        settings: { theme: 'light', language: 'en' },
        metadata: { author: 'Alice' },
      };
      const targetData = {
        settings: { theme: 'dark', language: 'en' },
        metadata: { author: 'Bob' },
      };
      const operations: DiffOperation[] = [
        { op: 'replace', path: '/settings/theme', value: 'dark' },
        { op: 'replace', path: '/metadata/author', value: 'Bob' },
      ];

      const result = transformDiffOperations(sourceData, targetData, operations);

      // Should have separate sections for settings and metadata
      expect(result.length).toBeGreaterThanOrEqual(2);
      const settingsSection = result.find((s) => s.label.toLowerCase().includes('settings'));
      const metadataSection = result.find((s) => s.label.toLowerCase().includes('metadata'));
      expect(settingsSection).toBeDefined();
      expect(metadataSection).toBeDefined();
    });
  });
});

describe('generateFieldLabel', () => {
  it('should generate a readable label from a simple path', () => {
    expect(generateFieldLabel('/title')).toBe('Title');
  });

  it('should generate a readable label from a nested path', () => {
    expect(generateFieldLabel('/meta/author')).toBe('Author');
  });

  it('should handle array indices in path', () => {
    const label = generateFieldLabel('/content/0/props/text');
    expect(label.toLowerCase()).toContain('text');
  });

  it('should convert camelCase to readable text', () => {
    const label = generateFieldLabel('/backgroundColor');
    expect(label.toLowerCase()).toContain('background');
    expect(label.toLowerCase()).toContain('color');
  });

  it('should convert snake_case to readable text', () => {
    const label = generateFieldLabel('/created_at');
    expect(label.toLowerCase()).toContain('created');
    expect(label.toLowerCase()).toContain('at');
  });
});
