import { describe, it, expect } from "vitest";
import { DEFAULT_MEDIA_PATTERNS } from "../patterns";

function matchesPatterns(name: string): boolean {
  return DEFAULT_MEDIA_PATTERNS.some((p) => p.test(name));
}

describe("DEFAULT_MEDIA_PATTERNS", () => {
  describe("should match media/image source fields", () => {
    const mediaFields = [
      "imageUrl",
      "logoUrl",
      "mediaUrl",
      "iconUrl",
      "thumbnailUrl",
      "productImageUrl",
      "sponsorLogoUrl",
      "corporateLogoUrl",
      "image",
      "logo",
      "media",
      "icon",
      "thumbnail",
    ];

    it.each(mediaFields)("matches %s", (name) => {
      expect(matchesPatterns(name)).toBe(true);
    });
  });

  describe("should NOT match navigation/link URL fields", () => {
    const nonMediaFields = [
      "buttonUrl",
      "linkUrl",
      "url",
      "shopButtonUrl",
      "viewAllUrl",
      "ctaUrl",
      "videoUrl",
      "href",
    ];

    it.each(nonMediaFields)("does not match %s", (name) => {
      expect(matchesPatterns(name)).toBe(false);
    });
  });

  describe("should NOT match alt text or non-URL fields", () => {
    const otherFields = [
      "imageAlt",
      "logoAlt",
      "mediaAlt",
      "accentColor",
      "backgroundColor",
      "title",
      "description",
      "buttonText",
    ];

    it.each(otherFields)("does not match %s", (name) => {
      expect(matchesPatterns(name)).toBe(false);
    });
  });
});
