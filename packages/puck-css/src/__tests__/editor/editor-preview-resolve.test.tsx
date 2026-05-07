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
