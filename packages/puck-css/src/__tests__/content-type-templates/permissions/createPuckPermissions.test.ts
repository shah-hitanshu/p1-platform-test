/**
 * createPuckPermissions Tests
 */

import { describe, it, expect } from 'vitest';
import type { Item as PuckItem, Data as PuckData } from '@puckeditor/core';
import { createPuckPermissions } from '../../../features/content-type-templates/permissions/createPuckPermissions.js';
import type { Template } from '../../../features/content-type-templates/types.js';

describe('createPuckPermissions', () => {
  const mockTemplate: Template = {
    id: 'template-1',
    name: 'blog-post',
    label: 'Blog Post',
    version: 1,
    components: [
      { type: 'HeadingBlock', pinned: true, defaultProps: {} },
      { type: 'TextBlock', pinned: true, defaultProps: {} },
      { type: 'ImageBlock', pinned: false, defaultProps: {} },
    ],
    createdAt: '2026-06-08T00:00:00Z',
    updatedAt: '2026-06-08T00:00:00Z',
  };

  describe('with template (templated document)', () => {
    it('should lock drag/delete for pinned components (all roles)', () => {
      const resolver = createPuckPermissions(mockTemplate, 'admin', false);

      const pinnedPerms = resolver({ type: 'HeadingBlock' } as PuckItem, {} as PuckData);
      expect(pinnedPerms.drag).toBe(false);
      expect(pinnedPerms.delete).toBe(false);
      expect(pinnedPerms.edit).toBe(true);
      expect(pinnedPerms.insert).toBe(true);
      expect(pinnedPerms.duplicate).toBe(true);
    });

    it('should allow drag/delete for non-pinned components (admin)', () => {
      const resolver = createPuckPermissions(mockTemplate, 'admin', false);

      const nonPinnedPerms = resolver({ type: 'ImageBlock' } as PuckItem, {} as PuckData);
      expect(nonPinnedPerms.drag).toBe(true);
      expect(nonPinnedPerms.delete).toBe(true);
      expect(nonPinnedPerms.edit).toBe(true);
      expect(nonPinnedPerms.insert).toBe(true);
      expect(nonPinnedPerms.duplicate).toBe(true);
    });

    it('should restrict all structural ops for junior-editor on non-pinned components', () => {
      const resolver = createPuckPermissions(mockTemplate, 'junior-editor', false);

      const nonPinnedPerms = resolver({ type: 'ImageBlock' } as PuckItem, {} as PuckData);
      expect(nonPinnedPerms.drag).toBe(false);
      expect(nonPinnedPerms.delete).toBe(false);
      expect(nonPinnedPerms.edit).toBe(true);
      expect(nonPinnedPerms.insert).toBe(false);
      expect(nonPinnedPerms.duplicate).toBe(false);
    });

    it('should allow structural permissions for editor on non-pinned components', () => {
      const resolver = createPuckPermissions(mockTemplate, 'editor', false);

      const nonPinnedPerms = resolver({ type: 'ImageBlock' } as PuckItem, {} as PuckData);
      expect(nonPinnedPerms.drag).toBe(true);
      expect(nonPinnedPerms.delete).toBe(true);
      expect(nonPinnedPerms.edit).toBe(true);
      expect(nonPinnedPerms.insert).toBe(true);
      expect(nonPinnedPerms.duplicate).toBe(true);
    });

    it('should lock junior-editor on pinned components', () => {
      const resolver = createPuckPermissions(mockTemplate, 'junior-editor', false);

      const pinnedPerms = resolver({ type: 'HeadingBlock' } as PuckItem, {} as PuckData);
      expect(pinnedPerms.drag).toBe(false);
      expect(pinnedPerms.delete).toBe(false);
      expect(pinnedPerms.edit).toBe(true);
      expect(pinnedPerms.insert).toBe(false);
      expect(pinnedPerms.duplicate).toBe(false);
    });
  });

  describe('without template (blank page)', () => {
    it('should return all-true permissions for admin', () => {
      const resolver = createPuckPermissions(null, 'admin', false);

      const perms = resolver({ type: 'AnyBlock' } as PuckItem, {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('should return all-true permissions for editor', () => {
      const resolver = createPuckPermissions(null, 'editor', false);

      const perms = resolver({ type: 'AnyBlock' } as PuckItem, {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('should restrict all structural ops for junior-editor on blank pages', () => {
      const resolver = createPuckPermissions(null, 'junior-editor', false);

      const perms = resolver({ type: 'AnyBlock' } as PuckItem, {} as PuckData);
      expect(perms.drag).toBe(false);
      expect(perms.delete).toBe(false);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(false);
      expect(perms.duplicate).toBe(false);
    });
  });

  describe('historical version mode', () => {
    it('should disable all structural permissions for all roles', () => {
      const adminResolver = createPuckPermissions(mockTemplate, 'admin', true);
      const editorResolver = createPuckPermissions(mockTemplate, 'editor', true);
      const juniorResolver = createPuckPermissions(mockTemplate, 'junior-editor', true);

      const adminPerms = adminResolver({ type: 'ImageBlock' } as PuckItem, {} as PuckData);
      const editorPerms = editorResolver({ type: 'ImageBlock' } as PuckItem, {} as PuckData);
      const juniorPerms = juniorResolver({ type: 'HeadingBlock' } as PuckItem, {} as PuckData);

      // Admin
      expect(adminPerms.drag).toBe(false);
      expect(adminPerms.delete).toBe(false);
      expect(adminPerms.insert).toBe(false);
      expect(adminPerms.duplicate).toBe(false);
      expect(adminPerms.edit).toBe(true); // Can still view props

      // Editor
      expect(editorPerms.drag).toBe(false);
      expect(editorPerms.delete).toBe(false);
      expect(editorPerms.insert).toBe(false);
      expect(editorPerms.duplicate).toBe(false);
      expect(editorPerms.edit).toBe(true);

      // Junior
      expect(juniorPerms.drag).toBe(false);
      expect(juniorPerms.delete).toBe(false);
      expect(juniorPerms.insert).toBe(false);
      expect(juniorPerms.duplicate).toBe(false);
      expect(juniorPerms.edit).toBe(true);
    });
  });

  describe('component not in template', () => {
    it('should allow full permissions for admin/editor on unknown components', () => {
      const resolver = createPuckPermissions(mockTemplate, 'editor', false);

      const perms = resolver({ type: 'UnknownBlock' } as PuckItem, {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('should restrict all structural ops for junior-editor on unknown components', () => {
      const resolver = createPuckPermissions(mockTemplate, 'junior-editor', false);

      const perms = resolver({ type: 'UnknownBlock' } as PuckItem, {} as PuckData);
      expect(perms.drag).toBe(false);
      expect(perms.delete).toBe(false);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(false);
      expect(perms.duplicate).toBe(false);
    });
  });
});
