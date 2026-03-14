/**
 * Puck Field Classifier Tests (TDD - Phase 3c)
 *
 * Tests for the utility that classifies fields in Puck data structures
 * for field-level conflict resolution. Understands Puck component structure
 * and groups conflicts by component.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import type { PuckData } from '@pantheon/css-client';
import {
  isPuckData,
  classifyPuckFields,
  getReadablePropPath,
  groupFieldsByComponent,
} from '../src/utils/puckFieldClassifier.js';
import type {
  PuckFieldClassification,
  PuckComponentConflict,
} from '../src/utils/puckFieldClassifier.js';

describe('isPuckData', () => {
  it('should return true for valid Puck data with content array and root', () => {
    const data = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Hello' } },
      ],
      root: { props: {} },
    };
    expect(isPuckData(data)).toBe(true);
  });

  it('should return true for Puck data with zones', () => {
    const data = {
      content: [],
      root: { props: {} },
      zones: {
        'sidebar': [
          { type: 'Text', props: { id: 't1', text: 'Side' } },
        ],
      },
    };
    expect(isPuckData(data)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isPuckData(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isPuckData(undefined)).toBe(false);
  });

  it('should return false for plain objects without content array', () => {
    expect(isPuckData({ title: 'hello', body: 'world' })).toBe(false);
  });

  it('should return false for objects with content but no root', () => {
    expect(isPuckData({ content: [] })).toBe(false);
  });

  it('should return false for objects with content that is not an array', () => {
    expect(isPuckData({ content: 'text', root: {} })).toBe(false);
  });

  it('should return true for empty content array with root', () => {
    expect(isPuckData({ content: [], root: { props: {} } })).toBe(true);
  });
});

describe('classifyPuckFields', () => {
  it('should classify component added only in source', () => {
    const source: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Hello' } },
        { type: 'Text', props: { id: 't1', text: 'New paragraph' } },
      ],
      root: { props: {} },
    };
    const target: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Hello' } },
      ],
      root: { props: {} },
    };

    const fields = classifyPuckFields(source, target, null);
    const addedInSource = fields.filter(
      (f) => f.classification === 'source-only' && f.componentId === 't1'
    );

    expect(addedInSource.length).toBeGreaterThan(0);
    expect(addedInSource[0].componentType).toBe('Text');
  });

  it('should classify component added only in target', () => {
    const source: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Hello' } },
      ],
      root: { props: {} },
    };
    const target: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Hello' } },
        { type: 'Image', props: { id: 'i1', src: '/photo.jpg' } },
      ],
      root: { props: {} },
    };

    const fields = classifyPuckFields(source, target, null);
    const addedInTarget = fields.filter(
      (f) => f.classification === 'target-only' && f.componentId === 'i1'
    );

    expect(addedInTarget.length).toBeGreaterThan(0);
    expect(addedInTarget[0].componentType).toBe('Image');
  });

  it('should classify prop changes within the same component as conflicting', () => {
    const base: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Original' } },
      ],
      root: { props: {} },
    };
    const source: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Source Version' } },
      ],
      root: { props: {} },
    };
    const target: PuckData = {
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Target Version' } },
      ],
      root: { props: {} },
    };

    const fields = classifyPuckFields(source, target, base);
    const conflicts = fields.filter((f) => f.classification === 'conflicting');

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].propName).toBe('text');
    expect(conflicts[0].sourceValue).toBe('Source Version');
    expect(conflicts[0].targetValue).toBe('Target Version');
  });

  it('should classify non-overlapping prop changes as source-only or target-only', () => {
    const base: PuckData = {
      content: [
        { type: 'Card', props: { id: 'c1', title: 'Original', description: 'Original desc' } },
      ],
      root: { props: {} },
    };
    const source: PuckData = {
      content: [
        { type: 'Card', props: { id: 'c1', title: 'Updated Title', description: 'Original desc' } },
      ],
      root: { props: {} },
    };
    const target: PuckData = {
      content: [
        { type: 'Card', props: { id: 'c1', title: 'Original', description: 'Updated desc' } },
      ],
      root: { props: {} },
    };

    const fields = classifyPuckFields(source, target, base);

    const sourceOnly = fields.filter((f) => f.classification === 'source-only');
    const targetOnly = fields.filter((f) => f.classification === 'target-only');
    const conflicts = fields.filter((f) => f.classification === 'conflicting');

    expect(sourceOnly).toHaveLength(1);
    expect(sourceOnly[0].propName).toBe('title');
    expect(targetOnly).toHaveLength(1);
    expect(targetOnly[0].propName).toBe('description');
    expect(conflicts).toHaveLength(0);
  });

  it('should handle root prop changes', () => {
    const base: PuckData = {
      content: [],
      root: { props: { title: 'Old Title' } },
    };
    const source: PuckData = {
      content: [],
      root: { props: { title: 'Source Title' } },
    };
    const target: PuckData = {
      content: [],
      root: { props: { title: 'Target Title' } },
    };

    const fields = classifyPuckFields(source, target, base);
    const rootConflicts = fields.filter(
      (f) => f.classification === 'conflicting' && f.componentId === 'root'
    );

    expect(rootConflicts).toHaveLength(1);
    expect(rootConflicts[0].propName).toBe('title');
  });

  it('should handle null base snapshot (all shared fields treated as conflicting)', () => {
    const source: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1', text: 'Source text', color: 'red' } },
      ],
      root: { props: {} },
    };
    const target: PuckData = {
      content: [
        { type: 'Text', props: { id: 't1', text: 'Target text', color: 'red' } },
      ],
      root: { props: {} },
    };

    const fields = classifyPuckFields(source, target, null);
    // Without a base, text differs -> conflicting; color same -> not included
    const conflicts = fields.filter((f) => f.classification === 'conflicting');

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].propName).toBe('text');
  });

  it('should detect components in zones', () => {
    const source: PuckData = {
      content: [],
      root: { props: {} },
      zones: {
        sidebar: [
          { type: 'Widget', props: { id: 'w1', label: 'Source Widget' } },
        ],
      },
    };
    const target: PuckData = {
      content: [],
      root: { props: {} },
      zones: {
        sidebar: [
          { type: 'Widget', props: { id: 'w1', label: 'Target Widget' } },
        ],
      },
    };

    const fields = classifyPuckFields(source, target, null);
    const conflicts = fields.filter((f) => f.classification === 'conflicting');

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].componentId).toBe('w1');
    expect(conflicts[0].propName).toBe('label');
  });
});

describe('getReadablePropPath', () => {
  it('should return prop name for simple content component props', () => {
    expect(getReadablePropPath('content', 'Heading', 'text')).toBe('Heading → text');
  });

  it('should include zone name for zone components', () => {
    expect(getReadablePropPath('zones/sidebar', 'Widget', 'label')).toBe(
      'sidebar → Widget → label'
    );
  });

  it('should handle root props', () => {
    expect(getReadablePropPath('root', 'root', 'title')).toBe('Page → title');
  });
});

describe('groupFieldsByComponent', () => {
  it('should group fields by component ID', () => {
    const fields: PuckFieldClassification[] = [
      {
        classification: 'conflicting',
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'text',
        sourceValue: 'Source',
        targetValue: 'Target',
        path: 'content',
      },
      {
        classification: 'source-only',
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'size',
        sourceValue: 'large',
        targetValue: 'medium',
        path: 'content',
      },
      {
        classification: 'conflicting',
        componentId: 't1',
        componentType: 'Text',
        propName: 'body',
        sourceValue: 'Source body',
        targetValue: 'Target body',
        path: 'content',
      },
    ];

    const groups = groupFieldsByComponent(fields);

    expect(groups).toHaveLength(2);

    const headingGroup = groups.find((g) => g.componentId === 'h1');
    expect(headingGroup).toBeDefined();
    expect(headingGroup!.componentType).toBe('Heading');
    expect(headingGroup!.fields).toHaveLength(2);

    const textGroup = groups.find((g) => g.componentId === 't1');
    expect(textGroup).toBeDefined();
    expect(textGroup!.componentType).toBe('Text');
    expect(textGroup!.fields).toHaveLength(1);
  });

  it('should mark component as having conflicts when any field is conflicting', () => {
    const fields: PuckFieldClassification[] = [
      {
        classification: 'source-only',
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'size',
        sourceValue: 'large',
        targetValue: 'medium',
        path: 'content',
      },
      {
        classification: 'conflicting',
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'text',
        sourceValue: 'Source',
        targetValue: 'Target',
        path: 'content',
      },
    ];

    const groups = groupFieldsByComponent(fields);

    expect(groups[0].hasConflicts).toBe(true);
  });

  it('should mark component as not having conflicts when all fields are auto-mergeable', () => {
    const fields: PuckFieldClassification[] = [
      {
        classification: 'source-only',
        componentId: 'h1',
        componentType: 'Heading',
        propName: 'size',
        sourceValue: 'large',
        targetValue: 'medium',
        path: 'content',
      },
    ];

    const groups = groupFieldsByComponent(fields);

    expect(groups[0].hasConflicts).toBe(false);
  });

  it('should return empty array for empty input', () => {
    const groups = groupFieldsByComponent([]);
    expect(groups).toHaveLength(0);
  });
});

describe('deepEqual - array vs object distinction', () => {
  it('should treat arrays and objects with same keys as different (conflicting)', () => {
    // An array [1, 2] and an object {0: 1, 1: 2} should NOT be equal.
    // This is tested indirectly through classifyPuckFields since deepEqual is private.
    const source: PuckData = {
      content: [
        {
          type: 'Data',
          props: { id: 'd1', items: [1, 2] },
        },
      ],
      root: { props: {} },
    };

    const target: PuckData = {
      content: [
        {
          type: 'Data',
          props: { id: 'd1', items: { 0: 1, 1: 2 } },
        },
      ],
      root: { props: {} },
    };

    const fields = classifyPuckFields(source, target, null);

    // Since source has array and target has object, they should differ
    const itemsField = fields.find((f) => f.propName === 'items');
    expect(itemsField).toBeDefined();
    expect(itemsField?.classification).toBe('conflicting');
  });
});
