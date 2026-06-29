/**
 * Broker Route Handler
 *
 * Handles all /broker/* routes for the brokered authentication flow.
 * The broker centralizes Auth0 communication — panels authenticate
 * with sat_ tokens, users authenticate via Auth0 through the broker,
 * and the broker issues its own HS256 JWTs signed via KMS MAC.
 */

import { issueBrokerJwt } from '../auth/broker/jwt-issuer.js';
import { exchangeAuth0Code, getAuth0AuthorizationUrl } from '../auth/oauth/auth0-handler.js';
import { signState, verifyAndParseState } from '../auth/oauth/state-signing.js';
import type { LoginTransaction } from '../durable-objects/broker-transaction.js';
import type { Env } from '../index.js';
import { authenticate } from '../middleware/authentication.js';

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}

function getPublicOrigin(request: Request, env: Env): string {
  const configured = env.PUBLIC_ORIGIN;
  if (configured !== undefined && configured !== '') {
    let origin = configured;
    while (origin.endsWith('/')) {
      origin = origin.slice(0, -1);
    }
    return origin;
  }
  return new URL(request.url).origin;
}

/**
 * Helper to handle Durable Object responses with consistent error handling.
 * Checks response.ok and throws if the DO returned an error.
 */
async function handleDoResponse<T>(response: Response, fallbackError: string): Promise<T> {
  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    throw new Error(error.error ?? fallbackError);
  }
  return (await response.json()) as T;
}

export async function handleBrokerRoutes(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/broker/') && path !== '/auth/callback') {
    return null;
  }

  const brokerTx = env.BROKER_TX;
  const internalSecret = env.INTERNAL_SECRET as string;

  // POST /broker/login — create a login transaction (requires sat_ token)
  if (path === '/broker/login' && request.method === 'POST') {
    const principal = await authenticate(request, env);
    if (principal === null) {
      return errorResponse('Authentication required', 401);
    }

    if (principal.siteId === undefined) {
      return errorResponse('Site API token required', 403);
    }

    let redirectUrl: string | undefined;
    let prompt: string | undefined;
    const contentType = request.headers.get('Content-Type');
    if (contentType?.includes('application/json') === true) {
      try {
        const body: { redirectUrl?: string; prompt?: string } = await request.json();
        if (typeof body.redirectUrl === 'string' && body.redirectUrl !== '') {
          redirectUrl = body.redirectUrl;
        }
        const ALLOWED_PROMPTS = new Set(['login', 'none', 'consent', 'select_account']);
        if (typeof body.prompt === 'string' && ALLOWED_PROMPTS.has(body.prompt)) {
          prompt = body.prompt;
        }
      } catch {
        // No body or invalid JSON is fine
      }
    }

    // Create a new transaction using Durable Object
    const txId = crypto.randomUUID();
    const stub = brokerTx.get(brokerTx.idFromName(txId));
    const response = await stub.fetch('http://do/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txId,
        siteId: principal.siteId,
        siteApiTokenId: principal.id,
        options: { redirectUrl, prompt },
      }),
    });

    let tx: LoginTransaction;
    try {
      tx = await handleDoResponse<LoginTransaction>(response, 'Failed to create transaction');
    } catch (err) {
      return errorResponse(
        err instanceof Error ? err.message : 'Failed to create transaction',
        response.status,
      );
    }

    const origin = getPublicOrigin(request, env);
    const loginUrl = `${origin}/broker/login/${tx.id}`;

    return jsonResponse({ transactionId: tx.id, loginUrl });
  }

  // GET /broker/login/:txId — redirect user to Auth0
  const loginMatch = /^\/broker\/login\/([^/]+)$/.exec(path);
  if (loginMatch !== null && request.method === 'GET') {
    const txId = loginMatch[1] ?? '';
    const stub = brokerTx.get(brokerTx.idFromName(txId));
    const response = await stub.fetch('http://do/get');

    let tx: LoginTransaction | null;
    try {
      tx = await handleDoResponse<LoginTransaction | null>(
        response,
        'Failed to retrieve transaction',
      );
    } catch (err) {
      return errorResponse(
        err instanceof Error ? err.message : 'Failed to retrieve transaction',
        response.status,
      );
    }

    if (tx?.status !== 'pending') {
      return errorResponse('Transaction not found', 404);
    }

    const now = Math.floor(Date.now() / 1000);
    if (tx.expiresAt <= now) {
      return errorResponse('Transaction expired', 410);
    }

    const origin = getPublicOrigin(request, env);
    const redirectUri = `${origin}/auth/callback`;
    const nonce = generateNonce();
    const signedState = await signState({ txId, nonce }, internalSecret);

    const authUrl = getAuth0AuthorizationUrl({
      issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL as string,
      clientId: env.AUTH0_CLIENT_ID as string,
      redirectUri,
      state: signedState,
      scope: 'openid email profile',
      nonce,
      prompt: tx.prompt,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
        'Referrer-Policy': 'no-referrer',
      },
    });
  }

  // GET /auth/callback — Auth0 redirects back here after user authenticates
  if (path === '/auth/callback' && request.method === 'GET') {
    const url = new URL(request.url);

    const authError = url.searchParams.get('error');
    if (authError !== null) {
      const desc = url.searchParams.get('error_description') ?? authError;
      return errorResponse(`Auth0 login failed: ${desc}`, 400);
    }

    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');

    if (code === null || stateParam === null) {
      return errorResponse('Missing code or state', 400);
    }

    const stateData = await verifyAndParseState<{
      txId: string;
      nonce?: string;
    }>(stateParam, internalSecret);
    if (stateData === null) {
      return errorResponse('Invalid state', 400);
    }

    const redirectUri = `${getPublicOrigin(request, env)}/auth/callback`;
    const { user } = await exchangeAuth0Code({
      code,
      issuerBaseUrl: env.AUTH0_ISSUER_BASE_URL as string,
      clientId: env.AUTH0_CLIENT_ID as string,
      clientSecret: env.AUTH0_CLIENT_SECRET as string,
      redirectUri,
    });

    if (stateData.nonce !== undefined && user.nonce !== stateData.nonce) {
      return errorResponse('Nonce mismatch', 400);
    }

    const stub = brokerTx.get(brokerTx.idFromName(stateData.txId));
    const response = await stub.fetch('http://do/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.sub,
        userEmail: user.email,
        userName: user.name,
      }),
    });

    let approved: LoginTransaction | null;
    try {
      approved = await handleDoResponse<LoginTransaction | null>(
        response,
        'Transaction approval failed',
      );
    } catch (err) {
      return new Response(
        `<html><body><h1>Login failed</h1><p>${err instanceof Error ? err.message : 'Transaction approval failed'}</p></body></html>`,
        { status: response.status, headers: { 'Content-Type': 'text/html' } },
      );
    }

    if (approved === null) {
      return new Response(
        '<html><body><h1>Login failed</h1><p>Transaction expired or already used.</p></body></html>',
        { status: 410, headers: { 'Content-Type': 'text/html' } },
      );
    }

    if (approved.redirectUrl !== undefined && approved.redirectUrl !== '') {
      return new Response(null, {
        status: 302,
        headers: {
          Location: approved.redirectUrl,
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    return new Response(
      '<html><body><h1>Login successful</h1><p>You may close this window.</p></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  }

  // POST /broker/redeem — exchange approved transaction for a broker JWT
  if (path === '/broker/redeem' && request.method === 'POST') {
    const contentType = request.headers.get('Content-Type');
    if (contentType?.includes('application/json') !== true) {
      return errorResponse('Content-Type must be application/json', 415);
    }

    const principal = await authenticate(request, env);
    if (principal === null) {
      return errorResponse('Authentication required', 401);
    }

    let body: { transactionId?: string };
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    if (typeof body.transactionId !== 'string' || body.transactionId === '') {
      return errorResponse('transactionId is required', 400);
    }

    // Redeem transaction via Durable Object (strongly consistent, no retry needed)
    const stub = brokerTx.get(brokerTx.idFromName(body.transactionId));
    const response = await stub.fetch('http://do/redeem', { method: 'POST' });

    let tx: LoginTransaction | null;
    try {
      tx = await handleDoResponse<LoginTransaction | null>(
        response,
        'Failed to redeem transaction',
      );
    } catch (err) {
      return errorResponse(
        err instanceof Error ? err.message : 'Failed to redeem transaction',
        response.status,
      );
    }

    if (tx === null) {
      return errorResponse('Transaction not found or not approved', 404);
    }

    if (tx.siteId !== principal.siteId) {
      return errorResponse('Site mismatch', 403);
    }

    const issuer = (env.BROKER_JWT_ISSUER as string | undefined) ?? getPublicOrigin(request, env);

    try {
      const token = await issueBrokerJwt({
        serviceAccountKeyJson: env.MAS_GCP_SERVICE_ACCOUNT_KEY as string,
        keyResource: env.GCP_KMS_KEY_RESOURCE as string,
        issuer,
        subject: tx.userId ?? '',
        audience: (env.BROKER_JWT_AUDIENCE as string | undefined) ?? 'css-api',
        ttlSeconds: 3600,
        siteId: tx.siteId,
        email: tx.userEmail ?? '',
        name: tx.userName,
        provider: 'auth0',
      });

      return jsonResponse({ token });
    } catch (err) {
      console.error(
        '[broker/redeem] JWT issuance failed:',
        err instanceof Error ? err.message : String(err),
      );
      return errorResponse('Failed to issue token', 502);
    }
  }

  return null;
}
