/**
 * useConflictNotifications Hook
 *
 * Hook for managing real-time conflict notifications.
 * Listens to WebSocket events for collaboration conflicts.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePresenceContext } from '../../../core/PresenceContext.js';

/**
 * Type of conflict notification.
 */
export type ConflictNotificationType =
  | 'agent_editing'
  | 'human_conflict'
  | 'agent_checkpoint'
  | 'agent_kicked';

/**
 * A conflict notification.
 */
export interface ConflictNotification {
  id: string;
  type: ConflictNotificationType;
  agentId?: string;
  agentName?: string;
  conflictingRegions?: string[];
  message: string;
  timestamp: string;
}

/**
 * Options for useConflictNotifications hook.
 */
export interface UseConflictNotificationsOptions {
  /** Auto-dismiss checkpoint notifications */
  autoDismissCheckpoints?: boolean;
  /** Auto-dismiss delay in milliseconds */
  autoDismissMs?: number;
}

/**
 * Return type for useConflictNotifications hook.
 */
export interface UseConflictNotificationsReturn {
  /** Active conflict notifications */
  notifications: ConflictNotification[];
  /** Dismiss a notification by ID */
  dismiss: (id: string) => void;
  /** Dismiss all notifications */
  dismissAll: () => void;
}

/**
 * WebSocket event types we listen for.
 */
interface ConflictEvent {
  type: 'conflict' | 'agent_checkpoint' | 'agent_kicked';
  conflictType?: ConflictNotificationType;
  agentId?: string;
  agentName?: string;
  regions?: string[];
  checkpointId?: string;
  reason?: string;
}

/**
 * Generate a unique notification ID.
 */
function generateNotificationId(): string {
  return `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get a human-readable message for a conflict event.
 */
function getConflictMessage(event: ConflictEvent): string {
  if (event.type === 'conflict') {
    switch (event.conflictType) {
      case 'agent_editing':
        return event.agentName
          ? `${event.agentName} is currently editing this region`
          : 'An agent is currently editing this region';
      case 'human_conflict':
        return 'Another user is editing in the same area';
      default:
        return 'A conflict has occurred';
    }
  }

  if (event.type === 'agent_checkpoint') {
    return event.agentName
      ? `${event.agentName} has completed changes and created a checkpoint`
      : 'An agent has completed changes and created a checkpoint';
  }

  if (event.type === 'agent_kicked') {
    return event.agentName
      ? `${event.agentName} edit was interrupted due to human activity`
      : 'Agent edit was interrupted due to human activity';
  }

  return 'A collaboration event occurred';
}

/**
 * Convert a WebSocket event to a ConflictNotification.
 */
function eventToNotification(event: ConflictEvent): ConflictNotification {
  let type: ConflictNotificationType;

  if (event.type === 'conflict') {
    type = event.conflictType ?? 'human_conflict';
  } else if (event.type === 'agent_checkpoint') {
    type = 'agent_checkpoint';
  } else if (event.type === 'agent_kicked') {
    type = 'agent_kicked';
  } else {
    type = 'human_conflict';
  }

  return {
    id: generateNotificationId(),
    type,
    agentId: event.agentId,
    agentName: event.agentName,
    conflictingRegions: event.regions,
    message: getConflictMessage(event),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Hook for managing real-time conflict notifications.
 *
 * Subscribes to the PresenceContext for WebSocket events and
 * maintains a list of active conflict notifications.
 *
 * @example
 * ```tsx
 * function ConflictPanel() {
 *   const { notifications, dismiss, dismissAll } = useConflictNotifications();
 *
 *   return (
 *     <div>
 *       {notifications.map((n) => (
 *         <ConflictNotificationToast
 *           key={n.id}
 *           notification={n}
 *           onDismiss={() => dismiss(n.id)}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useConflictNotifications(
  options: UseConflictNotificationsOptions = {}
): UseConflictNotificationsReturn {
  const { autoDismissCheckpoints = false, autoDismissMs = 5000 } = options;

  const [notifications, setNotifications] = useState<ConflictNotification[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const context = usePresenceContext();

  // Dismiss a notification by ID
  const dismiss = useCallback((id: string) => {
    // Clear any auto-dismiss timer
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Dismiss all notifications
  const dismissAll = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setNotifications([]);
  }, []);

  // Handle incoming events
  const handleEvent = useCallback(
    (event: unknown) => {
      const conflictEvent = event as ConflictEvent;

      // Only handle conflict-related events
      if (
        conflictEvent.type !== 'conflict' &&
        conflictEvent.type !== 'agent_checkpoint' &&
        conflictEvent.type !== 'agent_kicked'
      ) {
        return;
      }

      const notification = eventToNotification(conflictEvent);

      setNotifications((prev) => [...prev, notification]);

      // Set up auto-dismiss for checkpoint notifications
      if (autoDismissCheckpoints && notification.type === 'agent_checkpoint') {
        const timer = setTimeout(() => {
          dismiss(notification.id);
        }, autoDismissMs);
        timersRef.current.set(notification.id, timer);
      }
    },
    [autoDismissCheckpoints, autoDismissMs, dismiss]
  );

  // Subscribe to presence events
  useEffect(() => {
    const unsubscribe = context.subscribe(handleEvent);

    return () => {
      unsubscribe();
      // Clear all timers on unmount
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, [context, handleEvent]);

  return {
    notifications,
    dismiss,
    dismissAll,
  };
}
