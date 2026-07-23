/**
 * createPuckPermissions Tests
 *
 * Pinning resolves by slot-id membership: a canvas component is pinned when
 * its own props.id maps to true in the template's root.props._pinMap, so a
 * same-typed component with a different id (a local copy or duplicate) is
 * never locked.
 */

import { describe, it, expect } from 'vitest';
import type { Item as PuckItem, Data as PuckData } from '@puckeditor/core';
import { createPuckPermissions } from '../../../features/content-type-templates/permissions/createPuckPermissions.js';
import type { Template, TemplateSummary } from '../../../features/content-type-templates/types.js';

function item(type: string, id: string): PuckItem {
  return { type, props: { id } } as PuckItem;
}

describe('createPuckPermissions', () => {
  const mockTemplate: Template = {
    id: 'template-1',
    name: 'blog-post',
    version: 1,
    updatedAt: '2026-06-08T00:00:00Z',
    content: [
      { type: 'HeadingBlock', props: { id: 'HeadingBlock-a1b2' } },
      { type: 'TextBlock', props: { id: 'TextBlock-c3d4' } },
      { type: 'ImageBlock', props: { id: 'ImageBlock-e5f6' } },
    ],
    root: {
      props: {
        _template: { label: 'Blog Post', deprecated: false },
        _pinMap: {
          'HeadingBlock-a1b2': true,
          'TextBlock-c3d4': true,
          'ImageBlock-e5f6': false,
        },
      },
    },
    zones: {},
  };

  describe('with template (templated document)', () => {
    it('locks drag/delete for a pinned slot instance (all roles)', () => {
      const resolver = createPuckPermissions(mockTemplate, 'admin', false);

      const pinnedPerms = resolver(item('HeadingBlock', 'HeadingBlock-a1b2'), {} as PuckData);
      expect(pinnedPerms.drag).toBe(false);
      expect(pinnedPerms.delete).toBe(false);
      expect(pinnedPerms.edit).toBe(true);
      expect(pinnedPerms.insert).toBe(true);
      expect(pinnedPerms.duplicate).toBe(true);
    });

    it('does not lock a same-typed component with a different id', () => {
      const resolver = createPuckPermissions(mockTemplate, 'editor', false);

      const perms = resolver(item('HeadingBlock', 'HeadingBlock-local-copy'), {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
    });

    it('does not lock the unpinned slot instance', () => {
      const resolver = createPuckPermissions(mockTemplate, 'admin', false);

      const perms = resolver(item('ImageBlock', 'ImageBlock-e5f6'), {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('locks a pinned slot that lives in a template zone', () => {
      const template: Template = {
        ...mockTemplate,
        zones: {
          'HeadingBlock-a1b2:aside': [
            { type: 'CtaBlock', props: { id: 'CtaBlock-z1' } },
          ],
        },
        root: {
          props: {
            _template: { label: 'Blog Post' },
            _pinMap: { 'CtaBlock-z1': true },
          },
        },
      };
      const resolver = createPuckPermissions(template, 'editor', false);

      const perms = resolver(item('CtaBlock', 'CtaBlock-z1'), {} as PuckData);
      expect(perms.drag).toBe(false);
      expect(perms.delete).toBe(false);
    });

    it('restricts all structural ops for junior-editor on unpinned components', () => {
      const resolver = createPuckPermissions(mockTemplate, 'junior-editor', false);

      const perms = resolver(item('ImageBlock', 'ImageBlock-e5f6'), {} as PuckData);
      expect(perms.drag).toBe(false);
      expect(perms.delete).toBe(false);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(false);
      expect(perms.duplicate).toBe(false);
    });

    it('allows structural permissions for editor on unpinned components', () => {
      const resolver = createPuckPermissions(mockTemplate, 'editor', false);

      const perms = resolver(item('ImageBlock', 'ImageBlock-e5f6'), {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('locks junior-editor on pinned slot instances', () => {
      const resolver = createPuckPermissions(mockTemplate, 'junior-editor', false);

      const perms = resolver(item('HeadingBlock', 'HeadingBlock-a1b2'), {} as PuckData);
      expect(perms.drag).toBe(false);
      expect(perms.delete).toBe(false);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(false);
      expect(perms.duplicate).toBe(false);
    });

    it('treats a component without a pin map entry as unpinned', () => {
      const template: Template = {
        ...mockTemplate,
        root: {
          props: {
            _template: { label: 'Blog Post' },
            _pinMap: {},
          },
        },
      };
      const resolver = createPuckPermissions(template, 'editor', false);

      const perms = resolver(item('HeadingBlock', 'HeadingBlock-a1b2'), {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
    });

    it('treats an item without an id as unpinned', () => {
      const resolver = createPuckPermissions(mockTemplate, 'editor', false);

      const perms = resolver({ type: 'HeadingBlock', props: {} } as unknown as PuckItem, {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
    });
  });

  describe('with template summary (no component data)', () => {
    const summary: TemplateSummary = {
      id: 'template-1',
      name: 'blog-post',
      label: 'Blog Post',
      version: 1,
      updatedAt: '2026-06-08T00:00:00Z',
    };

    it('should allow full structural permissions for editor', () => {
      const resolver = createPuckPermissions(summary, 'editor', false);

      const perms = resolver(item('HeadingBlock', 'HeadingBlock-a1b2'), {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('should restrict structural ops for junior-editor', () => {
      const resolver = createPuckPermissions(summary, 'junior-editor', false);

      const perms = resolver(item('HeadingBlock', 'HeadingBlock-a1b2'), {} as PuckData);
      expect(perms.drag).toBe(false);
      expect(perms.delete).toBe(false);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(false);
      expect(perms.duplicate).toBe(false);
    });
  });

  describe('without template (blank page)', () => {
    it('should return all-true permissions for admin', () => {
      const resolver = createPuckPermissions(null, 'admin', false);

      const perms = resolver(item('AnyBlock', 'AnyBlock-1'), {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('should return all-true permissions for editor', () => {
      const resolver = createPuckPermissions(null, 'editor', false);

      const perms = resolver(item('AnyBlock', 'AnyBlock-1'), {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('should restrict all structural ops for junior-editor on blank pages', () => {
      const resolver = createPuckPermissions(null, 'junior-editor', false);

      const perms = resolver(item('AnyBlock', 'AnyBlock-1'), {} as PuckData);
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

      const adminPerms = adminResolver(item('ImageBlock', 'ImageBlock-e5f6'), {} as PuckData);
      const editorPerms = editorResolver(item('ImageBlock', 'ImageBlock-e5f6'), {} as PuckData);
      const juniorPerms = juniorResolver(item('HeadingBlock', 'HeadingBlock-a1b2'), {} as PuckData);

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

      const perms = resolver(item('UnknownBlock', 'UnknownBlock-1'), {} as PuckData);
      expect(perms.drag).toBe(true);
      expect(perms.delete).toBe(true);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(true);
      expect(perms.duplicate).toBe(true);
    });

    it('should restrict all structural ops for junior-editor on unknown components', () => {
      const resolver = createPuckPermissions(mockTemplate, 'junior-editor', false);

      const perms = resolver(item('UnknownBlock', 'UnknownBlock-1'), {} as PuckData);
      expect(perms.drag).toBe(false);
      expect(perms.delete).toBe(false);
      expect(perms.edit).toBe(true);
      expect(perms.insert).toBe(false);
      expect(perms.duplicate).toBe(false);
    });
  });
});
