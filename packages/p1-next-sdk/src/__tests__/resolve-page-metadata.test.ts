import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../published-page", () => ({
  loadRouteTemplateKeys: vi.fn().mockResolvedValue([]),
}));

vi.mock("@pantheon-systems/puck-css/server", () => ({
  extractReferencedDatasourceIds: vi.fn().mockReturnValue([]),
  loadRemoteDatasourceContext: vi.fn().mockResolvedValue({}),
  resolveStringTemplates: vi.fn(async (input: string) =>
    input.replace(/\{\{\s*name\s*\}\}/g, "World"),
  ),
}));

import * as puckServer from "@pantheon-systems/puck-css/server";
import { resolvePageMetadata } from "../resolve-page-metadata";

type PageData = Parameters<typeof resolvePageMetadata>[0]["pageData"];

function pageWithRootProps(props: Record<string, unknown>): PageData {
  return { root: { props }, content: [] } as unknown as PageData;
}

describe("resolvePageMetadata", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("maps root props and _seo.siteName to metadata without touching datasources when no templates", async () => {
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({
        title: "About Our Team",
        description: "Meet the people behind the product.",
        _seo: { siteName: "Acme Docs" },
      }),
      path: "/about/team",
    });

    expect(meta.title).toBe("About Our Team");
    expect(meta.description).toBe("Meet the people behind the product.");
    expect((meta.openGraph as { title?: string }).title).toBe(
      "About Our Team",
    );
    expect((meta.openGraph as { siteName?: string }).siteName).toBe(
      "Acme Docs",
    );
    // Callers never see the template step — and it's skipped entirely when the
    // values contain no {{ }}.
    expect(puckServer.loadRemoteDatasourceContext).not.toHaveBeenCalled();
  });

  it("treats the editor's default title boilerplate as absent", async () => {
    // Untitled pages carry root.defaultProps.title ("My Puck Editor"); that
    // boilerplate must not ship as <title>/og:title.
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({
        title: "My Puck Editor",
        description: "Real description.",
        _seo: { siteName: "Acme Docs" },
      }),
      path: "/untitled",
    });

    expect(meta.title).toBeUndefined();
    expect((meta.openGraph as { title?: string }).title).toBeUndefined();
    // Other fields are unaffected.
    expect(meta.description).toBe("Real description.");
    expect((meta.openGraph as { siteName?: string }).siteName).toBe(
      "Acme Docs",
    );
  });

  it("resolves {{ }} templates in title/description via the datasource context", async () => {
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({
        title: "Hello {{name}}",
        description: "Welcome, {{name}}!",
      }),
      path: "/greet",
    });

    expect(meta.title).toBe("Hello World");
    expect(meta.description).toBe("Welcome, World!");
    expect(puckServer.loadRemoteDatasourceContext).toHaveBeenCalledOnce();
  });

  it("sources title/description from root props even when _seo carries legacy page fields", async () => {
    // Guards the contract: _seo is site-level only; page-level values on it
    // (e.g. from an older backend) are ignored in favor of root props.
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({
        title: "Root Title",
        description: "Root description.",
        _seo: {
          title: "Stale backend title",
          description: "Stale backend description.",
          siteName: "Acme",
        },
      }),
      path: "/untitled",
    });

    expect(meta.title).toBe("Root Title");
    expect(meta.description).toBe("Root description.");
    expect((meta.openGraph as { siteName?: string }).siteName).toBe("Acme");
  });

  it("forwards the caller's fetchers to the datasource context load", async () => {
    // The registry is the app's, not the SDK's: it is injected rather than
    // imported, the same way the handler takes it.
    const fetchers = [{ id: "swapi" }] as never;
    await resolvePageMetadata({
      pageData: pageWithRootProps({ title: "Hello {{name}}" }),
      path: "/greet",
      fetchers,
    });

    expect(puckServer.loadRemoteDatasourceContext).toHaveBeenCalledWith(
      expect.objectContaining({ builtinFetchers: fetchers }),
    );
  });

  it("gives transform the last word on the emitted metadata", async () => {
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({ title: "About Our Team" }),
      path: "/about/team",
      transform: (metadata) => ({ ...metadata, robots: "noindex" }),
    });

    expect(meta.title).toBe("About Our Team");
    expect(meta.robots).toBe("noindex");
  });

  it("hands transform the page and the resolved authored values", async () => {
    // Emitting a tag from a field the site added means reading the value after
    // templates resolved — otherwise transform would have to resolve them again.
    const pageData = pageWithRootProps({
      title: "Hello {{name}}",
      description: "Static.",
      _meta: { ogTitle: "Hi {{name}}", keywords: "launch" },
    });

    let context: Parameters<NonNullable<Parameters<typeof resolvePageMetadata>[0]["transform"]>>[1]
      | undefined;

    const meta = await resolvePageMetadata({
      pageData,
      path: "/greet",
      transform: (metadata, transformContext) => {
        context = transformContext;
        return { ...metadata, keywords: transformContext.meta.keywords as string };
      },
    });

    expect(meta.keywords).toBe("launch");
    expect(context?.pageData).toBe(pageData);
    expect(context?.path).toBe("/greet");
    expect(context?.title).toBe("Hello World");
    expect(context?.description).toBe("Static.");
    // The authored _meta as resolved, not as stored.
    expect(context?.meta).toEqual({ ogTitle: "Hi World", keywords: "launch" });
  });

  it("falls back to the path canonical when pageData/_seo is absent and a site URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.example");
    const meta = await resolvePageMetadata({
      pageData: null,
      path: "/",
    });

    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.alternates?.canonical).toBe("/");
    expect(puckServer.loadRemoteDatasourceContext).not.toHaveBeenCalled();
  });
});
