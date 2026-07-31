import { describe, expect, it, vi } from "vitest";

vi.mock("@pantheon-systems/cpub-react-sdk/server", () => ({
  PCCConvenienceFunctions: {
    getPaginatedArticles: vi.fn(),
    getArticleBySlugOrId: vi.fn(),
  },
}));

// We need to mock the user-remote-datasource-store since loadRemoteDatasourceContext uses it
vi.mock("@pantheon-systems/puck-css/server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return actual;
});

import { REMOTE_DATASOURCE_FETCHERS } from "../lib/remote-datasource-fetchers";
import type { RemoteDatasourceFetcherParams } from "@pantheon-systems/puck-css/server";

const { PCCConvenienceFunctions } = await import(
  "@pantheon-systems/cpub-react-sdk/server"
);
const mockGetPaginatedArticles = PCCConvenienceFunctions
  .getPaginatedArticles as ReturnType<typeof vi.fn>;
const mockGetArticleBySlugOrId = PCCConvenienceFunctions
  .getArticleBySlugOrId as ReturnType<typeof vi.fn>;

function makeFetcherParams(
  overrides: Partial<RemoteDatasourceFetcherParams> = {},
): RemoteDatasourceFetcherParams {
  return {
    searchParams: {},
    urlParams: {},
    savedPreviewParams: {},
    fetchImpl: vi.fn() as unknown as typeof fetch,
    ...overrides,
  };
}

function getFetcher(id: string) {
  const f = REMOTE_DATASOURCE_FETCHERS.find((f) => f.id === id);
  if (!f) throw new Error(`No fetcher with id "${id}"`);
  return f;
}

describe("swapi fetcher", () => {
  const fetcher = getFetcher("swapi");

  it("returns {} when no id is available", async () => {
    const result = await fetcher.fetch(makeFetcherParams());
    expect(result).toEqual({});
  });

  it("returns {} on non-OK response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    const result = await fetcher.fetch(makeFetcherParams({
      searchParams: { id: "1" },
      fetchImpl,
    }));
    expect(result).toEqual({});
    expect(fetchImpl).toHaveBeenCalledWith("https://swapi.info/api/people/1");
  });

  it("returns parsed JSON on success", async () => {
    const payload = { name: "Luke Skywalker", height: "172" };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    const result = await fetcher.fetch(makeFetcherParams({
      searchParams: { id: "1" },
      fetchImpl,
    }));
    expect(result).toEqual(payload);
  });

  it("uses urlParams.id when searchParams has no id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: "FromPath" }),
    });
    const result = await fetcher.fetch(makeFetcherParams({
      urlParams: { id: "5" },
      fetchImpl,
    }));
    expect(result).toEqual({ name: "FromPath" });
    expect(fetchImpl).toHaveBeenCalledWith("https://swapi.info/api/people/5");
  });

  it("prefers query id over path id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: "Q" }),
    });
    await fetcher.fetch(makeFetcherParams({
      searchParams: { id: "2" },
      urlParams: { id: "9" },
      fetchImpl,
    }));
    expect(fetchImpl).toHaveBeenCalledWith("https://swapi.info/api/people/2");
  });
});

describe("swapi_list fetcher", () => {
  const fetcher = getFetcher("swapi_list");

  it("maps results to { items: [...] }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { name: "Luke", url: "https://swapi.info/api/people/1" },
      ],
    });
    const result = await fetcher.fetch(makeFetcherParams({ fetchImpl }));
    expect(result).toEqual({
      items: [{ id: "1", name: "Luke", url: "https://swapi.info/api/people/1" }],
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://swapi.info/api/people");
  });
});

describe("monster fetcher", () => {
  const fetcher = getFetcher("monster");

  it("returns {} when no index available", async () => {
    const result = await fetcher.fetch(makeFetcherParams());
    expect(result).toEqual({});
  });

  it("returns parsed pokemon on success", async () => {
    const payload = {
      data: {
        getPokemon: {
          key: "bulbasaur",
          species: "Bulbasaur",
          num: 1,
          types: ["Grass", "Poison"],
        },
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    const result = await fetcher.fetch(makeFetcherParams({
      searchParams: { monster: "bulbasaur" },
      fetchImpl,
    }));
    expect(result).toEqual({
      key: "bulbasaur",
      species: "Bulbasaur",
      num: 1,
      types: ["Grass", "Poison"],
      index: "bulbasaur",
      name: "Bulbasaur",
      url: "/pokemon/bulbasaur",
    });
  });
});

describe("monster_list fetcher", () => {
  const fetcher = getFetcher("monster_list");

  it("maps results to { items: [...] }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          getAllPokemon: [
            { key: "bulbasaur", species: "Bulbasaur" },
          ],
        },
      }),
    });
    const result = await fetcher.fetch(makeFetcherParams({ fetchImpl }));
    expect(result).toEqual({
      items: [{ index: "bulbasaur", name: "Bulbasaur", url: "/pokemon/bulbasaur" }],
    });
  });
});

describe("article fetcher", () => {
  const fetcher = getFetcher("article");

  it("returns {} when no article id", async () => {
    const result = await fetcher.fetch(makeFetcherParams());
    expect(result).toEqual({});
  });

  it("loads a single article", async () => {
    mockGetArticleBySlugOrId.mockResolvedValueOnce({
      id: "first-article",
      title: "First Article",
    });
    const result = await fetcher.fetch(makeFetcherParams({
      searchParams: { article: "first-article" },
    }));
    expect(result).toEqual({ id: "first-article", title: "First Article" });
    expect(mockGetArticleBySlugOrId).toHaveBeenCalledWith("first-article", {
      contentType: "TEXT_MARKDOWN",
    });
  });
});

describe("article_list fetcher", () => {
  const fetcher = getFetcher("article_list");

  it("maps list payload items to normalized article rows", async () => {
    mockGetPaginatedArticles.mockResolvedValueOnce({
      data: [
        { id: "a1", title: "First Article", slug: "first-article" },
        { id: 2, attributes: { title: "Second Article", slug: "second-article" } },
      ],
    });
    const result = await fetcher.fetch(makeFetcherParams());
    expect(result).toEqual({
      items: [
        { id: "a1", title: "First Article", slug: "first-article", url: undefined },
        { id: "2", title: "Second Article", slug: "second-article", url: undefined },
      ],
    });
  });
});
