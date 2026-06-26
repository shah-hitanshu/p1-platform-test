/**
 * Template Store Tests
 *
 * Tests for the TemplateStore interface and in-memory implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryTemplateStore } from '../../../features/content-type-templates/stores/template-store.js';
import type { CreateTemplateParams } from '../../../features/content-type-templates/types.js';

describe('TemplateStore interface', () => {
  let store: ReturnType<typeof createInMemoryTemplateStore>;

  beforeEach(() => {
    store = createInMemoryTemplateStore();
  });

  describe('create', () => {
    it('creates a template with generated ID and timestamps', async () => {
      const params: CreateTemplateParams = {
        name: 'blog-post',
        label: 'Blog Post',
        components: [],
      };

      const template = await store.create(params);

      expect(template.id).toBeDefined();
      expect(template.name).toBe('blog-post');
      expect(template.label).toBe('Blog Post');
      expect(template.version).toBe(1);
      expect(template.components).toEqual([]);
      expect(template.createdAt).toBeDefined();
      expect(template.updatedAt).toBeDefined();
    });

    it('creates template with all optional fields', async () => {
      const params: CreateTemplateParams = {
        name: 'event',
        label: 'Event Page',
        description: 'Template for events',
        defaultUrlPattern: '/events/:slug',
        components: [
          { type: 'HeadingBlock', pinned: true, defaultProps: { title: 'Event' } },
        ],
      };

      const template = await store.create(params);

      expect(template.description).toBe('Template for events');
      expect(template.defaultUrlPattern).toBe('/events/:slug');
      expect(template.components).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('retrieves a template by ID', async () => {
      const created = await store.create({
        name: 'blog',
        label: 'Blog',
        components: [],
      });

      const retrieved = await store.get(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns undefined for non-existent ID', async () => {
      const result = await store.get('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns empty array when no templates exist', async () => {
      const templates = await store.list();
      expect(templates).toEqual([]);
    });

    it('returns all templates', async () => {
      await store.create({ name: 'blog', label: 'Blog', components: [] });
      await store.create({ name: 'event', label: 'Event', components: [] });

      const templates = await store.list();

      expect(templates).toHaveLength(2);
      expect(templates.map((t) => t.name)).toContain('blog');
      expect(templates.map((t) => t.name)).toContain('event');
    });
  });

  describe('update', () => {
    it('updates template fields and increments version', async () => {
      const template = await store.create({
        name: 'blog',
        label: 'Blog',
        components: [],
      });

      // Small delay to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await store.update(template.id, {
        label: 'Blog Post',
        description: 'Updated description',
      });

      expect(updated.id).toBe(template.id);
      expect(updated.label).toBe('Blog Post');
      expect(updated.description).toBe('Updated description');
      expect(updated.version).toBe(2);
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(template.updatedAt).getTime()
      );
    });

    it('updates components array', async () => {
      const template = await store.create({
        name: 'blog',
        label: 'Blog',
        components: [],
      });

      const updated = await store.update(template.id, {
        components: [
          { type: 'HeadingBlock', pinned: true, defaultProps: {} },
        ],
      });

      expect(updated.components).toHaveLength(1);
      expect(updated.version).toBe(2);
    });

    it('throws error for non-existent template', async () => {
      await expect(
        store.update('non-existent', { label: 'Test' })
      ).rejects.toThrow('Template not found');
    });
  });

  describe('delete', () => {
    it('removes a template', async () => {
      const template = await store.create({
        name: 'blog',
        label: 'Blog',
        components: [],
      });

      await store.delete(template.id);

      const retrieved = await store.get(template.id);
      expect(retrieved).toBeUndefined();
    });

    it('succeeds silently when deleting non-existent template', async () => {
      await expect(store.delete('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('getBinding', () => {
    it('returns undefined when no binding exists', async () => {
      const binding = await store.getBinding('doc-123');
      expect(binding).toBeUndefined();
    });
  });

  describe('setBinding', () => {
    it('stores a document-template binding', async () => {
      await store.setBinding('doc-123', 'tmpl-456', 1);

      const binding = await store.getBinding('doc-123');

      expect(binding).toEqual({
        documentId: 'doc-123',
        templateId: 'tmpl-456',
        templateVersion: 1,
      });
    });

    it('overwrites existing binding', async () => {
      await store.setBinding('doc-123', 'tmpl-456', 1);
      await store.setBinding('doc-123', 'tmpl-789', 2);

      const binding = await store.getBinding('doc-123');

      expect(binding?.templateId).toBe('tmpl-789');
      expect(binding?.templateVersion).toBe(2);
    });
  });

  describe('listBindings', () => {
    it('returns empty array when no bindings exist', async () => {
      const bindings = await store.listBindings('tmpl-123');
      expect(bindings).toEqual([]);
    });

    it('returns all bindings for a template', async () => {
      await store.setBinding('doc-1', 'tmpl-123', 1);
      await store.setBinding('doc-2', 'tmpl-123', 1);
      await store.setBinding('doc-3', 'tmpl-456', 1);

      const bindings = await store.listBindings('tmpl-123');

      expect(bindings).toHaveLength(2);
      expect(bindings.map((b) => b.documentId)).toContain('doc-1');
      expect(bindings.map((b) => b.documentId)).toContain('doc-2');
      expect(bindings.map((b) => b.documentId)).not.toContain('doc-3');
    });
  });

  describe('removeBinding', () => {
    it('removes a document binding', async () => {
      await store.setBinding('doc-123', 'tmpl-456', 1);
      await store.removeBinding('doc-123');

      const binding = await store.getBinding('doc-123');
      expect(binding).toBeUndefined();
    });

    it('succeeds silently when removing non-existent binding', async () => {
      await expect(store.removeBinding('non-existent')).resolves.toBeUndefined();
    });
  });
});
