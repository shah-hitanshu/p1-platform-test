import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPageMetadata } from "../lib/seo-metadata";

/**
 * Authored page metadata (`root.props._meta`) rendered into <head>.
 *
 * Resolution order is: authored value → derived from title/description → omit
 * the tag. The template and site-default tiers are not wired up yet, so an
 * absent value must omit rather than guess.
 */

const og = (m: ReturnType<typeof buildPageMetadata>) =>
  (m.openGraph ?? {}) as Record<string, unknown>;
const tw = (m: ReturnType<typeof buildPageMetadata>) =>
  (m.twitter ?? {}) as Record<string, unknown>;

describe("buildPageMetadata — Open Graph from _meta", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the authored og values over the page title and description", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "Q3 Launch Recap",
        description: "How the launch went.",
        meta: { ogTitle: "The launch, in numbers", ogDescription: "Charts inside." },
      },
      path: "/q3",
    });

    expect(og(meta).title).toBe("The launch, in numbers");
    expect(og(meta).description).toBe("Charts inside.");
    // The page's own <title> is unaffected by the social override.
    expect(meta.title).toBe("Q3 Launch Recap");
  });

  it("falls back to title and description when the og fields are empty", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "Q3 Launch Recap",
        description: "How the launch went.",
        meta: { ogTitle: "", ogDescription: "" },
      },
      path: "/q3",
    });

    expect(og(meta).title).toBe("Q3 Launch Recap");
    expect(og(meta).description).toBe("How the launch went.");
  });

  it("emits og:image and og:locale when authored", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "Q3",
        meta: { ogImage: "https://cdn.example/hero.jpg", ogLocale: "en_US" },
      },
      path: "/q3",
    });

    expect(og(meta).images).toBe("https://cdn.example/hero.jpg");
    expect(og(meta).locale).toBe("en_US");
  });

  it("omits og:image and og:locale entirely when not authored", () => {
    const meta = buildPageMetadata({ seo: { title: "Q3" }, path: "/q3" });

    expect(og(meta)).not.toHaveProperty("images");
    expect(og(meta)).not.toHaveProperty("locale");
  });

  it("uses the authored og:type and keeps website as the default", () => {
    expect(og(buildPageMetadata({ seo: { title: "Q3", meta: { ogType: "article" } }, path: "/q3" })).type).toBe("article");
    expect(og(buildPageMetadata({ seo: { title: "Q3" }, path: "/q3" })).type).toBe("website");
  });
});

describe("buildPageMetadata — Twitter card", () => {
  it("defaults to summary_large_image when an image is available", () => {
    const meta = buildPageMetadata({
      seo: { title: "Q3", meta: { ogImage: "https://cdn.example/hero.jpg" } },
      path: "/q3",
    });

    expect(tw(meta).card).toBe("summary_large_image");
  });

  it("defaults to summary when no image is available", () => {
    const meta = buildPageMetadata({ seo: { title: "Q3" }, path: "/q3" });

    expect(tw(meta).card).toBe("summary");
  });

  it("respects an authored card style", () => {
    const meta = buildPageMetadata({
      seo: { title: "Q3", meta: { twitterCard: "summary", ogImage: "https://cdn.example/a.jpg" } },
      path: "/q3",
    });

    expect(tw(meta).card).toBe("summary");
  });

  it("ignores an unrecognised card style rather than emitting it", () => {
    // The field is free text, so a typo must not produce an invalid tag.
    const meta = buildPageMetadata({
      seo: { title: "Q3", meta: { twitterCard: "summary_large" } },
      path: "/q3",
    });

    expect(tw(meta).card).toBe("summary");
  });

  it("falls back through twitter → og → page for title and image", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "Q3 Launch Recap",
        meta: { ogTitle: "The launch", ogImage: "https://cdn.example/og.jpg" },
      },
      path: "/q3",
    });

    expect(tw(meta).title).toBe("The launch");
    expect(tw(meta).images).toBe("https://cdn.example/og.jpg");
  });

  it("prefers authored twitter values over the og ones", () => {
    const meta = buildPageMetadata({
      seo: {
        title: "Q3 Launch Recap",
        meta: {
          ogTitle: "The launch",
          ogImage: "https://cdn.example/og.jpg",
          twitterTitle: "Launch, for X",
          twitterImage: "https://cdn.example/x.jpg",
        },
      },
      path: "/q3",
    });

    expect(tw(meta).title).toBe("Launch, for X");
    expect(tw(meta).images).toBe("https://cdn.example/x.jpg");
  });

  it("omits the twitter block entirely when there is nothing to say", () => {
    const meta = buildPageMetadata({ seo: {}, path: "/untitled" });

    expect(meta.twitter).toBeUndefined();
  });
});

describe("buildPageMetadata — unchanged behaviour", () => {
  it("still emits title, description and siteName with no _meta present", () => {
    const meta = buildPageMetadata({
      seo: { title: "About", description: "Us", siteName: "Acme" },
      path: "/about",
    });

    expect(meta.title).toBe("About");
    expect(meta.description).toBe("Us");
    expect(og(meta).siteName).toBe("Acme");
  });
});

describe("buildPageMetadata — free-text fields are validated", () => {
  it("falls back to website for an unrecognised og:type", () => {
    // Next types og:type as a union, so an arbitrary string is both a type error
    // and an invalid tag, and the editor field is free text.
    const meta = buildPageMetadata({
      seo: { title: "Q3", meta: { ogType: "artical" } },
      path: "/q3",
    });

    expect(og(meta).type).toBe("website");
  });

  it("keeps the recognised og:type values", () => {
    for (const type of ["website", "article", "book", "profile"]) {
      const meta = buildPageMetadata({ seo: { title: "Q3", meta: { ogType: type } }, path: "/q3" });
      expect(og(meta).type).toBe(type);
    }
  });
});
