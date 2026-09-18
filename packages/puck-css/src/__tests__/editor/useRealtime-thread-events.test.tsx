/**
 * A thread change arriving on the editor's socket reaches the caller's
 * handler, and the newest handler at that, without rebuilding the client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Config = { onThreadEvent?: (event: unknown) => void };
const constructedWith: Config[] = [];

vi.mock('@pantheon-systems/css-client', () => ({
  RealtimeClient: vi.fn().mockImplementation(function (config: Config) {
    constructedWith.push(config);
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      getYDoc: vi.fn().mockReturnValue({
        getMap: vi.fn().mockReturnValue({ toJSON: () => ({}) }),
        on: vi.fn(),
        off: vi.fn(),
      }),
      getSnapshot: vi.fn().mockReturnValue(null),
      isConnected: vi.fn().mockReturnValue(false),
      sendFocusRegions: vi.fn().mockReturnValue(false),
      sendHeartbeat: vi.fn(),
      applyLocalUpdate: vi.fn(),
      waitForDelivery: vi.fn(),
      requestPublish: vi.fn(),
      presenceViaWebSocket: false,
    };
  }),
}));

vi.mock('../../editor/utils/puckYjsBinding', () => ({
  createPuckYjsBinding: vi.fn().mockReturnValue({ applyLocalChange: vi.fn(), destroy: vi.fn() }),
}));

import { useRealtime } from '../../editor/useRealtime.js';

const params = {
  baseUrl: 'ws://localhost:8787',
  siteId: 'site-1',
  branchId: 'branch-1',
  documentPath: 'pages/home',
  actorId: 'user-1',
  actorType: 'user' as const,
  initialData: { content: [], root: {} },
};

const event = { type: 'comment_posted', siteId: 'site-1', thread: { id: 't' }, comment: { id: 'c' } };

describe('useRealtime thread events', () => {
  beforeEach(() => {
    constructedWith.length = 0;
  });

  it('passes a pushed event to the handler most recently given', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      (onThreadEvent: (e: unknown) => void) => useRealtime({ ...params, onThreadEvent } as never),
      { initialProps: first },
    );
    expect(constructedWith).toHaveLength(1);

    act(() => constructedWith[0].onThreadEvent?.(event));
    expect(first).toHaveBeenCalledWith(event);

    rerender(second);
    expect(constructedWith).toHaveLength(1);

    act(() => constructedWith[0].onThreadEvent?.(event));
    expect(second).toHaveBeenCalledWith(event);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
