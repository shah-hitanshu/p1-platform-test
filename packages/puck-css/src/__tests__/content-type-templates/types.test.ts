/**
 * Content Type Templates - Core Types Tests
 *
 * Tests for core template types and interfaces.
 */

import { describe, it, expect } from 'vitest';
import type {
  ContentRole,
  TemplateMetadata,
  TemplateContentItem,
  Template,
  TemplateSummary,
  TemplateBinding,
} from '../../features/content-type-templates/types.js';

describe('ContentRole', () => {
  it('supports admin role', () => {
    const role: ContentRole = 'admin';
    expect(role).toBe('admin');
  });

  it('supports editor role', () => {
    const role: ContentRole = 'editor';
    expect(role).toBe('editor');
  });

  it('supports junior-editor role', () => {
    const role: ContentRole = 'junior-editor';
    expect(role).toBe('junior-editor');
  });
});

describe('TemplateMetadata', () => {
  it('validates minimal template metadata', () => {
    const meta: TemplateMetadata = {
      label: 'Blog Post',
    };
    expect(meta.label).toBe('Blog Post');
  });

  it('validates complete template metadata with optional fields', () => {
    const meta: TemplateMetadata = {
      label: 'Event Page',
      description: 'Template for event pages',
      defaultUrlPattern: '/events/:slug',
      deprecated: false,
    };
    expect(meta.description).toBe('Template for event pages');
    expect(meta.defaultUrlPattern).toBe('/events/:slug');
    expect(meta.deprecated).toBe(false);
  });
});

describe('TemplateContentItem', () => {
  it('validates a component instance with default props', () => {
    const item: TemplateContentItem = {
      type: 'HeadingBlock',
      props: {
        id: 'HeadingBlock-a1b2',
        title: 'Default Title',
        level: 1,
      },
    };
    expect(item.type).toBe('HeadingBlock');
    expect(item.props.id).toBe('HeadingBlock-a1b2');
    expect(item.props.title).toBe('Default Title');
  });

  it('validates a component instance with complex props', () => {
    const item: TemplateContentItem = {
      type: 'CardBlock',
      props: {
        id: 'CardBlock-c3d4',
        title: 'Card',
        items: [
          { label: 'Item 1', value: 'a' },
          { label: 'Item 2', value: 'b' },
        ],
      },
    };
    expect(item.props.items).toHaveLength(2);
  });
});

describe('Template', () => {
  it('validates an empty template snapshot', () => {
    const template: Template = {
      id: 'tmpl_123',
      name: 'blog-post',
      version: 1,
      updatedAt: '2026-06-08T00:00:00Z',
      content: [],
      root: {
        props: {
          _template: { label: 'Blog Post', deprecated: false },
          _pinMap: {},
        },
      },
      zones: {},
    };
    expect(template.id).toBe('tmpl_123');
    expect(template.content).toEqual([]);
    expect(template.root.props._template.label).toBe('Blog Post');
  });

  it('validates a template with content and pins', () => {
    const template: Template = {
      id: 'tmpl_456',
      name: 'event',
      version: 1,
      updatedAt: '2026-06-08T00:00:00Z',
      content: [
        { type: 'HeadingBlock', props: { id: 'HeadingBlock-a1b2', title: 'Event Title' } },
        { type: 'TextBlock', props: { id: 'TextBlock-c3d4' } },
      ],
      root: {
        props: {
          _template: {
            label: 'Event Page',
            description: 'Event template',
            defaultUrlPattern: '/events/:id',
            deprecated: false,
          },
          _pinMap: { 'HeadingBlock-a1b2': true, 'TextBlock-c3d4': false },
        },
      },
      zones: {},
    };
    expect(template.content).toHaveLength(2);
    expect(template.root.props._pinMap['HeadingBlock-a1b2']).toBe(true);
    expect(template.root.props._pinMap['TextBlock-c3d4']).toBe(false);
  });
});

describe('TemplateSummary', () => {
  it('validates a list entry with identifiers and metadata', () => {
    const summary: TemplateSummary = {
      id: 'tmpl_123',
      name: 'blog-post',
      label: 'Blog Post',
      description: 'Standard blog layout',
      defaultUrlPattern: '/blog/:slug',
      deprecated: false,
      version: 3,
      updatedAt: '2026-06-08T00:00:00Z',
    };
    expect(summary.name).toBe('blog-post');
    expect(summary.label).toBe('Blog Post');
    expect(summary.version).toBe(3);
  });
});

describe('TemplateBinding', () => {
  it('validates document-template binding', () => {
    const binding: TemplateBinding = {
      documentId: 'doc_123',
      templateId: 'tmpl_456',
      templateVersion: 1,
    };
    expect(binding.documentId).toBe('doc_123');
    expect(binding.templateId).toBe('tmpl_456');
    expect(binding.templateVersion).toBe(1);
  });

  it('supports null binding for unassociated documents', () => {
    const binding: TemplateBinding | null = null;
    expect(binding).toBeNull();
  });
});
