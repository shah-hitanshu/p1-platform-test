import { describe, expect, it } from "vitest";
import { puckRoot } from "../components/puck/root";

/**
 * The fixed page-metadata field set on the Puck root config.
 *
 * Values live at `root.props._meta` in the page snapshot — branch-scoped,
 * versioned and autosaved for free. The field set itself is fixed: no
 * admin-defined fields, no template or site tiers. `resolveFields` varies only
 * the placeholders (see puck-root-guidance), never which fields exist.
 *
 * Fields are declared flat inside one `_meta` object field. Grouping them
 * (SEO / Open Graph / Twitter) would mean nesting object fields, which deepens
 * the prop paths the root-prop migration applier has to handle.
 */

type ObjectField = {
  type: string;
  label?: string;
  objectFields: Record<string, { type: string; label?: string }>;
};

const metaField = (puckRoot.fields as Record<string, unknown>)._meta as ObjectField;

// ogType and twitterCard are selects: their vocabulary is fixed by what Next
// accepts for the tag. See puck-root-selects.
const EXPECTED_FIELDS: Record<string, string> = {
  ogTitle: "text",
  ogDescription: "textarea",
  ogType: "select",
  ogImage: "text",
  ogLocale: "text",
  twitterCard: "select",
  twitterTitle: "text",
  twitterImage: "text",
};

describe("puckRoot._meta field set", () => {
  it("is a single object field", () => {
    expect(metaField).toBeDefined();
    expect(metaField.type).toBe("object");
  });

  it("declares exactly the eight fixed fields, flat", () => {
    expect(Object.keys(metaField.objectFields).sort()).toEqual(
      Object.keys(EXPECTED_FIELDS).sort(),
    );
  });

  it("gives each field the expected type", () => {
    for (const [name, type] of Object.entries(EXPECTED_FIELDS)) {
      expect(metaField.objectFields[name]?.type).toBe(type);
    }
  });

  it("labels every field with the tag it writes", () => {
    // Not friendly rewrites: someone editing these is working from a checklist
    // that names the tags, and "Social title" makes them guess which one it is.
    expect(
      Object.fromEntries(
        Object.keys(EXPECTED_FIELDS).map((name) => [
          name,
          metaField.objectFields[name]?.label,
        ]),
      ),
    ).toEqual({
      ogTitle: "og:title",
      ogDescription: "og:description",
      ogType: "og:type",
      ogImage: "og:image",
      ogLocale: "og:locale",
      twitterCard: "twitter:card",
      twitterTitle: "twitter:title",
      twitterImage: "twitter:image",
    });
  });

  it("names the group for what it holds, matching the prototype", () => {
    expect((metaField as { label?: string }).label).toBe("Social & sharing");
  });

  it("omits ogUrl — the canonical URL is derived from the request", () => {
    expect(metaField.objectFields).not.toHaveProperty("ogUrl");
  });

  it("includes twitterCard, without which twitter:title and twitter:image are inert", () => {
    expect(metaField.objectFields.twitterCard).toBeDefined();
  });

  it("keeps the existing title and description fields", () => {
    const fields = puckRoot.fields as Record<string, { type: string }>;
    expect(fields.title?.type).toBe("text");
    expect(fields.description?.type).toBe("textarea");
  });

  it("adds no _meta default, so no page is seeded with boilerplate metadata", () => {
    // Empty-means-inherit (Q1): an unset field falls back at render time. A
    // default here would freeze a value into every new page's snapshot, and
    // would need adding to the DEFAULT_EDITOR_TITLE-style boilerplate filter.
    expect(puckRoot.defaultProps).not.toHaveProperty("_meta");
  });
});
