import { vi } from 'vitest';
import type { ChatContext } from '../src/types.js';

/**
 * Shared test doubles. Excluded from the build in tsconfig, so this never ships in `dist`.
 */

/** WebSocket stand-in that can also push server frames at the client. */
export class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
  open(): void { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  emit(msg: unknown): void { this.onmessage?.({ data: JSON.stringify(msg) }); }
  /** Frames this client sent, parsed — for asserting what reached the agent. */
  frames(): { type: string }[] {
    return this.sent.map(s => JSON.parse(s) as { type: string });
  }
}

export const baseContext: ChatContext = {
  siteId: 'site1',
  branchId: 'main',
  documentPath: '/current',
  documentId: 'doc1',
  token: 'tok',
};

export const MEDIA_URL = 'https://media.test';

/** Lets a test count token fetches, which is how it tells the send path did needless work. */
export interface AuthProbe {
  tokenFetches: number;
}

/*
 * Module factories for the three mocks every panel test needs. `vi.mock` hoists its factory
 * above the imports, so a test reaches these through `await import` inside the factory
 * rather than importing them at the top of the file.
 */

export function downscaleImageMock(): Record<string, unknown> {
  return { downscaleImage: async (file: File) => `data:image/webp;base64,${btoa(file.name)}` };
}

export function puckCoreMock(): Record<string, unknown> {
  return {
    useGetPuck: () => () => ({ dispatch: vi.fn() }),
    createUsePuck: () => (selector: (state: unknown) => unknown) =>
      selector({ selectedItem: null, appState: { ui: { itemSelector: null } }, config: { components: {} } }),
  };
}

export function puckCssMock(auth?: AuthProbe): Record<string, unknown> {
  return {
    humanizeComponentName: (name: string) => name,
    useP1Puck: () => ({
      userId: 'u1', siteId: 'site1', branchId: 'main',
      currentDocument: { id: 'doc1', path: '/current' },
      documents: [{ id: 'doc1', path: '/current', archived: false }],
    }),
    useP1Auth: () => ({
      getToken: async () => { if (auth) auth.tokenFetches += 1; return baseContext.token; },
      isAuthenticated: true,
    }),
    aiPanelStore: {
      close: vi.fn(), open: vi.fn(), toggle: vi.fn(), isOpen: () => true, subscribe: () => () => {},
    },
  };
}

/** Presign succeeds, PUT succeeds, finalize succeeds — overridden per test as needed. */
export function happyMedia(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/media/presign')) {
      return new Response(JSON.stringify({
        assetId: 'asset-1', versionId: 'v1', filename: 'brief.md', uploadUrl: 'https://storage.test/put',
      }), { status: 200 });
    }
    if (url.startsWith('https://storage.test/')) return new Response(null, { status: 200 });
    if (url.includes('/media/finalize')) return new Response('{}', { status: 201 });
    throw new Error(`unexpected request: ${url}`);
  });
}

/**
 * Patched rather than stubbed whole: replacing the global would take the URL constructor with
 * it, which the assertions parse request URLs through. Returns the undo.
 */
export function patchObjectUrls(
  { blobUrl = 'blob:kept', onRevoke }: { blobUrl?: string; onRevoke?: (url: string) => void } = {},
): () => void {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => blobUrl;
  URL.revokeObjectURL = (url: string) => onRevoke?.(url);
  return () => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  };
}
