import { describe, it, expect } from "vitest";
import type { Data } from "@puckeditor/core";
import { resolveDataTemplates } from "../data/resolve-data-templates.js";

/**
 * CSS query names are kebab-case and datasource ids are built as
 * `templates.${query.name}`, so the hyphenated form is the normal case for every
 * template datasource — not an edge case.
 */

const pageWith = (expr: string) =>
  ({
    root: { props: {} },
    content: [{ type: "DataListBlock", props: { id: "a", items: expr } }],
  }) as unknown as Data;

const itemsOf = (data: Data) =>
  (data.content[0]?.props as Record<string, unknown>).items;

describe("resolveDataTemplates with hyphenated template ids", () => {
  const context = {
    "templates.blog-post": { items: [{ path: "blog/page1" }] },
    "templates.news": { items: [{ path: "news/1" }] },
    numbers: { a: 10, b: 4 },
  };

  it("resolves a hyphenated dotted key", async () => {
    const out = await resolveDataTemplates(
      pageWith("{{ templates.blog-post.items }}"),
      context,
    );
    expect(itemsOf(out)).toEqual([{ path: "blog/page1" }]);
  });

  it("resolves the whole hyphenated source when no sub-path is given", async () => {
    const out = await resolveDataTemplates(
      pageWith("{{ templates.blog-post }}"),
      context,
    );
    expect(itemsOf(out)).toEqual({ items: [{ path: "blog/page1" }] });
  });

  it("still resolves a non-hyphenated dotted key", async () => {
    const out = await resolveDataTemplates(
      pageWith("{{ templates.news.items }}"),
      context,
    );
    expect(itemsOf(out)).toEqual([{ path: "news/1" }]);
  });

  it("reads unspaced hyphens as path segments, not subtraction (PCC-3668)", async () => {
    // Arithmetic was never supported (evalTemplateExpression has no
    // BinaryExpression case), so `a-b` is a key lookup, not `a - b`.
    const withHyphenKey = { ...context, numbers: { ...context.numbers, "a-b": 6 } };
    const hit = await resolveDataTemplates(
      pageWith("{{ numbers.a-b }}"),
      withHyphenKey,
    );
    expect(itemsOf(hit)).toBe("6");

    const miss = await resolveDataTemplates(
      pageWith("{{ numbers.a-b }}"),
      context,
    );
    expect(itemsOf(miss)).toBe("");
  });

  it("yields nothing for an unknown hyphenated template", async () => {
    const out = await resolveDataTemplates(
      pageWith("{{ templates.no-such-template.items }}"),
      context,
    );
    expect(itemsOf(out)).toBe("");
  });
});
