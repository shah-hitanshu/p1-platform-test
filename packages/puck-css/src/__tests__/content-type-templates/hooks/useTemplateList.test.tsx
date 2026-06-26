/**
 * useTemplateList Hook Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { P1Client } from '@pantheon-systems/css-client';
import { useTemplateList } from '../../../features/content-type-templates/hooks/useTemplateList.js';
import type { Template } from '../../../features/content-type-templates/types.js';

describe('useTemplateList', () => {
  const mockTemplates: Template[] = [
    {
      id: 'template-1',
      name: 'blog-post',
      label: 'Blog Post',
      description: 'Standard blog post layout',
      defaultUrlPattern: '/blog/:slug',
      version: 1,
      components: [
        { type: 'HeadingBlock', pinned: true, defaultProps: {} },
        { type: 'TextBlock', pinned: false, defaultProps: {} },
      ],
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T00:00:00Z',
    },
    {
      id: 'template-2',
      name: 'landing-page',
      label: 'Landing Page',
      description: 'Marketing landing page',
      defaultUrlPattern: '/landing/:slug',
      version: 2,
      components: [
        { type: 'HeroBlock', pinned: true, defaultProps: {} },
        { type: 'CTABlock', pinned: true, defaultProps: {} },
      ],
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T00:00:00Z',
    },
  ];

  let mockClient: P1Client;

  beforeEach(() => {
    mockClient = {
      templates: {
        list: vi.fn(),
      },
    } as unknown as P1Client;
  });

  it('should return loading state initially', () => {
    const templates = mockClient.templates;
    if (!templates) throw new Error('templates endpoint not available');
    vi.mocked(templates.list).mockReturnValue(new Promise(() => {
      // Never resolves
    }));

    const { result } = renderHook(() =>
      useTemplateList(mockClient, 'site-1', 'branch-1')
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.templates).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should return templates after successful fetch', async () => {
    const templates = mockClient.templates;
    if (!templates) throw new Error('templates endpoint not available');
    vi.mocked(templates.list).mockResolvedValue(mockTemplates);

    const { result } = renderHook(() =>
      useTemplateList(mockClient, 'site-1', 'branch-1')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.templates).toEqual(mockTemplates);
    expect(result.current.error).toBeNull();
    expect(templates.list).toHaveBeenCalledWith('site-1', 'branch-1');
  });

  it('should return error on fetch failure', async () => {
    const mockError = new Error('Failed to fetch templates');
    const templates = mockClient.templates;
    if (!templates) throw new Error('templates endpoint not available');
    vi.mocked(templates.list).mockRejectedValue(mockError);

    const { result } = renderHook(() =>
      useTemplateList(mockClient, 'site-1', 'branch-1')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.templates).toEqual([]);
    expect(result.current.error).toBe(mockError);
  });

  it('should refetch templates when refresh is called', async () => {
    const templates = mockClient.templates;
    if (!templates) throw new Error('templates endpoint not available');
    vi.mocked(templates.list)
      .mockResolvedValueOnce([mockTemplates[0]])
      .mockResolvedValueOnce(mockTemplates);

    const { result } = renderHook(() =>
      useTemplateList(mockClient, 'site-1', 'branch-1')
    );

    await waitFor(() => {
      expect(result.current.templates).toEqual([mockTemplates[0]]);
    });

    // Call refresh
    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.templates).toEqual(mockTemplates);
    });

    expect(templates.list).toHaveBeenCalledTimes(2);
  });

  it('should refetch when siteId or branchId changes', async () => {
    const templates = mockClient.templates;
    if (!templates) throw new Error('templates endpoint not available');
    vi.mocked(templates.list).mockResolvedValue(mockTemplates);

    const { result, rerender } = renderHook(
      ({ siteId, branchId }) => useTemplateList(mockClient, siteId, branchId),
      {
        initialProps: { siteId: 'site-1', branchId: 'branch-1' },
      }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(templates.list).toHaveBeenCalledWith('site-1', 'branch-1');

    // Change branchId
    rerender({ siteId: 'site-1', branchId: 'branch-2' });

    await waitFor(() => {
      expect(templates.list).toHaveBeenCalledWith('site-1', 'branch-2');
    });

    expect(templates.list).toHaveBeenCalledTimes(2);
  });
});
