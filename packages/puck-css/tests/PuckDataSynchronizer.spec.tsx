/**
 * PuckDataSynchronizer Tests
 *
 * Tests for the component that syncs external data to Puck's internal state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { PuckDataSynchronizer, _resetSyncTracking } from '../src/components/PuckDataSynchronizer.js';
import type { PuckData } from '@pantheon/css-client';

// Mock @puckeditor/core
const mockDispatch = vi.fn();
vi.mock('@puckeditor/core', () => ({
  usePuck: () => ({
    dispatch: mockDispatch,
  }),
  // createUsePuck returns a function that creates a hook
  // The hook accepts a selector and returns the selected value
  createUsePuck: () => {
    // Return the hook function
    return <T,>(selector?: (state: { dispatch: typeof mockDispatch }) => T): T => {
      const state = { dispatch: mockDispatch };
      if (selector) {
        return selector(state);
      }
      return state as unknown as T;
    };
  },
}));

describe('PuckDataSynchronizer', () => {
  const sampleData: PuckData = {
    content: [{ type: 'Heading', props: { id: 'h1', text: 'Hello' } }],
    root: { props: {} },
  };

  const sampleData2: PuckData = {
    content: [{ type: 'Heading', props: { id: 'h1', text: 'Updated' } }],
    root: { props: {} },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset module-level state to ensure tests don't affect each other
    _resetSyncTracking();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not dispatch when data is null', async () => {
    render(<PuckDataSynchronizer data={null} syncKey="key1" />);

    // Advance timers to trigger the setTimeout in the component
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should dispatch setData when syncKey changes and data is provided', async () => {
    const { rerender } = render(
      <PuckDataSynchronizer data={sampleData} syncKey="key1" />
    );

    // Advance timers to trigger the setTimeout in the component
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    // Initial render with data should dispatch
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'setData',
      data: sampleData,
    });

    // Same syncKey, different data - should NOT dispatch again
    mockDispatch.mockClear();
    rerender(<PuckDataSynchronizer data={sampleData2} syncKey="key1" />);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(mockDispatch).not.toHaveBeenCalled();

    // Different syncKey - SHOULD dispatch
    rerender(<PuckDataSynchronizer data={sampleData2} syncKey="key2" />);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'setData',
      data: sampleData2,
    });
  });

  it('should not dispatch when syncKey is null (null means do not sync)', async () => {
    render(<PuckDataSynchronizer data={sampleData} syncKey={null} />);

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should dispatch when syncKey changes from null to value', async () => {
    const { rerender } = render(
      <PuckDataSynchronizer data={sampleData} syncKey={null} />
    );

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(mockDispatch).not.toHaveBeenCalled();

    rerender(<PuckDataSynchronizer data={sampleData} syncKey="key1" />);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('should not dispatch when syncKey changes from value to null', async () => {
    const { rerender } = render(
      <PuckDataSynchronizer data={sampleData} syncKey="key1" />
    );

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(mockDispatch).toHaveBeenCalledTimes(1);

    // Changing to null should NOT trigger a dispatch
    mockDispatch.mockClear();
    rerender(<PuckDataSynchronizer data={sampleData2} syncKey={null} />);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should not dispatch on remount if syncKey is null', async () => {
    // Simulate what happens when the component remounts due to parent recreation
    const { unmount } = render(
      <PuckDataSynchronizer data={sampleData} syncKey={null} />
    );

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(mockDispatch).not.toHaveBeenCalled();

    unmount();
    mockDispatch.mockClear();

    // Remount with null key - should still not dispatch
    render(<PuckDataSynchronizer data={sampleData} syncKey={null} />);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should render nothing (return null)', async () => {
    const { container } = render(
      <PuckDataSynchronizer data={sampleData} syncKey="key1" />
    );

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(container.innerHTML).toBe('');
  });
});
