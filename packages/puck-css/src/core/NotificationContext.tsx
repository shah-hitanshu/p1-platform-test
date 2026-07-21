/**
 * Notification Context
 *
 * React context for managing toast-style notifications.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type {
  Notification,
  NotificationContextValue,
  AddNotificationOptions,
  NotificationSeverity,
} from './types.js';

/**
 * Context for notification management.
 */
export const NotificationContext = createContext<NotificationContextValue | null>(null);

/**
 * Hook to access notification context.
 *
 * @throws Error if used outside of NotificationProvider
 * @returns Notification context value
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { addError, addSuccess } = useNotifications();
 *
 *   const handleSave = async () => {
 *     try {
 *       await save();
 *       addSuccess('Changes saved successfully');
 *     } catch (error) {
 *       addError('Failed to save changes', () => handleSave());
 *     }
 *   };
 * }
 * ```
 */
export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);

  if (context === null) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }

  return context;
}

/**
 * Default auto-dismiss times by severity.
 */
const DEFAULT_AUTO_DISMISS_MS: Record<NotificationSeverity, number> = {
  success: 5000,
  info: 5000,
  warning: 0, // Don't auto-dismiss warnings
  error: 0, // Don't auto-dismiss errors
};

interface NotificationProviderProps {
  children: React.ReactNode;
  /**
   * Maximum number of notifications to show at once.
   * Oldest notifications are removed when limit is exceeded.
   * @default 5
   */
  maxNotifications?: number;
}

/**
 * Generate a unique notification ID.
 */
function generateNotificationId(): string {
  return `notification-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Provider component for notification management.
 *
 * @example
 * ```tsx
 * import { NotificationProvider, NotificationContainer } from '@pantheon-systems/puck-css';
 *
 * function App() {
 *   return (
 *     <NotificationProvider>
 *       <YourApp />
 *       <NotificationContainer />
 *     </NotificationProvider>
 *   );
 * }
 * ```
 */
export function NotificationProvider({
  children,
  maxNotifications = 5,
}: NotificationProviderProps): React.ReactElement {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  // Remove notification by ID
  const removeNotification = useCallback((id: string) => {
    // Clear any existing timer
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Add notification
  const addNotification = useCallback(
    (options: AddNotificationOptions): string => {
      const severity = options.severity ?? 'info';
      const autoDismissMs = options.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS[severity];
      const id = generateNotificationId();

      const notification: Notification = {
        id,
        message: options.message,
        severity,
        title: options.title,
        actions: options.actions,
        autoDismissMs,
        createdAt: new Date(),
      };

      setNotifications((prev) => {
        // Add new notification, then trim to max if needed
        const updated = [...prev, notification];
        if (updated.length > maxNotifications) {
          // Remove oldest notifications that exceed the limit
          const toRemove = updated.slice(0, updated.length - maxNotifications);
          toRemove.forEach((n) => {
            const timer = timersRef.current.get(n.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(n.id);
            }
          });
          return updated.slice(-maxNotifications);
        }
        return updated;
      });

      // Set up auto-dismiss timer if enabled
      if (autoDismissMs > 0) {
        const timer = setTimeout(() => {
          removeNotification(id);
        }, autoDismissMs);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [maxNotifications, removeNotification]
  );

  // Clear all notifications
  const clearNotifications = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setNotifications([]);
  }, []);

  // Convenience method for error notifications with retry
  const addError = useCallback(
    (message: string, onRetry?: () => void): string => {
      const actions = onRetry
        ? [{ label: 'Retry', onClick: onRetry }]
        : undefined;

      return addNotification({
        message,
        severity: 'error',
        title: 'Error',
        actions,
      });
    },
    [addNotification]
  );

  // Convenience method for success notifications
  const addSuccess = useCallback(
    (message: string): string => {
      return addNotification({
        message,
        severity: 'success',
      });
    },
    [addNotification]
  );

  // Convenience method for warning notifications
  const addWarning = useCallback(
    (message: string): string => {
      return addNotification({
        message,
        severity: 'warning',
        title: 'Warning',
      });
    },
    [addNotification]
  );

  // Convenience method for info notifications
  const addInfo = useCallback(
    (message: string): string => {
      return addNotification({
        message,
        severity: 'info',
      });
    },
    [addNotification]
  );

  const contextValue: NotificationContextValue = useMemo(
    () => ({
      notifications,
      addNotification,
      removeNotification,
      clearNotifications,
      addError,
      addSuccess,
      addWarning,
      addInfo,
    }),
    [
      notifications,
      addNotification,
      removeNotification,
      clearNotifications,
      addError,
      addSuccess,
      addWarning,
      addInfo,
    ]
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}
