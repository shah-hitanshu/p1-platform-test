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
    input
      .replace(/\{\{\s*name\s*\}\}/g, "World")
      .replace(/\{\{\s*slug\s*\}\}/g, "widgets"),
  ),
}));

import * as puckServer from "@pantheon-systems/puck-css/server";
import { resolvePageMetadata } from "../lib/page-seo";

/**
 * `{{ }}` interpolation on the metadata fields.
 *
 * Loading the datasource context is a network round trip, so it happens only
 * when something on the page actually carries a template — and once, however
 * many fields do.
 *
 * The two fixed-vocabulary fields are deliberately excluded: their values are
 * validated against a union, so a template could only ever produce a value the
 * renderer rejects.
 */

type PageData = Parameters<typeof resolvePageMetadata>[0]["pageData"];

function pageWithRootProps(props: Record<string, unknown>): PageData {
  return { root: { props }, content: [] } as unknown as PageData;
}

const resolve = (props: Record<string, unknown>) =>
  resolvePageMetadata({
    pageData: pageWithRootProps(props),
    path: "/q3",
  });

const og = (m: Awaited<ReturnType<typeof resolvePageMetadata>>) =>
  (m.openGraph ?? {}) as Record<string, unknown>;
const tw = (m: Awaited<ReturnType<typeof resolvePageMetadata>>) =>
  (m.twitter ?? {}) as Record<string, unknown>;

describe("resolvePageMetadata — {{ }} in _meta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves templates in the free-text metadata fields", async () => {
    const meta = await resolve({
      title: "Q3",
      _meta: {
        ogTitle: "Hello {{ name }}",
        ogDescription: "All about {{ name }}",
        twitterTitle: "{{ name }} on X",
        ogLocale: "{{ name }}",
      },
    });

    expect(og(meta).title).toBe("Hello World");
    expect(og(meta).description).toBe("All about World");
    expect(tw(meta).title).toBe("World on X");
    expect(og(meta).locale).toBe("World");
  });

  it("resolves templates in the image URLs", async () => {
    const meta = await resolve({
      title: "Q3",
      _meta: {
        ogImage: "https://cdn.example/{{ slug }}.png",
        twitterImage: "https://cdn.example/{{ slug }}-x.png",
      },
    });

    expect(og(meta).images).toBe("https://cdn.example/widgets.png");
    expect(tw(meta).images).toBe("https://cdn.example/widgets-x.png");
  });

  it("leaves the fixed-vocabulary fields alone", async () => {
    const meta = await resolve({
      title: "Q3",
      _meta: { ogType: "{{ name }}", twitterCard: "{{ name }}", ogTitle: "Set" },
    });

    // Unresolved and unrecognised, so the union check falls back.
    expect(og(meta).type).toBe("website");
    expect(tw(meta).card).toBe("summary");
    for (const call of vi.mocked(puckServer.resolveStringTemplates).mock.calls) {
      expect(call[0]).not.toBe("{{ name }}");
    }
  });

  it("loads the datasource context once, however many fields template", async () => {
    await resolve({
      title: "Hello {{ name }}",
      description: "About {{ name }}",
      _meta: { ogTitle: "{{ name }}", twitterTitle: "{{ name }}" },
    });

    expect(puckServer.loadRemoteDatasourceContext).toHaveBeenCalledTimes(1);
  });

  it("does not touch the network when nothing carries a template", async () => {
    const meta = await resolve({
      title: "Q3 Launch Recap",
      _meta: { ogTitle: "The launch, in numbers" },
    });

    expect(puckServer.loadRemoteDatasourceContext).not.toHaveBeenCalled();
    expect(puckServer.resolveStringTemplates).not.toHaveBeenCalled();
    expect(og(meta).title).toBe("The launch, in numbers");
  });

  it("resolves only the fields that carry a template", async () => {
    await resolve({
      title: "Q3",
      _meta: { ogTitle: "Hello {{ name }}", ogDescription: "Static" },
    });

    expect(puckServer.resolveStringTemplates).toHaveBeenCalledTimes(1);
    expect(puckServer.resolveStringTemplates).toHaveBeenCalledWith("Hello {{ name }}", {});
  });

  it("resolves a metadata field when the title carries no template", async () => {
    // The context load used to be gated on title/description alone, so a
    // template that appeared only in _meta would never have been resolved.
    const meta = await resolve({ title: "Q3", _meta: { ogTitle: "Hello {{ name }}" } });

    expect(og(meta).title).toBe("Hello World");
  });

  it("still derives an unset field from the resolved title", async () => {
    const meta = await resolve({ title: "Hello {{ name }}", _meta: { ogTitle: "" } });

    expect(og(meta).title).toBe("Hello World");
    expect(tw(meta).title).toBe("Hello World");
  });
});
