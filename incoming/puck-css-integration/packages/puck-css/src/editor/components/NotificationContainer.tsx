/**
 * NotificationContainer Component
 *
 * Renders all active notifications in a fixed position container.
 */

import React from 'react';
import { useNotifications } from '../../core/NotificationContext.js';
import { Toast } from './Toast.js';

type NotificationPosition =
  | 'top-right'
  | 'top-left'
  | 'top-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center';

interface NotificationContainerProps {
  /**
   * Position of the notification container.
   * @default 'top-right'
   */
  position?: NotificationPosition;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Container component that renders all active notifications.
 *
 * Place this component once at the root of your app, after the
 * NotificationProvider.
 *
 * @example
 * ```tsx
 * import { NotificationProvider, NotificationContainer } from '@pantheon-systems/puck-css';
 *
 * function App() {
 *   return (
 *     <NotificationProvider>
 *       <YourApp />
 *       <NotificationContainer position="top-right" />
 *     </NotificationProvider>
 *   );
 * }
 * ```
 */
export function NotificationContainer({
  position = 'top-right',
  className = '',
}: NotificationContainerProps): React.ReactElement | null {
  const { notifications, removeNotification } = useNotifications();

  if (notifications.length === 0) {
    return null;
  }

  const baseClass = 'css-puck-notification-container';

  return (
    <div
      className={`${baseClass} ${baseClass}--${position} ${className}`}
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {notifications.map((notification) => (
        <Toast
          key={notification.id}
          notification={notification}
          onDismiss={removeNotification}
        />
      ))}
    </div>
  );
}
