// Polyfill browser globals missing in the Node.js test environment.
// Vitest runs with environment: 'node', which lacks CloseEvent and
// may lack WebSocket depending on the Node version.

if (typeof globalThis.CloseEvent === 'undefined') {
  (globalThis as Record<string, unknown>).CloseEvent = class CloseEvent extends Event {
    code: number;
    reason: string;
    wasClean: boolean;
    constructor(type: string, init: { code?: number; reason?: string; wasClean?: boolean } = {}) {
      super(type);
      this.code = init.code ?? 1000;
      this.reason = init.reason ?? '';
      this.wasClean = init.wasClean ?? true;
    }
  };
}

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as Record<string, unknown>).WebSocket = class WebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    constructor(public url: string) { super(); }
    send(_data: unknown) {}
    close() {}
  };
}
