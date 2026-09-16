import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/resolve-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/resolve-connection')>();
  return { ...actual, resolveConnection: vi.fn(actual.resolveConnection) };
});
vi.mock('../../src/middleware/authentication', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/middleware/authentication')>()),
  authenticate: vi.fn(async () => {
    throw new Error('no auth in this test');
  }),
}));

import worker from '../../src/index';
import type { Env } from '../../src/index';
import { resolveConnection } from '../../src/db/resolve-connection';

const env = {
  POSTGRES_CONNECTION_STRING: 'postgres://user:pass@localhost:5432/unused',
  METRICS_ENABLED: 'false',
  ENVIRONMENT: 'test',
} as unknown as Env;
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

// The resolver only picks a binding; which pool a route asks for is decided
// at the request entry point, so that is what this pins.
describe('which Hyperdrive pool a route asks for', () => {
  it.each([
    ['GET', '/api/admin/users', true],
    ['POST', '/api/organizations/abc/users', true],
    // The router tolerates a trailing slash, so the pool choice must too.
    ['POST', '/api/organizations/abc/users/', true],
    ['GET', '/api/organizations/abc/users', false],
    ['POST', '/api/organizations/abc/users/def', false],
    ['GET', '/api/sites', false],
  ])('%s %s → requireFresh=%s', async (method, path, fresh) => {
    vi.mocked(resolveConnection).mockClear();
    await worker.fetch(new Request(`https://css.example.com${path}`, { method }), env, ctx);
    expect(resolveConnection).toHaveBeenCalledWith(env, fresh);
  });
});
