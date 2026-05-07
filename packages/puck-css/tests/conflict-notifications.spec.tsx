/**
 * Phase 7: Conflict Notification System Tests (TDD)
 *
 * Tests for useConflictNotifications hook and ConflictNotificationToast component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import React from 'react';
import {
  useConflictNotifications,
  ConflictNotificationToast,
} from '../src/merge/components/conflict-notifications/index.js';
import type { ConflictNotification } from '../src/merge/components/conflict-notifications/index.js';
import { PresenceContext } from '../src/core/PresenceContext.js';
import type { PresenceContextValue } from '../src/core/PresenceContext.js';

// =============================================================================
// Mock Data
// =============================================================================

const mockAgentEditingNotification: ConflictNotification = {
  id: 'conflict-1',
  type: 'agent_editing',
  agentId: 'agent-123',
  agentName: 'Layout Optimizer',
  conflictingRegions: ['/content/0', '/content/1'],
  message: 'An agent is currently editing this region',
  timestamp: '2026-01-27T10:00:00Z',
};

const mockHumanConflictNotification: ConflictNotification = {
  id: 'conflict-2',
  type: 'human_conflict',
  message: 'Another user is editing in the same area',
  timestamp: '2026-01-27T10:01:00Z',
  conflictingRegions: ['/content/2'],
};

const mockAgentCheckpointNotification: ConflictNotification = {
  id: 'conflict-3',
  type: 'agent_checkpoint',
  agentId: 'agent-456',
  agentName: 'Content Generator',
  message: 'Agent has completed changes and created a checkpoint',
  timestamp: '2026-01-27T10:02:00Z',
};

const mockAgentKickedNotification: ConflictNotification = {
  id: 'conflict-4',
  type: 'agent_kicked',
  agentId: 'agent-123',
  agentName: 'Layout Optimizer',
  message: 'Agent edit was interrupted due to human activity',
  timestamp: '2026-01-27T10:03:00Z',
};

// =============================================================================
// Mock Presence Context
// =============================================================================

function createMockPresenceContext(
  overrides: Partial<PresenceContextValue> = {}
): PresenceContextValue {
  return {
    client: null,
    siteId: 'site-1',
    branchId: 'branch-1',
    documentPath: '/test',
    currentUserId: 'user-1',
    isConnected: true,
    presence: [],
    activeAgents: [],
    agentEditingRegions: [],
    isAgentEditing: false,
    canEdit: vi.fn().mockResolvedValue({ allowed: true }),
    startEdit: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
    completeEdit: vi.fn().mockResolvedValue({ success: true }),
    abortEdit: vi.fn().mockResolvedValue({ success: true }),
    subscribe: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

function createWrapper(contextValue: PresenceContextValue) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <PresenceContext.Provider value={contextValue}>
        {children}
      </PresenceContext.Provider>
    );
  };
}

// =============================================================================
// useConflictNotifications Hook Tests
// =============================================================================

describe('useConflictNotifications', () => {
  let mockContext: PresenceContextValue;
  let subscribeCallback: ((event: unknown) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    subscribeCallback = null;
    mockContext = createMockPresenceContext({
      subscribe: vi.fn((callback) => {
        subscribeCallback = callback;
        return () => {
          subscribeCallback = null;
        };
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should return empty notifications array initially', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      expect(result.current.notifications).toEqual([]);
    });

    it('should subscribe to presence events on mount', () => {
      renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      expect(mockContext.subscribe).toHaveBeenCalled();
    });

    it('should unsubscribe on unmount', () => {
      const unsubscribe = vi.fn();
      mockContext = createMockPresenceContext({
        subscribe: vi.fn().mockReturnValue(unsubscribe),
      });

      const { unmount } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('receiving conflict events', () => {
    it('should add notification when agent_editing event is received', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      act(() => {
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'agent_editing',
          agentId: 'agent-123',
          agentName: 'Layout Optimizer',
          regions: ['/content/0'],
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].type).toBe('agent_editing');
      expect(result.current.notifications[0].agentName).toBe('Layout Optimizer');
    });

    it('should add notification when human_conflict event is received', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      act(() => {
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'human_conflict',
          regions: ['/content/2'],
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].type).toBe('human_conflict');
    });

    it('should add notification when agent_checkpoint event is received', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      act(() => {
        subscribeCallback?.({
          type: 'agent_checkpoint',
          agentId: 'agent-456',
          agentName: 'Content Generator',
          checkpointId: 'cp-1',
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].type).toBe('agent_checkpoint');
    });

    it('should add notification when agent_kicked event is received', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      act(() => {
        subscribeCallback?.({
          type: 'agent_kicked',
          agentId: 'agent-123',
          agentName: 'Layout Optimizer',
          reason: 'human_activity',
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].type).toBe('agent_kicked');
    });

    it('should generate unique IDs for each notification', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      act(() => {
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'agent_editing',
          agentId: 'agent-1',
          agentName: 'Agent 1',
          regions: [],
        });
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'agent_editing',
          agentId: 'agent-2',
          agentName: 'Agent 2',
          regions: [],
        });
      });

      expect(result.current.notifications).toHaveLength(2);
      expect(result.current.notifications[0].id).not.toBe(
        result.current.notifications[1].id
      );
    });
  });

  describe('dismiss', () => {
    it('should remove a notification by ID', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      act(() => {
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'agent_editing',
          agentId: 'agent-1',
          agentName: 'Agent 1',
          regions: [],
        });
      });

      const notificationId = result.current.notifications[0].id;

      act(() => {
        result.current.dismiss(notificationId);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should not affect other notifications when dismissing', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      act(() => {
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'agent_editing',
          agentId: 'agent-1',
          agentName: 'Agent 1',
          regions: [],
        });
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'human_conflict',
          regions: ['/content/0'],
        });
      });

      const firstId = result.current.notifications[0].id;

      act(() => {
        result.current.dismiss(firstId);
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].type).toBe('human_conflict');
    });
  });

  describe('dismissAll', () => {
    it('should remove all notifications', () => {
      const { result } = renderHook(() => useConflictNotifications(), {
        wrapper: createWrapper(mockContext),
      });

      act(() => {
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'agent_editing',
          agentId: 'agent-1',
          agentName: 'Agent 1',
          regions: [],
        });
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'human_conflict',
          regions: [],
        });
        subscribeCallback?.({
          type: 'agent_checkpoint',
          agentId: 'agent-2',
          agentName: 'Agent 2',
        });
      });

      expect(result.current.notifications).toHaveLength(3);

      act(() => {
        result.current.dismissAll();
      });

      expect(result.current.notifications).toHaveLength(0);
    });
  });

  describe('auto-dismiss', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should auto-dismiss agent_checkpoint notifications after delay', async () => {
      const { result } = renderHook(
        () => useConflictNotifications({ autoDismissCheckpoints: true, autoDismissMs: 5000 }),
        { wrapper: createWrapper(mockContext) }
      );

      act(() => {
        subscribeCallback?.({
          type: 'agent_checkpoint',
          agentId: 'agent-1',
          agentName: 'Agent 1',
        });
      });

      expect(result.current.notifications).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should not auto-dismiss conflict notifications by default', async () => {
      const { result } = renderHook(
        () => useConflictNotifications(),
        { wrapper: createWrapper(mockContext) }
      );

      act(() => {
        subscribeCallback?.({
          type: 'conflict',
          conflictType: 'agent_editing',
          agentId: 'agent-1',
          agentName: 'Agent 1',
          regions: [],
        });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(result.current.notifications).toHaveLength(1);
    });
  });
});

// =============================================================================
// ConflictNotificationToast Component Tests
// =============================================================================

describe('ConflictNotificationToast', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should display notification message', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      expect(
        screen.getByText('An agent is currently editing this region')
      ).toBeInTheDocument();
    });

    it('should display agent name for agent notifications', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      expect(screen.getByText('Layout Optimizer')).toBeInTheDocument();
    });

    it('should display conflicting regions', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      expect(screen.getByText('/content/0')).toBeInTheDocument();
      expect(screen.getByText('/content/1')).toBeInTheDocument();
    });

    it('should apply correct CSS class for notification type', () => {
      const { container } = render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      expect(container.firstChild).toHaveClass(
        'css-puck-conflict-toast--agent_editing'
      );
    });
  });

  describe('different notification types', () => {
    it('should render agent_editing notification with warning style', () => {
      const { container } = render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      expect(container.firstChild).toHaveClass('css-puck-conflict-toast--agent_editing');
    });

    it('should render human_conflict notification', () => {
      render(
        <ConflictNotificationToast
          notification={mockHumanConflictNotification}
          onDismiss={() => {}}
        />
      );

      expect(
        screen.getByText('Another user is editing in the same area')
      ).toBeInTheDocument();
    });

    it('should render agent_checkpoint notification with success style', () => {
      const { container } = render(
        <ConflictNotificationToast
          notification={mockAgentCheckpointNotification}
          onDismiss={() => {}}
        />
      );

      expect(container.firstChild).toHaveClass('css-puck-conflict-toast--agent_checkpoint');
    });

    it('should render agent_kicked notification', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentKickedNotification}
          onDismiss={() => {}}
        />
      );

      expect(
        screen.getByText('Agent edit was interrupted due to human activity')
      ).toBeInTheDocument();
    });
  });

  describe('dismiss behavior', () => {
    it('should call onDismiss when dismiss button is clicked', () => {
      const onDismiss = vi.fn();
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={onDismiss}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

      expect(onDismiss).toHaveBeenCalledWith('conflict-1');
    });
  });

  describe('action button', () => {
    it('should render action button when onAction is provided', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
          onAction={() => {}}
          actionLabel="View Changes"
        />
      );

      expect(
        screen.getByRole('button', { name: 'View Changes' })
      ).toBeInTheDocument();
    });

    it('should call onAction when action button is clicked', () => {
      const onAction = vi.fn();
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
          onAction={onAction}
          actionLabel="View Changes"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'View Changes' }));

      expect(onAction).toHaveBeenCalled();
    });

    it('should not render action button when onAction is not provided', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      expect(
        screen.queryByRole('button', { name: 'View Changes' })
      ).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have role="alert"', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should have aria-live attribute', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live');
    });
  });

  describe('icon display', () => {
    it('should show agent icon for agent-related notifications', () => {
      render(
        <ConflictNotificationToast
          notification={mockAgentEditingNotification}
          onDismiss={() => {}}
        />
      );

      // Should have some visual indicator for agent
      const icon = screen.getByLabelText(/agent|conflict/i);
      expect(icon).toBeInTheDocument();
    });
  });
});
