/**
 * useTemplateScaffold Hook Tests
 */

import { describe, it, expect } from 'vitest';
import { scaffoldFromTemplate } from '../../../features/content-type-templates/editor/useTemplateScaffold.js';
import type { Template } from '../../../features/content-type-templates/types.js';

const mockTemplate: Template = {
  id: 'tmpl-1',
  name: 'blog',
  label: 'Blog',
  version: 1,
  components: [
    { type: 'HeadingBlock', pinned: true, defaultProps: { title: 'Blog Title' } },
    { type: 'TextBlock', pinned: true, defaultProps: { text: 'Content here' } },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('scaffoldFromTemplate', () => {
  it('creates Puck data from template components', () => {
    const data = scaffoldFromTemplate(mockTemplate);

    expect(data.content).toHaveLength(2);
    expect(data.content[0].type).toBe('HeadingBlock');
    expect(data.content[1].type).toBe('TextBlock');
  });

  it('applies default props to components', () => {
    const data = scaffoldFromTemplate(mockTemplate);

    expect(data.content[0].props.title).toBe('Blog Title');
    expect(data.content[1].props.text).toBe('Content here');
  });

  it('generates unique component IDs', () => {
    const data = scaffoldFromTemplate(mockTemplate);

    expect(data.content[0].props.id).toBeDefined();
    expect(data.content[1].props.id).toBeDefined();
    expect(data.content[0].props.id).not.toBe(data.content[1].props.id);
  });

  it('creates empty data for template with no components', () => {
    const emptyTemplate: Template = {
      ...mockTemplate,
      components: [],
    };

    const data = scaffoldFromTemplate(emptyTemplate);

    expect(data.content).toEqual([]);
    expect(data.zones).toEqual({});
  });

  it('preserves component types and structure', () => {
    const data1 = scaffoldFromTemplate(mockTemplate);
    const data2 = scaffoldFromTemplate(mockTemplate);

    expect(data1.content[0].type).toBe(data2.content[0].type);
    expect(data1.content[1].type).toBe(data2.content[1].type);
    // But IDs should be different
    expect(data1.content[0].props.id).not.toBe(data2.content[0].props.id);
  });
});
