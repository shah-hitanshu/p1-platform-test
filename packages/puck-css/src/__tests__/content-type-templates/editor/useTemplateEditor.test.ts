/**
 * useTemplateEditor Hook Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTemplateEditor } from '../../../features/content-type-templates/editor/useTemplateEditor.js';
import type { TemplateStore } from '../../../features/content-type-templates/stores/template-store.js';
import type { Template } from '../../../features/content-type-templates/types.js';

const mockTemplate: Template = {
  id: 'tmpl-1',
  name: 'blog',
  label: 'Blog',
  version: 1,
  components: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('useTemplateEditor', () => {
  let mockStore: TemplateStore;

  beforeEach(() => {
    mockStore = {
      create: vi.fn().mockResolvedValue(mockTemplate),
      get: vi.fn().mockResolvedValue(mockTemplate),
      list: vi.fn().mockResolvedValue([mockTemplate]),
      update: vi.fn().mockResolvedValue({ ...mockTemplate, version: 2 }),
      delete: vi.fn().mockResolvedValue(undefined),
      getBinding: vi.fn().mockResolvedValue(undefined),
      setBinding: vi.fn().mockResolvedValue(undefined),
      listBindings: vi.fn().mockResolvedValue([]),
      removeBinding: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('loads template on mount', async () => {
    const { result } = renderHook(() => useTemplateEditor('tmpl-1', mockStore));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.template).toEqual(mockTemplate);
    expect(mockStore.get).toHaveBeenCalledWith('tmpl-1');
  });

  it('handles loading error', async () => {
    mockStore.get = vi.fn().mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useTemplateEditor('tmpl-1', mockStore));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.template).toBeUndefined();
  });

  it('saves template updates', async () => {
    const { result } = renderHook(() => useTemplateEditor('tmpl-1', mockStore));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.save({ label: 'Updated Blog' });

    expect(mockStore.update).toHaveBeenCalledWith('tmpl-1', { label: 'Updated Blog' });
  });

  it('completes save operation', async () => {
    const { result } = renderHook(() => useTemplateEditor('tmpl-1', mockStore));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.save({ label: 'Updated' });

    expect(mockStore.update).toHaveBeenCalledWith('tmpl-1', { label: 'Updated' });
    expect(result.current.saving).toBe(false);
  });
});
