import { describe, expect, it } from "vitest";
import { buildPageMetadata } from "../lib/seo-metadata";

/**
 * Site-level social defaults, delivered on the content payload alongside
 * og:site_name. They sit below the page's own values: a page that authors
 * og:image wins, a page that leaves it empty inherits the site's.
 */

const og = (m: ReturnType<typeof buildPageMetadata>) =>
  (m.openGraph ?? {}) as Record<string, unknown>;
const tw = (m: ReturnType<typeof buildPageMetadata>) =>
  (m.twitter ?? {}) as Record<string, unknown>;

describe("buildPageMetadata — site-level defaults", () => {
  it("uses the site og:image when the page leaves it empty", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "Q3 Launch Recap",
        siteDefaults: { ogImage: "https://cdn.example/site-social.png" },
        meta: { ogImage: "" },
      },
      path: "/q3",
    });

    expect(og(meta).images).toBe("https://cdn.example/site-social.png");
  });

  it("prefers the page's own og:image over the site default", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "Q3 Launch Recap",
        siteDefaults: { ogImage: "https://cdn.example/site-social.png" },
        meta: { ogImage: "https://cdn.example/page-hero.png" },
      },
      path: "/q3",
    });

    expect(og(meta).images).toBe("https://cdn.example/page-hero.png");
  });

  it("uses the site og:locale when the page leaves it empty", () => {
    const meta = buildPageMetadata({
      seo: { title: "Q3", siteDefaults: { ogLocale: "en_US" }, meta: {} },
      path: "/q3",
    });

    expect(og(meta).locale).toBe("en_US");
  });

  it("prefers the page's own og:locale over the site default", () => {
    const meta = buildPageMetadata({
      seo: { title: "Q3", siteDefaults: { ogLocale: "en_US" }, meta: { ogLocale: "fr_FR" } },
      path: "/q3",
    });

    expect(og(meta).locale).toBe("fr_FR");
  });

  it("lets an inherited image drive twitter:image and the card style", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "Q3",
        siteDefaults: { ogImage: "https://cdn.example/site-social.png" },
        meta: {},
      },
      path: "/q3",
    });

    expect(tw(meta).images).toBe("https://cdn.example/site-social.png");
    expect(tw(meta).card).toBe("summary_large_image");
  });

  it("omits the tags when neither tier has a value", () => {
    const meta = buildPageMetadata({ seo: { title: "Q3", meta: {} }, path: "/q3" });

    expect(og(meta).images).toBeUndefined();
    expect(og(meta).locale).toBeUndefined();
  });
});
