import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

const mockRefreshPermissions = vi.fn().mockResolvedValue(undefined);
const mockResolvePermissions = vi.fn();
let currentResolvePermissions: (() => void) | null = mockResolvePermissions;

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => (selector: (s: unknown) => unknown) =>
    selector({ refreshPermissions: mockRefreshPermissions }),
}));

vi.mock('../../../core/P1PuckContext.js', () => ({
  useP1PuckOptional: () =>
    currentResolvePermissions
      ? { resolvePermissions: currentResolvePermissions }
      : null,
}));

// Import after mocks
const { PermissionRefresher } = await import(
  '../../../editor/plugin/P1Plugin.js'
) as { PermissionRefresher: React.FC };

beforeEach(() => {
  vi.clearAllMocks();
  currentResolvePermissions = mockResolvePermissions;
});

describe('PermissionRefresher', () => {
  it('should not call refreshPermissions on first render', () => {
    render(<PermissionRefresher />);
    expect(mockRefreshPermissions).not.toHaveBeenCalled();
  });

  it('should call refreshPermissions when resolvePermissions reference changes', () => {
    const { rerender } = render(<PermissionRefresher />);
    expect(mockRefreshPermissions).not.toHaveBeenCalled();

    // Simulate a role/template change by providing a new function reference
    const newResolver = vi.fn();
    currentResolvePermissions = newResolver;

    act(() => {
      rerender(<PermissionRefresher />);
    });

    expect(mockRefreshPermissions).toHaveBeenCalledTimes(1);
  });

  it('should not call refreshPermissions when reference stays the same', () => {
    const { rerender } = render(<PermissionRefresher />);

    // Re-render without changing the resolver reference
    act(() => {
      rerender(<PermissionRefresher />);
    });

    expect(mockRefreshPermissions).not.toHaveBeenCalled();
  });

  it('should not call refreshPermissions when css context is null', () => {
    currentResolvePermissions = null;

    const { rerender } = render(<PermissionRefresher />);
    expect(mockRefreshPermissions).not.toHaveBeenCalled();

    currentResolvePermissions = mockResolvePermissions;
    act(() => {
      rerender(<PermissionRefresher />);
    });

    // First real resolver — sets the ref but should not call refresh
    // (ref starts as null, now it's set)
    // Actually this IS a change, so it should call refresh
    // But the initial ref is set to css?.resolvePermissions in useRef,
    // which was null on first render. Now it's mockResolvePermissions.
    // The effect sees a difference and calls refresh.
    expect(mockRefreshPermissions).toHaveBeenCalledTimes(1);
  });
});
