/**
 * Version Patches - JSON Diff Unit Tests
 *
 * Tests for Phase 2 JSON diff version storage using RFC 6902 patches.
 * Validates that fast-json-patch correctly handles realistic Puck editor
 * data structures for baseline + patch reconstruction.
 */

import { describe, it, expect } from 'vitest';
import { compare, applyPatch } from 'fast-json-patch';

// ---------------------------------------------------------------------------
// Test helpers - realistic Puck data factories
// ---------------------------------------------------------------------------

function makePuckData(overrides: Record<string, unknown> = {}) {
  return {
    root: {
      props: {
        title: 'My Page',
        description: 'A sample page',
      },
    },
    content: [
      {
        type: 'Hero',
        props: {
          id: 'hero-1',
          heading: 'Welcome',
          subheading: 'Get started',
          backgroundImage: '/hero.jpg',
        },
      },
      {
        type: 'TextBlock',
        props: {
          id: 'text-1',
          body: 'Hello world',
          align: 'left',
        },
      },
    ],
    zones: {
      'sidebar:left': [
        {
          type: 'Navigation',
          props: {
            id: 'nav-1',
            links: [
              { label: 'Home', href: '/' },
              { label: 'About', href: '/about' },
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Version Patches - JSON Diff Storage', () => {
  // -----------------------------------------------------------------------
  // 1. JSON patch computation roundtrip
  // -----------------------------------------------------------------------
  describe('JSON patch computation roundtrip', () => {
    it('should compute a patch from one snapshot to another and apply it to reproduce the target', () => {
      const snapshotA = makePuckData();
      const snapshotB = makePuckData({
        root: {
          props: {
            title: 'Updated Page',
            description: 'A modified page',
          },
        },
      });

      const patch = compare(snapshotA, snapshotB);
      expect(patch.length).toBeGreaterThan(0);

      const reconstructed = deepClone(snapshotA);
      const result = applyPatch(reconstructed, patch);

      // Every operation should succeed (no errors)
      for (const op of result) {
        expect(op.newDocument).toBeDefined();
      }

      expect(reconstructed).toEqual(snapshotB);
    });

    it('should roundtrip through content array changes', () => {
      const snapshotA = makePuckData();
      const snapshotB = deepClone(snapshotA) as ReturnType<typeof makePuckData>;
      (snapshotB.content[0] as Record<string, unknown>).props = {
        ...(snapshotB.content[0] as Record<string, Record<string, unknown>>).props,
        heading: 'Changed Heading',
      };

      const patch = compare(snapshotA, snapshotB);
      const reconstructed = deepClone(snapshotA);
      applyPatch(reconstructed, patch);

      expect(reconstructed).toEqual(snapshotB);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Empty patch when data is identical
  // -----------------------------------------------------------------------
  describe('empty patch for identical data', () => {
    it('should produce an empty patch array when two objects are identical', () => {
      const snapshot = makePuckData();
      const identical = deepClone(snapshot);

      const patch = compare(snapshot, identical);

      expect(patch).toHaveLength(0);
    });

    it('should produce an empty patch for identical deeply nested structures', () => {
      const snapshot = makePuckData({
        zones: {
          'sidebar:left': [
            {
              type: 'Navigation',
              props: {
                id: 'nav-1',
                links: [
                  { label: 'Home', href: '/' },
                  { label: 'About', href: '/about' },
                ],
              },
            },
          ],
          'sidebar:right': [
            {
              type: 'Widget',
              props: {
                id: 'widget-1',
                config: { nested: { deep: true } },
              },
            },
          ],
        },
      });

      const identical = deepClone(snapshot);
      const patch = compare(snapshot, identical);

      expect(patch).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Baseline + N patches reconstruction
  // -----------------------------------------------------------------------
  describe('baseline + N patches reconstruction', () => {
    it('should reconstruct final state by applying sequential patches to a baseline', () => {
      // Simulate a sequence of edits
      const baseline = makePuckData();

      // Edit 1: change title
      const v1 = deepClone(baseline) as ReturnType<typeof makePuckData>;
      v1.root.props.title = 'First Edit';
      const patch1 = compare(baseline, v1);

      // Edit 2: change body text
      const v2 = deepClone(v1);
      (v2.content[1] as Record<string, Record<string, unknown>>).props.body =
        'Updated body text';
      const patch2 = compare(v1, v2);

      // Edit 3: add a zone entry
      const v3 = deepClone(v2) as ReturnType<typeof makePuckData>;
      v3.zones['footer:main'] = [
        {
          type: 'Footer',
          props: { id: 'footer-1', text: 'Copyright 2026' },
        },
      ];
      const patch3 = compare(v2, v3);

      // Edit 4: change navigation link
      const v4 = deepClone(v3) as ReturnType<typeof makePuckData>;
      (v4.zones['sidebar:left'][0] as Record<string, Record<string, unknown[]>>)
        .props.links[0] = { label: 'Dashboard', href: '/dashboard' };
      const patch4 = compare(v3, v4);

      // Reconstruct from baseline by applying all patches sequentially
      const reconstructed = deepClone(baseline);
      applyPatch(reconstructed, patch1);
      applyPatch(reconstructed, patch2);
      applyPatch(reconstructed, patch3);
      applyPatch(reconstructed, patch4);

      expect(reconstructed).toEqual(v4);
    });

    it('should handle applying patches where some are empty (no-op edits)', () => {
      const baseline = makePuckData();

      const v1 = deepClone(baseline) as ReturnType<typeof makePuckData>;
      v1.root.props.title = 'Edited';
      const patch1 = compare(baseline, v1);

      // No-op: same as v1
      const v2 = deepClone(v1);
      const patch2 = compare(v1, v2);
      expect(patch2).toHaveLength(0);

      // Another real edit
      const v3 = deepClone(v2) as ReturnType<typeof makePuckData>;
      v3.root.props.description = 'New description';
      const patch3 = compare(v2, v3);

      const reconstructed = deepClone(baseline);
      applyPatch(reconstructed, patch1);
      applyPatch(reconstructed, patch2);
      applyPatch(reconstructed, patch3);

      expect(reconstructed).toEqual(v3);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Realistic Puck data scenarios
  // -----------------------------------------------------------------------
  describe('realistic Puck data scenarios', () => {
    it('should produce a small patch for a single component property change', () => {
      const before = makePuckData();
      const after = deepClone(before) as ReturnType<typeof makePuckData>;
      (after.content[0] as Record<string, Record<string, unknown>>).props.heading =
        'New Heading';

      const patch = compare(before, after);

      // A single property change should produce very few operations
      expect(patch.length).toBeLessThan(5);
      expect(patch.length).toBeGreaterThan(0);

      // Verify roundtrip
      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);
      expect(reconstructed).toEqual(after);
    });

    it('should handle component reordering correctly', () => {
      const before = makePuckData();
      const after = deepClone(before) as ReturnType<typeof makePuckData>;

      // Reverse the content array order
      after.content = [after.content[1], after.content[0]];

      const patch = compare(before, after);
      expect(patch.length).toBeGreaterThan(0);

      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);
      expect(reconstructed).toEqual(after);
    });

    it('should handle changes across multiple zones', () => {
      const before = makePuckData({
        zones: {
          'sidebar:left': [
            { type: 'Nav', props: { id: 'nav-1', title: 'Navigation' } },
          ],
          'sidebar:right': [
            { type: 'Widget', props: { id: 'w-1', value: 10 } },
          ],
        },
      });

      const after = deepClone(before) as ReturnType<typeof makePuckData>;
      (after.zones['sidebar:left'][0] as Record<string, Record<string, unknown>>)
        .props.title = 'Updated Nav';
      (after.zones['sidebar:right'][0] as Record<string, Record<string, unknown>>)
        .props.value = 42;

      const patch = compare(before, after);
      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);

      expect(reconstructed).toEqual(after);
    });

    it('should produce patches for root-level metadata changes', () => {
      const before = makePuckData();
      const after = deepClone(before) as ReturnType<typeof makePuckData>;
      after.root.props.title = 'Brand New Title';
      after.root.props.description = 'Brand new description';

      const patch = compare(before, after);
      // Two property changes should still be compact
      expect(patch.length).toBeLessThan(5);

      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);
      expect(reconstructed).toEqual(after);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('should produce a correct patch for adding a new component', () => {
      const before = makePuckData();
      const after = deepClone(before) as ReturnType<typeof makePuckData>;
      after.content.push({
        type: 'CallToAction',
        props: {
          id: 'cta-1',
          label: 'Sign Up',
          href: '/signup',
        },
      });

      const patch = compare(before, after);
      expect(patch.length).toBeGreaterThan(0);

      // At least one operation should be an "add"
      expect(patch.some((op) => op.op === 'add')).toBe(true);

      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);
      expect(reconstructed).toEqual(after);
    });

    it('should produce a correct patch for removing a component', () => {
      const before = makePuckData();
      const after = deepClone(before) as ReturnType<typeof makePuckData>;
      after.content.splice(0, 1); // Remove the first component (Hero)

      const patch = compare(before, after);
      expect(patch.length).toBeGreaterThan(0);

      // Should contain a "remove" operation
      expect(patch.some((op) => op.op === 'remove')).toBe(true);

      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);
      expect(reconstructed).toEqual(after);
    });

    it('should produce a correct patch for a deeply nested property change', () => {
      const before = makePuckData();
      const after = deepClone(before) as ReturnType<typeof makePuckData>;

      // Change a nested link label inside a zone component
      const navComponent = after.zones['sidebar:left'][0] as Record<
        string,
        Record<string, Array<Record<string, string>>>
      >;
      navComponent.props.links[1].label = 'Contact Us';
      navComponent.props.links[1].href = '/contact';

      const patch = compare(before, after);
      expect(patch.length).toBeGreaterThan(0);

      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);
      expect(reconstructed).toEqual(after);
    });

    it('should not mutate the original object when applying a patch to a clone', () => {
      const original = makePuckData();
      const modified = deepClone(original) as ReturnType<typeof makePuckData>;
      modified.root.props.title = 'Mutated Title';

      const patch = compare(original, modified);

      // Clone the original and apply patch to the clone
      const cloned = deepClone(original);
      applyPatch(cloned, patch);

      // The clone should match the modified version
      expect(cloned).toEqual(modified);

      // The original must remain unchanged
      expect(original.root.props.title).toBe('My Page');
      expect(original).not.toEqual(modified);
    });

    it('should handle adding and removing properties from a component', () => {
      const before = makePuckData();
      const after = deepClone(before) as ReturnType<typeof makePuckData>;

      // Add a new property
      (after.content[0] as Record<string, Record<string, unknown>>).props.newProp =
        'new value';

      // Remove an existing property
      delete (after.content[0] as Record<string, Record<string, unknown>>).props
        .subheading;

      const patch = compare(before, after);
      expect(patch.length).toBeGreaterThan(0);

      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);
      expect(reconstructed).toEqual(after);
    });

    it('should handle replacing an entire content array', () => {
      const before = makePuckData();
      const after = deepClone(before) as ReturnType<typeof makePuckData>;
      after.content = [
        {
          type: 'FullWidthBanner',
          props: {
            id: 'banner-1',
            text: 'Completely new content',
            color: '#ff0000',
          },
        },
      ];

      const patch = compare(before, after);
      const reconstructed = deepClone(before);
      applyPatch(reconstructed, patch);
      expect(reconstructed).toEqual(after);
    });
  });
});
