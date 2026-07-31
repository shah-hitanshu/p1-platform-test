/**
 * Tests for GET /api/sites/{siteId}/screenshot.
 *
 * The route returns an R2 presigned URL the browser uses to load the PNG
 * directly. 404 is the right answer when nothing has been captured (or
 * the last attempt failed) — the body still carries the status/error so
 * the UI can show a meaningful message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../src/types';
import type { SiteScreenshot } from '../../src/types';

vi.mock('../../src/services/site-screenshot-service', () => ({
  getSiteScreenshot: vi.fn(),
}));

vi.mock('../../src/services', () => ({
  getMainBranch: vi.fn(),
}));

vi.mock('../../src/auth/authorization', () => ({
  assertPermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {},
}));

vi.mock('../../src/storage/r2-presign', () => ({
  signR2GetUrl: vi.fn(),
}));

const mockPrincipal: AuthenticatedPrincipal = {
  id: 'user-alice',
  type: 'user',
  email: 'alice@example.com',
  authProvider: 'mock',
  pantheonSiteRoles: { 'site-123': 'viewer' },
  tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
};

const mockMainBranch = {
  id: 'branch-main',
  siteId: 'site-123',
  name: 'main',
  isMain: true,
  status: 'active' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockScreenshot: SiteScreenshot = {
  siteId: 'site-123',
  r2Key: 'screenshots/site-123.png',
  status: 'ok',
  capturedAt: '2026-05-08T10:00:00.000Z',
  createdAt: '2026-05-08T10:00:00.000Z',
  updatedAt: '2026-05-08T10:00:00.000Z',
};

interface PresignEnv {
  R2_SCREENSHOTS_BUCKET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

function createEnv(overrides: Partial<PresignEnv> = {}): PresignEnv {
  return {
    R2_SCREENSHOTS_BUCKET: 'css-screenshots-test',
    R2_ACCOUNT_ID: 'acct-abc',
    R2_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    R2_SECRET_ACCESS_KEY: 'secret-do-not-use',
    ...overrides,
  };
}

describe('GET /api/sites/{siteId}/screenshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 200 with a presigned URL when status=ok', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');
    const services = await import('../../src/services');
    const screenshotService = await import('../../src/services/site-screenshot-service');
    const presigner = await import('../../src/storage/r2-presign');

    vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
    vi.mocked(screenshotService.getSiteScreenshot).mockResolvedValue(mockScreenshot);
    vi.mocked(presigner.signR2GetUrl).mockResolvedValue({
      url: 'https://acct-abc.r2.cloudflarestorage.com/css-screenshots-test/screenshots/site-123.png?X-Amz-Signature=sig',
      expiresAt: '2026-05-08T11:00:00.000Z',
    });

    const request = new Request('https://api.example.com/api/sites/site-123/screenshot', {
      method: 'GET',
    });

    const response = await handleSiteScreenshotRoutes(
      request,
      { siteId: 'site-123', principal: mockPrincipal },
      createEnv(),
    );

    expect(response.status).toBe(200);
    const body: { url: string; expiresAt: string; capturedAt: string } = await response.json();
    expect(body.url).toContain('X-Amz-Signature');
    expect(body.expiresAt).toBe('2026-05-08T11:00:00.000Z');
    expect(body.capturedAt).toBe('2026-05-08T10:00:00.000Z');

    expect(presigner.signR2GetUrl).toHaveBeenCalledWith(expect.objectContaining({
      bucket: 'css-screenshots-test',
      key: 'screenshots/site-123.png',
      accountId: 'acct-abc',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret-do-not-use',
    }));
  });

  it('passes a TTL in seconds to the presigner', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');
    const services = await import('../../src/services');
    const screenshotService = await import('../../src/services/site-screenshot-service');
    const presigner = await import('../../src/storage/r2-presign');

    vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
    vi.mocked(screenshotService.getSiteScreenshot).mockResolvedValue(mockScreenshot);
    vi.mocked(presigner.signR2GetUrl).mockResolvedValue({
      url: 'https://example.com/x', expiresAt: '2026-05-08T11:00:00.000Z',
    });

    const request = new Request('https://api.example.com/api/sites/site-123/screenshot', {
      method: 'GET',
    });

    await handleSiteScreenshotRoutes(
      request,
      { siteId: 'site-123', principal: mockPrincipal },
      createEnv(),
    );

    const call = vi.mocked(presigner.signR2GetUrl).mock.calls[0][0];
    expect(typeof call.ttlSeconds).toBe('number');
    expect(call.ttlSeconds).toBeGreaterThan(0);
    expect(call.ttlSeconds).toBeLessThanOrEqual(86400);
  });

  it('returns 404 with status payload when no screenshot row exists', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');
    const services = await import('../../src/services');
    const screenshotService = await import('../../src/services/site-screenshot-service');

    vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
    vi.mocked(screenshotService.getSiteScreenshot).mockResolvedValue(null);

    const request = new Request('https://api.example.com/api/sites/site-123/screenshot', {
      method: 'GET',
    });

    const response = await handleSiteScreenshotRoutes(
      request,
      { siteId: 'site-123', principal: mockPrincipal },
      createEnv(),
    );

    expect(response.status).toBe(404);
    const body: { status?: string } = await response.json();
    expect(body.status).toBe('missing');
  });

  it('returns 404 with status=failed and error when the last capture failed', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');
    const services = await import('../../src/services');
    const screenshotService = await import('../../src/services/site-screenshot-service');

    vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
    vi.mocked(screenshotService.getSiteScreenshot).mockResolvedValue({
      ...mockScreenshot,
      status: 'failed',
      error: 'Browser Rendering 502: upstream gone',
    });

    const request = new Request('https://api.example.com/api/sites/site-123/screenshot', {
      method: 'GET',
    });

    const response = await handleSiteScreenshotRoutes(
      request,
      { siteId: 'site-123', principal: mockPrincipal },
      createEnv(),
    );

    expect(response.status).toBe(404);
    const body: { status?: string; error?: string } = await response.json();
    expect(body.status).toBe('failed');
    expect(body.error).toContain('502');
  });

  it('returns 404 when the site does not exist', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');
    const services = await import('../../src/services');

    vi.mocked(services.getMainBranch).mockResolvedValue(null);

    const request = new Request('https://api.example.com/api/sites/missing/screenshot', {
      method: 'GET',
    });

    const response = await handleSiteScreenshotRoutes(
      request,
      { siteId: 'missing', principal: mockPrincipal },
      createEnv(),
    );

    expect(response.status).toBe(404);
  });

  it('returns 403 when the principal lacks canView on the site', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');
    const services = await import('../../src/services');
    const auth = await import('../../src/auth/authorization');

    vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
    vi.mocked(auth.assertPermission).mockRejectedValue(
      new auth.AuthorizationError('Insufficient permissions'),
    );

    const request = new Request('https://api.example.com/api/sites/site-123/screenshot', {
      method: 'GET',
    });

    const response = await handleSiteScreenshotRoutes(
      request,
      { siteId: 'site-123', principal: mockPrincipal },
      createEnv(),
    );

    expect(response.status).toBe(403);
  });

  it('returns 500 when R2 presigning credentials are not configured', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');
    const services = await import('../../src/services');
    const screenshotService = await import('../../src/services/site-screenshot-service');

    vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
    vi.mocked(screenshotService.getSiteScreenshot).mockResolvedValue(mockScreenshot);

    const request = new Request('https://api.example.com/api/sites/site-123/screenshot', {
      method: 'GET',
    });

    const response = await handleSiteScreenshotRoutes(
      request,
      { siteId: 'site-123', principal: mockPrincipal },
      createEnv({ R2_ACCESS_KEY_ID: undefined }),
    );

    expect(response.status).toBe(500);
  });

  it('returns 400 when siteId is missing from the route context', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');

    const request = new Request('https://api.example.com/api/sites//screenshot', {
      method: 'GET',
    });

    const response = await handleSiteScreenshotRoutes(
      request,
      { siteId: undefined, principal: mockPrincipal },
      createEnv(),
    );

    expect(response.status).toBe(400);
  });

  it('returns 405 for non-GET methods', async () => {
    const { handleSiteScreenshotRoutes } = await import('../../src/routes/site-screenshot-api');
    const services = await import('../../src/services');

    vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);

    const request = new Request('https://api.example.com/api/sites/site-123/screenshot', {
      method: 'POST',
    });

    const response = await handleSiteScreenshotRoutes(
      request,
      { siteId: 'site-123', principal: mockPrincipal },
      createEnv(),
    );

    expect(response.status).toBe(405);
  });
});
