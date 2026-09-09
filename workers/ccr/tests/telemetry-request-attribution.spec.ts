/**
 * The site a request addressed has to survive into the log line.
 *
 * `http.route` is normalized to `/api/sites/:id` on purpose, so without a field of its
 * own there is nothing in a log line that names the tenant, and traffic cannot be
 * attributed. These drive the real worker entry point rather than the context helper,
 * because the failure mode is the wiring: the context is built before routing, and the
 * value has to come from the route parser rather than a second regex over the path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const siteOrigins = vi.hoisted(() => ({
  // Throwing is what makes the preflight emit a log line at all, and that line is the
  // observable surface — a preflight that succeeds logs nothing.
  getCachedSiteAllowedOrigins: vi.fn(async () => {
    throw new Error('no database in this test');
  }),
}));

vi.mock('../src/services/site-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/site-service')>()),
  getCachedSiteAllowedOrigins: siteOrigins.getCachedSiteAllowedOrigins,
}));

const auth = vi.hoisted(() => ({ authenticate: vi.fn() }));

vi.mock('../src/middleware/authentication', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/middleware/authentication')>()),
  authenticate: auth.authenticate,
}));

import worker from '../src/index';
import type { Env } from '../src/index';
import { ensureLogger, resetLoggerForTests } from '../src/telemetry';

const SITE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function testEnv(): Env {
  return {
    POSTGRES_CONNECTION_STRING: 'postgres://user:pass@localhost:5432/unused',
    METRICS_ENABLED: 'false',
    ENVIRONMENT: 'local',
    LOG_LEVEL: 'debug',
  } as unknown as Env;
}

function testCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

async function linesFor(request: Request): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = [];
  const env = testEnv();
  ensureLogger(env).addSink({
    id: 'capture',
    write: (line) => lines.push(line as unknown as Record<string, unknown>),
    flush: async () => undefined,
  });
  await worker.fetch(request, env, testCtx());
  return lines;
}

beforeEach(() => {
  resetLoggerForTests();
  auth.authenticate.mockReset();
});

describe('site_id on the request context', () => {
  it('names the site on every line of a site-scoped request', async () => {
    const lines = await linesFor(
      new Request(`https://css.example.com/api/sites/${SITE_ID}`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com' },
      }),
    );

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.site_id).toBe(SITE_ID);
    }
  });

  it('leaves http.route normalized, so the id is not back in the route label', async () => {
    const [line] = await linesFor(
      new Request(`https://css.example.com/api/sites/${SITE_ID}`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com' },
      }),
    );

    expect(line?.['http.route']).toBe('/api/sites/:id');
  });

  it('omits the field entirely on a request that names no site', async () => {
    const lines = await linesFor(
      new Request('https://css.example.com/no-such-route', { method: 'GET' }),
    );

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toHaveProperty('site_id');
    }
  });

  it('drops a path segment that is not shaped like an id rather than logging it', async () => {
    const lines = await linesFor(
      new Request('https://css.example.com/api/sites/not%20an%20id', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com' },
      }),
    );

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toHaveProperty('site_id');
    }
  });
});

/**
 * Who was calling cannot be derived from the path — it comes from the credential, which
 * is only validated after routing. A service principal on a route with no site is
 * rejected before any query runs, which is what makes this reachable without a database.
 */
describe('principal_type and auth_provider on the request context', () => {
  it('names the kind of caller and the provider that validated it', async () => {
    auth.authenticate.mockResolvedValue({
      id: 'svc-1',
      type: 'service',
      authProvider: 'site_token',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 60_000).toISOString(),
    });

    const lines = await linesFor(
      new Request('https://css.example.com/api/sites', {
        method: 'GET',
        headers: { 'X-API-Key': 'sat_whatever' },
      }),
    );

    const complete = lines.find((line) => line.msg === 'request complete');
    expect(complete?.principal_type).toBe('service');
    expect(complete?.auth_provider).toBe('site_token');
  });

  it('leaves both fields off a request that never authenticated', async () => {
    auth.authenticate.mockResolvedValue(null);

    const lines = await linesFor(
      new Request('https://css.example.com/api/sites', { method: 'GET' }),
    );

    const complete = lines.find((line) => line.msg === 'request complete');
    expect(complete).toBeDefined();
    expect(complete).not.toHaveProperty('principal_type');
    expect(complete).not.toHaveProperty('auth_provider');
  });
});
