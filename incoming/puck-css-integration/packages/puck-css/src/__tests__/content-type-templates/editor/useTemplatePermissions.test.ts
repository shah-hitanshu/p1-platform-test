/**
 * useTemplatePermissions Hook Tests
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTemplatePermissions } from '../../../features/content-type-templates/editor/useTemplatePermissions.js';

describe('useTemplatePermissions', () => {
  it('returns permissions for admin role', () => {
    const { result } = renderHook(() => useTemplatePermissions('admin', false));
    expect(result.current.canAddComponents).toBe(true);
  });

  it('locks all permissions for historical version', () => {
    const { result } = renderHook(() => useTemplatePermissions('admin', true));
    expect(result.current.canAddComponents).toBe(false);
    expect(result.current.canEditProps).toBe(false);
  });

  it('restricts junior-editor', () => {
    const { result } = renderHook(() => useTemplatePermissions('junior-editor', false));
    expect(result.current.canAddComponents).toBe(false);
    expect(result.current.canEditProps).toBe(true);
  });
});
