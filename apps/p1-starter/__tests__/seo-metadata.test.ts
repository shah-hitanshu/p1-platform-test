import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPageMetadata } from "../lib/seo-metadata";

/**
 * buildPageMetadata maps the head metadata inputs (client-derived
 * title/description/canonical plus the backend-supplied siteName) onto the
 * Next.js Metadata object that renders the per-page <head> tags. Next replaces
 * (not deep-merges) a page's openGraph over the layout's, so og:type and the
 * env og:site_name fallback are declared here rather than relying on the
 * layout. A relative canonical is emitted only when NEXT_PUBLIC_SITE_URL is
 * configured to resolve it — a wrong (localhost) canonical is worse than none.
 */
describe("buildPageMetadata", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("maps a full SeoMetadata onto title/description/canonical/OG tags", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "About Our Team",
        description: "Meet the people behind the product.",
        canonicalUrl: "https://content.public.url/about/team",
        siteName: "Acme Docs",
      },
      path: "/about/team",
    });

    expect(meta.title).toBe("About Our Team");
    expect(meta.description).toBe("Meet the people behind the product.");
    // Absolute canonicalUrl is used verbatim for canonical + og:url.
    expect(meta.alternates?.canonical).toBe(
      "https://content.public.url/about/team",
    );
    expect(meta.openGraph?.url).toBe("https://content.public.url/about/team");
    expect(meta.openGraph?.title).toBe("About Our Team");
    expect(meta.openGraph?.description).toBe(
      "Meet the people behind the product.",
    );
    expect((meta.openGraph as { siteName?: string }).siteName).toBe(
      "Acme Docs",
    );
    expect((meta.openGraph as { type?: string }).type).toBe("website");
  });

  it("falls back to the relative path when canonicalUrl is absent and a site URL is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.example");
    const meta = buildPageMetadata({
      seo: { title: "No Canonical" },
      path: "/no-canonical",
    });

    expect(meta.alternates?.canonical).toBe("/no-canonical");
    expect(meta.openGraph?.url).toBe("/no-canonical");
  });

  it("omits canonical and og:url when neither canonicalUrl nor a site URL exists", () => {
    const meta = buildPageMetadata({
      seo: { title: "No Canonical" },
      path: "/no-canonical",
    });

    expect(meta.alternates).toBeUndefined();
    expect((meta.openGraph as { url?: string }).url).toBeUndefined();
  });

  it("falls back to the env site name when siteName is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_NAME", "Env Site");
    const meta = buildPageMetadata({
      seo: { title: "No Site Name" },
      path: "/x",
    });

    expect((meta.openGraph as { siteName?: string }).siteName).toBe(
      "Env Site",
    );
  });

  it("omits og:site_name when siteName and the env fallback are both absent", () => {
    const meta = buildPageMetadata({
      seo: { title: "No Site Name" },
      path: "/x",
    });

    expect((meta.openGraph as { siteName?: string }).siteName).toBeUndefined();
  });

  it("treats an empty title as absent", () => {
    const meta = buildPageMetadata({
      seo: { title: "" },
      path: "/x",
    });

    expect(meta.title).toBeUndefined();
    expect((meta.openGraph as { title?: string }).title).toBeUndefined();
  });

  it("handles missing seo entirely (og:type still emitted, canonical omitted)", () => {
    const meta = buildPageMetadata({ path: "/" });

    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.alternates).toBeUndefined();
    expect((meta.openGraph as { url?: string }).url).toBeUndefined();
    expect((meta.openGraph as { type?: string }).type).toBe("website");
  });
});
