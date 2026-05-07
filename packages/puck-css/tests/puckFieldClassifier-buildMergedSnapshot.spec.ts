/**
 * buildMergedSnapshot Tests
 *
 * Tests for the buildMergedSnapshot function after extraction
 * from PuckFieldResolutionPanel.tsx to utils/puckFieldClassifier.ts.
 * Verifies the extraction is behavior-preserving.
 */

import { describe, it, expect } from 'vitest';
import type { PuckData } from '@pantheon-systems/css-client';
import type { PuckFieldClassification } from '../src/merge/utils/puckFieldClassifier.js';
import {
  buildMergedSnapshot,
  classifyPuckFields,
} from '../src/merge/utils/puckFieldClassifier.js';

// =============================================================================
// Shared Fixtures
// =============================================================================

const sourceSnapshot: PuckData = {
  content: [
    {
      type: 'Heading',
      props: { id: 'h1', text: 'Source Title', level: 1, color: 'red' },
    },
    {
      type: 'Paragraph',
      props: { id: 'p1', body: 'Source body text' },
    },
  ],
  root: {
    props: { title: 'Source Page Title', description: 'Source description' },
  },
};

const targetSnapshot: PuckData = {
  content: [
    {
      type: 'Heading',
      props: { id: 'h1', text: 'Target Title', level: 2, color: 'blue' },
    },
    {
      type: 'Paragraph',
      props: { id: 'p1', body: 'Target body text' },
    },
  ],
  root: {
    props: { title: 'Target Page Title', description: 'Target description' },
  },
};

// Helper to create a resolution map selecting all fields from one side
function allSelectionsFrom(
  fields: PuckFieldClassification[],
  choice: 'source' | 'target'
): Record<string, 'source' | 'target'> {
  const result: Record<string, 'source' | 'target'> = {};
  for (const f of fields) {
    if (f.classification === 'conflicting') {
      result[`${f.componentId}:${f.propName}`] = choice;
    }
  }
  return result;
}

// =============================================================================
// Tests
// =============================================================================

describe('buildMergedSnapshot', () => {
  it('builds snapshot selecting all props from source', () => {
    const fields = classifyPuckFields(sourceSnapshot, targetSnapshot, null);
    const resolutions = allSelectionsFrom(fields, 'source');
    const merged = buildMergedSnapshot(sourceSnapshot, targetSnapshot, fields, resolutions);

    // All conflicting props should come from source
    const heading = merged.content.find((c) => c.props.id === 'h1');
    expect(heading?.props.text).toBe('Source Title');
    expect(heading?.props.level).toBe(1);
    expect(heading?.props.color).toBe('red');

    const paragraph = merged.content.find((c) => c.props.id === 'p1');
    expect(paragraph?.props.body).toBe('Source body text');
  });

  it('builds snapshot selecting all props from target', () => {
    const fields = classifyPuckFields(sourceSnapshot, targetSnapshot, null);
    const resolutions = allSelectionsFrom(fields, 'target');
    const merged = buildMergedSnapshot(sourceSnapshot, targetSnapshot, fields, resolutions);

    // All conflicting props should come from target (which is the base)
    const heading = merged.content.find((c) => c.props.id === 'h1');
    expect(heading?.props.text).toBe('Target Title');
    expect(heading?.props.level).toBe(2);
    expect(heading?.props.color).toBe('blue');

    const paragraph = merged.content.find((c) => c.props.id === 'p1');
    expect(paragraph?.props.body).toBe('Target body text');
  });

  it('builds snapshot with mixed per-prop selections', () => {
    const fields = classifyPuckFields(sourceSnapshot, targetSnapshot, null);
    // Take text from source, level from target, color from source
    const resolutions: Record<string, 'source' | 'target'> = {
      'h1:text': 'source',
      'h1:level': 'target',
      'h1:color': 'source',
      'p1:body': 'target',
      'root:title': 'source',
      'root:description': 'target',
    };

    const merged = buildMergedSnapshot(sourceSnapshot, targetSnapshot, fields, resolutions);

    const heading = merged.content.find((c) => c.props.id === 'h1');
    expect(heading?.props.text).toBe('Source Title');
    expect(heading?.props.level).toBe(2);
    expect(heading?.props.color).toBe('red');

    const paragraph = merged.content.find((c) => c.props.id === 'p1');
    expect(paragraph?.props.body).toBe('Target body text');

    expect(merged.root.props?.title).toBe('Source Page Title');
    expect(merged.root.props?.description).toBe('Target description');
  });

  it('preserves auto-merged (non-conflicting) fields in output', () => {
    // Create a base where only source changed some fields
    const baseSnapshot: PuckData = {
      content: [
        {
          type: 'Heading',
          props: { id: 'h1', text: 'Base Title', level: 1, color: 'blue' },
        },
      ],
      root: { props: { title: 'Base Page Title' } },
    };

    // Source changed text, target unchanged
    const source: PuckData = {
      content: [
        {
          type: 'Heading',
          props: { id: 'h1', text: 'Source Title', level: 1, color: 'blue' },
        },
      ],
      root: { props: { title: 'Base Page Title' } },
    };

    // Target identical to base
    const target: PuckData = {
      content: [
        {
          type: 'Heading',
          props: { id: 'h1', text: 'Base Title', level: 1, color: 'blue' },
        },
      ],
      root: { props: { title: 'Base Page Title' } },
    };

    const fields = classifyPuckFields(source, target, baseSnapshot);
    // Should have source-only for text, no conflicts
    const sourceOnly = fields.filter((f) => f.classification === 'source-only');
    expect(sourceOnly.length).toBeGreaterThan(0);

    const merged = buildMergedSnapshot(source, target, fields, {});

    // Source-only field should be auto-merged (taken from source)
    const heading = merged.content.find((c) => c.props.id === 'h1');
    expect(heading?.props.text).toBe('Source Title');
  });

  it('handles root props in selections', () => {
    const fields = classifyPuckFields(sourceSnapshot, targetSnapshot, null);
    const resolutions: Record<string, 'source' | 'target'> = {};
    // Select all component fields from target, root fields from source
    for (const f of fields) {
      if (f.classification === 'conflicting') {
        if (f.componentId === 'root') {
          resolutions[`${f.componentId}:${f.propName}`] = 'source';
        } else {
          resolutions[`${f.componentId}:${f.propName}`] = 'target';
        }
      }
    }

    const merged = buildMergedSnapshot(sourceSnapshot, targetSnapshot, fields, resolutions);

    expect(merged.root.props?.title).toBe('Source Page Title');
    expect(merged.root.props?.description).toBe('Source description');
  });

  it('returns valid PuckData structure', () => {
    const fields = classifyPuckFields(sourceSnapshot, targetSnapshot, null);
    const resolutions = allSelectionsFrom(fields, 'source');
    const merged = buildMergedSnapshot(sourceSnapshot, targetSnapshot, fields, resolutions);

    expect(Array.isArray(merged.content)).toBe(true);
    expect(merged.root).toBeDefined();
    expect(typeof merged.root).toBe('object');
    // Each component should have type and props with id
    for (const comp of merged.content) {
      expect(comp.type).toBeDefined();
      expect(comp.props).toBeDefined();
      expect(comp.props.id).toBeDefined();
    }
  });
});
