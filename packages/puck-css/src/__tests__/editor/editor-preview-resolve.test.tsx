import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { wrapConfigForEditorPreview } from '../../p1/editor/editor-preview-resolve';

describe('wrapConfigForEditorPreview', () => {
  it('wraps component renders for preview merging', () => {
    const originalRender = vi.fn(() => null);
    const base = {
      components: {
        Heading: { render: originalRender, label: 'Heading' },
      },
      root: {
        render: vi.fn(() => null),
      },
    };

    const wrapped = wrapConfigForEditorPreview(base as never);
    const comps = wrapped.components as Record<string, { render: (...args: unknown[]) => unknown }>;
    expect(comps.Heading.render).not.toBe(originalRender);
    expect(typeof comps.Heading.render).toBe('function');
  });

  it('wraps root render for preview merging', () => {
    const originalRoot = vi.fn(() => null);
    const base = {
      components: {},
      root: { render: originalRoot },
    };

    const wrapped = wrapConfigForEditorPreview(base as never);
    const root = wrapped.root as { render: (...args: unknown[]) => unknown };
    expect(root.render).not.toBe(originalRoot);
    expect(typeof root.render).toBe('function');
  });

  it('preserves non-render properties on components', () => {
    const base = {
      components: {
        Block: { render: vi.fn(), label: 'My Block', defaultProps: { text: '' } },
      },
      root: { render: vi.fn() },
    };

    const wrapped = wrapConfigForEditorPreview(base as never);
    const comps = wrapped.components as Record<string, { label: string; defaultProps: { text: string } }>;
    expect(comps.Block.label).toBe('My Block');
    expect(comps.Block.defaultProps).toEqual({ text: '' });
  });
});

describe('contentEditable preservation in merge functions', () => {
  it('mergeBlockForPreview preserves React element props', async () => {
    const { _mergeBlockForPreview } = await import('../../p1/editor/editor-preview-resolve');

    const inlineTextField = React.createElement('span', {
      contentEditable: 'plaintext-only',
    }, 'Hello World');

    const props = {
      id: 'h1',
      heading: inlineTextField,
      subtitle: 'plain text',
      puck: {},
      editMode: true,
    };

    const resolved = {
      root: { props: {} },
      content: [{ type: 'Heading', props: { id: 'h1', heading: 'Hello World', subtitle: 'resolved subtitle' } }],
      zones: {},
    };

    const merged = _mergeBlockForPreview(props, resolved, false);

    expect(React.isValidElement(merged.heading)).toBe(true);
    expect(merged.subtitle).toBe('resolved subtitle');
  });

  it('mergeBlockForPreview still merges string props normally', async () => {
    const { _mergeBlockForPreview } = await import('../../p1/editor/editor-preview-resolve');

    const props = {
      id: 'h1',
      heading: '{{product.name}}',
      puck: {},
      editMode: true,
    };

    const resolved = {
      root: { props: {} },
      content: [{ type: 'Heading', props: { id: 'h1', heading: 'iPhone 15' } }],
      zones: {},
    };

    const merged = _mergeBlockForPreview(props, resolved, false);

    expect(merged.heading).toBe('iPhone 15');
  });

  it('mergeBlockForPreview returns shimmer for unresolved tokens when loading', async () => {
    const { _mergeBlockForPreview } = await import('../../p1/editor/editor-preview-resolve');

    const props = {
      id: 'h1',
      heading: '{{product.name}}',
      puck: {},
      editMode: true,
    };

    const merged = _mergeBlockForPreview(props, null, true);

    expect(merged.heading).not.toContain('{{');
  });

  it('mergeRootForPreview preserves React element props', async () => {
    const { _mergeRootForPreview } = await import('../../p1/editor/editor-preview-resolve');

    const inlineElement = React.createElement('span', {
      contentEditable: 'plaintext-only',
    }, 'Site Title');

    const props = {
      id: 'puck-root',
      title: inlineElement,
      description: 'plain text',
      children: null,
      puck: {},
      editMode: true,
    };

    const resolved = {
      root: { props: { title: 'Site Title', description: 'resolved desc' } },
      content: [],
      zones: {},
    };

    const merged = _mergeRootForPreview(props, resolved, false);

    expect(React.isValidElement(merged.title)).toBe(true);
    expect(merged.description).toBe('resolved desc');
  });
});
