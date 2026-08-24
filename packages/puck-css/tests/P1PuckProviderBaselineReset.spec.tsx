/**
 * Regression test: loadDocument rejection during onBaselineReset must not
 * permanently wedge the editor. The recovery path requires setBaselineResetKey
 * to fire even on failure, which triggers useRealtime to rebuild with a new resetKey.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import type { P1Client } from '@pantheon-systems/css-client';

// ---------------------------------------------------------------------------
// Mock useRealtime so we can capture onBaselineReset and track resetKey.
// Must be hoisted above imports of the module under test.
// ---------------------------------------------------------------------------
const capturedParams: { resetKey: number; onBaselineReset?: () => void; documentPath?: string | null }[] = [];

vi.mock('../src/editor/useRealtime.js', () => ({
  useRealtime: vi.fn().mockImplementation((params: { resetKey?: number; onBaselineReset?: () => void; documentPath?: string | null }) => {
    capturedParams.push({ resetKey: params.resetKey ?? 0, onBaselineReset: params.onBaselineReset, documentPath: params.documentPath });
    return {
      connected: false,
      applyLocalChange: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue(null),
      error: null,
      sendFocusRegions: vi.fn().mockReturnValue(false),
      sendHeartbeat: vi.fn(),
      presenceViaWebSocket: false,
      connectedDocumentPath: null,
      waitForDelivery: vi.fn().mockResolvedValue(undefined),
      requestPublish: vi.fn().mockResolvedValue({}),
    };
  }),
}));

// Import after vi.mock so the mock is in place
import { P1PuckProvider } from '../src/editor/P1PuckProvider.js';
import { useP1Puck } from '../src/core/P1PuckContext.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const createMockClient = () => {
  const client = {
    sites: { list: vi.fn(), get: vi.fn() },
    branches: {
      list: vi.fn().mockResolvedValue([{ id: 'branch-1', isMain: true, name: 'main' }]),
    },
    documents: { getByPath: vi.fn() },
    versions: { getLatest: vi.fn(), create: vi.fn() },
    checkpoints: { create: vi.fn() },
    withPrincipal: vi.fn(),
  };
  client.withPrincipal.mockReturnValue(client);
  return client as unknown as P1Client;
};

function DocLoader({ path }: { path: string }): null {
  const { loadDocument } = useP1Puck();
  useEffect(() => {
    void loadDocument(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('P1PuckProvider — onBaselineReset error recovery', () => {
  beforeEach(() => {
    capturedParams.length = 0;
    vi.clearAllMocks();
  });

  it('still increments resetKey when loadDocument rejects during baseline reset', async () => {
    const mockClient = createMockClient();
    const mockDoc = { id: 'doc-1', path: '/test-doc', templateId: null };
    const mockVersion = {
      snapshot: { content: [], root: { props: {} } },
      branchId: 'branch-1',
      id: 'v-1',
    };

    const docs = mockClient as unknown as { documents: { getByPath: ReturnType<typeof vi.fn> }; versions: { getLatest: ReturnType<typeof vi.fn> } };

    // Initial load succeeds
    docs.documents.getByPath.mockResolvedValueOnce(mockDoc);
    docs.versions.getLatest.mockResolvedValueOnce(mockVersion);
    // Baseline-reset refetch fails
    docs.documents.getByPath.mockRejectedValueOnce(new Error('network error'));

    render(
      <P1PuckProvider
        client={mockClient}
        siteId="site-123"
        branchId="branch-1"
        userId="user-789"
        enableRealtime={true}
        wsBaseUrl="ws://localhost:8787"
      >
        <DocLoader path="/test-doc" />
      </P1PuckProvider>
    );

    // Wait for the document to load — useRealtime must be called with a non-null
    // documentPath so currentDocumentRef is populated before onBaselineReset fires.
    await waitFor(() => {
      const withDoc = capturedParams.find((p) => p.onBaselineReset !== undefined && p.documentPath != null);
      expect(withDoc).toBeDefined();
    });

    // Capture the callback for the most recent call that has the document path set.
    const latestWithCallback = [...capturedParams].reverse().find((p) => p.onBaselineReset && p.documentPath != null);
    const onBaselineReset = latestWithCallback!.onBaselineReset!;

    // The initial resetKey must be 0
    expect(latestWithCallback!.resetKey).toBe(0);

    // Trigger baseline reset — loadDocument will reject (second getByPath call)
    act(() => {
      onBaselineReset();
    });

    // After the .catch(), setBaselineResetKey must have fired, causing useRealtime
    // to be re-invoked with resetKey = 1.
    await waitFor(() => {
      const bumped = capturedParams.find((p) => p.resetKey === 1);
      expect(bumped).toBeDefined();
    });
  });
});
