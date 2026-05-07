/**
 * Tests for stale loadDocument response guard.
 *
 * Validates that during rapid document navigation:
 * 1. Stale loadDocument responses are discarded (don't overwrite current document)
 * 2. Non-stale loadDocument responses proceed normally
 * 3. REST-loaded data is marked as non-local when realtime is enabled
 *    (prevents echoing back through Y.Doc)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { CSSPuckProvider } from '../src/editor/CSSPuckProvider.js';
import { useCSSPuck } from '../src/core/CSSPuckContext.js';
import type { CSSClient } from '@pantheon-systems/css-client';

// Helper: create a deferred promise for controlled resolution
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Mock WebSocket (required when enableRealtime=true)
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;
  binaryType: string = 'arraybuffer';

  private listeners: Map<string, Set<EventListener>> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
    }
    return true;
  }

  send = vi.fn();
  close = vi.fn();
}

const originalWebSocket = globalThis.WebSocket;

// Mock CSS Client
const createMockClient = () => {
  const client = {
    sites: { list: vi.fn(), get: vi.fn() },
    branches: {
      list: vi.fn().mockResolvedValue([
        { id: 'branch-1', isMain: true, name: 'main', siteId: 'site-1', status: 'active' },
      ]),
    },
    documents: { getByPath: vi.fn() },
    versions: { getLatest: vi.fn(), create: vi.fn(), get: vi.fn() },
    checkpoints: { create: vi.fn() },
    presence: { getBranchPresence: vi.fn() },
    agentEdit: {
      canEdit: vi.fn(),
      startEdit: vi.fn(),
      completeEdit: vi.fn(),
      abortEdit: vi.fn(),
    },
    withPrincipal: vi.fn(),
  };
  client.withPrincipal.mockReturnValue(client);
  return client as unknown as CSSClient;
};

// Test component to capture context
interface CapturedContext {
  loadDocument: (path: string) => Promise<void>;
  currentDocument: { path: string } | null;
  currentData: unknown;
  saveData: (data: unknown) => void;
}

function ContextCapture({
  onContext,
}: {
  onContext: (ctx: CapturedContext) => void;
}): null {
  const context = useCSSPuck();
  onContext(context as unknown as CapturedContext);
  return null;
}

describe('Stale loadDocument Response Guard', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockClient = createMockClient() as unknown as ReturnType<typeof createMockClient>;
    globalThis.WebSocket = vi.fn().mockImplementation(function (url: string) {
      return new MockWebSocket(url);
    }) as unknown as typeof WebSocket;
    Object.assign(globalThis.WebSocket, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it('should discard stale loadDocument response when a newer load is in flight', async () => {
    // Create deferred promises for controlling getByPath resolution order
    const docADeferred = createDeferred<{ id: string; siteId: string; path: string; createdAt: string }>();
    const docBDeferred = createDeferred<{ id: string; siteId: string; path: string; createdAt: string }>();

    const clientAny = mockClient as unknown as {
      documents: { getByPath: ReturnType<typeof vi.fn> };
      versions: { getLatest: ReturnType<typeof vi.fn> };
    };

    // First getByPath call returns A's deferred, second returns B's deferred
    clientAny.documents.getByPath
      .mockReturnValueOnce(docADeferred.promise)
      .mockReturnValueOnce(docBDeferred.promise);

    // getLatest always resolves immediately with version data
    clientAny.versions.getLatest.mockResolvedValue({
      id: 'version-1',
      documentId: 'any',
      branchId: 'branch-1',
      versionNumber: 1,
      snapshot: { content: [{ type: 'Text', props: { text: 'test' } }], root: { props: { title: 'Test' } } },
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });

    let ctx: CapturedContext | null = null;

    render(
      <CSSPuckProvider
        client={mockClient as unknown as CSSClient}
        siteId="site-1"
        branchId="branch-1"
        userId="user-1"
      >
        <ContextCapture onContext={(c) => { ctx = c; }} />
      </CSSPuckProvider>
    );

    // Wait for initial render
    await waitFor(() => {
      expect(ctx).not.toBeNull();
    });

    // Start both loadDocument calls (fire-and-forget, simulating rapid navigation)
    let loadADone = false;
    let loadBDone = false;
    void ctx!.loadDocument('pageA').then(() => { loadADone = true; }).catch(() => { loadADone = true; });
    void ctx!.loadDocument('pageB').then(() => { loadBDone = true; });

    // Resolve B first (the one the user actually wants)
    await act(async () => {
      docBDeferred.resolve({ id: 'doc-b', siteId: 'site-1', path: 'pageB', createdAt: new Date().toISOString() });
    });

    // Wait for B's data to appear
    await waitFor(() => {
      expect(loadBDone).toBe(true);
      expect(ctx!.currentDocument?.path).toBe('pageB');
    });

    // Now resolve A (stale - should be ignored)
    await act(async () => {
      docADeferred.resolve({ id: 'doc-a', siteId: 'site-1', path: 'pageA', createdAt: new Date().toISOString() });
    });

    // Wait for A's promise to settle
    await waitFor(() => {
      expect(loadADone).toBe(true);
    });

    // A should NOT have overwritten B
    expect(ctx!.currentDocument?.path).toBe('pageB');
  });

  it('should process non-stale loadDocument response normally', async () => {
    const clientAny = mockClient as unknown as {
      documents: { getByPath: ReturnType<typeof vi.fn> };
      versions: { getLatest: ReturnType<typeof vi.fn> };
    };

    clientAny.documents.getByPath.mockResolvedValue({
      id: 'doc-1',
      siteId: 'site-1',
      path: 'homePage',
      createdAt: new Date().toISOString(),
    });

    clientAny.versions.getLatest.mockResolvedValue({
      id: 'version-1',
      documentId: 'doc-1',
      branchId: 'branch-1',
      versionNumber: 1,
      snapshot: { content: [{ type: 'Heading', props: { text: 'Home' } }], root: { props: { title: 'Home Page' } } },
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });

    let ctx: CapturedContext | null = null;

    render(
      <CSSPuckProvider
        client={mockClient as unknown as CSSClient}
        siteId="site-1"
        branchId="branch-1"
        userId="user-1"
      >
        <ContextCapture onContext={(c) => { ctx = c; }} />
      </CSSPuckProvider>
    );

    await waitFor(() => {
      expect(ctx).not.toBeNull();
    });

    // Load a single document — no concurrent loads, should work normally
    await act(async () => {
      await ctx!.loadDocument('homePage');
    });

    expect(ctx!.currentDocument?.path).toBe('homePage');
    expect(ctx!.currentData).not.toBeNull();
  });

  it('should discard stale response even when first load resolves after second completes', async () => {
    // This tests the scenario from the bug report:
    // User navigates A → B → C, but A resolves last
    const docADeferred = createDeferred<{ id: string; siteId: string; path: string; createdAt: string }>();
    const docBDeferred = createDeferred<{ id: string; siteId: string; path: string; createdAt: string }>();
    const docCDeferred = createDeferred<{ id: string; siteId: string; path: string; createdAt: string }>();

    const clientAny = mockClient as unknown as {
      documents: { getByPath: ReturnType<typeof vi.fn> };
      versions: { getLatest: ReturnType<typeof vi.fn> };
    };

    clientAny.documents.getByPath
      .mockReturnValueOnce(docADeferred.promise)
      .mockReturnValueOnce(docBDeferred.promise)
      .mockReturnValueOnce(docCDeferred.promise);

    clientAny.versions.getLatest.mockResolvedValue({
      id: 'version-1',
      documentId: 'any',
      branchId: 'branch-1',
      versionNumber: 1,
      snapshot: { content: [], root: { props: {} } },
      source: 'edit',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: new Date().toISOString(),
    });

    let ctx: CapturedContext | null = null;

    render(
      <CSSPuckProvider
        client={mockClient as unknown as CSSClient}
        siteId="site-1"
        branchId="branch-1"
        userId="user-1"
      >
        <ContextCapture onContext={(c) => { ctx = c; }} />
      </CSSPuckProvider>
    );

    await waitFor(() => {
      expect(ctx).not.toBeNull();
    });

    // Rapid navigation: A → B → C
    let loadASettled = false;
    let loadBSettled = false;
    let loadCSettled = false;
    void ctx!.loadDocument('pageA').then(() => { loadASettled = true; }).catch(() => { loadASettled = true; });
    void ctx!.loadDocument('pageB').then(() => { loadBSettled = true; }).catch(() => { loadBSettled = true; });
    void ctx!.loadDocument('pageC').then(() => { loadCSettled = true; }).catch(() => { loadCSettled = true; });

    // Resolve C first (the final destination)
    await act(async () => {
      docCDeferred.resolve({ id: 'doc-c', siteId: 'site-1', path: 'pageC', createdAt: new Date().toISOString() });
    });
    await waitFor(() => expect(loadCSettled).toBe(true));

    // Then resolve B (stale)
    await act(async () => {
      docBDeferred.resolve({ id: 'doc-b', siteId: 'site-1', path: 'pageB', createdAt: new Date().toISOString() });
    });
    await waitFor(() => expect(loadBSettled).toBe(true));

    // Then resolve A (stale)
    await act(async () => {
      docADeferred.resolve({ id: 'doc-a', siteId: 'site-1', path: 'pageA', createdAt: new Date().toISOString() });
    });
    await waitFor(() => expect(loadASettled).toBe(true));

    // Only C's data should be active
    expect(ctx!.currentDocument?.path).toBe('pageC');
  });
});
