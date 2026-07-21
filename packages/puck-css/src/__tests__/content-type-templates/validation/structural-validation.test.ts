/**
 * Structural Validation Tests
 *
 * Tests for template structural conformance validation.
 */

import { describe, it, expect } from 'vitest';
import type { Data } from '@puckeditor/core';
import {
  validateStructure,
  type ValidationError,
} from '../../../features/content-type-templates/validation/structural-validation.js';
import type { Template } from '../../../features/content-type-templates/types.js';

const mockTemplate: Template = {
  id: 'tmpl-1',
  name: 'blog',
  version: 1,
  updatedAt: '2026-01-01T00:00:00Z',
  content: [
    { type: 'HeadingBlock', props: { id: 'HeadingBlock-a1b2' } },
    { type: 'TextBlock', props: { id: 'TextBlock-c3d4' } },
  ],
  root: {
    props: {
      _template: { label: 'Blog', deprecated: false },
      _pinMap: { 'HeadingBlock-a1b2': true, 'TextBlock-c3d4': true },
    },
  },
  zones: {},
};

describe('validateStructure', () => {
  it('passes validation when document conforms to template', () => {
    const data: Data = {
      root: { props: {} },
      content: [
        { type: 'HeadingBlock', props: { id: 'h1' } },
        { type: 'TextBlock', props: { id: 't1' } },
      ],
      zones: {},
    };

    const result = validateStructure(data, mockTemplate);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('allows extra non-pinned components', () => {
    const data: Data = {
      root: { props: {} },
      content: [
        { type: 'HeadingBlock', props: { id: 'h1' } },
        { type: 'TextBlock', props: { id: 't1' } },
        { type: 'ImageBlock', props: { id: 'img1' } },
      ],
      zones: {},
    };

    const result = validateStructure(data, mockTemplate);
    expect(result.valid).toBe(true);
  });

  it('fails when pinned component is missing', () => {
    const data: Data = {
      root: { props: {} },
      content: [{ type: 'HeadingBlock', props: { id: 'h1' } }],
      zones: {},
    };

    const result = validateStructure(data, mockTemplate);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('MISSING_PINNED_COMPONENT');
  });

  it('fails when pinned components are out of order', () => {
    const data: Data = {
      root: { props: {} },
      content: [
        { type: 'TextBlock', props: { id: 't1' } },
        { type: 'HeadingBlock', props: { id: 'h1' } },
      ],
      zones: {},
    };

    const result = validateStructure(data, mockTemplate);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('PINNED_COMPONENT_OUT_OF_ORDER');
  });

  it('passes when template has no pinned components', () => {
    const template: Template = {
      ...mockTemplate,
      content: [{ type: 'TextBlock', props: { id: 'TextBlock-c3d4' } }],
      root: {
        props: {
          _template: { label: 'Blog', deprecated: false },
          _pinMap: { 'TextBlock-c3d4': false },
        },
      },
    };

    const data: Data = {
      root: { props: {} },
      content: [],
      zones: {},
    };

    const result = validateStructure(data, template);
    expect(result.valid).toBe(true);
  });
});
