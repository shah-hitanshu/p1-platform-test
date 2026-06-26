/**
 * Content Type Templates - Core Types Tests
 *
 * Tests for core template types and interfaces.
 */

import { describe, it, expect } from 'vitest';
import type {
  ContentRole,
  TemplateMetadata,
  TemplateComponent,
  Template,
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
      name: 'blog-post',
      label: 'Blog Post',
      version: 1,
    };
    expect(meta.name).toBe('blog-post');
    expect(meta.label).toBe('Blog Post');
    expect(meta.version).toBe(1);
  });

  it('validates complete template metadata with optional fields', () => {
    const meta: TemplateMetadata = {
      name: 'event',
      label: 'Event Page',
      description: 'Template for event pages',
      defaultUrlPattern: '/events/:slug',
      version: 2,
    };
    expect(meta.description).toBe('Template for event pages');
    expect(meta.defaultUrlPattern).toBe('/events/:slug');
  });
});

describe('TemplateComponent', () => {
  it('validates component with pinned status', () => {
    const component: TemplateComponent = {
      type: 'HeadingBlock',
      pinned: true,
      defaultProps: {
        title: 'Default Title',
        level: 1,
      },
    };
    expect(component.type).toBe('HeadingBlock');
    expect(component.pinned).toBe(true);
    expect(component.defaultProps).toEqual({ title: 'Default Title', level: 1 });
  });

  it('validates unpinned component', () => {
    const component: TemplateComponent = {
      type: 'TextBlock',
      pinned: false,
      defaultProps: {},
    };
    expect(component.pinned).toBe(false);
  });

  it('validates component with complex default props', () => {
    const component: TemplateComponent = {
      type: 'CardBlock',
      pinned: true,
      defaultProps: {
        title: 'Card',
        items: [
          { label: 'Item 1', value: 'a' },
          { label: 'Item 2', value: 'b' },
        ],
      },
    };
    expect(component.defaultProps.items).toHaveLength(2);
  });
});

describe('Template', () => {
  it('validates minimal template', () => {
    const template: Template = {
      id: 'tmpl_123',
      name: 'blog-post',
      label: 'Blog Post',
      version: 1,
      components: [],
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T00:00:00Z',
    };
    expect(template.id).toBe('tmpl_123');
    expect(template.components).toEqual([]);
  });

  it('validates template with components', () => {
    const template: Template = {
      id: 'tmpl_456',
      name: 'event',
      label: 'Event Page',
      description: 'Event template',
      defaultUrlPattern: '/events/:id',
      version: 1,
      components: [
        { type: 'HeadingBlock', pinned: true, defaultProps: { title: 'Event Title' } },
        { type: 'TextBlock', pinned: false, defaultProps: {} },
      ],
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T00:00:00Z',
    };
    expect(template.components).toHaveLength(2);
    expect(template.components[0].pinned).toBe(true);
    expect(template.components[1].pinned).toBe(false);
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
