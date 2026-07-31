/**
 * Route Dispatch Tests
 *
 * Covers the dispatcher-level guard that protects the site-import route: when the
 * worker has no INTERNAL_SECRET configured, bundle signatures cannot be verified, so
 * import must fail safe with a generic 503 BEFORE the import handler runs — rather than
 * letting a request reach signature verification with no signing key. The guard also
 * must not leak the internal env var name in its response (PR #135, Finding 3/5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';

// Importing the dispatcher transitively pulls in every route handler (and their service
// imports). Mock the DB layer so no real connection is attempted at import time.
vi.mock('../../src/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }));
// Spy on the import handler so we can assert the guard short-circuits before it is reached.
vi.mock('../../src/routes/site-import-api', () => ({ handleSiteImportRoute: vi.fn() }));

import { dispatchRoute } from '../../src/routes/route-dispatch';
import { handleSiteImportRoute } from '../../src/routes/site-import-api';

const mockHandleImport = vi.mocked(handleSiteImportRoute);

function createPrincipal(): AuthenticatedPrincipal {
  return {
    id: 'user-1',
    type: 'user',
    email: 'admin@example.com',
    systemRole: 'admin',
    pantheonSiteRoles: {},
    tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
  };
}

function importRequest(): Request {
  return new Request('https://example.com/api/admin/sites/site-1/import', { method: 'POST' });
}

describe('dispatchRoute — site-import INTERNAL_SECRET guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 and does not invoke the import handler when INTERNAL_SECRET is undefined', async () => {
    const resp = await dispatchRoute(
      importRequest(),
      { handler: 'site-import', params: { siteId: 'site-1' } },
      createPrincipal(),
      { CONFIG_KV: {} as KVNamespace } as never, // INTERNAL_SECRET absent
      undefined,
    );

    expect(resp.status).toBe(503);
    expect(mockHandleImport).not.toHaveBeenCalled();
    const body = JSON.parse(await resp.text()) as { error: string };
    // Generic message — must not leak the internal env var name (Finding 5).
    expect(body.error).toContain('not available');
    expect(body.error).not.toContain('INTERNAL_SECRET');
  });

  it('returns 503 when INTERNAL_SECRET is an empty string', async () => {
    const resp = await dispatchRoute(
      importRequest(),
      { handler: 'site-import', params: { siteId: 'site-1' } },
      createPrincipal(),
      { CONFIG_KV: {} as KVNamespace, INTERNAL_SECRET: '' } as never,
      undefined,
    );

    expect(resp.status).toBe(503);
    expect(mockHandleImport).not.toHaveBeenCalled();
  });

  it('invokes the import handler when INTERNAL_SECRET is present', async () => {
    mockHandleImport.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const resp = await dispatchRoute(
      importRequest(),
      { handler: 'site-import', params: { siteId: 'site-1' } },
      createPrincipal(),
      { CONFIG_KV: {} as KVNamespace, INTERNAL_SECRET: 'present' } as never,
      undefined,
    );

    expect(resp.status).toBe(200);
    expect(mockHandleImport).toHaveBeenCalledTimes(1);
    // The narrowed, non-empty secret is forwarded to the handler.
    expect(mockHandleImport).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ siteId: 'site-1' }),
      expect.objectContaining({ INTERNAL_SECRET: 'present' }),
    );
  });
});
