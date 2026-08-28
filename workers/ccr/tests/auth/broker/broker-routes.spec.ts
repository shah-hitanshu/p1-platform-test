/**
 * Broker Route Handler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthenticatedPrincipal } from '../../../src/types/auth.js';
import type { Env } from '../../../src/index.js';

vi.mock('../../../src/auth/broker/jwt-issuer.js', () => ({
  issueBrokerJwt: vi.fn(),
}));

vi.mock('../../../src/auth/oauth/auth0-handler.js', () => ({
  getAuth0AuthorizationUrl: vi.fn(),
  exchangeAuth0Code: vi.fn(),
}));

vi.mock('../../../src/auth/oauth/state-signing.js', () => ({
  signState: vi.fn(),
  verifyAndParseState: vi.fn(),
  DEFAULT_STATE_TTL_SECONDS: 600,
}));

vi.mock('../../../src/middleware/authentication.js', () => ({
  authenticate: vi.fn(),
}));

vi.mock('../../../src/services/site-service.js', () => ({
  getCachedSiteAllowedOrigins: vi.fn(),
}));

// Mock transaction responses - set by tests
let mockTransactionResponse: unknown = null;

// Records every DO RPC the routes make, so tests can assert on what was sent.
// A fresh stub is created per `brokerTx.get()`, so the log has to live here.
let capturedDoCalls: { path: string; body: unknown }[] = [];

function createMockDurableObjectStub(): DurableObjectStub {
  return {
    // The routes call `stub.fetch(url, init)` as well as `stub.fetch(request)`,
    // so `init` has to be honoured or the POST body is lost.
    fetch: vi.fn(async (request: Request | string, init?: RequestInit) => {
      if (typeof request === 'string') {
        request = new Request(request, init);
      }
      let body: unknown = null;
      try {
        body = await request.clone().json();
      } catch {
        // GET RPCs carry no body
      }
      capturedDoCalls.push({ path: new URL(request.url).pathname, body });
      return new Response(JSON.stringify(mockTransactionResponse), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
    id: {} as DurableObjectId,
  } as unknown as DurableObjectStub;
}

function createMockBrokerTx(): DurableObjectNamespace {
  return {
    idFromName: vi.fn((name: string) => ({ toString: () => name }) as DurableObjectId),
    get: vi.fn(() => createMockDurableObjectStub()),
    idFromString: vi.fn(),
    newUniqueId: vi.fn(),
  } as unknown as DurableObjectNamespace;
}

/** Only the bindings the broker routes read; cast past the document, presence
 *  and KV bindings on Env, which these routes never touch. */
function createMockEnv(): Env {
  return {
    BROKER_TX: createMockBrokerTx(),
    AUTH0_CLIENT_ID: 'test-client-id',
    AUTH0_CLIENT_SECRET: 'test-client-secret',
    AUTH0_ISSUER_BASE_URL: 'https://example.auth0.com',
    MAS_GCP_SERVICE_ACCOUNT_KEY: '{}',
    GCP_KMS_KEY_RESOURCE: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
    BROKER_JWT_AUDIENCE: 'css-api',
    INTERNAL_SECRET: 'test-secret-at-least-32-characters-long',
  } as unknown as Env;
}

/** createMockEnv() typed as Env, for call sites that need the real handler signature. */
function createMockAuthEnv(): Env {
  return createMockEnv();
}

describe('BrokerRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTransactionResponse = null;
    capturedDoCalls = [];
  });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('POST /broker/login', () => {
    it('creates a transaction and returns loginUrl + transactionId', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'token-id-1',
        type: 'service',
        authProvider: 'site_token',
        siteId: 'site-123',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      mockTransactionResponse = {
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'pending',
        createdAt: 1000,
        expiresAt: 1300,
      };

      vi.mocked(signState).mockResolvedValue('signed-state');

      const request = new Request('https://css.example.com/broker/login', {
        method: 'POST',
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login');
      expect(response).not.toBeNull();

      const body: { transactionId: string; loginUrl: string } = await response?.json();
      expect(body.transactionId).toBe('tx-abc-123');
      expect(body.loginUrl).toContain('/broker/login/tx-abc-123');
    });

    it('returns 401 if not authenticated with sat_ token', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue(null);

      const request = new Request('https://css.example.com/broker/login', {
        method: 'POST',
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login');
      expect(response?.status).toBe(401);
    });

    it('stores redirectUrl from request body in the transaction', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'token-id-1',
        type: 'service',
        authProvider: 'site_token',
        siteId: 'site-123',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      mockTransactionResponse = {
        id: 'tx-redirect-1',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'pending',
        createdAt: 1000,
        expiresAt: 1300,
        redirectUrl: 'https://myapp.example.com/p1/editor',
      };

      const request = new Request('https://css.example.com/broker/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUrl: 'https://myapp.example.com/p1/editor' }),
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login');
      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);

      const body: { transactionId: string } = await response?.json();
      expect(body.transactionId).toBe('tx-redirect-1');
    });

    it('returns 403 if principal has no siteId', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'user-1',
        type: 'user',
        authProvider: 'auth0',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      const request = new Request('https://css.example.com/broker/login', {
        method: 'POST',
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login');
      expect(response?.status).toBe(403);
    });

    // PCC-3531: the SDK always sends redirectUrl and adds proposedRedirectUrl when
    // unconfigured. The broker decides, being the only party that authenticates
    // the site.
    describe('proposedRedirectUrl (PCC-3531)', () => {
      function sitePrincipal(): AuthenticatedPrincipal {
        return {
          id: 'token-id-1',
          type: 'service' as const,
          authProvider: 'site_token' as const,
          siteId: 'site-123',
          pantheonSiteRoles: {},
          tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
        };
      }

      function loginRequest(body: Record<string, unknown>): Request {
        return new Request('https://css.example.com/broker/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      /** Stable stub across get() calls so the create payload can be inspected;
       *  the shared createMockBrokerTx() builds a fresh one per call by design. */
      function observableEnv(
        overrides: Record<string, unknown> = {},
      ): { env: Env; fetchMock: ReturnType<typeof vi.fn> } {
        const fetchMock = vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockTransactionResponse), {
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        );
        const stub = { fetch: fetchMock, id: {} } as unknown as DurableObjectStub;
        const env = {
          ...createMockEnv(),
          BROKER_TX: {
            idFromName: vi.fn((name: string) => ({ toString: () => name }) as DurableObjectId),
            get: vi.fn(() => stub),
            idFromString: vi.fn(),
            newUniqueId: vi.fn(),
          } as unknown as DurableObjectNamespace,
          ...overrides,
        };
        return { env: env, fetchMock };
      }

      /** The redirectUrl the route asked the Durable Object to store. */
      function storedRedirectUrl(fetchMock: ReturnType<typeof vi.fn>): string | undefined {
        const call = fetchMock.mock.calls[0] as [string, { body: string }] | undefined;
        if (call === undefined) return undefined;
        const parsed = JSON.parse(call[1].body) as { options?: { redirectUrl?: string } };
        return parsed.options?.redirectUrl;
      }

      it('stores the proposal when it matches a registered origin', async () => {
        const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
        const { authenticate } = await import('../../../src/middleware/authentication.js');
        const siteService = await import('../../../src/services/site-service.js');

        vi.mocked(authenticate).mockResolvedValue(sitePrincipal());
        vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([
          'https://*-mysite.pantheonsite.io',
        ]);

        mockTransactionResponse = {
          id: 'tx-1',
          siteId: 'site-123',
          siteApiTokenId: 'token-id-1',
          status: 'pending',
          createdAt: 1000,
          expiresAt: 1300,
        };

        const { env, fetchMock } = observableEnv();
        const response = await handleBrokerRoutes(
          loginRequest({
            redirectUrl: 'http://localhost:3000/p1',
            proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1',
          }),
          env,
          '/broker/login',
        );

        expect(response?.status).toBe(200);
        expect(storedRedirectUrl(fetchMock)).toBe('https://live-mysite.pantheonsite.io/p1');
      });

      it('stores the fallback and returns a warning when the proposal is unregistered', async () => {
        const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
        const { authenticate } = await import('../../../src/middleware/authentication.js');
        const siteService = await import('../../../src/services/site-service.js');

        vi.mocked(authenticate).mockResolvedValue(sitePrincipal());
        vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([
          'https://*-mysite.pantheonsite.io',
        ]);

        mockTransactionResponse = {
          id: 'tx-2',
          siteId: 'site-123',
          siteApiTokenId: 'token-id-1',
          status: 'pending',
          createdAt: 1000,
          expiresAt: 1300,
        };

        const { env, fetchMock } = observableEnv();
        const response = await handleBrokerRoutes(
          loginRequest({
            redirectUrl: 'https://fallback.example.com/p1',
            proposedRedirectUrl: 'https://evil.example/p1',
          }),
          env,
          '/broker/login',
        );

        // Login proceeds on the fallback rather than erroring.
        expect(response?.status).toBe(200);
        expect(storedRedirectUrl(fetchMock)).toBe('https://fallback.example.com/p1');

        const body: { transactionId: string; warning?: string } | undefined =
          await response?.json();
        expect(body?.transactionId).toBe('tx-2');
        expect(body?.warning).toBeDefined();
        expect(body?.warning).toContain('https://evil.example');
      });

      // The fail-open trap: every site's array is empty today.
      it('ignores the proposal when the site has no registered origins', async () => {
        const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
        const { authenticate } = await import('../../../src/middleware/authentication.js');
        const siteService = await import('../../../src/services/site-service.js');

        vi.mocked(authenticate).mockResolvedValue(sitePrincipal());
        vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([]);

        mockTransactionResponse = {
          id: 'tx-3',
          siteId: 'site-123',
          siteApiTokenId: 'token-id-1',
          status: 'pending',
          createdAt: 1000,
          expiresAt: 1300,
        };

        const { env, fetchMock } = observableEnv();
        const response = await handleBrokerRoutes(
          loginRequest({
            redirectUrl: 'https://fallback.example.com/p1',
            proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1',
          }),
          env,
          '/broker/login',
        );

        expect(response?.status).toBe(200);
        expect(storedRedirectUrl(fetchMock)).toBe('https://fallback.example.com/p1');
      });

      // An older SDK must behave as before, including no wasted origins lookup.
      it('does not consult registered origins when no proposal is sent', async () => {
        const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
        const { authenticate } = await import('../../../src/middleware/authentication.js');
        const siteService = await import('../../../src/services/site-service.js');

        vi.mocked(authenticate).mockResolvedValue(sitePrincipal());
        vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([]);

        mockTransactionResponse = {
          id: 'tx-4',
          siteId: 'site-123',
          siteApiTokenId: 'token-id-1',
          status: 'pending',
          createdAt: 1000,
          expiresAt: 1300,
        };

        const { env, fetchMock } = observableEnv();
        const response = await handleBrokerRoutes(
          loginRequest({ redirectUrl: 'https://fallback.example.com/p1' }),
          env,
          '/broker/login',
        );

        expect(response?.status).toBe(200);
        expect(storedRedirectUrl(fetchMock)).toBe('https://fallback.example.com/p1');
        expect(siteService.getCachedSiteAllowedOrigins).not.toHaveBeenCalled();

        const body: { warning?: string } | undefined = await response?.json();
        expect(body?.warning).toBeUndefined();
      });

      it('refuses a localhost proposal when ENVIRONMENT is production', async () => {
        const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
        const { authenticate } = await import('../../../src/middleware/authentication.js');
        const siteService = await import('../../../src/services/site-service.js');

        vi.mocked(authenticate).mockResolvedValue(sitePrincipal());
        vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([
          'https://*-mysite.pantheonsite.io',
        ]);

        mockTransactionResponse = {
          id: 'tx-5',
          siteId: 'site-123',
          siteApiTokenId: 'token-id-1',
          status: 'pending',
          createdAt: 1000,
          expiresAt: 1300,
        };

        const { env, fetchMock } = observableEnv({ ENVIRONMENT: 'production' });
        const response = await handleBrokerRoutes(
          loginRequest({
            redirectUrl: 'https://fallback.example.com/p1',
            proposedRedirectUrl: 'http://localhost:3000/p1',
          }),
          env,
          '/broker/login',
        );

        expect(response?.status).toBe(200);
        expect(storedRedirectUrl(fetchMock)).toBe('https://fallback.example.com/p1');
      });

      // A failed lookup must not get a proposal honoured.
      it('ignores the proposal when the origins lookup throws', async () => {
        const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
        const { authenticate } = await import('../../../src/middleware/authentication.js');
        const siteService = await import('../../../src/services/site-service.js');

        vi.mocked(authenticate).mockResolvedValue(sitePrincipal());
        vi.mocked(siteService.getCachedSiteAllowedOrigins).mockRejectedValue(
          new Error('db unavailable'),
        );

        mockTransactionResponse = {
          id: 'tx-6',
          siteId: 'site-123',
          siteApiTokenId: 'token-id-1',
          status: 'pending',
          createdAt: 1000,
          expiresAt: 1300,
        };

        const { env, fetchMock } = observableEnv();
        const response = await handleBrokerRoutes(
          loginRequest({
            redirectUrl: 'https://fallback.example.com/p1',
            proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1',
          }),
          env,
          '/broker/login',
        );

        expect(response?.status).toBe(200);
        expect(storedRedirectUrl(fetchMock)).toBe('https://fallback.example.com/p1');
      });
    });
  });

  describe('GET /broker/login/:txId', () => {
    it('redirects to Auth0 for a valid pending transaction', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { getAuth0AuthorizationUrl } = await import('../../../src/auth/oauth/auth0-handler.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');

      mockTransactionResponse = {
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'pending',
        createdAt: 1000,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };

      vi.mocked(signState).mockResolvedValue('signed-state-value');
      vi.mocked(getAuth0AuthorizationUrl).mockReturnValue('https://example.auth0.com/authorize?...');

      const request = new Request('https://css.example.com/broker/login/tx-abc-123');
      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login/tx-abc-123');

      expect(response?.status).toBe(302);
      expect(response?.headers.get('Location')).toContain('auth0.com');
    });

    it('returns 404 for non-existent transaction', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');

      mockTransactionResponse = null;

      const request = new Request('https://css.example.com/broker/login/nonexistent');
      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login/nonexistent');

      expect(response?.status).toBe(404);
    });
  });

  describe('GET /auth/callback', () => {
    it('approves transaction and shows success page', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue({ txId: 'tx-abc-123' });

      vi.mocked(exchangeAuth0Code).mockResolvedValue({
        accessToken: 'auth0-access-token',
        user: {
          sub: 'auth0|user-1',
          email: 'user@example.com',
          name: 'Test User',
        },
      });

      mockTransactionResponse = {
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'approved',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      };

      const url = 'https://css.example.com/auth/callback?code=auth-code&state=signed-state';
      const request = new Request(url);
      const response = await handleBrokerRoutes(request, createMockEnv(), '/auth/callback');

      expect(response?.status).toBe(200);
    });

    it('redirects to transaction redirectUrl after successful auth', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue({ txId: 'tx-redirect-1' });

      vi.mocked(exchangeAuth0Code).mockResolvedValue({
        accessToken: 'auth0-access-token',
        user: {
          sub: 'auth0|user-1',
          email: 'user@example.com',
          name: 'Test User',
        },
      });

      mockTransactionResponse = {
        id: 'tx-redirect-1',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'approved',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
        redirectUrl: 'https://myapp.example.com/p1/editor',
      };

      const url = 'https://css.example.com/auth/callback?code=auth-code&state=signed-state';
      const request = new Request(url);
      const response = await handleBrokerRoutes(request, createMockEnv(), '/auth/callback');

      expect(response?.status).toBe(302);
      expect(response?.headers.get('Location')).toBe('https://myapp.example.com/p1/editor');
    });

    it('shows close-window page when no redirectUrl is set', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue({ txId: 'tx-no-redirect' });

      vi.mocked(exchangeAuth0Code).mockResolvedValue({
        accessToken: 'auth0-access-token',
        user: {
          sub: 'auth0|user-1',
          email: 'user@example.com',
          name: 'Test User',
        },
      });

      mockTransactionResponse = {
        id: 'tx-no-redirect',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'approved',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      };

      const url = 'https://css.example.com/auth/callback?code=auth-code&state=signed-state';
      const request = new Request(url);
      const response = await handleBrokerRoutes(request, createMockEnv(), '/auth/callback');

      expect(response?.status).toBe(200);
      const body = await response?.text();
      expect(body).toContain('close this window');
    });

    it('forwards the Auth0 picture claim to the transaction as userAvatarUrl', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { exchangeAuth0Code } = await import('../../../src/auth/oauth/auth0-handler.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue({ txId: 'tx-avatar-1' });

      vi.mocked(exchangeAuth0Code).mockResolvedValue({
        accessToken: 'auth0-access-token',
        user: {
          sub: 'auth0|user-1',
          email: 'user@example.com',
          name: 'Test User',
          picture: 'https://lh3.googleusercontent.com/a/alice=s96-c',
        },
      });

      mockTransactionResponse = {
        id: 'tx-avatar-1',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'approved',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      };

      const url = 'https://css.example.com/auth/callback?code=auth-code&state=signed-state';
      await handleBrokerRoutes(new Request(url), createMockEnv(), '/auth/callback');

      const approveCall = capturedDoCalls.find((c) => c.path === '/approve');
      expect(approveCall?.body).toMatchObject({
        userAvatarUrl: 'https://lh3.googleusercontent.com/a/alice=s96-c',
      });
    });

    it('returns 400 if state verification fails', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue(null);

      const url = 'https://css.example.com/auth/callback?code=auth-code&state=bad-state';
      const request = new Request(url);
      const response = await handleBrokerRoutes(request, createMockEnv(), '/auth/callback');

      expect(response?.status).toBe(400);
    });
  });

  describe('POST /broker/redeem', () => {
    it('returns a broker JWT for an approved transaction', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'token-id-1',
        type: 'service',
        authProvider: 'site_token',
        siteId: 'site-123',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      mockTransactionResponse = {
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'redeemed',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      };

      vi.mocked(issueBrokerJwt).mockResolvedValue('mock.broker.jwt');

      const request = new Request('https://css.example.com/broker/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: 'tx-abc-123' }),
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/redeem');
      expect(response?.status).toBe(200);

      const body: { token: string } = await response?.json();
      expect(body.token).toBe('mock.broker.jwt');
    });

    it('passes the transaction avatar URL into the issued JWT', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { issueBrokerJwt } = await import('../../../src/auth/broker/jwt-issuer.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'token-id-1',
        type: 'service',
        authProvider: 'site_token',
        siteId: 'site-123',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      mockTransactionResponse = {
        id: 'tx-avatar-2',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'redeemed',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
        userAvatarUrl: 'https://lh3.googleusercontent.com/a/alice=s96-c',
      };

      vi.mocked(issueBrokerJwt).mockResolvedValue('mock.broker.jwt');

      const request = new Request('https://css.example.com/broker/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: 'tx-avatar-2' }),
      });

      await handleBrokerRoutes(request, createMockEnv(), '/broker/redeem');

      expect(issueBrokerJwt).toHaveBeenCalledWith(
        expect.objectContaining({
          avatarUrl: 'https://lh3.googleusercontent.com/a/alice=s96-c',
        }),
      );
    });

    it('returns 400 if transactionId is missing', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'token-id-1',
        type: 'service',
        authProvider: 'site_token',
        siteId: 'site-123',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      const request = new Request('https://css.example.com/broker/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/redeem');
      expect(response?.status).toBe(400);
    });

    it('returns 403 if redeeming site does not match transaction site', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'token-id-1',
        type: 'service',
        authProvider: 'site_token',
        siteId: 'site-OTHER',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      mockTransactionResponse = {
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'redeemed',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
      };

      const request = new Request('https://css.example.com/broker/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: 'tx-abc-123' }),
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/redeem');
      expect(response?.status).toBe(403);
    });
  });

  describe('POST /broker/logout', () => {
    // Matches what BrokerJwtIdentityProvider actually builds: siteId set from
    // the site_id claim, pantheonSiteRoles empty.
    function brokerPrincipal(siteId = 'site-123'): AuthenticatedPrincipal {
      return {
        id: 'auth0|user-1',
        type: 'user',
        authProvider: 'broker',
        pantheonSiteRoles: {},
        siteId,
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      };
    }

    it('returns logoutUrl without returnTo or warning when none is provided', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue(brokerPrincipal());
      vi.mocked(signState).mockResolvedValue('signed-logout-state');

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);

      const body: { logoutUrl: string } = await response!.json();
      expect(body.logoutUrl).toContain('example.auth0.com/v2/logout');
      expect(body.logoutUrl).toContain('client_id=test-client-id');
      expect(body.logoutUrl).toContain('broker%2Flogout%2Fcomplete');
      expect(body).not.toHaveProperty('warning');

      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined, nonce: expect.any(String) }),
        'test-secret-at-least-32-characters-long',
      );
    });

    it('includes validated returnTo in signed state with no warning when origin matches', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      vi.mocked(authenticate).mockResolvedValue(brokerPrincipal());
      vi.mocked(signState).mockResolvedValue('signed-logout-state');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([
        'https://mysite.example.com',
      ]);

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://mysite.example.com/goodbye' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);

      const body: { logoutUrl: string } = await response!.json();
      expect(body).not.toHaveProperty('warning');

      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'logout',
          returnTo: 'https://mysite.example.com/goodbye',
          nonce: expect.any(String),
        }),
        'test-secret-at-least-32-characters-long',
      );
    });

    it('drops returnTo when origin is not registered', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      vi.mocked(authenticate).mockResolvedValue(brokerPrincipal());
      vi.mocked(signState).mockResolvedValue('signed-logout-state');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([
        'https://mysite.example.com',
      ]);

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://evil.example.com' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);

      const body: { logoutUrl: string } = await response!.json();
      // The rejected URL is logged, never echoed back to whoever proposed it.
      expect(body).not.toHaveProperty('warning');

      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined, nonce: expect.any(String) }),
        'test-secret-at-least-32-characters-long',
      );
    });

    it('drops returnTo when site has no registered origins (fail-closed)', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      vi.mocked(authenticate).mockResolvedValue(brokerPrincipal());
      vi.mocked(signState).mockResolvedValue('signed-logout-state');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([]);

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://mysite.example.com' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);

      const body: { logoutUrl: string } = await response!.json();
      expect(body).not.toHaveProperty('warning');

      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined, nonce: expect.any(String) }),
        'test-secret-at-least-32-characters-long',
      );
    });

    it('drops returnTo when origins lookup fails', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      vi.mocked(authenticate).mockResolvedValue(brokerPrincipal());
      vi.mocked(signState).mockResolvedValue('signed-logout-state');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockRejectedValue(
        new Error('db unavailable'),
      );

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://mysite.example.com' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);

      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined, nonce: expect.any(String) }),
        'test-secret-at-least-32-characters-long',
      );
    });

    // Unauthenticated by design. The URL is built from config and a fresh nonce,
    // so a credential has nothing here to protect.
    it('mints a logout URL with no credential at all', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      vi.mocked(authenticate).mockResolvedValue(null);
      vi.mocked(signState).mockResolvedValue('signed-logout-state');

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);
      const body: { logoutUrl: string } = await response!.json();
      expect(body.logoutUrl).toContain('https://example.auth0.com/v2/logout');
      expect(body).not.toHaveProperty('warning');
      expect(siteService.getCachedSiteAllowedOrigins).not.toHaveBeenCalled();
      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined }),
        'test-secret-at-least-32-characters-long',
      );
    });

    // The case this route exists to serve: the broker JWT expired while a tab
    // sat open, so authenticate() rejects it. The Auth0 session still ends.
    it('still mints a logout URL when the broker JWT has expired', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      // An expired token is indistinguishable from no token here — the verifier
      // rejects it before a principal is ever built.
      vi.mocked(authenticate).mockResolvedValue(null);
      vi.mocked(signState).mockResolvedValue('signed-logout-state');

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://mysite.example.com' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);
      const body: { logoutUrl: string } = await response!.json();
      expect(body.logoutUrl).toContain('https://example.auth0.com/v2/logout');
      // The rejection is logged, never returned — the caller cannot act on it,
      // and it would tell an anonymous caller how the route decided.
      expect(body).not.toHaveProperty('warning');
      // No session means no site, and no site means no database read.
      expect(siteService.getCachedSiteAllowedOrigins).not.toHaveBeenCalled();
      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined }),
        'test-secret-at-least-32-characters-long',
      );
    });

    it('throws if AUTH0_ISSUER_BASE_URL is missing, consistent with /broker/login and /auth/callback', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue(brokerPrincipal());

      const env = createMockAuthEnv();
      delete env.AUTH0_ISSUER_BASE_URL;

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
      });

      await expect(handleBrokerRoutes(request, env, '/broker/logout')).rejects.toThrow(
        'Missing required environment variable: AUTH0_ISSUER_BASE_URL',
      );
    });

    it('resolves the site to validate returnTo against from principal.siteId', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      vi.mocked(authenticate).mockResolvedValue(brokerPrincipal());
      vi.mocked(signState).mockResolvedValue('signed-logout-state');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([
        'https://mysite.example.com',
      ]);

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://mysite.example.com/goodbye' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);
      expect(siteService.getCachedSiteAllowedOrigins).toHaveBeenCalledWith('site-123');
    });

    // Deliberately wider than the 403 this replaces. Scope to one site is the
    // whole authorisation rule, so a site token qualifies exactly as a broker
    // JWT does; a provider check would add a second rule that guards nothing.
    it('validates returnTo for any principal scoped to a single site', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'site-token-user',
        type: 'service',
        authProvider: 'site_token',
        pantheonSiteRoles: {},
        siteId: 'site-123',
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });
      vi.mocked(signState).mockResolvedValue('signed-logout-state');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([
        'https://mysite.example.com',
      ]);

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://mysite.example.com/goodbye' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);
      expect(siteService.getCachedSiteAllowedOrigins).toHaveBeenCalledWith('site-123');
      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'logout',
          returnTo: 'https://mysite.example.com/goodbye',
        }),
        'test-secret-at-least-32-characters-long',
      );
    });

    // Site resolution used to fall back to a single pantheonSiteRoles entry.
    // Without this, reinstating that fallback goes unnoticed.
    it('does not fall back to pantheonSiteRoles when siteId is absent', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      const rolesOnly: AuthenticatedPrincipal = brokerPrincipal();
      delete rolesOnly.siteId;
      rolesOnly.pantheonSiteRoles = { 'site-123': 'admin' };
      vi.mocked(authenticate).mockResolvedValue(rolesOnly);
      vi.mocked(signState).mockResolvedValue('signed-logout-state');

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://mysite.example.com' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);
      expect(siteService.getCachedSiteAllowedOrigins).not.toHaveBeenCalled();
      // The roles entry naming site-123 must not reach the signed state.
      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined }),
        'test-secret-at-least-32-characters-long',
      );
    });

    // The request Origin was briefly used as a fallback when returnTo was
    // rejected. It let a registered localhost origin through on a deployed
    // environment, bypassing the rule that had just rejected the proposal.
    it('does not fall back to the request Origin when returnTo is rejected', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      vi.mocked(authenticate).mockResolvedValue(brokerPrincipal());
      vi.mocked(signState).mockResolvedValue('signed-logout-state');
      vi.mocked(siteService.getCachedSiteAllowedOrigins).mockResolvedValue([
        'https://mysite.example.com',
      ]);

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Registered, and would have been handed back as the fallback.
          'Origin': 'https://mysite.example.com',
        },
        // Not registered, so it is rejected.
        body: JSON.stringify({ returnTo: 'https://elsewhere.example.com/goodbye' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);

      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined }),
        'test-secret-at-least-32-characters-long',
      );
    });

    // A principal that names no site cannot authorise a returnTo, but it also
    // must not cost the caller the logout itself.
    it('drops returnTo but still mints a URL when the principal names no site', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');
      const siteService = await import('../../../src/services/site-service.js');

      const withoutSiteId: AuthenticatedPrincipal = brokerPrincipal();
      delete withoutSiteId.siteId;
      vi.mocked(authenticate).mockResolvedValue(withoutSiteId);
      vi.mocked(signState).mockResolvedValue('signed-logout-state');

      const request = new Request('https://css.example.com/broker/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: 'https://mysite.example.com' }),
      });

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout');
      expect(response?.status).toBe(200);
      const body: { logoutUrl: string } = await response!.json();
      expect(body.logoutUrl).toContain('https://example.auth0.com/v2/logout');
      expect(body).not.toHaveProperty('warning');
      expect(siteService.getCachedSiteAllowedOrigins).not.toHaveBeenCalled();
      expect(signState).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'logout', returnTo: undefined }),
        'test-secret-at-least-32-characters-long',
      );
    });
  });

  describe('GET /broker/logout/complete', () => {
    it('redirects to returnTo when state contains a validated returnTo', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue({
        purpose: 'logout',
        returnTo: 'https://mysite.example.com/goodbye',
        nonce: 'nonce-1',
      });
      mockTransactionResponse = { claimed: true };

      const request = new Request(
        'https://css.example.com/broker/logout/complete?state=signed-logout-state',
      );

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout/complete');
      expect(response?.status).toBe(302);
      expect(response?.headers.get('Location')).toBe('https://mysite.example.com/goodbye');
      expect(response?.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    it('shows logged-out page when state has no returnTo', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue({
        purpose: 'logout',
        nonce: 'nonce-2',
      });
      mockTransactionResponse = { claimed: true };

      const request = new Request(
        'https://css.example.com/broker/logout/complete?state=signed-logout-state',
      );

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout/complete');
      expect(response?.status).toBe(200);
      const body = await response?.text();
      expect(body).toContain('Logged out');
      expect(body).toContain('close this window');
      // No returnTo means no redirect to make single-use, so nothing is claimed
      // and an anonymous caller cannot make the route write durable state.
      expect(capturedDoCalls).toEqual([]);
    });

    it('returns logged-out HTML page on back-navigation when nonce was already claimed', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      // Carries a returnTo: a state without one can never redirect, so it is the
      // only case where a replayed nonce could produce a second redirect.
      vi.mocked(verifyAndParseState).mockResolvedValue({
        purpose: 'logout',
        returnTo: 'https://mysite.example.com/goodbye',
        nonce: 'nonce-abc',
      });
      mockTransactionResponse = { claimed: false };

      const request = new Request(
        'https://css.example.com/broker/logout/complete?state=signed-logout-state',
      );

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout/complete');
      // Must not redirect (no second redirect from an already-consumed nonce).
      expect(response?.status).toBe(200);
      const body = await response?.text();
      expect(body).toContain('Logged out');
      expect(capturedDoCalls).toEqual([
        { path: '/nonce/claim', body: { nonce: 'nonce-abc', ttlSeconds: 600 } },
      ]);
    });

    it('returns 400 when state purpose is not logout', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue({
        purpose: 'login',
        nonce: 'nonce-abc',
      });

      const request = new Request(
        'https://css.example.com/broker/logout/complete?state=signed-logout-state',
      );

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout/complete');
      expect(response?.status).toBe(400);
      expect(capturedDoCalls).toEqual([]);
    });

    it('returns 400 when state has no nonce', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue({
        purpose: 'logout',
      });

      const request = new Request(
        'https://css.example.com/broker/logout/complete?state=signed-logout-state',
      );

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout/complete');
      expect(response?.status).toBe(400);
      expect(capturedDoCalls).toEqual([]);
    });

    it('returns 400 if state is missing', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');

      const request = new Request('https://css.example.com/broker/logout/complete');

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout/complete');
      expect(response?.status).toBe(400);
    });

    it('returns 400 if state verification fails (tampered or expired)', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { verifyAndParseState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(verifyAndParseState).mockResolvedValue(null);

      const request = new Request(
        'https://css.example.com/broker/logout/complete?state=tampered-state',
      );

      const response = await handleBrokerRoutes(request, createMockAuthEnv(), '/broker/logout/complete');
      expect(response?.status).toBe(400);
    });
  });

  describe('unmatched routes', () => {
    it('returns null for non-broker paths', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');

      const request = new Request('https://css.example.com/api/sites');
      const response = await handleBrokerRoutes(request, createMockEnv(), '/api/sites');

      expect(response).toBeNull();
    });
  });
});
