import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { P1Client } from '../src/client.js';
import type { P1ApiError } from '../src/errors.js';
import { NetworkError, NotFoundError } from '../src/errors.js';
import { SDK_NAME, SDK_VERSION } from '../src/telemetry-headers.js';

interface Captured {
  headers: Headers;
}

function stubFetch(
  response: Response,
): { fetchMock: ReturnType<typeof vi.fn>; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    captured.push({ headers: new Headers(init?.headers) });
    return Promise.resolve(response.clone());
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, captured };
}

const okResponse = (headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('correlation headers', () => {
  it('sends trace context, a request id, and the SDK identity on every call', async () => {
    const { captured } = stubFetch(okResponse());
    const client = new P1Client({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    await client.sites.list();

    const headers = captured[0]!.headers;
    expect(headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(headers.get('x-p1-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get('x-p1-sdk')).toBe(`${SDK_NAME}/${SDK_VERSION}`);
  });

  it('mints a distinct trace and request id per call', async () => {
    const { captured } = stubFetch(okResponse());
    const client = new P1Client({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    await client.sites.list();
    await client.sites.list();

    expect(captured[0]!.headers.get('traceparent')).not.toBe(
      captured[1]!.headers.get('traceparent'),
    );
    expect(captured[0]!.headers.get('x-p1-request-id')).not.toBe(
      captured[1]!.headers.get('x-p1-request-id'),
    );
  });

  it('continues an ambient trace when the host app supplies one', async () => {
    const { captured } = stubFetch(okResponse());
    const ambient = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const client = new P1Client({
      baseUrl: 'https://api.example.com',
      apiKey: 'k',
      getTraceparent: () => ambient,
    });

    await client.sites.list();

    expect(captured[0]!.headers.get('traceparent')).toBe(ambient);
  });

  it('lets a wrapper SDK identify itself instead', async () => {
    const { captured } = stubFetch(okResponse());
    const client = new P1Client({
      baseUrl: 'https://api.example.com',
      apiKey: 'k',
      sdk: { name: 'p1-next-sdk', version: '1.2.3' },
      clientId: 'acme-storefront',
    });

    await client.sites.list();

    expect(captured[0]!.headers.get('x-p1-sdk')).toBe('p1-next-sdk/1.2.3');
    expect(captured[0]!.headers.get('x-p1-client-id')).toBe('acme-storefront');
  });

  it('omits the client id when not configured', async () => {
    const { captured } = stubFetch(okResponse());
    const client = new P1Client({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    await client.sites.list();

    expect(captured[0]!.headers.has('x-p1-client-id')).toBe(false);
  });

  it('never sends telemetry anywhere of its own accord', async () => {
    const { fetchMock } = stubFetch(okResponse());
    const client = new P1Client({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    await client.sites.list();

    // Exactly the call the caller asked for. A published SDK that phones home is the
    // thing this design exists to avoid.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/api/sites');
  });
});

describe('request id on errors', () => {
  it('attaches the id the server reported, in preference to ours', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: 'nope' }), {
        status: 404,
        headers: { 'content-type': 'application/json', 'x-p1-request-id': 'server-side-id' },
      }),
    );
    const client = new P1Client({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const error = await client.sites.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundError);
    const notFound = error as NotFoundError;
    expect(notFound.requestId).toBe('server-side-id');
    // Surfaced in the message too: the id only helps if a human sees it.
    expect(notFound.message).toContain('[request id: server-side-id]');
  });

  it('falls back to the client-minted id when the server echoes nothing', async () => {
    const { captured } = stubFetch(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new P1Client({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const error = (await client.sites.list().catch((e: unknown) => e)) as P1ApiError;

    expect(error.requestId).toBe(captured[0]!.headers.get('x-p1-request-id'));
  });

  it('attaches an id even when the request never reached the API', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const client = new P1Client({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const error = (await client.sites.list().catch((e: unknown) => e)) as NetworkError;

    expect(error).toBeInstanceOf(NetworkError);
    // A network failure still leaves the caller something to quote.
    expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('SDK identity', () => {
  /**
   * `src/sdk-version.ts` is generated from the manifest by `scripts/sync-sdk-version.mjs`
   * — at `prebuild`, and on `changeset version` so a release bump updates it in the same
   * commit. This asserts the committed output is current, which is the one thing the
   * generator cannot enforce on its own: a hand-edit of either file.
   *
   * It used to compare a hand-maintained constant against the manifest, which meant any
   * version bump broke the build until someone noticed and edited the constant. That is
   * what happened at 0.8.0 → 0.9.0.
   */
  it('has a generated version matching the manifest', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { name: string; version: string };
    expect(SDK_VERSION).toBe(manifest.version);
    expect(manifest.name).toBe(`@pantheon-systems/${SDK_NAME}`);
  });

  it('reports a plausible semver, so a failed generation cannot ship silently', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });
});
