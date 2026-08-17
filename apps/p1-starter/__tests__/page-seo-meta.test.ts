import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/remote-datasource-fetchers", () => ({
  REMOTE_DATASOURCE_FETCHERS: {},
}));

vi.mock("@pantheon-systems/p1-next-sdk/server", () => ({
  loadRouteTemplateKeys: vi.fn().mockResolvedValue([]),
}));

vi.mock("@pantheon-systems/puck-css/server", () => ({
  extractReferencedDatasourceIds: vi.fn().mockReturnValue([]),
  loadRemoteDatasourceContext: vi.fn().mockResolvedValue({}),
  resolveStringTemplates: vi.fn(async (input: string) =>
    input.replace(/\{\{\s*name\s*\}\}/g, "World"),
  ),
}));

import { resolvePageMetadata } from "../lib/page-seo";

/**
 * `root.props._meta` reaches <head> through resolvePageMetadata.
 */

type PageData = Parameters<typeof resolvePageMetadata>[0]["pageData"];

function pageWithRootProps(props: Record<string, unknown>): PageData {
  return { root: { props }, content: [] } as unknown as PageData;
}

const og = (m: Awaited<ReturnType<typeof resolvePageMetadata>>) =>
  (m.openGraph ?? {}) as Record<string, unknown>;
const tw = (m: Awaited<ReturnType<typeof resolvePageMetadata>>) =>
  (m.twitter ?? {}) as Record<string, unknown>;

describe("resolvePageMetadata — _meta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("carries authored _meta through to the og and twitter tags", async () => {
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({
        title: "Q3 Launch Recap",
        description: "How the launch went.",
        _meta: {
          ogTitle: "The launch, in numbers",
          ogImage: "https://cdn.example/hero.jpg",
          ogType: "article",
          twitterTitle: "Launch, for X",
        },
      }),
      path: "/q3",
    });

    expect(og(meta).title).toBe("The launch, in numbers");
    expect(og(meta).images).toBe("https://cdn.example/hero.jpg");
    expect(og(meta).type).toBe("article");
    expect(tw(meta).title).toBe("Launch, for X");
    expect(tw(meta).card).toBe("summary_large_image");
  });

  it("inherits from title and description when _meta is absent", async () => {
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({
        title: "Q3 Launch Recap",
        description: "How the launch went.",
      }),
      path: "/q3",
    });

    expect(og(meta).title).toBe("Q3 Launch Recap");
    expect(og(meta).description).toBe("How the launch went.");
    expect(og(meta)).not.toHaveProperty("images");
  });

  it("still resolves {{ }} in the page title alongside authored _meta", async () => {
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({
        title: "Hello {{ name }}",
        _meta: { ogDescription: "Static description." },
      }),
      path: "/greet",
    });

    expect(meta.title).toBe("Hello World");
    expect(og(meta).description).toBe("Static description.");
  });

  it("ignores the editor's default title boilerplate when deriving og:title", async () => {
    const meta = await resolvePageMetadata({
      pageData: pageWithRootProps({ title: "My Puck Editor" }),
      path: "/new",
    });

    expect(meta.title).toBeUndefined();
    expect(og(meta)).not.toHaveProperty("title");
  });
});
