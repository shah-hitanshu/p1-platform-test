/**
 * PublishButton Component Tests
 *
 * Tests for the PublishButton with a confirmation step before publishing
 * to the live site.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PublishButton } from '../../src/editor/components/PublishButton.js';
import type { Checkpoint } from '@pantheon-systems/css-client';

const createMockCheckpoint = (overrides: Partial<Checkpoint> = {}): Checkpoint => ({
  id: 'cp-1',
  branchId: 'branch-1',
  name: 'Test Checkpoint',
  checkpointType: 'manual',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('PublishButton', () => {
  let onPublish: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onPublish = vi.fn().mockResolvedValue(createMockCheckpoint());
  });

  afterEach(() => {
    cleanup();
  });

  it('renders with default "Publish" text', () => {
    render(<PublishButton onPublish={onPublish} />);

    expect(screen.getByRole('button').textContent).toBe('Publish');
  });

  it('renders with custom children text', () => {
    render(<PublishButton onPublish={onPublish}>Save Version</PublishButton>);

    expect(screen.getByRole('button').textContent).toBe('Save Version');
  });

  it('shows confirmation prompt when clicked instead of publishing immediately', () => {
    render(<PublishButton onPublish={onPublish} />);

    fireEvent.click(screen.getByRole('button'));

    // Should NOT have called onPublish yet
    expect(onPublish).not.toHaveBeenCalled();
    // Should show confirmation UI with live site warning
    expect(screen.getByText(/live site/i)).not.toBeNull();
  });

  it('shows a confirm button in the confirmation prompt', () => {
    render(<PublishButton onPublish={onPublish} />);

    fireEvent.click(screen.getByRole('button'));

    // Should show a confirm button
    const buttons = screen.getAllByRole('button');
    const confirmButton = buttons.find(
      (b) => b.textContent?.toLowerCase().includes('confirm') || b.textContent?.toLowerCase().includes('publish to live')
    );
    expect(confirmButton).toBeDefined();
  });

  it('shows a cancel button in the confirmation prompt', () => {
    render(<PublishButton onPublish={onPublish} />);

    fireEvent.click(screen.getByRole('button'));

    const buttons = screen.getAllByRole('button');
    const cancelButton = buttons.find((b) => b.textContent?.toLowerCase().includes('cancel'));
    expect(cancelButton).toBeDefined();
  });

  it('calls onPublish when confirm is clicked', async () => {
    render(<PublishButton onPublish={onPublish} />);

    // First click opens confirmation
    fireEvent.click(screen.getByRole('button'));
    expect(onPublish).not.toHaveBeenCalled();

    // Find and click confirm
    const buttons = screen.getAllByRole('button');
    const confirmButton = buttons.find(
      (b) => b.textContent?.toLowerCase().includes('confirm') || b.textContent?.toLowerCase().includes('publish to live')
    );
    fireEvent.click(confirmButton!);

    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call onPublish when cancel is clicked', () => {
    render(<PublishButton onPublish={onPublish} />);

    // Open confirmation
    fireEvent.click(screen.getByRole('button'));

    // Click cancel
    const buttons = screen.getAllByRole('button');
    const cancelButton = buttons.find((b) => b.textContent?.toLowerCase().includes('cancel'));
    fireEvent.click(cancelButton!);

    expect(onPublish).not.toHaveBeenCalled();
  });

  it('returns to initial state after cancel', () => {
    render(<PublishButton onPublish={onPublish} />);

    // Open confirmation
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/live site/i)).not.toBeNull();

    // Cancel
    const buttons = screen.getAllByRole('button');
    const cancelButton = buttons.find((b) => b.textContent?.toLowerCase().includes('cancel'));
    fireEvent.click(cancelButton!);

    // Should be back to initial Publish button
    expect(screen.getByRole('button').textContent).toBe('Publish');
  });

  it('shows "Publishing..." during publish', async () => {
    let resolvePublish!: (value: Checkpoint) => void;
    const pendingPublish = new Promise<Checkpoint>((resolve) => {
      resolvePublish = resolve;
    });
    onPublish.mockReturnValue(pendingPublish);

    render(<PublishButton onPublish={onPublish} />);

    // Open confirmation and confirm
    fireEvent.click(screen.getByRole('button'));
    const buttons = screen.getAllByRole('button');
    const confirmButton = buttons.find(
      (b) => b.textContent?.toLowerCase().includes('confirm') || b.textContent?.toLowerCase().includes('publish to live')
    );
    fireEvent.click(confirmButton!);

    await waitFor(() => {
      expect(screen.getByText('Publishing...')).not.toBeNull();
    });

    resolvePublish(createMockCheckpoint());
    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toBe('Publish');
    });
  });

  it('calls onSuccess with checkpoint after successful publish', async () => {
    const checkpoint = createMockCheckpoint({ id: 'cp-success' });
    onPublish.mockResolvedValue(checkpoint);
    const onSuccess = vi.fn();

    render(<PublishButton onPublish={onPublish} onSuccess={onSuccess} />);

    // Open confirmation and confirm
    fireEvent.click(screen.getByRole('button'));
    const buttons = screen.getAllByRole('button');
    const confirmButton = buttons.find(
      (b) => b.textContent?.toLowerCase().includes('confirm') || b.textContent?.toLowerCase().includes('publish to live')
    );
    fireEvent.click(confirmButton!);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).toHaveBeenCalledWith(checkpoint);
  });

  it('calls onError when publish fails', async () => {
    const error = new Error('Publish failed');
    onPublish.mockRejectedValue(error);
    const onError = vi.fn();

    render(<PublishButton onPublish={onPublish} onError={onError} />);

    // Open confirmation and confirm
    fireEvent.click(screen.getByRole('button'));
    const buttons = screen.getAllByRole('button');
    const confirmButton = buttons.find(
      (b) => b.textContent?.toLowerCase().includes('confirm') || b.textContent?.toLowerCase().includes('publish to live')
    );
    fireEvent.click(confirmButton!);

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('button is disabled when disabled prop is true', () => {
    render(<PublishButton onPublish={onPublish} disabled />);

    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });

  it('applies custom className', () => {
    const { container } = render(
      <PublishButton onPublish={onPublish} className="my-custom-class" />
    );

    expect(container.querySelector('.my-custom-class')).not.toBeNull();
  });
});
