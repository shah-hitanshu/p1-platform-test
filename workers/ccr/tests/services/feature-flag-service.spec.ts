/**
 * Feature flag evaluation tests (PCC-3479)
 *
 * The P1V0 gate decides whether a stranger may self-service onboard, so the
 * behaviour that matters most here is that every failure mode says "no".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isFeatureFlagEnabled, P1V0_FLAG } from '../../src/services/feature-flag-service';
import type { Env } from '../../src/env';

// LAUNCHDARKLY_API_URL is the proxy's origin; the service appends the `/api`
// path the launchdarklyapi service actually serves.
const PROXY_URL = 'https://launchdarklyapi.example.com';
const PROXY_ENDPOINT = `${PROXY_URL}/api`;

interface KvStub {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function makeEnv(overrides: Partial<Env> = {}, kv?: Partial<KvStub>): Env {
  const configKv: KvStub = {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    ...kv,
  };
  return {
    LAUNCHDARKLY_API_URL: PROXY_URL,
    CONFIG_KV: configKv,
    ...overrides,
  } as unknown as Env;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('isFeatureFlagEnabled', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards the caller token and reads the proxy verdict', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: true }));
    const env = makeEnv();

    await expect(
      isFeatureFlagEnabled(env, 'Bearer token-abc', 'User@Example.com'),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PROXY_ENDPOINT);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-abc',
    );
    expect(init.body).toBe(JSON.stringify({ feature: P1V0_FLAG }));
  });

  it('treats anything other than a literal true as off', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: 'true' }));

    await expect(
      isFeatureFlagEnabled(makeEnv(), 'Bearer t', 'user@example.com'),
    ).resolves.toBe(false);
  });

  it('caches the verdict per flag and email, lower-cased', async () => {
    const put = vi.fn(async () => undefined);
    const env = makeEnv({}, { put });
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: true }));

    await isFeatureFlagEnabled(env, 'Bearer t', 'User@Example.com');

    expect(put).toHaveBeenCalledWith(
      `feature-flag:${P1V0_FLAG}:user@example.com`,
      'true',
      { expirationTtl: 300 },
    );
  });

  it('serves a cached verdict without calling the proxy', async () => {
    const env = makeEnv({}, { get: vi.fn(async () => 'true') });

    await expect(
      isFeatureFlagEnabled(env, 'Bearer t', 'user@example.com'),
    ).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a cached negative without calling the proxy', async () => {
    const env = makeEnv({}, { get: vi.fn(async () => 'false') });

    await expect(
      isFeatureFlagEnabled(env, 'Bearer t', 'user@example.com'),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still asks the proxy when the cache read fails', async () => {
    const env = makeEnv(
      {},
      {
        get: vi.fn(async () => {
          throw new Error('KV down');
        }),
      },
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: true }));

    await expect(
      isFeatureFlagEnabled(env, 'Bearer t', 'user@example.com'),
    ).resolves.toBe(true);
  });

  describe('fails closed', () => {
    it('when the proxy URL is unset', async () => {
      const env = makeEnv({ LAUNCHDARKLY_API_URL: undefined });

      await expect(
        isFeatureFlagEnabled(env, 'Bearer t', 'user@example.com'),
      ).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('when there is no Authorization header to forward', async () => {
      await expect(
        isFeatureFlagEnabled(makeEnv(), null, 'user@example.com'),
      ).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('when the proxy rejects the token', async () => {
      fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }));

      await expect(
        isFeatureFlagEnabled(makeEnv(), 'Bearer t', 'user@example.com'),
      ).resolves.toBe(false);
    });

    it('when the proxy is unreachable', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(
        isFeatureFlagEnabled(makeEnv(), 'Bearer t', 'user@example.com'),
      ).resolves.toBe(false);
    });

    it('when the proxy returns something that is not JSON', async () => {
      fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));

      await expect(
        isFeatureFlagEnabled(makeEnv(), 'Bearer t', 'user@example.com'),
      ).resolves.toBe(false);
    });
  });

  it('still answers when the cache write fails', async () => {
    const env = makeEnv(
      {},
      {
        put: vi.fn(async () => {
          throw new Error('KV down');
        }),
      },
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: true }));

    await expect(
      isFeatureFlagEnabled(env, 'Bearer t', 'user@example.com'),
    ).resolves.toBe(true);
  });
});
