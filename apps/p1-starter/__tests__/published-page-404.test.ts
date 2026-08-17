import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadPublishedPage, notFound } = vi.hoisted(() => ({
  loadPublishedPage: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@pantheon-systems/p1-next-sdk/server", () => ({
  loadPublishedPage,
  loadRouteTemplateKeys: vi.fn().mockResolvedValue([]),
  createCssQueryFetchers: vi.fn().mockReturnValue([]),
}));

vi.mock("next/navigation", () => ({ notFound }));

vi.mock("@pantheon-systems/puck-css/server", () => ({
  pagePathFromCatchAllSegments: (segments: string[]) => `/${segments.join("/")}`,
  loadRemoteDatasourceContext: vi.fn().mockResolvedValue({}),
  extractReferencedDatasourceIds: vi.fn().mockReturnValue([]),
  resolveDataTemplates: vi.fn(async (d: unknown) => d),
}));

vi.mock("../lib/remote-datasource-fetchers", () => ({
  REMOTE_DATASOURCE_FETCHERS: [],
}));

vi.mock("../app/[...puckPath]/client", () => ({ Client: () => null }));
vi.mock("../components/content-unavailable", () => ({
  ContentUnavailable: () => null,
}));

import Page from "../app/[...puckPath]/page";

const render = (...segments: string[]) =>
  Page({ params: Promise.resolve({ puckPath: segments }) });

describe("catch-all route — missing vs unavailable", () => {
  beforeEach(() => vi.clearAllMocks());

  // The route is statically renderable, so a 200 here would write every junk URL
  // a crawler probes into the response cache as a successful page.
  it("404s a path with no published page", async () => {
    loadPublishedPage.mockResolvedValue({ status: "missing" });
    await expect(render("nope")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  // 404ing here would deindex a live page over a transient backend blip.
  it("does not 404 when the backend is unreachable", async () => {
    loadPublishedPage.mockResolvedValue({ status: "unavailable" });
    await render("real-page");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("renders published content", async () => {
    loadPublishedPage.mockResolvedValue({
      status: "ok",
      data: { root: { props: { title: "Hi" } }, content: [] },
    });
    await render("blog");
    expect(notFound).not.toHaveBeenCalled();
  });
});
