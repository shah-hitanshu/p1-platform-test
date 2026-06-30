/**
 * templateFromRegistryPath — resolves the template being edited from a document
 * path so the fields override can switch the right sidebar into "Template" mode.
 */

import { describe, it, expect } from 'vitest';
import { templateFromRegistryPath } from '../../editor/plugin/createP1Overrides.js';
import type { Template } from '../../features/content-type-templates/types.js';

const templates: Template[] = [
  { id: 't1', name: 'blog-post', label: 'Blog', version: 1, components: [], updatedAt: '' },
  { id: 't2', name: 'event', label: 'Event', version: 1, components: [], updatedAt: '' },
];

describe('templateFromRegistryPath', () => {
  it('returns the matching template for a _registry/templates/<name> path', () => {
    expect(templateFromRegistryPath('_registry/templates/blog-post', templates)?.id).toBe(
      't1',
    );
  });

  it('returns null for ordinary page paths', () => {
    expect(templateFromRegistryPath('/about', templates)).toBeNull();
    expect(templateFromRegistryPath('blog-post', templates)).toBeNull();
  });

  it('returns null when the template name is unknown', () => {
    expect(templateFromRegistryPath('_registry/templates/nope', templates)).toBeNull();
  });

  it('returns null for empty or missing inputs', () => {
    expect(templateFromRegistryPath(undefined, templates)).toBeNull();
    expect(templateFromRegistryPath('_registry/templates/blog-post', undefined)).toBeNull();
  });
});
