/**
 * NotificationContext Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { NotificationProvider, useNotifications } from '../src/core/NotificationContext.js';
import React from 'react';

// Test component that uses the notification hook
function TestComponent() {
  const {
    notifications,
    addNotification,
    removeNotification,
    clearNotifications,
    addError,
    addSuccess,
    addWarning,
    addInfo,
  } = useNotifications();

  return (
    <div>
      <div data-testid="notification-count">{notifications.length}</div>
      <ul data-testid="notification-list">
        {notifications.map((n) => (
          <li key={n.id} data-testid={`notification-${n.id}`}>
            {n.severity}: {n.message}
          </li>
        ))}
      </ul>
      <button
        onClick={() => addNotification({ message: 'Test notification' })}
        data-testid="add-notification"
      >
        Add Notification
      </button>
      <button onClick={() => addError('Error message')} data-testid="add-error">
        Add Error
      </button>
      <button
        onClick={() => addError('Error with retry', () => console.log('retry'))}
        data-testid="add-error-retry"
      >
        Add Error with Retry
      </button>
      <button onClick={() => addSuccess('Success message')} data-testid="add-success">
        Add Success
      </button>
      <button onClick={() => addWarning('Warning message')} data-testid="add-warning">
        Add Warning
      </button>
      <button onClick={() => addInfo('Info message')} data-testid="add-info">
        Add Info
      </button>
      <button onClick={() => clearNotifications()} data-testid="clear-all">
        Clear All
      </button>
      <button
        onClick={() => {
          if (notifications.length > 0) {
            removeNotification(notifications[0].id);
          }
        }}
        data-testid="remove-first"
      >
        Remove First
      </button>
    </div>
  );
}

describe('NotificationContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should throw error when used outside of NotificationProvider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<TestComponent />)).toThrow(
      'useNotifications must be used within a NotificationProvider'
    );

    consoleSpy.mockRestore();
  });

  it('should start with no notifications', () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    expect(screen.getByTestId('notification-count').textContent).toBe('0');
  });

  it('should add a notification', () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-notification'));

    expect(screen.getByTestId('notification-count').textContent).toBe('1');
    expect(screen.getByText(/info: Test notification/)).toBeInTheDocument();
  });

  it('should add an error notification', () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-error'));

    expect(screen.getByTestId('notification-count').textContent).toBe('1');
    expect(screen.getByText(/error: Error message/)).toBeInTheDocument();
  });

  it('should add a success notification', () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-success'));

    expect(screen.getByTestId('notification-count').textContent).toBe('1');
    expect(screen.getByText(/success: Success message/)).toBeInTheDocument();
  });

  it('should add a warning notification', () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-warning'));

    expect(screen.getByTestId('notification-count').textContent).toBe('1');
    expect(screen.getByText(/warning: Warning message/)).toBeInTheDocument();
  });

  it('should add an info notification', () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-info'));

    expect(screen.getByTestId('notification-count').textContent).toBe('1');
    expect(screen.getByText(/info: Info message/)).toBeInTheDocument();
  });

  it('should remove a notification', () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-notification'));
    expect(screen.getByTestId('notification-count').textContent).toBe('1');

    fireEvent.click(screen.getByTestId('remove-first'));
    expect(screen.getByTestId('notification-count').textContent).toBe('0');
  });

  it('should clear all notifications', () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-error'));
    fireEvent.click(screen.getByTestId('add-success'));
    fireEvent.click(screen.getByTestId('add-warning'));
    expect(screen.getByTestId('notification-count').textContent).toBe('3');

    fireEvent.click(screen.getByTestId('clear-all'));
    expect(screen.getByTestId('notification-count').textContent).toBe('0');
  });

  it('should limit notifications to maxNotifications', () => {
    render(
      <NotificationProvider maxNotifications={2}>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-notification'));
    fireEvent.click(screen.getByTestId('add-error'));
    fireEvent.click(screen.getByTestId('add-success'));

    // Should only have 2 notifications (the last 2)
    expect(screen.getByTestId('notification-count').textContent).toBe('2');
    // First notification should be removed
    expect(screen.queryByText(/info: Test notification/)).not.toBeInTheDocument();
    // Last two should remain
    expect(screen.getByText(/error: Error message/)).toBeInTheDocument();
    expect(screen.getByText(/success: Success message/)).toBeInTheDocument();
  });

  it('should auto-dismiss success notifications', async () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-success'));
    expect(screen.getByTestId('notification-count').textContent).toBe('1');

    // Fast forward past auto-dismiss time (5000ms default)
    act(() => {
      vi.advanceTimersByTime(5100);
    });

    expect(screen.getByTestId('notification-count').textContent).toBe('0');
  });

  it('should not auto-dismiss error notifications', async () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-error'));
    expect(screen.getByTestId('notification-count').textContent).toBe('1');

    // Fast forward well past success auto-dismiss time
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Error should still be there
    expect(screen.getByTestId('notification-count').textContent).toBe('1');
  });

  it('should not auto-dismiss warning notifications', async () => {
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByTestId('add-warning'));
    expect(screen.getByTestId('notification-count').textContent).toBe('1');

    // Fast forward well past success auto-dismiss time
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Warning should still be there
    expect(screen.getByTestId('notification-count').textContent).toBe('1');
  });
});
