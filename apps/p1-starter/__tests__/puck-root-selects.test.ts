import { describe, expect, it } from "vitest";
import { puckRoot } from "../components/puck/root";
import { OG_TYPES, TWITTER_CARDS } from "../lib/seo-metadata.consts";

/**
 * The two metadata fields with a fixed vocabulary are dropdowns.
 *
 * Their options come from the same lists `buildPageMetadata` validates against,
 * so an option cannot drift from what actually reaches the tag.
 *
 * The default option's value is empty rather than the default itself. Storing
 * `website` on every page would freeze it there, and a page holding an explicit
 * value can never pick up a template default later — so the label states the
 * outcome while the data stays uncommitted.
 */

type Field = {
  type: string;
  options?: { label: string; value: string }[];
};
type ObjectField = { type: string; objectFields: Record<string, Field> };

const staticMeta = (puckRoot.fields as Record<string, unknown>)._meta as ObjectField;

const resolve = (props: Record<string, unknown>) => {
  const resolveFields = puckRoot.resolveFields as (
    data: { props: Record<string, unknown> },
  ) => Record<string, unknown>;
  return (resolveFields({ props })._meta as ObjectField).objectFields;
};

const values = (field?: Field) => field?.options?.map((option) => option.value) ?? [];

describe("fixed-vocabulary metadata fields", () => {
  it("renders as selects rather than free text", () => {
    expect(staticMeta.objectFields.ogType?.type).toBe("select");
    expect(staticMeta.objectFields.twitterCard?.type).toBe("select");
  });

  it("offers exactly the values the head tags accept", () => {
    expect(values(staticMeta.objectFields.ogType).filter(Boolean)).toEqual([...OG_TYPES]);
    expect(values(staticMeta.objectFields.twitterCard).filter(Boolean)).toEqual([
      ...TWITTER_CARDS,
    ]);
  });

  it("keeps an empty first option, so a page stays uncommitted", () => {
    for (const name of ["ogType", "twitterCard"]) {
      expect(values(staticMeta.objectFields[name])[0]).toBe("");
    }
  });

  it("labels every option, since the tag values are not user-facing", () => {
    for (const name of ["ogType", "twitterCard"]) {
      const options = staticMeta.objectFields[name]?.options ?? [];
      expect(options.length).toBeGreaterThan(1);
      for (const option of options) {
        expect(option.label).toBeTruthy();
      }
    }
  });

  it("names the og:type default, which is always website", () => {
    expect(staticMeta.objectFields.ogType?.options?.[0]?.label).toMatch(/website/i);
  });

  it("names the default card style, which depends on whether there is an image", () => {
    // buildPageMetadata picks summary_large_image when an image is present and
    // summary when it is not, so the label has to follow the image field.
    const withImage = resolve({ _meta: { ogImage: "https://cdn.example/card.png" } });
    const without = resolve({});

    expect(withImage.twitterCard?.options?.[0]?.label).toMatch(/large image/i);
    expect(without.twitterCard?.options?.[0]?.label).toMatch(/summary/i);
    expect(without.twitterCard?.options?.[0]?.label).not.toMatch(/large image/i);
  });

  it("varies only the default label, never the option values", () => {
    const resolved = resolve({ _meta: { ogImage: "https://cdn.example/card.png" } });

    expect(values(resolved.ogType)).toEqual(values(staticMeta.objectFields.ogType));
    expect(values(resolved.twitterCard)).toEqual(
      values(staticMeta.objectFields.twitterCard),
    );
  });
});
