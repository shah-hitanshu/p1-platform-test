/**
 * P1PuckProvider Template Integration Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import type { Item as PuckItem, Data as PuckData } from '@puckeditor/core';
import type { P1Client, Document } from '@pantheon-systems/css-client';
import { P1PuckProvider } from '../../../editor/P1PuckProvider.js';
import { useP1Puck } from '../../../core/P1PuckContext.js';
import type { Template } from '../../../features/content-type-templates/types.js';

describe('P1PuckProvider - Template Integration', () => {
  const mockTemplate: Template = {
    id: 'template-1',
    name: 'blog-post',
    label: 'Blog Post',
    version: 3,
    components: [
      { type: 'HeadingBlock', pinned: true, defaultProps: {} },
      { type: 'TextBlock', pinned: false, defaultProps: {} },
    ],
    createdAt: '2026-06-08T00:00:00Z',
    updatedAt: '2026-06-08T00:00:00Z',
  };

  const mockDocument: Document = {
    id: 'doc-1',
    siteId: 'site-1',
    path: '/blog-post',
    archived: false,
    createdAt: '2026-06-08T00:00:00Z',
    updatedAt: '2026-06-08T00:00:00Z',
    templateId: 'template-1',
    templateVersion: 3,
  };

  let mockClient: P1Client;

  beforeEach(() => {
    const baseMockClient = {
      sites: {
        get: vi.fn().mockResolvedValue({ id: 'site-1', name: 'Test Site' }),
      },
      branches: {
        list: vi.fn().mockResolvedValue([
          { id: 'branch-1', name: 'main', isMain: true },
        ]),
        get: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'main', isMain: true }),
      },
      documents: {
        getByPath: vi.fn().mockResolvedValue(mockDocument),
        list: vi.fn().mockResolvedValue([mockDocument]),
      },
      versions: {
        getLatest: vi.fn().mockResolvedValue({
          id: 'ver-1',
          versionNumber: 1,
          snapshot: { root: {}, content: [], zones: {} },
        }),
      },
      templates: {
        get: vi.fn().mockResolvedValue(mockTemplate),
      },
      presence: {
        getBranchPresence: vi.fn().mockResolvedValue({ actors: [], documents: [] }),
      },
      withPrincipal: vi.fn(),
    };

    // withPrincipal returns the same mock client
    baseMockClient.withPrincipal.mockReturnValue(baseMockClient);

    mockClient = baseMockClient as unknown as P1Client;
  });

  it('should fetch template when document has template_id', async () => {
    const { result } = renderHook(() => useP1Puck(), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          userRole="editor"
        >
          {children}
        </P1PuckProvider>
      ),
    });

    // Load document with template binding
    await result.current.loadDocument('/blog-post');

    await waitFor(() => {
      expect(result.current.currentTemplate).toEqual(mockTemplate);
    });

    const templates = mockClient.templates;
    if (!templates) throw new Error('templates endpoint not available');
    expect(templates.get).toHaveBeenCalledWith('site-1', 'branch-1', 'template-1');
  });

  it('exposes createTemplate that creates with empty components and returns the template', async () => {
    const created = { ...mockTemplate, id: 'new-1', name: 'recipes', label: 'Recipes' };
    const templates = mockClient.templates as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    templates.create = vi.fn().mockResolvedValue(created);
    templates.list = vi.fn().mockResolvedValue([created]);

    const { result } = renderHook(() => useP1Puck(), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          userRole="admin"
        >
          {children}
        </P1PuckProvider>
      ),
    });

    const returned = await result.current.createTemplate({
      name: 'recipes',
      label: 'Recipes',
      description: 'Recipe pages',
      defaultUrlPattern: '/recipes/:slug',
    });

    expect(templates.create).toHaveBeenCalledWith('site-1', 'branch-1', {
      name: 'recipes',
      label: 'Recipes',
      description: 'Recipe pages',
      defaultUrlPattern: '/recipes/:slug',
      components: [],
    });
    expect(returned).toEqual(created);
  });

  it('exposes updateTemplate that calls templates.update with the params', async () => {
    const updated = { ...mockTemplate, label: 'Updated' };
    const templates = mockClient.templates as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    templates.update = vi.fn().mockResolvedValue(updated);
    templates.list = vi.fn().mockResolvedValue([updated]);

    const { result } = renderHook(() => useP1Puck(), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          userRole="admin"
        >
          {children}
        </P1PuckProvider>
      ),
    });

    await result.current.updateTemplate('template-1', {
      label: 'Updated',
      description: 'New desc',
      defaultUrlPattern: '/x/:slug',
    });

    expect(templates.update).toHaveBeenCalledWith('site-1', 'branch-1', 'template-1', {
      label: 'Updated',
      description: 'New desc',
      defaultUrlPattern: '/x/:slug',
    });
  });

  it('forwards components to templates.update when provided (complete-template save)', async () => {
    const updated = { ...mockTemplate, label: 'Updated' };
    const templates = mockClient.templates as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    templates.update = vi.fn().mockResolvedValue(updated);
    templates.list = vi.fn().mockResolvedValue([updated]);

    const { result } = renderHook(() => useP1Puck(), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          userRole="admin"
        >
          {children}
        </P1PuckProvider>
      ),
    });

    const components = [
      { type: 'HeadingBlock', pinned: true, defaultProps: { text: 'Hi' } },
    ];
    await result.current.updateTemplate('template-1', {
      label: 'Updated',
      components,
    });

    // The complete-template save sends the canvas-derived components alongside
    // metadata so the backend full-replace can't wipe them.
    expect(templates.update).toHaveBeenCalledWith('site-1', 'branch-1', 'template-1', {
      label: 'Updated',
      components,
    });
  });

  it('should set currentTemplate to null for documents without template_id', async () => {
    const blankDocument = { ...mockDocument, templateId: null, templateVersion: null };
    const documents = mockClient.documents;
    if (!documents) throw new Error('documents endpoint not available');
    vi.mocked(documents.getByPath).mockResolvedValue(blankDocument);

    const { result } = renderHook(() => useP1Puck(), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          userRole="editor"
        >
          {children}
        </P1PuckProvider>
      ),
    });

    await result.current.loadDocument('/blank-page');

    await waitFor(() => {
      expect(result.current.currentTemplate).toBeNull();
    });

    const templates = mockClient.templates;
    if (!templates) throw new Error('templates endpoint not available');
    expect(templates.get).not.toHaveBeenCalled();
  });

  it('should expose resolvePermissions in context', async () => {
    const { result } = renderHook(() => useP1Puck(), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          userRole="editor"
        >
          {children}
        </P1PuckProvider>
      ),
    });

    await result.current.loadDocument('/blog-post');

    // Wait for both resolvePermissions and currentTemplate to be ready
    await waitFor(() => {
      expect(result.current.resolvePermissions).toBeDefined();
      expect(result.current.currentTemplate).toEqual(mockTemplate);
    });

    // Test that resolvePermissions locks pinned components
    const resolvePerms = result.current.resolvePermissions;
    if (!resolvePerms) throw new Error('resolvePermissions not available');
    const pinnedPerms = resolvePerms({ type: 'HeadingBlock' } as PuckItem, {} as PuckData);
    expect(pinnedPerms.drag).toBe(false);
    expect(pinnedPerms.delete).toBe(false);

    // Test that non-pinned components are allowed
    const nonPinnedPerms = resolvePerms({ type: 'TextBlock' } as PuckItem, {} as PuckData);
    expect(nonPinnedPerms.drag).toBe(true);
    expect(nonPinnedPerms.delete).toBe(true);
  });

  it('should expose userRole in context', () => {
    const { result } = renderHook(() => useP1Puck(), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
          userRole="admin"
        >
          {children}
        </P1PuckProvider>
      ),
    });

    expect(result.current.userRole).toBe('admin');
  });

  it('should default userRole to "editor" when not provided', () => {
    const { result } = renderHook(() => useP1Puck(), {
      wrapper: ({ children }) => (
        <P1PuckProvider
          client={mockClient}
          siteId="site-1"
          branchId="branch-1"
          userId="user-1"
        >
          {children}
        </P1PuckProvider>
      ),
    });

    expect(result.current.userRole).toBe('editor');
  });
});
