import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRemoteDatasourcesForPage } from "../../src/lib/remote-datasources/user-remote-datasource-store";

vi.mock("../../src/lib/remote-datasources/user-remote-datasource-store", () => ({
  listRemoteDatasourcesForPage: vi.fn(() => ({ global: [], page: [] })),
}));

import { loadRemoteDatasourceContext } from "../../src/lib/remote-datasources/loader";
import type { RemoteDatasourceFetcher } from "../../src/lib/remote-datasources/loader";

const JEDI_TEMPLATE_KEYS = ["/jedi/:id"];

describe("loadRemoteDatasourceContext", () => {
  beforeEach(() => {
    vi.mocked(listRemoteDatasourcesForPage).mockReturnValue({ global: [], page: [] });
  });

  it("exposes route params as urlParams for concrete instance paths", async () => {
    const ctx = await loadRemoteDatasourceContext({
      searchParams: {},
      pagePath: "/jedi/5",
      routeTemplateKeys: JEDI_TEMPLATE_KEYS,
    });
    expect(ctx.urlParams).toEqual({ id: "5" });
  });

  it("builds urlParams from saved preview values for canonical template path", async () => {
    const ctx = await loadRemoteDatasourceContext({
      searchParams: {},
      pagePath: "/jedi/:id",
      routeTemplateKeys: JEDI_TEMPLATE_KEYS,
      savedPreviewParams: { id: "20" },
    });
    expect(ctx.urlParams).toEqual({ id: "20" });
  });

  it("query params override saved preview params for urlParams", async () => {
    const ctx = await loadRemoteDatasourceContext({
      searchParams: { id: "99" },
      pagePath: "/jedi/:id",
      routeTemplateKeys: JEDI_TEMPLATE_KEYS,
      savedPreviewParams: { id: "20" },
    });
    expect(ctx.urlParams).toEqual({ id: "99" });
  });

  it("calls builtin fetchers with correct params and merges results", async () => {
    const mockFetcher: RemoteDatasourceFetcher = {
      id: "test_api",
      fetch: vi.fn().mockResolvedValue({ title: "Hello" }),
    };
    const ctx = await loadRemoteDatasourceContext({
      searchParams: { id: "5" },
      pagePath: "/jedi/5",
      routeTemplateKeys: JEDI_TEMPLATE_KEYS,
      savedPreviewParams: { color: "blue" },
      builtinFetchers: [mockFetcher],
    });
    expect(ctx.test_api).toEqual({ title: "Hello" });
    expect(mockFetcher.fetch).toHaveBeenCalledWith({
      searchParams: { id: "5" },
      urlParams: { id: "5" },
      savedPreviewParams: { color: "blue" },
      fetchImpl: expect.any(Function),
    });
  });

  it("calls multiple builtin fetchers in parallel", async () => {
    const fetcher1: RemoteDatasourceFetcher = {
      id: "source_a",
      fetch: vi.fn().mockResolvedValue({ name: "A" }),
    };
    const fetcher2: RemoteDatasourceFetcher = {
      id: "source_b",
      fetch: vi.fn().mockResolvedValue({ name: "B" }),
    };
    const ctx = await loadRemoteDatasourceContext({
      searchParams: {},
      builtinFetchers: [fetcher1, fetcher2],
    });
    expect(ctx.source_a).toEqual({ name: "A" });
    expect(ctx.source_b).toEqual({ name: "B" });
  });

  it("loads user-defined datasource using urlParams templates", async () => {
    vi.mocked(listRemoteDatasourcesForPage).mockReturnValue({
      global: [
        {
          id: "jedi_api",
          label: "Jedi API",
          description: "Test",
          urlTemplate: "https://example.test/api/jedi/{{ urlParams.id }}",
          fields: [{ path: "title", description: "Title" }],
        },
      ],
      page: [],
    });
    const fetchImpl = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const u = String(url);
      if (u === "https://example.test/api/jedi/5") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ title: "Master Yoda" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
    const ctx = await loadRemoteDatasourceContext({
      searchParams: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pagePath: "/jedi/5",
      routeTemplateKeys: JEDI_TEMPLATE_KEYS,
    });
    expect(ctx.jedi_api).toEqual({ title: "Master Yoda" });
  });

  it("combines builtin fetcher results with user-defined datasource results", async () => {
    vi.mocked(listRemoteDatasourcesForPage).mockReturnValue({
      global: [
        {
          id: "external_api",
          label: "External",
          description: "Test",
          urlTemplate: "https://example.test/api/data",
          fields: [],
        },
      ],
      page: [],
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ external: true }),
    });
    const builtinFetcher: RemoteDatasourceFetcher = {
      id: "builtin_source",
      fetch: vi.fn().mockResolvedValue({ builtin: true }),
    };
    const ctx = await loadRemoteDatasourceContext({
      searchParams: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pagePath: "/test",
      builtinFetchers: [builtinFetcher],
    });
    expect(ctx.builtin_source).toEqual({ builtin: true });
    expect(ctx.external_api).toEqual({ external: true });
    expect(ctx.urlParams).toEqual({});
  });

  it("normalizes URLSearchParams to plain object for fetcher params", async () => {
    const mockFetcher: RemoteDatasourceFetcher = {
      id: "test",
      fetch: vi.fn().mockResolvedValue({}),
    };
    await loadRemoteDatasourceContext({
      searchParams: new URLSearchParams("a=1&b=2"),
      builtinFetchers: [mockFetcher],
    });
    expect(mockFetcher.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        searchParams: { a: "1", b: "2" },
      }),
    );
  });

  it("returns urlParams even with no fetchers", async () => {
    const ctx = await loadRemoteDatasourceContext({
      searchParams: {},
      pagePath: "/jedi/5",
      routeTemplateKeys: JEDI_TEMPLATE_KEYS,
    });
    expect(ctx.urlParams).toEqual({ id: "5" });
    expect(Object.keys(ctx)).toEqual(["urlParams"]);
  });
});
