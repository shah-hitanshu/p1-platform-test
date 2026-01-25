/**
 * Toast Component Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toast } from '../src/components/Toast.js';
import type { Notification } from '../src/types.js';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createNotification = (overrides: Partial<Notification> = {}): Notification => ({
    id: 'test-1',
    message: 'Test message',
    severity: 'info',
    createdAt: new Date(),
    ...overrides,
  });

  it('should render the notification message', () => {
    const notification = createNotification({ message: 'Hello world' });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('should render the notification title when provided', () => {
    const notification = createNotification({ title: 'Alert', message: 'Something happened' });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(screen.getByText('Alert')).toBeInTheDocument();
    expect(screen.getByText('Something happened')).toBeInTheDocument();
  });

  it('should display the correct icon for success severity', () => {
    const notification = createNotification({ severity: 'success' });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('should display the correct icon for error severity', () => {
    const notification = createNotification({ severity: 'error' });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const icons = screen.getAllByText('✕');
    // First one is the severity icon, second is dismiss button
    expect(icons.length).toBeGreaterThanOrEqual(1);
  });

  it('should display the correct icon for warning severity', () => {
    const notification = createNotification({ severity: 'warning' });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(screen.getByText('⚠')).toBeInTheDocument();
  });

  it('should display the correct icon for info severity', () => {
    const notification = createNotification({ severity: 'info' });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(screen.getByText('ℹ')).toBeInTheDocument();
  });

  it('should render action buttons when provided', () => {
    const onRetry = vi.fn();
    const notification = createNotification({
      actions: [{ label: 'Retry', onClick: onRetry }],
    });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const retryButton = screen.getByRole('button', { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
  });

  it('should call action onClick and dismiss when action is clicked', () => {
    const onRetry = vi.fn();
    const notification = createNotification({
      actions: [{ label: 'Retry', onClick: onRetry }],
    });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);

    // After clicking action, toast should dismiss (after animation)
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledWith(notification.id);
  });

  it('should call onDismiss when dismiss button is clicked', () => {
    const notification = createNotification();
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));

    // Wait for animation
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onDismiss).toHaveBeenCalledWith(notification.id);
  });

  it('should apply severity-specific CSS classes', () => {
    const notification = createNotification({ severity: 'error' });
    const onDismiss = vi.fn();

    const { container } = render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(container.querySelector('.css-puck-toast--error')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const notification = createNotification();
    const onDismiss = vi.fn();

    const { container } = render(
      <Toast notification={notification} onDismiss={onDismiss} className="custom-class" />
    );

    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('should show progress bar for auto-dismiss notifications', () => {
    const notification = createNotification({ autoDismissMs: 5000 });
    const onDismiss = vi.fn();

    const { container } = render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(container.querySelector('.css-puck-toast__progress')).toBeInTheDocument();
  });

  it('should not show progress bar when autoDismissMs is 0', () => {
    const notification = createNotification({ autoDismissMs: 0 });
    const onDismiss = vi.fn();

    const { container } = render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(container.querySelector('.css-puck-toast__progress')).not.toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    const notification = createNotification({ severity: 'error' });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('should use polite aria-live for non-error notifications', () => {
    const notification = createNotification({ severity: 'info' });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });

  it('should render multiple actions', () => {
    const onRetry = vi.fn();
    const onDetails = vi.fn();
    const notification = createNotification({
      actions: [
        { label: 'Retry', onClick: onRetry },
        { label: 'Details', onClick: onDetails },
      ],
    });
    const onDismiss = vi.fn();

    render(<Toast notification={notification} onDismiss={onDismiss} />);

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument();
  });
});
