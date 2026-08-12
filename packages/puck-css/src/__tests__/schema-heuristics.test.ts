import { describe, it, expect } from "vitest";
import type { RemoteDatasourceFieldDoc } from "../data/remote-datasources/remote-datasource-registry.js";
import {
  suggestFieldForRole,
  autoMapFields,
} from "../data/schema-heuristics.js";

const RICH_FIELDS: RemoteDatasourceFieldDoc[] = [
  { path: "id", description: "Unique identifier" },
  { path: "title", description: "Article title" },
  { path: "subtitle", description: "Article subtitle" },
  { path: "date", description: "Published date" },
  { path: "thumbnail", description: "Thumbnail image URL" },
  { path: "body", description: "Article body" },
];

const AMBIGUOUS_FIELDS: RemoteDatasourceFieldDoc[] = [
  { path: "name", description: "Character name" },
  { path: "height", description: "Height in cm" },
  { path: "homeworld", description: "Planet name" },
  { path: "image", description: "Portrait image" },
];

const MINIMAL_FIELDS: RemoteDatasourceFieldDoc[] = [
  { path: "foo", description: "First field" },
  { path: "bar", description: "Second field" },
];

describe("suggestFieldForRole", () => {
  it("matches title by keyword", () => {
    expect(suggestFieldForRole(RICH_FIELDS, "title")).toBe("title");
  });

  it("matches name as title", () => {
    expect(suggestFieldForRole(AMBIGUOUS_FIELDS, "title")).toBe("name");
  });

  it("matches subtitle by keyword", () => {
    expect(suggestFieldForRole(RICH_FIELDS, "subtitle")).toBe("subtitle");
  });

  it("matches meta by date/author/category keyword", () => {
    expect(suggestFieldForRole(RICH_FIELDS, "meta")).toBe("date");
  });

  it("matches image by thumbnail/image keyword", () => {
    expect(suggestFieldForRole(RICH_FIELDS, "image")).toBe("thumbnail");
    expect(suggestFieldForRole(AMBIGUOUS_FIELDS, "image")).toBe("image");
  });

  it("returns null when no field matches", () => {
    expect(suggestFieldForRole(MINIMAL_FIELDS, "image")).toBeNull();
    expect(suggestFieldForRole(MINIMAL_FIELDS, "subtitle")).toBeNull();
  });

  it("returns null for empty fields array", () => {
    expect(suggestFieldForRole([], "title")).toBeNull();
  });

  it("is case-insensitive", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "ArticleTitle", description: "The title" },
    ];
    expect(suggestFieldForRole(fields, "title")).toBe("ArticleTitle");
  });

  it("matches headline as title", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "headline", description: "News headline" },
    ];
    expect(suggestFieldForRole(fields, "title")).toBe("headline");
  });

  it("matches excerpt as subtitle", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "excerpt", description: "Article excerpt" },
    ];
    expect(suggestFieldForRole(fields, "subtitle")).toBe("excerpt");
  });

  it("matches author as meta", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "author", description: "Article author" },
    ];
    expect(suggestFieldForRole(fields, "meta")).toBe("author");
  });

  it("matches photo as image", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "photo", description: "Profile photo" },
    ];
    expect(suggestFieldForRole(fields, "image")).toBe("photo");
  });

  it("matches teaser_text as teaser", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "teaser_text", description: "Preview teaser" },
    ];
    expect(suggestFieldForRole(fields, "teaser")).toBe("teaser_text");
  });

  it("matches preview as teaser", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "preview", description: "Content preview" },
    ];
    expect(suggestFieldForRole(fields, "teaser")).toBe("preview");
  });

  it("matches snippet as teaser", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "snippet", description: "Text snippet" },
    ];
    expect(suggestFieldForRole(fields, "teaser")).toBe("snippet");
  });

  it("matches blurb as teaser", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "blurb", description: "Short blurb" },
    ];
    expect(suggestFieldForRole(fields, "teaser")).toBe("blurb");
  });

  it("matches icon as icon", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "icon", description: "Item icon" },
    ];
    expect(suggestFieldForRole(fields, "icon")).toBe("icon");
  });

  it("matches logo as icon", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "logo", description: "Brand logo" },
    ];
    expect(suggestFieldForRole(fields, "icon")).toBe("logo");
  });

  it("matches badge as icon", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "badge", description: "Achievement badge" },
    ];
    expect(suggestFieldForRole(fields, "icon")).toBe("badge");
  });

  it("matches emoji as icon", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "emoji", description: "Status emoji" },
    ];
    expect(suggestFieldForRole(fields, "icon")).toBe("emoji");
  });
});

describe("autoMapFields", () => {
  it("maps all four roles from rich field set", () => {
    const result = autoMapFields(RICH_FIELDS);
    expect(result.title).toBe("title");
    expect(result.subtitle).toBe("subtitle");
    expect(result.meta).toBe("date");
    expect(result.image).toBe("thumbnail");
  });

  it("does not assign the same field to multiple roles", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "name", description: "Display name" },
    ];
    const result = autoMapFields(fields);
    expect(result.title).toBe("name");
    expect(result.subtitle).toBeUndefined();
    expect(result.meta).toBeUndefined();
    expect(result.image).toBeUndefined();
  });

  it("falls back to first field for title when no keyword match", () => {
    const result = autoMapFields(MINIMAL_FIELDS);
    expect(result.title).toBe("foo");
  });

  it("returns empty mapping for empty fields", () => {
    const result = autoMapFields([]);
    expect(result.title).toBeUndefined();
    expect(result.subtitle).toBeUndefined();
    expect(result.meta).toBeUndefined();
    expect(result.image).toBeUndefined();
  });

  it("assigns roles in priority order (title > subtitle > meta > image)", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "title_and_image", description: "Has both title and image keywords" },
      { path: "other", description: "Something else" },
    ];
    const result = autoMapFields(fields);
    expect(result.title).toBe("title_and_image");
    expect(result.image).toBeUndefined();
  });

  it("maps teaser and icon roles from a rich field set", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "title", description: "Title" },
      { path: "teaser_text", description: "Teaser text" },
      { path: "icon", description: "Item icon" },
    ];
    const result = autoMapFields(fields);
    expect(result.title).toBe("title");
    expect(result.teaser).toBe("teaser_text");
    expect(result.icon).toBe("icon");
  });

  it("maps all six roles when all keywords are present", () => {
    const fields: RemoteDatasourceFieldDoc[] = [
      { path: "title", description: "Title" },
      { path: "subtitle", description: "Subtitle" },
      { path: "date", description: "Date" },
      { path: "thumbnail", description: "Image" },
      { path: "preview", description: "Teaser" },
      { path: "logo", description: "Icon" },
    ];
    const result = autoMapFields(fields);
    expect(result.title).toBe("title");
    expect(result.subtitle).toBe("subtitle");
    expect(result.meta).toBe("date");
    expect(result.image).toBe("thumbnail");
    expect(result.teaser).toBe("preview");
    expect(result.icon).toBe("logo");
  });
});
