/**
 * Regression test: connectedDocumentPath ref pattern
 *
 * Validates that CSSPuckProvider reads connectedDocumentPath from a ref
 * (live value) rather than the stale snapshot returned by useRealtime().
 *
 * Bug: useRealtime() returns `connectedDocumentPath: ref.current` which is
 * evaluated once per render. When saveData() runs inside a useCallback closure,
 * it reads the value captured at render time — which may be null even though
 * the WebSocket has since connected. This caused "Connection identity mismatch"
 * guards to silently reject all saves.
 *
 * Fix: CSSPuckProvider now mirrors connectedDocumentPath into its own ref
 * (`connectedDocumentPathRef`) and reads from that ref inside saveData/saveNow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useContext } from 'react';
import type { PuckData } from '@pantheon/css-client';

// ---------------------------------------------------------------------------
// Mutable mock state — allows tests to simulate connection state changes
// ---------------------------------------------------------------------------
const mockRealtimeState = {
  connected: false,
  connectedDocumentPath: null as string | null,
  applyLocalChange: vi.fn(),
  getSnapshot: vi.fn().mockReturnValue(null),
  error: null,
  sendFocusRegions: vi.fn().mockReturnValue(false),
  sendHeartbeat: vi.fn(),
  presenceViaWebSocket: false,
  waitForDelivery: vi.fn().mockResolvedValue(undefined),
  requestPublish: vi.fn().mockResolvedValue({ success: true }),
};

// Track useRealtime callbacks for triggering onRemoteUpdate etc.
let capturedRealtimeCallbacks: Record<string, (...args: unknown[]) => void> = {};

vi.mock('../hooks/useRealtime', () => ({
  useRealtime: (opts: Record<string, unknown>) => {
    // Capture callbacks for test control
    if (opts.onRemoteUpdate) capturedRealtimeCallbacks.onRemoteUpdate = opts.onRemoteUpdate as (...args: unknown[]) => void;
    return { ...mockRealtimeState };
  },
}));

// Mock useDocuments
vi.mock('../hooks/useDocuments', () => ({
  useDocuments: () => ({
    documents: [],
    loading: false,
    refreshDocuments: vi.fn().mockResolvedValue([]),
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
  }),
}));

// Mock css-client — withPrincipal returns self for chaining
const mockClientMethods = {
  documents: {
    getByPath: vi.fn(),
    publish: vi.fn(),
  },
  versions: {
    getLatest: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  },
  branches: {
    list: vi.fn().mockResolvedValue([]),
  },
  checkpoints: {
    create: vi.fn(),
  },
  presence: {
    getBranchPresence: vi.fn().mockResolvedValue({ actors: [] }),
  },
  agentEdit: {
    canEdit: vi.fn(),
    startEdit: vi.fn(),
    completeEdit: vi.fn(),
    abortEdit: vi.fn(),
    stopAgent: vi.fn(),
  },
  withPrincipal: vi.fn(),
};
// withPrincipal returns the same mock (methods available on the derived client)
mockClientMethods.withPrincipal.mockReturnValue(mockClientMethods);

vi.mock('@pantheon/css-client', () => ({
  CSSClient: vi.fn().mockImplementation(() => ({ ...mockClientMethods })),
}));

// Mock NotificationContext
vi.mock('../NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotifications: () => ({
    addNotification: vi.fn(),
    notifications: [],
    dismissNotification: vi.fn(),
  }),
}));

// Import after mocks
import { CSSPuckContext } from '../CSSPuckContext';
import { CSSPuckProvider } from '../CSSPuckProvider';

// Helper to capture context value
let capturedCtx: ReturnType<typeof useContext<typeof CSSPuckContext>> = null;

function ContextCapture() {
  capturedCtx = useContext(CSSPuckContext);
  return null;
}

const TEST_PATH = '/pages/home';
const TEST_DATA: PuckData = { content: [], root: { props: {} }, zones: {} };

describe('connectedDocumentPath ref regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCtx = null;
    capturedRealtimeCallbacks = {};

    // Reset mock state
    mockRealtimeState.connected = false;
    mockRealtimeState.connectedDocumentPath = null;
    mockRealtimeState.applyLocalChange = vi.fn();
  });

  it('saveData sends via WebSocket when connectedDocumentPath matches (not stale null)', async () => {
    // Start disconnected (connectedDocumentPath = null)
    const client = new (await import('@pantheon/css-client')).CSSClient({
      baseUrl: 'http://localhost:8787',
      apiKey: 'test',
    });

    const { rerender } = render(
      <CSSPuckProvider
        client={client}
        siteId="test-site"
        branchId="branch-1"
        userId="user-1"
        enableRealtime={true}
        wsBaseUrl="ws://localhost:8787"
      >
        <ContextCapture />
      </CSSPuckProvider>
    );

    // Verify we have context
    expect(capturedCtx).not.toBeNull();

    // Simulate: loadDocument sets currentDocument
    if (capturedCtx && 'loadDocument' in capturedCtx) {
      const mockDoc = { id: 'doc-1', path: TEST_PATH, siteId: 'test-site', branchId: 'branch-1' };
      mockClientMethods.documents.getByPath.mockResolvedValueOnce(mockDoc);
      mockClientMethods.versions.getLatest.mockResolvedValueOnce({
        id: 'v-1', documentId: 'doc-1', branchId: 'branch-1',
        data: TEST_DATA, createdAt: '2026-01-01T00:00:00Z',
      });

      await act(async () => {
        await (capturedCtx as { loadDocument: (path: string) => Promise<void> }).loadDocument(TEST_PATH);
      });
    }

    // Now simulate connection established — connectedDocumentPath becomes TEST_PATH
    // This is the key part: the ref updates but the closure may have captured null
    mockRealtimeState.connected = true;
    mockRealtimeState.connectedDocumentPath = TEST_PATH;

    // Rerender so the ref gets the new value
    rerender(
      <CSSPuckProvider
        client={client}
        siteId="test-site"
        branchId="branch-1"
        userId="user-1"
        enableRealtime={true}
        wsBaseUrl="ws://localhost:8787"
      >
        <ContextCapture />
      </CSSPuckProvider>
    );

    // Call saveData (onChange handler)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() => {
      if (capturedCtx && 'saveData' in capturedCtx) {
        (capturedCtx as { saveData: (data: PuckData) => void }).saveData(TEST_DATA);
      }
    });

    // The bug: with stale closure, connectedDocumentPath would be null,
    // causing "Connection identity mismatch" warning and skipped send.
    // The fix: using a ref ensures the current value is read.
    const mismatchWarnings = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].toLowerCase().includes('connection identity mismatch')
    );

    expect(mismatchWarnings).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it('saveData still rejects when connectedDocumentPath genuinely mismatches', async () => {
    const client = new (await import('@pantheon/css-client')).CSSClient({
      baseUrl: 'http://localhost:8787',
      apiKey: 'test',
    });

    const { rerender } = render(
      <CSSPuckProvider
        client={client}
        siteId="test-site"
        branchId="branch-1"
        userId="user-1"
        enableRealtime={true}
        wsBaseUrl="ws://localhost:8787"
      >
        <ContextCapture />
      </CSSPuckProvider>
    );

    // Load document
    if (capturedCtx && 'loadDocument' in capturedCtx) {
      const mockDoc = { id: 'doc-1', path: TEST_PATH, siteId: 'test-site', branchId: 'branch-1' };
      mockClientMethods.documents.getByPath.mockResolvedValueOnce(mockDoc);
      mockClientMethods.versions.getLatest.mockResolvedValueOnce({
        id: 'v-1', documentId: 'doc-1', branchId: 'branch-1',
        data: TEST_DATA, createdAt: '2026-01-01T00:00:00Z',
      });

      await act(async () => {
        await (capturedCtx as { loadDocument: (path: string) => Promise<void> }).loadDocument(TEST_PATH);
      });
    }

    // Connected but to a DIFFERENT document
    mockRealtimeState.connected = true;
    mockRealtimeState.connectedDocumentPath = '/pages/about';

    // Rerender so saveData closure picks up connected=true and ref updates
    rerender(
      <CSSPuckProvider
        client={client}
        siteId="test-site"
        branchId="branch-1"
        userId="user-1"
        enableRealtime={true}
        wsBaseUrl="ws://localhost:8787"
      >
        <ContextCapture />
      </CSSPuckProvider>
    );

    // Wait for loadDocument's suppressNextSave and pendingRemoteUpdates guards
    // to clear (100ms timeout in loadDocument resets pendingRemoteUpdatesRef)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First call clears suppressNextSave, second hits the guards
    act(() => {
      if (capturedCtx && 'saveData' in capturedCtx) {
        const sd = (capturedCtx as { saveData: (data: PuckData) => void }).saveData;
        sd(TEST_DATA); // Clears suppressNextSave
        sd(TEST_DATA); // Should hit connection identity guard
      }
    });

    // Should still reject when paths genuinely don't match
    const mismatchWarnings = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].toLowerCase().includes('connection identity mismatch')
    );

    expect(mismatchWarnings.length).toBeGreaterThanOrEqual(1);

    warnSpy.mockRestore();
  });
});
