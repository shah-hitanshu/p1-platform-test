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
