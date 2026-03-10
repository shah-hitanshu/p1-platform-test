/**
 * PublishButton Component Tests
 *
 * Tests for the simplified PublishButton that calls onPublish() directly
 * without a name prompt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PublishButton } from '../../src/components/PublishButton.js';
import type { Checkpoint } from '@pantheon/css-client';

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

  it('calls onPublish when clicked', () => {
    render(<PublishButton onPublish={onPublish} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('shows "Publishing..." during publish', async () => {
    let resolvePublish!: (value: Checkpoint) => void;
    const pendingPublish = new Promise<Checkpoint>((resolve) => {
      resolvePublish = resolve;
    });
    onPublish.mockReturnValue(pendingPublish);

    render(<PublishButton onPublish={onPublish} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toBe('Publishing...');
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

    fireEvent.click(screen.getByRole('button'));

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

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('button is disabled when disabled prop is true', () => {
    render(<PublishButton onPublish={onPublish} disabled />);

    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });

  it('button is disabled during publishing', async () => {
    let resolvePublish!: (value: Checkpoint) => void;
    const pendingPublish = new Promise<Checkpoint>((resolve) => {
      resolvePublish = resolve;
    });
    onPublish.mockReturnValue(pendingPublish);

    render(<PublishButton onPublish={onPublish} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toBe('Publishing...');
    });
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);

    resolvePublish(createMockCheckpoint());
    await waitFor(() => {
      expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
    });
  });

  it('applies custom className', () => {
    const { container } = render(
      <PublishButton onPublish={onPublish} className="my-custom-class" />
    );

    expect(container.querySelector('.my-custom-class')).not.toBeNull();
  });
});
