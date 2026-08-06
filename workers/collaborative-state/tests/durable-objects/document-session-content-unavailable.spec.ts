/**
 * A session that could not load its content from PostgreSQL holds an empty
 * Y.Doc. Serving that as the document would show an editor a blank page it
 * could then save over the stored content, so the endpoints that read or write
 * content report the failure instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson } from '../helpers/http';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const SESSION_ID = [
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'cccccccc-0000-4000-8000-000000000001',
].join(':');

interface MockState {
  id: { toString: () => string; name: string };
  storage: Record<string, ReturnType<typeof vi.fn>>;
  blockConcurrencyWhile: ReturnType<typeof vi.fn>;
  acceptWebSocket: ReturnType<typeof vi.fn>;
  getWebSockets: ReturnType<typeof vi.fn>;
}

function createMockState(): MockState {
  const storageData = new Map<string, unknown>();

  return {
    id: { toString: (): string => SESSION_ID, name: SESSION_ID },
    storage: {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.get(key))),
      put: vi.fn().mockImplementation((key: string, value: unknown) => {
        storageData.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.delete(key))),
      list: vi.fn().mockResolvedValue(new Map()),
      getAlarm: vi.fn().mockResolvedValue(null),
      setAlarm: vi.fn().mockResolvedValue(undefined),
    },
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => { await cb(); }),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
  };
}

const ENV_WITH_POSTGRES = {
  API_URL: 'http://localhost:8787',
  ENVIRONMENT: 'test',
  INTERNAL_API_URL: 'https://internal.example.com',
  INTERNAL_SECRET: 'secret',
};

describe('Endpoints on a session whose content failed to load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('PostgreSQL unreachable'));
  });

  it.each(['/snapshot', '/apply', '/connect', '/sync', '/flush'])(
    'reports content unavailable from %s',
    async (path) => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const session = new DocumentSession(createMockState(), ENV_WITH_POSTGRES);

      const response = await session.fetch(new Request(`http://localhost${path}`, { method: 'POST' }));

      expect(response.status).toBe(503);
      const body = await readJson(response);
      expect((body as { error: string }).error).toMatch(/could not be loaded/);
    },
  );

  it('still answers presence queries, which do not depend on content', async () => {
    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(createMockState(), ENV_WITH_POSTGRES);

    const response = await session.fetch(new Request('http://localhost/presences'));

    expect(response.status).toBe(200);
  });

  it('serves content once the load succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ snapshot: { content: [] } }), { status: 200 }),
    );

    const { DocumentSession } = await import('../../src/durable-objects/document-session');
    const session = new DocumentSession(createMockState(), ENV_WITH_POSTGRES);

    const response = await session.fetch(new Request('http://localhost/snapshot'));

    expect(response.status).toBe(200);
  });
});
