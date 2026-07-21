/**
 * useContentRole Hook Tests
 *
 * Tests for the useContentRole React hook.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useContentRole } from '../../../features/content-type-templates/permissions/useContentRole.js';
import type { ContentRole } from '../../../features/content-type-templates/types.js';

describe('useContentRole', () => {
  it('returns admin role when provided', () => {
    const { result } = renderHook(() => useContentRole('admin'));
    expect(result.current.role).toBe('admin');
    expect(result.current.permissions.canAddComponents).toBe(true);
  });

  it('returns editor role when provided', () => {
    const { result } = renderHook(() => useContentRole('editor'));
    expect(result.current.role).toBe('editor');
    expect(result.current.permissions.canAddComponents).toBe(true);
  });

  it('returns junior-editor role when provided', () => {
    const { result } = renderHook(() => useContentRole('junior-editor'));
    expect(result.current.role).toBe('junior-editor');
    expect(result.current.permissions.canAddComponents).toBe(false);
  });

  it('defaults to admin when no role provided', () => {
    const { result } = renderHook(() => useContentRole());
    expect(result.current.role).toBe('admin');
  });

  it('memoizes permissions for same role', () => {
    const { result, rerender } = renderHook(
      ({ role }: { role: ContentRole }) => useContentRole(role),
      { initialProps: { role: 'admin' as ContentRole } }
    );

    const firstPerms = result.current.permissions;
    rerender({ role: 'admin' });
    const secondPerms = result.current.permissions;

    expect(firstPerms).toBe(secondPerms);
  });
});
