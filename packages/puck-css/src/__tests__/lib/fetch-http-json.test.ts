import { describe, expect, it, vi } from 'vitest';

import { fetchHttpJsonRemoteDatasource } from '../../data/remote-datasources/fetch-http-json';
import type { HttpJsonRemoteDatasourceDefinition } from '../../data/remote-datasources/user-remote-datasource-types';

const makeDef = (overrides: Partial<HttpJsonRemoteDatasourceDefinition> = {}): HttpJsonRemoteDatasourceDefinition => ({
  id: 'test',
  label: 'Test',
  description: 'A test datasource',
  urlTemplate: 'https://example.com/api/data',
  fields: [],
  ...overrides,
});

describe('fetchHttpJsonRemoteDatasource', () => {
  it('fetches from URL and returns JSON object', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: 'Hello' }),
    });
    const result = await fetchHttpJsonRemoteDatasource(
      makeDef(),
      {},
      mockFetch as unknown as typeof fetch
    );
    expect(result).toEqual({ title: 'Hello' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('resolves token templates in URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Yoda' }),
    });
    await fetchHttpJsonRemoteDatasource(
      makeDef({ urlTemplate: 'https://example.com/api/jedi/{{ urlParams.id }}' }),
      { urlParams: { id: '5' } },
      mockFetch as unknown as typeof fetch
    );
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toBe('https://example.com/api/jedi/5');
  });

  it('sets query params with template resolution', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    await fetchHttpJsonRemoteDatasource(
      makeDef({
        urlTemplate: 'https://example.com/api',
        query: { search: '{{ searchParams.q }}' },
      }),
      { searchParams: { q: 'test' } },
      mockFetch as unknown as typeof fetch
    );
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('search=test');
  });

  it('sets custom headers with template resolution', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    await fetchHttpJsonRemoteDatasource(
      makeDef({ headers: { Authorization: 'Bearer {{ auth.token }}' } }),
      { auth: { token: 'abc123' } },
      mockFetch as unknown as typeof fetch
    );
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.get('Authorization')).toBe('Bearer abc123');
  });

  it('returns empty object on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await fetchHttpJsonRemoteDatasource(
      makeDef(),
      {},
      mockFetch as unknown as typeof fetch
    );
    expect(result).toEqual({});
  });

  it('wraps arrays in { items: [...] }', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [1, 2, 3],
    });
    const result = await fetchHttpJsonRemoteDatasource(
      makeDef(),
      {},
      mockFetch as unknown as typeof fetch
    );
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('wraps primitives in { value: x }', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => 'hello',
    });
    const result = await fetchHttpJsonRemoteDatasource(
      makeDef(),
      {},
      mockFetch as unknown as typeof fetch
    );
    expect(result).toEqual({ value: 'hello' });
  });

  it('returns empty object on fetch error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await fetchHttpJsonRemoteDatasource(
      makeDef(),
      {},
      mockFetch as unknown as typeof fetch
    );
    expect(result).toEqual({});
  });

  it('returns empty object when URL is empty after template resolution', async () => {
    const mockFetch = vi.fn();
    const result = await fetchHttpJsonRemoteDatasource(
      makeDef({ urlTemplate: '{{ missing.value }}' }),
      {},
      mockFetch as unknown as typeof fetch
    );
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
