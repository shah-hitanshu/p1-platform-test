/**
 * Broker Route Handler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/auth/broker/transaction.js', () => ({
  createTransaction: vi.fn(),
  getTransaction: vi.fn(),
  approveTransaction: vi.fn(),
  redeemTransaction: vi.fn(),
}));

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
}));

vi.mock('../../../src/middleware/authentication.js', () => ({
  authenticate: vi.fn(),
}));

function createMockEnv(): Record<string, unknown> {
  return {
    BROKER_KV: {},
    AUTH0_CLIENT_ID: 'test-client-id',
    AUTH0_CLIENT_SECRET: 'test-client-secret',
    AUTH0_ISSUER_BASE_URL: 'https://example.auth0.com',
    MAS_GCP_SERVICE_ACCOUNT_KEY: '{}',
    GCP_KMS_KEY_RESOURCE: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
    BROKER_JWT_AUDIENCE: 'css-api',
    INTERNAL_SECRET: 'test-secret-at-least-32-characters-long',
  };
}

describe('BrokerRoutes', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('POST /broker/login', () => {
    it('creates a transaction and returns loginUrl + transactionId', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { createTransaction } = await import('../../../src/auth/broker/transaction.js');
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

      vi.mocked(createTransaction).mockResolvedValue({
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'pending',
        createdAt: 1000,
        expiresAt: 1300,
      });

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
      const { createTransaction } = await import('../../../src/auth/broker/transaction.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'token-id-1',
        type: 'service',
        authProvider: 'site_token',
        siteId: 'site-123',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      vi.mocked(createTransaction).mockResolvedValue({
        id: 'tx-redirect-1',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'pending',
        createdAt: 1000,
        expiresAt: 1300,
        redirectUrl: 'https://myapp.example.com/p1/editor',
      });

      const request = new Request('https://css.example.com/broker/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUrl: 'https://myapp.example.com/p1/editor' }),
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login');
      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);

      expect(createTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'site-123',
        'token-id-1',
        { redirectUrl: 'https://myapp.example.com/p1/editor', prompt: undefined },
      );
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
  });

  describe('GET /broker/login/:txId', () => {
    it('redirects to Auth0 for a valid pending transaction', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { getTransaction } = await import('../../../src/auth/broker/transaction.js');
      const { getAuth0AuthorizationUrl } = await import('../../../src/auth/oauth/auth0-handler.js');
      const { signState } = await import('../../../src/auth/oauth/state-signing.js');

      vi.mocked(getTransaction).mockResolvedValue({
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'pending',
        createdAt: 1000,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      });

      vi.mocked(signState).mockResolvedValue('signed-state-value');
      vi.mocked(getAuth0AuthorizationUrl).mockReturnValue('https://example.auth0.com/authorize?...');

      const request = new Request('https://css.example.com/broker/login/tx-abc-123');
      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login/tx-abc-123');

      expect(response?.status).toBe(302);
      expect(response?.headers.get('Location')).toContain('auth0.com');
    });

    it('returns 404 for non-existent transaction', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { getTransaction } = await import('../../../src/auth/broker/transaction.js');

      vi.mocked(getTransaction).mockResolvedValue(null);

      const request = new Request('https://css.example.com/broker/login/nonexistent');
      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/login/nonexistent');

      expect(response?.status).toBe(404);
    });
  });

  describe('GET /auth/callback', () => {
    it('approves transaction and shows success page', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { approveTransaction } = await import('../../../src/auth/broker/transaction.js');
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

      vi.mocked(approveTransaction).mockResolvedValue({
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'approved',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      });

      const url = 'https://css.example.com/auth/callback?code=auth-code&state=signed-state';
      const request = new Request(url);
      const response = await handleBrokerRoutes(request, createMockEnv(), '/auth/callback');

      expect(response?.status).toBe(200);
      expect(approveTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'tx-abc-123',
        expect.objectContaining({
          userId: 'auth0|user-1',
          userEmail: 'user@example.com',
          userName: 'Test User',
        }),
      );
    });

    it('redirects to transaction redirectUrl after successful auth', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { approveTransaction } = await import('../../../src/auth/broker/transaction.js');
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

      vi.mocked(approveTransaction).mockResolvedValue({
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
      });

      const url = 'https://css.example.com/auth/callback?code=auth-code&state=signed-state';
      const request = new Request(url);
      const response = await handleBrokerRoutes(request, createMockEnv(), '/auth/callback');

      expect(response?.status).toBe(302);
      expect(response?.headers.get('Location')).toBe('https://myapp.example.com/p1/editor');
    });

    it('shows close-window page when no redirectUrl is set', async () => {
      const { handleBrokerRoutes } = await import('../../../src/routes/broker-routes.js');
      const { approveTransaction } = await import('../../../src/auth/broker/transaction.js');
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

      vi.mocked(approveTransaction).mockResolvedValue({
        id: 'tx-no-redirect',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'approved',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      });

      const url = 'https://css.example.com/auth/callback?code=auth-code&state=signed-state';
      const request = new Request(url);
      const response = await handleBrokerRoutes(request, createMockEnv(), '/auth/callback');

      expect(response?.status).toBe(200);
      const body = await response?.text();
      expect(body).toContain('close this window');
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
      const { redeemTransaction } = await import('../../../src/auth/broker/transaction.js');
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

      vi.mocked(redeemTransaction).mockResolvedValue({
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'redeemed',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      });

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
      const { redeemTransaction } = await import('../../../src/auth/broker/transaction.js');
      const { authenticate } = await import('../../../src/middleware/authentication.js');

      vi.mocked(authenticate).mockResolvedValue({
        id: 'token-id-1',
        type: 'service',
        authProvider: 'site_token',
        siteId: 'site-OTHER',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      });

      vi.mocked(redeemTransaction).mockResolvedValue({
        id: 'tx-abc-123',
        siteId: 'site-123',
        siteApiTokenId: 'token-id-1',
        status: 'redeemed',
        createdAt: 1000,
        expiresAt: 1300,
        userId: 'auth0|user-1',
        userEmail: 'user@example.com',
      });

      const request = new Request('https://css.example.com/broker/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: 'tx-abc-123' }),
      });

      const response = await handleBrokerRoutes(request, createMockEnv(), '/broker/redeem');
      expect(response?.status).toBe(403);
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
