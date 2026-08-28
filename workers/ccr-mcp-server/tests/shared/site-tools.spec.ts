/**
 * create_site / get_site / update_site Tool Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

const agentConfig = {
  baseUrl: 'http://localhost:8787',
  agentId: 'agent-1',
  agentApiKey: 'aak_test',
};

const userConfig = {
  baseUrl: 'http://localhost:8787',
  accessToken: 'auth0-token',
};

const siteResponse = {
  id: 'site-new',
  name: 'Marketing Website',
  pantheonSiteId: 'pantheon-123',
  url: 'https://example.com',
  allowedOrigins: ['https://example.com'],
  workflowSettings: { mergeApprovalMode: 'optional', minApprovers: 1 },
  createdAt: '2026-08-27T10:00:00.000Z',
  updatedAt: '2026-08-27T10:00:00.000Z',
};

async function makeHandlers(config: Record<string, unknown>) {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createToolHandlers } = await import('../../src/shared/tools.js');
  return createToolHandlers(new McpApiClient(config as never));
}

describe('create_site tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('posts to /api/sites and reports the new site as ready to use', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, siteResponse, 201));

    const result = await handlers.create_site({
      name: 'Marketing Website',
      url: 'https://example.com',
      pantheon_site_id: 'pantheon-123',
      allowed_origins: ['https://example.com'],
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('site-new');
    expect(result.content[0].text).toContain('main');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/api/sites');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Marketing Website',
      url: 'https://example.com',
      pantheonSiteId: 'pantheon-123',
      allowedOrigins: ['https://example.com'],
    });
  });

  it('omits optional fields that were not supplied', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, siteResponse, 201));

    await handlers.create_site({ name: 'Bare Site' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Bare Site' });
  });

  it('refuses on an agent key without calling the backend', async () => {
    const handlers = await makeHandlers(agentConfig);

    const result = await handlers.create_site({ name: 'Autonomous Site' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('authenticated user session');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces a backend rejection as an error result', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(
      createMockResponse(false, { error: 'Site creation requires an authenticated user session.' }, 403),
    );

    const result = await handlers.create_site({ name: 'Marketing Website' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('authenticated user session');
  });
});

describe('site tool input schemas', () => {
  it('rejects a blank name on create and update', async () => {
    const { schemas } = await import('../../src/shared/tools.js');

    // updateSite writes name through COALESCE($1, name), so '' is stored as
    // the new name rather than meaning "leave it alone". The backend rejects
    // it; failing here saves the round trip.
    expect(schemas.create_site.safeParse({ name: '' }).success).toBe(false);
    expect(schemas.create_site.safeParse({ name: '   ' }).success).toBe(false);
    expect(schemas.update_site.safeParse({ site_id: 's', name: '' }).success).toBe(false);
    expect(schemas.update_site.safeParse({ site_id: 's', name: '   ' }).success).toBe(false);
  });

  it('still accepts a real name, and an update that omits it', async () => {
    const { schemas } = await import('../../src/shared/tools.js');

    expect(schemas.create_site.safeParse({ name: 'Marketing' }).success).toBe(true);
    expect(schemas.update_site.safeParse({ site_id: 's', url: null }).success).toBe(true);
  });
});

describe('get_site tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders every configuration field', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, siteResponse));

    const result = await handlers.get_site({ site_id: 'site-new' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('Marketing Website');
    expect(text).toContain('https://example.com');
    expect(text).toContain('pantheon-123');
    expect(text).toContain('mergeApprovalMode');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/api/sites/site-new');
    expect(init.method).toBe('GET');
  });

  it('spells out unset optional fields rather than printing undefined', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(
      createMockResponse(true, { ...siteResponse, url: undefined, pantheonSiteId: undefined, allowedOrigins: [] }),
    );

    const result = await handlers.get_site({ site_id: 'site-new' });

    const text = result.content[0].text;
    expect(text).toContain('(not set)');
    expect(text).toContain('(not linked)');
    expect(text).not.toContain('undefined');
  });

  it('does not describe an empty origin list as simply unrestricted', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { ...siteResponse, allowedOrigins: [] }));

    const result = await handlers.get_site({ site_id: 'site-new' });

    // buildCorsPatterns falls back to wildcard-all on an empty list while
    // resolveRedirectOrigin fails closed, so reporting only the CORS half
    // would hide a broken sign-in from anyone reading this output.
    const text = result.content[0].text;
    expect(text).toContain('CORS accepts any origin');
    expect(text).toContain('login redirects are refused');
  });

  it('works on an agent key', async () => {
    const handlers = await makeHandlers(agentConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, siteResponse));

    const result = await handlers.get_site({ site_id: 'site-new' });

    expect(result.isError).toBeFalsy();
  });
});

describe('update_site tool', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('sends only the supplied fields', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, siteResponse));

    await handlers.update_site({ site_id: 'site-new', name: 'Renamed' });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/api/sites/site-new');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Renamed' });
  });

  it('sends an explicit null to clear url and pantheon_site_id', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, siteResponse));

    await handlers.update_site({ site_id: 'site-new', url: null, pantheon_site_id: null });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toHaveProperty('url', null);
    expect(body).toHaveProperty('pantheonSiteId', null);
  });

  it('omits the clearable keys entirely when they were not supplied', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, siteResponse));

    await handlers.update_site({ site_id: 'site-new', name: 'Renamed' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    // Key presence is the wire contract: an absent key means "leave as-is",
    // so a null here would silently clear the stored value.
    expect(Object.keys(body)).not.toContain('url');
    expect(Object.keys(body)).not.toContain('pantheonSiteId');
  });

  it('replaces the allowed origins list wholesale', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(createMockResponse(true, siteResponse));

    await handlers.update_site({ site_id: 'site-new', allowed_origins: [] });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ allowedOrigins: [] });
  });

  it('rejects a call that supplies no fields to change', async () => {
    const handlers = await makeHandlers(userConfig);

    const result = await handlers.update_site({ site_id: 'site-new' });

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces the backend origin-pattern validation message', async () => {
    const handlers = await makeHandlers(userConfig);
    mockFetch.mockResolvedValueOnce(
      createMockResponse(false, { error: 'allowedOrigins[0]: wildcard is only allowed in the leftmost label' }, 400),
    );

    const result = await handlers.update_site({
      site_id: 'site-new',
      allowed_origins: ['https://example.*.com'],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('wildcard is only allowed');
  });
});
