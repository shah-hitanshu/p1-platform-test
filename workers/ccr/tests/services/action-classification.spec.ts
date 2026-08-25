/**
 * Phase 4: Action Classification Service Tests (TDD)
 *
 * Tests for classifying changes as structural or prop-only based on
 * Puck actions and JSON patch analysis.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// No mocking needed - pure functions under test
describe('Phase 4: Action Classification Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('classifyChange - Puck action classification', () => {
    it('should classify "insert" action as structural', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const puckActions = [
        {
          type: 'insert',
          componentType: 'HeroBlock',
          destinationIndex: 0,
          destinationZone: 'content',
        },
      ];

      const result = classifyChange(undefined, puckActions);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ puckActions });
    });

    it('should classify "reorder" action as structural', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const puckActions = [
        {
          type: 'reorder',
          sourceIndex: 2,
          destinationIndex: 0,
          sourceZone: 'content',
          destinationZone: 'content',
        },
      ];

      const result = classifyChange(undefined, puckActions);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ puckActions });
    });

    it('should classify "move" action as structural', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const puckActions = [
        {
          type: 'move',
          sourceIndex: 1,
          destinationIndex: 0,
          sourceZone: 'sidebar',
          destinationZone: 'content',
        },
      ];

      const result = classifyChange(undefined, puckActions);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ puckActions });
    });

    it('should classify "duplicate" action as structural', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const puckActions = [
        {
          type: 'duplicate',
          sourceIndex: 0,
          sourceZone: 'content',
        },
      ];

      const result = classifyChange(undefined, puckActions);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ puckActions });
    });

    it('should classify "remove" action as structural', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const puckActions = [
        {
          type: 'remove',
          index: 2,
          zone: 'content',
        },
      ];

      const result = classifyChange(undefined, puckActions);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ puckActions });
    });

    it('should classify "set" action as prop_update', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const puckActions = [
        {
          type: 'set',
          componentId: 'hero-123',
          props: { title: 'New Title' },
        },
      ];

      const result = classifyChange(undefined, puckActions);

      expect(result.actionType).toBe('prop_update');
      expect(result.actionMetadata).toEqual({ puckActions });
    });

    it('should classify multiple structural actions correctly', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const puckActions = [
        {
          type: 'insert',
          componentType: 'CTABlock',
          destinationIndex: 3,
          destinationZone: 'content',
        },
        {
          type: 'reorder',
          sourceIndex: 0,
          destinationIndex: 1,
          sourceZone: 'content',
          destinationZone: 'content',
        },
      ];

      const result = classifyChange(undefined, puckActions);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ puckActions });
    });

    it('should ignore prop-only actions when mixed with structural actions', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const puckActions = [
        {
          type: 'set',
          componentId: 'hero-123',
          props: { title: 'Title' },
        },
        {
          type: 'reorder',
          sourceIndex: 1,
          destinationIndex: 0,
          sourceZone: 'content',
          destinationZone: 'content',
        },
      ];

      const result = classifyChange(undefined, puckActions);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ puckActions });
    });
  });

  describe('classifyChange - Patch-based structural detection', () => {
    it('should detect structural change from root array modification', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const patch = [
        {
          op: 'add',
          path: '/root/0',
          value: { type: 'HeroBlock', props: {} },
        },
      ];

      const result = classifyChange(patch, undefined);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ derived: true });
    });

    it('should detect structural change from content array modification', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const patch = [
        {
          op: 'remove',
          path: '/content/2',
        },
      ];

      const result = classifyChange(patch, undefined);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ derived: true });
    });

    it('should classify prop-only patch as prop_update (leaf property change)', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const patch = [
        {
          op: 'replace',
          path: '/root/0/props/title',
          value: 'New Title',
        },
      ];

      const result = classifyChange(patch, undefined);

      expect(result.actionType).toBe('prop_update');
      expect(result.actionMetadata).toEqual({ derived: true });
    });

    it('should classify deep property changes as prop_update', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const patch = [
        {
          op: 'replace',
          path: '/content/0/props/settings/background',
          value: 'dark',
        },
      ];

      const result = classifyChange(patch, undefined);

      expect(result.actionType).toBe('prop_update');
      expect(result.actionMetadata).toEqual({ derived: true });
    });

    it('should prefer Puck actions over patch analysis when both provided', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const patch = [
        {
          op: 'replace',
          path: '/root/0/props/title',
          value: 'Title',
        },
      ];

      const puckActions = [
        {
          type: 'reorder',
          sourceIndex: 1,
          destinationIndex: 0,
        },
      ];

      const result = classifyChange(patch, puckActions);

      expect(result.actionType).toBe('structural');
      expect(result.actionMetadata).toEqual({ puckActions });
    });
  });

  describe('classifyChange - Edge cases', () => {
    it('should return null for empty patch and no Puck actions', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const result = classifyChange([], undefined);

      expect(result.actionType).toBeNull();
      expect(result.actionMetadata).toBeNull();
    });

    it('should return null for undefined patch and no Puck actions', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const result = classifyChange(undefined, undefined);

      expect(result.actionType).toBeNull();
      expect(result.actionMetadata).toBeNull();
    });

    it('should return null for empty Puck actions array', async () => {
      const { classifyChange } = await import('../../src/services/action-classification');

      const result = classifyChange(undefined, []);

      expect(result.actionType).toBeNull();
      expect(result.actionMetadata).toBeNull();
    });
  });

  describe('isStructuralPath', () => {
    it('should identify root array element as structural', async () => {
      const { isStructuralPath } = await import('../../src/services/action-classification');

      expect(isStructuralPath('/root/0')).toBe(true);
      expect(isStructuralPath('/root/1')).toBe(true);
      expect(isStructuralPath('/root/99')).toBe(true);
    });

    it('should identify content array element as structural', async () => {
      const { isStructuralPath } = await import('../../src/services/action-classification');

      expect(isStructuralPath('/content/0')).toBe(true);
      expect(isStructuralPath('/content/5')).toBe(true);
    });

    it('should identify root array itself as structural', async () => {
      const { isStructuralPath } = await import('../../src/services/action-classification');

      expect(isStructuralPath('/root')).toBe(true);
      expect(isStructuralPath('/content')).toBe(true);
    });

    it('should not identify prop paths as structural', async () => {
      const { isStructuralPath } = await import('../../src/services/action-classification');

      expect(isStructuralPath('/root/0/props/title')).toBe(false);
      expect(isStructuralPath('/content/0/props/title')).toBe(false);
    });

    it('should not identify deep prop paths as structural', async () => {
      const { isStructuralPath } = await import('../../src/services/action-classification');

      expect(isStructuralPath('/root/0/props/settings/background')).toBe(false);
      // Note: /content/2/props/data/items/0 IS structural (nested array modification)
      // This is covered in the nested array tests
    });

    it('should not identify zones container as structural', async () => {
      const { isStructuralPath } = await import('../../src/services/action-classification');

      expect(isStructuralPath('/zones')).toBe(false);
      expect(isStructuralPath('/zones/sidebar')).toBe(false);
      // Note: /zones/sidebar/0 IS structural (zone array element)
      // This is covered in the zone array tests
    });

    it('should not identify other top-level properties as structural', async () => {
      const { isStructuralPath } = await import('../../src/services/action-classification');

      expect(isStructuralPath('/metadata')).toBe(false);
      expect(isStructuralPath('/metadata/title')).toBe(false);
    });

    describe('Edge cases - Paths with escaped characters', () => {
      it('should handle paths with escaped tilde (~0 = ~)', async () => {
        const { isStructuralPath } = await import('../../src/services/action-classification');

        // ~0 represents ~ in JSON Pointer, ~1 represents /
        expect(isStructuralPath('/root/~0/props')).toBe(false);
        expect(isStructuralPath('/content/~1/props')).toBe(false);
      });
    });

    describe('Edge cases - Zone paths', () => {
      it('should identify zone array elements as structural', async () => {
        const { isStructuralPath } = await import('../../src/services/action-classification');

        expect(isStructuralPath('/zones/header/0')).toBe(true);
        expect(isStructuralPath('/zones/sidebar/0')).toBe(true);
        expect(isStructuralPath('/zones/footer/99')).toBe(true);
      });

      it('should identify nested arrays inside props as prop changes (not structural)', async () => {
        const { isStructuralPath } = await import('../../src/services/action-classification');

        expect(isStructuralPath('/zones/sidebar/0/props/content/0')).toBe(false);
        expect(isStructuralPath('/root/0/props/items/0')).toBe(false);
      });

      it('should not identify zone prop paths as structural', async () => {
        const { isStructuralPath } = await import('../../src/services/action-classification');

        expect(isStructuralPath('/zones/header/0/props/title')).toBe(false);
        expect(isStructuralPath('/zones/sidebar/0/props/content/0/props/text')).toBe(false);
      });
    });
  });

  describe('Critical Edge Cases for PROPOSAL-010', () => {
    describe('Deeply nested modifications', () => {
      it('should detect deeply nested modifications (>5 levels) as prop_update', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root/0/props/content/props/items/props/data/props/value',
            value: 'Updated deep value',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('prop_update');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should detect very deeply nested modifications (>10 levels) as prop_update', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root/0/props/a/props/b/props/c/props/d/props/e/props/f/props/g',
            value: 'Deep value',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('prop_update');
        expect(result.actionMetadata).toEqual({ derived: true });
      });
    });

    describe('Multiple component array modifications', () => {
      it('should detect multiple component array modifications in single patch as structural', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'add',
            path: '/root/0',
            value: { type: 'HeroBlock', props: {} },
          },
          {
            op: 'remove',
            path: '/root/2',
          },
          {
            op: 'replace',
            path: '/root/1',
            value: { type: 'CTABlock', props: {} },
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should detect multiple array modifications across different zones as structural', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'add',
            path: '/root/0',
            value: { type: 'HeroBlock', props: {} },
          },
          {
            op: 'add',
            path: '/content/1',
            value: { type: 'TextBlock', props: {} },
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });
    });

    describe('Malformed patch operations', () => {
      it('should handle gracefully patch with missing op field', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            path: '/root/0',
            value: { type: 'HeroBlock', props: {} },
          } as any,
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBeNull();
        expect(result.actionMetadata).toBeNull();
      });

      it('should handle gracefully patch with missing path field', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'add',
            value: { type: 'HeroBlock', props: {} },
          } as any,
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBeNull();
        expect(result.actionMetadata).toBeNull();
      });

      it('should handle gracefully invalid JSON pointer path (no leading /)', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'add',
            path: 'root/0',
            value: { type: 'HeroBlock', props: {} },
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBeNull();
        expect(result.actionMetadata).toBeNull();
      });

      it('should classify path with spaces as prop_update', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root/0/props/my title',
            value: 'New Title',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('prop_update');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should classify path with special characters as prop_update', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root/0/props/title@#$%',
            value: 'New Title',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('prop_update');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should handle gracefully null patch operations', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [null, undefined, { op: 'add', path: '/root/0', value: {} }];


        /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
        const result = classifyChange(patch as any, undefined);

        /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should handle gracefully non-object patch operations', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = ['string', 123, true, { op: 'add', path: '/root/0', value: {} }];


        /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
        const result = classifyChange(patch as any, undefined);

        /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });
    });

    describe('Mixed structural and prop changes same component', () => {
      it('should detect as structural when both component and props modified', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root/0',
            value: { type: 'HeroBlock', props: {} },
          },
          {
            op: 'replace',
            path: '/root/0/props/title',
            value: 'New Title',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should detect as structural when array element added and props modified', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'add',
            path: '/root/1',
            value: { type: 'CTABlock', props: {} },
          },
          {
            op: 'replace',
            path: '/root/0/props/subtitle',
            value: 'Updated subtitle',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });
    });

    describe('Empty and malformed paths', () => {
      it('should handle empty path string gracefully', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '',
            value: 'value',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBeNull();
        expect(result.actionMetadata).toBeNull();
      });

      it('should handle path with double slashes gracefully', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root//props',
            value: 'value',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBeNull();
        expect(result.actionMetadata).toBeNull();
      });

      it('should handle path with trailing slash gracefully', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root/0/',
            value: 'value',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBeNull();
        expect(result.actionMetadata).toBeNull();
      });
    });

    describe('Very long paths', () => {
      it('should handle very long path (>1000 chars) without performance issues', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        // Build a path with 200+ segments
        const longPath = '/root/0/props/' + 'deeply/'.repeat(200) + 'nested/value';

        const patch = [
          {
            op: 'replace',
            path: longPath,
            value: 'deep value',
          },
        ];

        const startTime = Date.now();
        const result = classifyChange(patch, undefined);
        const duration = Date.now() - startTime;

        expect(result.actionType).toBe('prop_update');
        expect(result.actionMetadata).toEqual({ derived: true });
        expect(duration).toBeLessThan(100); // Should complete in <100ms
      });
    });

    describe('Remove and replace operations', () => {
      it('should detect remove operation on component array as structural', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'remove',
            path: '/root/0',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should detect remove operation on prop as prop_update', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'remove',
            path: '/root/0/props/optionalField',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('prop_update');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should detect replace operation on component array as structural', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root/0',
            value: { type: 'NewBlock', props: {} },
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });

      it('should detect replace operation on prop as prop_update', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'replace',
            path: '/root/0/props/title',
            value: 'New Title',
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('prop_update');
        expect(result.actionMetadata).toEqual({ derived: true });
      });
    });

    describe('Test operations', () => {
      it('should not affect classification when only test operations present', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'test',
            path: '/root/0',
            value: { type: 'HeroBlock', props: {} },
          },
        ];

        const result = classifyChange(patch, undefined);

        // Test operations don't modify state, so should be treated as non-structural
        expect(result.actionType).toBeNull();
        expect(result.actionMetadata).toBeNull();
      });

      it('should detect structural when test operation mixed with structural operation', async () => {
        const { classifyChange } = await import('../../src/services/action-classification');

        const patch = [
          {
            op: 'test',
            path: '/root/0/props/title',
            value: 'Expected Title',
          },
          {
            op: 'add',
            path: '/root/1',
            value: { type: 'CTABlock', props: {} },
          },
        ];

        const result = classifyChange(patch, undefined);

        expect(result.actionType).toBe('structural');
        expect(result.actionMetadata).toEqual({ derived: true });
      });
    });
  });
});
