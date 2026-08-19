import { describe, it, expect } from "vitest";
import type { Data } from "@puckeditor/core";
import { extractReferencedDatasourceIds } from "../data/remote-datasources/loader.js";

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

describe("extractReferencedDatasourceIds", () => {
  it("extracts a hyphenated template id", () => {
    const ids = extractReferencedDatasourceIds(
      pageWith("{{ templates.blog-post.items }}"),
    );
    expect([...ids]).toEqual(["templates.blog-post"]);
  });

  it("extracts a template id with several hyphens", () => {
    const ids = extractReferencedDatasourceIds(
      pageWith("{{ templates.long-form-blog-post.items }}"),
    );
    expect([...ids]).toEqual(["templates.long-form-blog-post"]);
  });

  it("still extracts a non-hyphenated template id", () => {
    const ids = extractReferencedDatasourceIds(
      pageWith("{{ templates.news.items }}"),
    );
    expect([...ids]).toEqual(["templates.news"]);
  });

  it("still extracts plain datasource ids", () => {
    const ids = extractReferencedDatasourceIds(
      pageWith("{{ swapi_list.items }}"),
    );
    expect([...ids]).toEqual(["swapi_list"]);
  });

  it("extracts hyphenated plain datasource ids (PCC-3668)", () => {
    // P1 auto-generates content-type datasource ids as kebab-case (`blog-post`),
    // so plain ids must admit hyphens or those datasources are never fetched.
    const ids = extractReferencedDatasourceIds(pageWith("{{ swapi-list.items }}"));
    expect([...ids]).toEqual(["swapi-list"]);
  });
});
