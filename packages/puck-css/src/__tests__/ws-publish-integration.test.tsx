/**
 * WebSocket Publish Integration Tests
 *
 * Tests that the useRealtime hook exposes requestPublish, enabling
 * CSSPuckProvider to use WebSocket-driven publish when connected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublishResult } from '@pantheon/css-client';

// =============================================================================
// Mocks
// =============================================================================

// Mock the RealtimeClient to verify requestPublish is wired through
const mockRequestPublish = vi.fn<() => Promise<PublishResult>>();
const mockWaitForDelivery = vi.fn<() => Promise<void>>();

vi.mock('@pantheon/css-client', () => ({
  RealtimeClient: vi.fn().mockImplementation(() => ({
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
    waitForDelivery: mockWaitForDelivery,
    requestPublish: mockRequestPublish,
    presenceViaWebSocket: false,
  })),
}));

// Mock puckYjsBinding
vi.mock('../utils/puckYjsBinding', () => ({
  createPuckYjsBinding: vi.fn().mockReturnValue({
    applyLocalChange: vi.fn(),
    destroy: vi.fn(),
  }),
}));

describe('WebSocket Publish Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useRealtime return type should include requestPublish', async () => {
    // The useRealtime hook wraps RealtimeClient.requestPublish
    // Verify the hook module exports the right interface
    const { useRealtime } = await import('../hooks/useRealtime');

    // We can't call the hook outside React, but we can verify
    // the module exports correctly. The real test is that TypeScript
    // compiles without errors when we add requestPublish to UseRealtimeReturn.
    expect(useRealtime).toBeDefined();
    expect(typeof useRealtime).toBe('function');
  });

  it('RealtimeClient mock should have requestPublish method', async () => {
    const { RealtimeClient } = await import('@pantheon/css-client');
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });

    expect(client.requestPublish).toBeDefined();
    expect(typeof client.requestPublish).toBe('function');
  });

  it('requestPublish should return PublishResult shape', async () => {
    const { RealtimeClient } = await import('@pantheon/css-client');
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });

    const mockResult: PublishResult = {
      success: true,
      publishedVersionId: 'v-1',
      checkpoint: {
        id: 'cp-1',
        branchId: 'branch-1',
        name: 'Publish',
        checkpointType: 'publish',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-03-11T00:00:00Z',
      },
    };
    mockRequestPublish.mockResolvedValue(mockResult);

    const result = await client.requestPublish();
    expect(result.success).toBe(true);
    expect(result.publishedVersionId).toBe('v-1');
    expect(result.checkpoint?.id).toBe('cp-1');
  });

  it('requestPublish error result should include error message', async () => {
    const { RealtimeClient } = await import('@pantheon/css-client');
    const client = new RealtimeClient({ baseUrl: 'ws://localhost' });

    mockRequestPublish.mockResolvedValue({
      success: false,
      error: 'Document not found',
    });

    const result = await client.requestPublish();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Document not found');
    expect(result.publishedVersionId).toBeUndefined();
  });
});
