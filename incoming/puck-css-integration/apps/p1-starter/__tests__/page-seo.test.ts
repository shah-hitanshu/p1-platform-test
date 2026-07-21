import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

// The datasource fetchers module pulls in the cpub SDK; stub it — the helper
// only forwards it to loadRemoteDatasourceContext, which is mocked below.
vi.mock("../lib/remote-datasource-fetchers", () => ({
  REMOTE_DATASOURCE_FETCHERS: {},
}));

vi.mock("@pantheon-systems/puck-css/server", () => ({
  listRouteTemplateKeysFromDatabase: vi.fn().mockResolvedValue([]),
  extractReferencedDatasourceIds: vi.fn().mockReturnValue([]),
  loadRemoteDatasourceContext: vi.fn().mockResolvedValue({}),
  resolveStringTemplates: vi.fn(async (input: string) =>
    input.replace(/\{\{\s*name\s*\}\}/g, "World"),
  ),
}));

import * as puckServer from "@pantheon-systems/puck-css/server";
import { resolvePageMetadata } from "../lib/page-seo";

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
      searchParams: {},
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
      searchParams: {},
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
      searchParams: {},
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
      searchParams: {},
    });

    expect(meta.title).toBe("Root Title");
    expect(meta.description).toBe("Root description.");
    expect((meta.openGraph as { siteName?: string }).siteName).toBe("Acme");
  });

  it("falls back to the path canonical when pageData/_seo is absent and a site URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.example");
    const meta = await resolvePageMetadata({
      pageData: null,
      path: "/",
      searchParams: {},
    });

    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.alternates?.canonical).toBe("/");
    expect(puckServer.loadRemoteDatasourceContext).not.toHaveBeenCalled();
  });
});
