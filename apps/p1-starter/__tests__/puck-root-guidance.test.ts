import { describe, expect, it } from "vitest";
import { puckRoot } from "../components/puck/root";

/**
 * Guidance on the page-metadata fields: help text under every field, and a
 * placeholder showing what an empty field will inherit.
 *
 * The placeholder comes from `resolveFields` reading the live root props — the
 * only tiers that exist today are the page's own title and description. It is a
 * placeholder rather than a value on purpose: autosave persists the whole
 * snapshot, so a derived value written into the field would be saved and the
 * field would stop inheriting for good.
 */

type Field = {
  type: string;
  label?: string;
  placeholder?: string;
  metadata?: { help?: string; helpWhenEmpty?: string };
};
type ObjectField = { type: string; objectFields: Record<string, Field> };

const staticMeta = (puckRoot.fields as Record<string, unknown>)._meta as ObjectField;

const resolve = (props: Record<string, unknown>) => {
  const resolveFields = puckRoot.resolveFields as (
    data: { props: Record<string, unknown> },
  ) => Record<string, unknown>;
  const fields = resolveFields({ props });
  return (fields._meta as ObjectField).objectFields;
};

const INHERITS_FROM: Record<string, string> = {
  ogTitle: "title",
  ogDescription: "description",
  twitterTitle: "title",
};

describe("page-metadata field guidance", () => {
  it("gives every metadata field help text", () => {
    for (const [name, field] of Object.entries(staticMeta.objectFields)) {
      expect(
        field.metadata?.help ?? field.metadata?.helpWhenEmpty,
        `${name} has no help text`,
      ).toBeTruthy();
    }
  });

  it("tells an empty inheriting field where its value comes from", () => {
    for (const name of Object.keys(INHERITS_FROM)) {
      expect(staticMeta.objectFields[name]?.metadata?.helpWhenEmpty).toMatch(/inherit/i);
    }
  });
});

describe("puckRoot.resolveFields", () => {
  it("shows the inherited value as the placeholder", () => {
    const fields = resolve({ title: "Q3 Launch Recap", description: "How it went" });

    expect(fields.ogTitle?.placeholder).toBe("Q3 Launch Recap");
    expect(fields.twitterTitle?.placeholder).toBe("Q3 Launch Recap");
    expect(fields.ogDescription?.placeholder).toBe("How it went");
  });

  it("follows the same fallback chains the head tags use", () => {
    // buildPageMetadata resolves twitter:title from ogTitle before title, and
    // twitter:image from ogImage. A placeholder that disagreed would mislead.
    const fields = resolve({
      title: "Q3 Launch Recap",
      _meta: { ogTitle: "Read the Q3 recap", ogImage: "https://cdn.example/card.png" },
    });

    expect(fields.twitterTitle?.placeholder).toBe("Read the Q3 recap");
    expect(fields.twitterImage?.placeholder).toBe("https://cdn.example/card.png");
  });

  it("omits the placeholder when there is nothing to inherit", () => {
    const fields = resolve({});

    expect(fields.ogTitle?.placeholder).toBeUndefined();
    expect(fields.ogDescription?.placeholder).toBeUndefined();
  });

  it("does not offer the editor's boilerplate title as an inherited value", () => {
    // Matches the head-tag side, which refuses to ship defaultProps.title.
    const fields = resolve({ title: "My Puck Editor" });

    expect(fields.ogTitle?.placeholder).toBeUndefined();
  });

  it("resolves the same field set it declares statically", () => {
    expect(Object.keys(resolve({ title: "x" })).sort()).toEqual(
      Object.keys(staticMeta.objectFields).sort(),
    );
  });

  it("leaves the declared fields unmutated, so a resolve cannot leak into the next", () => {
    resolve({ title: "Q3 Launch Recap" });

    expect(staticMeta.objectFields.ogTitle?.placeholder).toBeUndefined();
  });

  it("keeps the placeholder out of the document by never touching props", () => {
    const props = { title: "Q3 Launch Recap", _meta: { ogTitle: "" } };
    resolve(props);

    expect(props._meta).toEqual({ ogTitle: "" });
  });
});
