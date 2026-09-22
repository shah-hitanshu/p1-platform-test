/**
 * Presence Polling Visibility Gating Tests
 *
 * Verifies that P1PuckProvider's HTTP presence polling pauses while the tab is
 * hidden and resumes with a single immediate refresh when it becomes visible.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { BranchPresence, P1Client } from '@pantheon-systems/css-client';
import { P1PuckProvider } from '../src/editor/P1PuckProvider.js';

const POLL_INTERVAL = 5000;

const mockBranchPresence: BranchPresence = {
  branchId: 'branch-1',
  branchName: 'main',
  siteId: 'site-1',
  summary: {
    totalActors: 1,
    humanCount: 1,
    agentCount: 0,
    editingCount: 0,
  },
  actors: [
    {
      id: 'presence-1',
      actorId: 'user-2',
      actorType: 'user',
      role: 'human',
      name: 'Other User',
      state: 'active',
      lastActivityAt: '2026-01-27T10:00:00Z',
      joinedAt: '2026-01-27T09:00:00Z',
    },
  ],
  documentSummary: [],
};

function createMockClient(): P1Client {
  return {
    branches: {
      list: vi.fn().mockResolvedValue([
        { id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true },
      ]),
      get: vi.fn().mockResolvedValue({ id: 'branch-1', name: 'main', isMain: true }),
    },
    documents: {
      list: vi.fn().mockResolvedValue([]),
      listByBranch: vi.fn().mockResolvedValue([]),
      getByPath: vi.fn(),
    },
    versions: {
      list: vi.fn().mockResolvedValue([]),
      getLatest: vi.fn(),
    },
    checkpoints: {
      list: vi.fn().mockResolvedValue([]),
    },
    presence: {
      getBranchPresence: vi.fn().mockResolvedValue(mockBranchPresence),
      getSitePresence: vi.fn().mockResolvedValue({}),
      getDocumentPresence: vi.fn().mockResolvedValue([]),
      updateFocusRegions: vi.fn().mockResolvedValue({ success: true, focusRegions: [] }),
    },
    withPrincipal: vi.fn().mockReturnThis(),
  } as unknown as P1Client;
}

describe('Presence polling visibility gating', () => {
  let originalDescriptor: PropertyDescriptor | undefined;
  let visibility: DocumentVisibilityState;

  const setVisibility = (next: DocumentVisibilityState) => {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  const renderProvider = (client: P1Client) =>
    render(
      <P1PuckProvider
        client={client}
        siteId="site-1"
        branchId="branch-1"
        userId="user-1"
        enableRealtime={false}
        presenceEnabled={true}
        presencePollingInterval={POLL_INTERVAL}
      >
        <div>Test</div>
      </P1PuckProvider>
    );

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    originalDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalDescriptor);
    } else {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should stop polling while the tab is hidden', async () => {
    const client = createMockClient();
    renderProvider(client);

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

    await act(async () => { setVisibility('hidden'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 3); });

    expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);
  });

  it('should fetch once on return to visibility and restart the interval', async () => {
    const client = createMockClient();
    renderProvider(client);

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { setVisibility('hidden'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 3); });
    expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);

    await act(async () => { setVisibility('visible'); });
    expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL - 1); });
    expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(3);
  });

  it('should defer the first fetch when mounted hidden', async () => {
    visibility = 'hidden';
    const client = createMockClient();
    renderProvider(client);

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL); });
    expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(0);

    await act(async () => { setVisibility('visible'); });
    expect(client.presence.getBranchPresence).toHaveBeenCalledTimes(1);
  });
});
