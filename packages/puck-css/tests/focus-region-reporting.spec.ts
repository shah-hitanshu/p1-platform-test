/**
 * Phase 3: Focus Region Reporting Tests (TDD)
 *
 * Tests for useFocusRegionReporting hook and PuckSelectionTracker component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import React from 'react';
import { useFocusRegionReporting } from '../src/hooks/useFocusRegionReporting.js';
import { PuckSelectionTracker } from '../src/components/PuckSelectionTracker.js';
import { PresenceContext } from '../src/PresenceContext.js';
import type { CSSClient } from '@pantheon/css-client';

// Mock Puck's createUsePuck
const mockUsePuckReturn = {
  appState: {
    ui: {
      itemSelector: null as { zone: string; index: number } | null,
    },
  },
  selectedItem: null as { type: string; props: { id: string } } | null,
};

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => (selector: (state: typeof mockUsePuckReturn) => unknown) => {
    return selector(mockUsePuckReturn);
  },
}));

// =============================================================================
// Mock Client Factory
// =============================================================================

function createMockClient(overrides: Partial<CSSClient> = {}): CSSClient {
  return {
    presence: {
      getSitePresence: vi.fn(),
      getBranchPresence: vi.fn(),
      getAgentPresence: vi.fn(),
      updateFocusRegions: vi.fn().mockResolvedValue({
        success: true,
        focusRegions: [],
      }),
    },
    sites: {} as CSSClient['sites'],
    branches: {} as CSSClient['branches'],
    documents: {} as CSSClient['documents'],
    versions: {} as CSSClient['versions'],
    checkpoints: {} as CSSClient['checkpoints'],
    agents: {} as CSSClient['agents'],
    agentEdits: {} as CSSClient['agentEdits'],
    withPrincipal: vi.fn(),
    ...overrides,
  } as unknown as CSSClient;
}

// =============================================================================
// Test Wrapper
// =============================================================================

function createWrapper(client: CSSClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      PresenceContext.Provider,
      {
        value: {
          client,
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: '/home',
          userId: 'user-123',
        },
      },
      children
    );
  };
}

// =============================================================================
// useFocusRegionReporting Tests
// =============================================================================

describe('useFocusRegionReporting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with empty focus regions', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useFocusRegionReporting(), {
        wrapper: createWrapper(client),
      });

      expect(result.current.focusRegions).toEqual([]);
      expect(result.current.isReporting).toBe(false);
    });

    it('should not report when disabled', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useFocusRegionReporting({ enabled: false }),
        { wrapper: createWrapper(client) }
      );

      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });

      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();
    });
  });

  describe('setFocusRegions', () => {
    it('should update local state immediately', () => {
      const client = createMockClient();
      const { result } = renderHook(() => useFocusRegionReporting(), {
        wrapper: createWrapper(client),
      });

      act(() => {
        result.current.setFocusRegions(['/content/0', '/content/1']);
      });

      expect(result.current.focusRegions).toEqual(['/content/0', '/content/1']);
    });

    it('should debounce API calls', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 300 }),
        { wrapper: createWrapper(client) }
      );

      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });

      // No call yet
      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();

      // Multiple rapid changes
      act(() => {
        result.current.setFocusRegions(['/content/1']);
      });
      act(() => {
        result.current.setFocusRegions(['/content/2']);
      });

      // Still no call
      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();

      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      // Now called once with the last value
      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(1);
      expect(client.presence.updateFocusRegions).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        ['/content/2']
      );
    });

    it('should set isReporting to true during API call', async () => {
      const resolvePromise = { resolve: (_v: unknown) => {} };
      const client = createMockClient({
        presence: {
          ...createMockClient().presence,
          updateFocusRegions: vi.fn().mockReturnValue(
            new Promise((resolve) => {
              resolvePromise.resolve = resolve;
            })
          ),
        } as unknown as CSSClient['presence'],
      });

      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100 }),
        { wrapper: createWrapper(client) }
      );

      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current.isReporting).toBe(true);

      await act(async () => {
        resolvePromise.resolve({ success: true, focusRegions: ['/content/0'] });
      });

      expect(result.current.isReporting).toBe(false);
    });
  });

  describe('clearFocus', () => {
    it('should clear focus regions and send empty array', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100 }),
        { wrapper: createWrapper(client) }
      );

      // Set some focus
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Clear focus
      act(() => {
        result.current.clearFocus();
      });

      expect(result.current.focusRegions).toEqual([]);

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(client.presence.updateFocusRegions).toHaveBeenLastCalledWith(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        []
      );
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat at configured interval', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () =>
          useFocusRegionReporting({
            debounceMs: 100,
            heartbeatMs: 5000,
          }),
        { wrapper: createWrapper(client) }
      );

      // Set focus
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(1);

      // Advance to heartbeat interval
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Should have sent heartbeat
      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(2);
      expect(client.presence.updateFocusRegions).toHaveBeenLastCalledWith(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        ['/content/0']
      );
    });

    it('should not send heartbeat when focus is empty', async () => {
      const client = createMockClient();
      renderHook(
        () =>
          useFocusRegionReporting({
            debounceMs: 100,
            heartbeatMs: 5000,
          }),
        { wrapper: createWrapper(client) }
      );

      // Advance past multiple heartbeat intervals
      await act(async () => {
        vi.advanceTimersByTime(15000);
      });

      // No calls should be made
      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();
    });

    it('should not send heartbeat when disabled', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () =>
          useFocusRegionReporting({
            enabled: false,
            debounceMs: 100,
            heartbeatMs: 5000,
          }),
        { wrapper: createWrapper(client) }
      );

      // Set focus (won't report since disabled)
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });

      // Advance past heartbeat
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();
    });
  });

  describe('unmount cleanup', () => {
    it('should clear focus on unmount', async () => {
      const client = createMockClient();
      const { result, unmount } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100 }),
        { wrapper: createWrapper(client) }
      );

      // Set focus
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(1);

      // Unmount
      unmount();

      // Should send clear on unmount (synchronously, not debounced)
      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(2);
      expect(client.presence.updateFocusRegions).toHaveBeenLastCalledWith(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        []
      );
    });

    it('should cancel pending debounced calls on unmount', async () => {
      const client = createMockClient();
      const { result, unmount } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 500 }),
        { wrapper: createWrapper(client) }
      );

      // Set focus but don't wait for debounce
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });

      // Unmount before debounce fires
      unmount();

      // Advance timer
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Should only have the clear call from unmount
      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(1);
      expect(client.presence.updateFocusRegions).toHaveBeenLastCalledWith(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        []
      );
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const client = createMockClient({
        presence: {
          ...createMockClient().presence,
          updateFocusRegions: vi.fn().mockRejectedValue(new Error('Network error')),
        } as unknown as CSSClient['presence'],
      });

      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100 }),
        { wrapper: createWrapper(client) }
      );

      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Should not throw, just continue with local state
      expect(result.current.focusRegions).toEqual(['/content/0']);
      expect(result.current.isReporting).toBe(false);
    });
  });

  describe('WebSocket-first reporting', () => {
    it('should accept sendViaWebSocket option', () => {
      const client = createMockClient();
      const sendViaWebSocket = vi.fn().mockReturnValue(true);
      const { result } = renderHook(
        () => useFocusRegionReporting({ sendViaWebSocket }),
        { wrapper: createWrapper(client) }
      );

      expect(result.current).toBeDefined();
    });

    it('should try WebSocket first when sendViaWebSocket is provided', async () => {
      const client = createMockClient();
      const sendViaWebSocket = vi.fn().mockReturnValue(true);
      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100, sendViaWebSocket }),
        { wrapper: createWrapper(client) }
      );

      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // WebSocket should be called
      expect(sendViaWebSocket).toHaveBeenCalledWith(['/content/0']);
      // HTTP should NOT be called since WebSocket succeeded
      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();
    });

    it('should fall back to HTTP when WebSocket returns false', async () => {
      const client = createMockClient();
      const sendViaWebSocket = vi.fn().mockReturnValue(false);
      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100, sendViaWebSocket }),
        { wrapper: createWrapper(client) }
      );

      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // WebSocket should be tried first
      expect(sendViaWebSocket).toHaveBeenCalledWith(['/content/0']);
      // HTTP fallback should be called since WebSocket failed
      expect(client.presence.updateFocusRegions).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        ['/content/0']
      );
    });

    it('should use WebSocket for heartbeat when available', async () => {
      const client = createMockClient();
      const sendViaWebSocket = vi.fn().mockReturnValue(true);
      const { result } = renderHook(
        () =>
          useFocusRegionReporting({
            debounceMs: 100,
            heartbeatMs: 5000,
            sendViaWebSocket,
          }),
        { wrapper: createWrapper(client) }
      );

      // Set focus
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(sendViaWebSocket).toHaveBeenCalledTimes(1);
      sendViaWebSocket.mockClear();

      // Advance to heartbeat interval
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Heartbeat should use WebSocket
      expect(sendViaWebSocket).toHaveBeenCalledWith(['/content/0']);
      // HTTP should not be called
      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();
    });

    it('should use WebSocket for clearFocus when available', async () => {
      const client = createMockClient();
      const sendViaWebSocket = vi.fn().mockReturnValue(true);
      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100, sendViaWebSocket }),
        { wrapper: createWrapper(client) }
      );

      // Set focus first
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      sendViaWebSocket.mockClear();

      // Clear focus
      act(() => {
        result.current.clearFocus();
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // WebSocket should be called with empty array
      expect(sendViaWebSocket).toHaveBeenCalledWith([]);
      // HTTP should not be called
      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();
    });

    it('should still deduplicate when using WebSocket', async () => {
      const client = createMockClient();
      const sendViaWebSocket = vi.fn().mockReturnValue(true);
      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100, sendViaWebSocket }),
        { wrapper: createWrapper(client) }
      );

      // Set focus
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(sendViaWebSocket).toHaveBeenCalledTimes(1);

      // Set same focus again
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Should not call again (deduplication)
      expect(sendViaWebSocket).toHaveBeenCalledTimes(1);
    });

    it('should try WebSocket on unmount cleanup', async () => {
      const client = createMockClient();
      const sendViaWebSocket = vi.fn().mockReturnValue(true);
      const { result, unmount } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100, sendViaWebSocket }),
        { wrapper: createWrapper(client) }
      );

      // Set focus
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      sendViaWebSocket.mockClear();

      // Unmount
      unmount();

      // Should try WebSocket for cleanup
      expect(sendViaWebSocket).toHaveBeenCalledWith([]);
      // HTTP should not be called if WebSocket succeeded
      expect(client.presence.updateFocusRegions).not.toHaveBeenCalled();
    });

    it('should fall back to HTTP on unmount if WebSocket fails', async () => {
      const client = createMockClient();
      const sendViaWebSocket = vi.fn().mockReturnValue(false);
      const { result, unmount } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100, sendViaWebSocket }),
        { wrapper: createWrapper(client) }
      );

      // Set focus
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      (client.presence.updateFocusRegions as ReturnType<typeof vi.fn>).mockClear();

      // Unmount
      unmount();

      // Should try WebSocket first
      expect(sendViaWebSocket).toHaveBeenCalledWith([]);
      // HTTP fallback should be called
      expect(client.presence.updateFocusRegions).toHaveBeenCalledWith(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        []
      );
    });
  });

  describe('deduplication', () => {
    it('should not report if regions have not changed', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100 }),
        { wrapper: createWrapper(client) }
      );

      // Set focus
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(1);

      // Set same focus again
      act(() => {
        result.current.setFocusRegions(['/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Should not have called again
      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(1);
    });

    it('should report when regions order changes', async () => {
      const client = createMockClient();
      const { result } = renderHook(
        () => useFocusRegionReporting({ debounceMs: 100 }),
        { wrapper: createWrapper(client) }
      );

      // Set focus with order A, B
      act(() => {
        result.current.setFocusRegions(['/content/0', '/content/1']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Set focus with order B, A (different)
      act(() => {
        result.current.setFocusRegions(['/content/1', '/content/0']);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Should have called twice (order matters for overlap detection)
      expect(client.presence.updateFocusRegions).toHaveBeenCalledTimes(2);
    });
  });
});

// =============================================================================
// PuckSelectionTracker Tests
// =============================================================================

describe('PuckSelectionTracker', () => {
  beforeEach(() => {
    // Reset mock state
    mockUsePuckReturn.appState.ui.itemSelector = null;
    mockUsePuckReturn.selectedItem = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render nothing (null)', () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      React.createElement(PuckSelectionTracker, { onSelectionChange })
    );

    expect(container.innerHTML).toBe('');
  });

  it('should call onSelectionChange with null when no selection', () => {
    const onSelectionChange = vi.fn();
    render(React.createElement(PuckSelectionTracker, { onSelectionChange }));

    // Initial render with no selection
    expect(onSelectionChange).toHaveBeenCalledWith(null, null);
  });

  it('should call onSelectionChange with path when item is selected', () => {
    const onSelectionChange = vi.fn();

    // Set up mock selection
    mockUsePuckReturn.appState.ui.itemSelector = { zone: 'content', index: 0 };
    mockUsePuckReturn.selectedItem = { type: 'Text', props: { id: 'item-1' } };

    render(React.createElement(PuckSelectionTracker, { onSelectionChange }));

    expect(onSelectionChange).toHaveBeenCalledWith('/content/0', 'item-1');
  });

  it('should handle zone selection with nested paths', () => {
    const onSelectionChange = vi.fn();

    // Set up mock selection in a zone
    mockUsePuckReturn.appState.ui.itemSelector = { zone: 'zones:Header:left', index: 2 };
    mockUsePuckReturn.selectedItem = { type: 'Button', props: { id: 'btn-1' } };

    render(React.createElement(PuckSelectionTracker, { onSelectionChange }));

    expect(onSelectionChange).toHaveBeenCalledWith('/zones/Header/left/2', 'btn-1');
  });

  it('should handle root content zone', () => {
    const onSelectionChange = vi.fn();

    mockUsePuckReturn.appState.ui.itemSelector = { zone: 'content', index: 5 };
    mockUsePuckReturn.selectedItem = { type: 'Hero', props: { id: 'hero-1' } };

    render(React.createElement(PuckSelectionTracker, { onSelectionChange }));

    expect(onSelectionChange).toHaveBeenCalledWith('/content/5', 'hero-1');
  });
});
