/**
 * Structural Validation Tests
 *
 * Conformance resolves by slot-id membership: every pinned slot id must be
 * present among the document's component ids (content and zones), and the
 * pinned slots found in a list keep the template's relative order within
 * that list. A same-typed component with a different id never satisfies a
 * pinned slot.
 */

import { describe, it, expect } from 'vitest';
import type { Data } from '@puckeditor/core';
import { validateStructure } from '../../../features/content-type-templates/validation/structural-validation.js';
import type { Template } from '../../../features/content-type-templates/types.js';

function comp(type: string, id: string): { type: string; props: { id: string } } {
  return { type, props: { id } };
}

function doc(content: unknown[], zones: Record<string, unknown[]> = {}): Data {
  return { content, root: { props: {} }, zones } as unknown as Data;
}

const template: Template = {
  id: 'template-1',
  name: 'blog-post',
  version: 1,
  updatedAt: '2026-06-08T00:00:00Z',
  content: [
    comp('HeadingBlock', 'HeadingBlock-slot-1'),
    comp('TextBlock', 'TextBlock-slot-1'),
    comp('ImageBlock', 'ImageBlock-slot-1'),
  ],
  root: {
    props: {
      _template: { label: 'Blog Post' },
      _pinMap: {
        'HeadingBlock-slot-1': true,
        'TextBlock-slot-1': true,
        'ImageBlock-slot-1': false,
      },
    },
  },
  zones: {},
};

const zonedTemplate: Template = {
  ...template,
  content: [comp('HeadingBlock', 'HeadingBlock-slot-1')],
  zones: {
    'HeadingBlock-slot-1:cta': [
      comp('CtaBlock', 'CtaBlock-slot-1'),
      comp('CtaBlock', 'CtaBlock-slot-2'),
    ],
  },
  root: {
    props: {
      _template: { label: 'Blog Post' },
      _pinMap: {
        'HeadingBlock-slot-1': true,
        'CtaBlock-slot-1': true,
        'CtaBlock-slot-2': true,
      },
    },
  },
};

describe('validateStructure', () => {
  it('accepts a document holding every pinned slot id in order', () => {
    const result = validateStructure(
      doc([
        comp('HeadingBlock', 'HeadingBlock-slot-1'),
        comp('TextBlock', 'TextBlock-slot-1'),
      ]),
      template,
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts local components between and around pinned slots', () => {
    const result = validateStructure(
      doc([
        comp('BannerBlock', 'BannerBlock-local'),
        comp('HeadingBlock', 'HeadingBlock-slot-1'),
        comp('QuoteBlock', 'QuoteBlock-local'),
        comp('TextBlock', 'TextBlock-slot-1'),
      ]),
      template,
    );

    expect(result.valid).toBe(true);
  });

  it('rejects a document where a same-typed local stands in for a pinned slot', () => {
    const result = validateStructure(
      doc([
        comp('HeadingBlock', 'HeadingBlock-local'),
        comp('TextBlock', 'TextBlock-slot-1'),
      ]),
      template,
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('MISSING_PINNED_COMPONENT');
    expect(result.errors[0].componentType).toBe('HeadingBlock');
  });

  it('accepts a duplicated pinned type when the slot id is present', () => {
    const result = validateStructure(
      doc([
        comp('HeadingBlock', 'HeadingBlock-slot-1'),
        comp('HeadingBlock', 'HeadingBlock-local'),
        comp('TextBlock', 'TextBlock-slot-1'),
      ]),
      template,
    );

    expect(result.valid).toBe(true);
  });

  it('reports a pinned slot appearing before its template predecessor', () => {
    const result = validateStructure(
      doc([
        comp('TextBlock', 'TextBlock-slot-1'),
        comp('HeadingBlock', 'HeadingBlock-slot-1'),
      ]),
      template,
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('PINNED_COMPONENT_OUT_OF_ORDER');
    expect(result.errors[0].componentType).toBe('TextBlock');
    expect(typeof result.errors[0].actualIndex).toBe('number');
  });

  it('accepts a pinned slot satisfied from a zone', () => {
    const result = validateStructure(
      doc(
        [comp('HeadingBlock', 'HeadingBlock-slot-1')],
        {
          'HeadingBlock-slot-1:aside': [comp('TextBlock', 'TextBlock-slot-1')],
        },
      ),
      template,
    );

    expect(result.valid).toBe(true);
  });

  it('rejects a missing pinned zone slot', () => {
    const result = validateStructure(
      doc(
        [comp('HeadingBlock', 'HeadingBlock-slot-1')],
        { 'HeadingBlock-slot-1:cta': [comp('CtaBlock', 'CtaBlock-slot-1')] },
      ),
      zonedTemplate,
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('MISSING_PINNED_COMPONENT');
    expect(result.errors[0].componentType).toBe('CtaBlock');
  });

  it('checks pinned order within a zone', () => {
    const result = validateStructure(
      doc(
        [comp('HeadingBlock', 'HeadingBlock-slot-1')],
        {
          'HeadingBlock-slot-1:cta': [
            comp('CtaBlock', 'CtaBlock-slot-2'),
            comp('CtaBlock', 'CtaBlock-slot-1'),
          ],
        },
      ),
      zonedTemplate,
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('PINNED_COMPONENT_OUT_OF_ORDER');
  });

  it('passes when the template pins nothing', () => {
    const unpinned: Template = {
      ...template,
      root: { props: { _template: { label: 'Blog Post' }, _pinMap: {} } },
    };

    const result = validateStructure(doc([]), unpinned);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports every missing pinned slot', () => {
    const result = validateStructure(doc([]), template);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((e) => e.code === 'MISSING_PINNED_COMPONENT')).toBe(true);
  });
});
