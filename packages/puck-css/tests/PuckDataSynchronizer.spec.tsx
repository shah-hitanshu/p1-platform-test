/**
 * PuckDataSynchronizer Tests
 *
 * Tests for the component that syncs external data to Puck's internal state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import type { PuckData } from '@pantheon-systems/css-client';
import { PuckDataSynchronizer, _resetSyncTracking } from '../src/editor/components/PuckDataSynchronizer.js';

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

function dispatched(): { type: string }[] {
  return (mockDispatch.mock.calls as [{ type: string }][]).map(([action]) => action);
}

const setDataCalls = (): { type: string }[] => dispatched().filter(a => a.type === 'setData');

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
    expect(setDataCalls()).toHaveLength(1);
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
    expect(setDataCalls()).toHaveLength(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'setData',
      data: sampleData2,
    });
  });

  it('clears the selection before the new document lands', async () => {
    render(<PuckDataSynchronizer data={sampleData} syncKey="key1" />);

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(dispatched().map(action => action.type)).toEqual(['setUi', 'setData']);
    expect(mockDispatch).toHaveBeenNthCalledWith(1, { type: 'setUi', ui: { itemSelector: null } });
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

    expect(setDataCalls()).toHaveLength(1);
  });

  it('should not dispatch when syncKey changes from value to null', async () => {
    const { rerender } = render(
      <PuckDataSynchronizer data={sampleData} syncKey="key1" />
    );

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(setDataCalls()).toHaveLength(1);

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
