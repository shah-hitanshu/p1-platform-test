import { describe, expect, it } from "vitest";
import { createSeoRootFields } from "@pantheon-systems/puck-css/seo";
import { puckRoot } from "../components/puck/root";

/**
 * The root config composes the page-metadata fields rather than declaring them.
 *
 * The field set and its placeholder chains are tested in puck-css, which owns
 * the `root.props._meta` shape they write. What matters here is that this
 * template keeps composing them — and that title, description and the render
 * wrapper stay the site's own, so branding remains forkable.
 */

type Fields = Record<string, unknown>;

const fields = puckRoot.fields as Fields;
const resolved = (props: Record<string, unknown>) =>
  (puckRoot.resolveFields as (data: { props: Record<string, unknown> }) => Fields)({
    props,
  });

describe("puckRoot", () => {
  it("keeps the site's own title and description fields", () => {
    expect(fields.title).toEqual({ type: "text" });
    expect(fields.description).toEqual({ type: "textarea" });
  });

  it("takes the metadata field set from puck-css", () => {
    expect(fields._meta).toEqual(createSeoRootFields()._meta);
  });

  it("passes the live root props through, so placeholders track edits", () => {
    const meta = resolved({ title: "Q3 Launch Recap" })._meta as {
      objectFields: Record<string, { placeholder?: string }>;
    };

    expect(meta.objectFields.ogTitle?.placeholder).toBe("Q3 Launch Recap");
  });

  it("resolves the same field set it declares statically", () => {
    expect(Object.keys(resolved({ title: "x" })).sort()).toEqual(
      Object.keys(fields).sort(),
    );
  });

  it("adds no _meta default, so no page is seeded with boilerplate metadata", () => {
    // Empty-means-inherit: an unset field falls back at render time. A default
    // here would freeze a value into every new page's snapshot.
    expect(puckRoot.defaultProps).not.toHaveProperty("_meta");
  });
});
