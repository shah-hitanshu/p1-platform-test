/**
 * PuckDataSynchronizer Tests
 *
 * Tests for the component that syncs external data to Puck's internal state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { PuckDataSynchronizer } from '../src/components/PuckDataSynchronizer.js';
import type { PuckData } from '@pantheon/css-client';

// Mock @puckeditor/core
const mockDispatch = vi.fn();
vi.mock('@puckeditor/core', () => ({
  usePuck: () => ({
    dispatch: mockDispatch,
  }),
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
  });

  it('should not dispatch when data is null', () => {
    render(<PuckDataSynchronizer data={null} syncKey="key1" />);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should dispatch setData when syncKey changes and data is provided', () => {
    const { rerender } = render(
      <PuckDataSynchronizer data={sampleData} syncKey="key1" />
    );

    // Initial render with data should dispatch
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'setData',
      data: sampleData,
    });

    // Same syncKey, different data - should NOT dispatch again
    mockDispatch.mockClear();
    rerender(<PuckDataSynchronizer data={sampleData2} syncKey="key1" />);
    expect(mockDispatch).not.toHaveBeenCalled();

    // Different syncKey - SHOULD dispatch
    rerender(<PuckDataSynchronizer data={sampleData2} syncKey="key2" />);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'setData',
      data: sampleData2,
    });
  });

  it('should not dispatch when syncKey is null (null means do not sync)', () => {
    render(<PuckDataSynchronizer data={sampleData} syncKey={null} />);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should dispatch when syncKey changes from null to value', () => {
    const { rerender } = render(
      <PuckDataSynchronizer data={sampleData} syncKey={null} />
    );
    expect(mockDispatch).not.toHaveBeenCalled();

    rerender(<PuckDataSynchronizer data={sampleData} syncKey="key1" />);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('should not dispatch when syncKey changes from value to null', () => {
    const { rerender } = render(
      <PuckDataSynchronizer data={sampleData} syncKey="key1" />
    );
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    // Changing to null should NOT trigger a dispatch
    mockDispatch.mockClear();
    rerender(<PuckDataSynchronizer data={sampleData2} syncKey={null} />);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should not dispatch on remount if syncKey is null', () => {
    // Simulate what happens when the component remounts due to parent recreation
    const { unmount } = render(
      <PuckDataSynchronizer data={sampleData} syncKey={null} />
    );
    expect(mockDispatch).not.toHaveBeenCalled();

    unmount();
    mockDispatch.mockClear();

    // Remount with null key - should still not dispatch
    render(<PuckDataSynchronizer data={sampleData} syncKey={null} />);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should render nothing (return null)', () => {
    const { container } = render(
      <PuckDataSynchronizer data={sampleData} syncKey="key1" />
    );
    expect(container.innerHTML).toBe('');
  });
});
