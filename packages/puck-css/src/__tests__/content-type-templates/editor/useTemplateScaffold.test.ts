/**
 * useTemplateScaffold Hook Tests
 */

import { describe, it, expect } from 'vitest';
import { scaffoldFromTemplate } from '../../../features/content-type-templates/editor/useTemplateScaffold.js';
import type { Template } from '../../../features/content-type-templates/types.js';

const mockTemplate: Template = {
  id: 'tmpl-1',
  name: 'blog',
  version: 1,
  updatedAt: '2026-01-01T00:00:00Z',
  content: [
    { type: 'HeadingBlock', props: { id: 'HeadingBlock-a1b2', title: 'Blog Title' } },
    { type: 'TextBlock', props: { id: 'TextBlock-c3d4', text: 'Content here' } },
  ],
  root: {
    props: {
      _template: { label: 'Blog', deprecated: false },
      _pinMap: { 'HeadingBlock-a1b2': true },
    },
  },
  zones: {},
};

describe('scaffoldFromTemplate', () => {
  it('creates Puck data from the template content', () => {
    const data = scaffoldFromTemplate(mockTemplate);

    expect(data.content).toHaveLength(2);
    expect(data.content[0].type).toBe('HeadingBlock');
    expect(data.content[1].type).toBe('TextBlock');
  });

  it('applies the template component props as defaults', () => {
    const data = scaffoldFromTemplate(mockTemplate);

    expect(data.content[0].props.title).toBe('Blog Title');
    expect(data.content[1].props.text).toBe('Content here');
  });

  it('generates fresh unique component IDs', () => {
    const data = scaffoldFromTemplate(mockTemplate);

    expect(data.content[0].props.id).toBeDefined();
    expect(data.content[1].props.id).toBeDefined();
    expect(data.content[0].props.id).not.toBe(data.content[1].props.id);
    expect(data.content[0].props.id).not.toBe('HeadingBlock-a1b2');
    expect(data.content[1].props.id).not.toBe('TextBlock-c3d4');
  });

  it('does not carry template metadata into the page root', () => {
    const data = scaffoldFromTemplate(mockTemplate);

    expect(data.root.props).toEqual({});
  });

  it('creates empty data for a template with empty content', () => {
    const emptyTemplate: Template = {
      ...mockTemplate,
      content: [],
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
