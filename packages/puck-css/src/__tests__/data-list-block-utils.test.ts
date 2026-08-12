import { describe, it, expect } from "vitest";
import {
  getByDotPath,
  viewExtractKey,
  resolveField,
  resolveItemFields,
  normalizeItems,
} from "../data/data-list-block/utils.js";

describe("getByDotPath", () => {
  it("resolves a top-level key", () => {
    expect(getByDotPath({ name: "Alice" }, "name")).toBe("Alice");
  });

  it("resolves a nested key", () => {
    expect(getByDotPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns undefined for missing key", () => {
    expect(getByDotPath({ a: 1 }, "b")).toBeUndefined();
  });

  it("returns undefined for path through non-object", () => {
    expect(getByDotPath({ a: "string" }, "a.b")).toBeUndefined();
  });

  it("returns undefined for path through null", () => {
    expect(getByDotPath({ a: null }, "a.b")).toBeUndefined();
  });

  it("returns undefined for path through array", () => {
    expect(getByDotPath({ a: [1, 2] }, "a.b")).toBeUndefined();
  });

  it("blocks __proto__ access", () => {
    expect(getByDotPath({}, "__proto__")).toBeUndefined();
  });

  it("blocks constructor access", () => {
    expect(getByDotPath({}, "constructor")).toBeUndefined();
  });

  it("blocks prototype access", () => {
    expect(getByDotPath({}, "prototype")).toBeUndefined();
  });

  it("blocks unsafe key in nested path", () => {
    expect(getByDotPath({ a: {} }, "a.__proto__")).toBeUndefined();
  });
});

describe("viewExtractKey", () => {
  it("extracts key from {{ item.fieldName }}", () => {
    expect(viewExtractKey("{{ item.name }}")).toBe("name");
  });

  it("extracts nested key", () => {
    expect(viewExtractKey("{{ item.address.city }}")).toBe("address.city");
  });

  it("handles whitespace variations", () => {
    expect(viewExtractKey("{{item.name}}")).toBe("name");
    expect(viewExtractKey("{{  item.name  }}")).toBe("name");
  });

  it("returns empty string for non-template value", () => {
    expect(viewExtractKey("plain text")).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(viewExtractKey("")).toBe("");
  });

  it("returns empty string for malformed template", () => {
    expect(viewExtractKey("{{ notitem.name }}")).toBe("");
  });
});

describe("resolveField", () => {
  it("resolves a template against an item", () => {
    expect(resolveField({ name: "Luke" }, "{{ item.name }}")).toBe("Luke");
  });

  it("returns empty string for missing field", () => {
    expect(resolveField({ name: "Luke" }, "{{ item.age }}")).toBe("");
  });

  it("returns empty string for non-template value", () => {
    expect(resolveField({ name: "Luke" }, "plain")).toBe("");
  });

  it("returns empty string for empty template value", () => {
    expect(resolveField({ name: "Luke" }, "")).toBe("");
  });

  it("converts numbers to string", () => {
    expect(resolveField({ count: 42 }, "{{ item.count }}")).toBe("42");
  });

  it("returns empty string for null value", () => {
    expect(resolveField({ x: null }, "{{ item.x }}")).toBe("");
  });

  it("joins a flat array of strings with commas", () => {
    expect(resolveField({ types: ["Grass", "Poison"] }, "{{ item.types }}")).toBe("Grass, Poison");
  });

  it("joins a flat array of numbers with commas", () => {
    expect(resolveField({ scores: [10, 20, 30] }, "{{ item.scores }}")).toBe("10, 20, 30");
  });

  it("stringifies an array of objects as JSON", () => {
    const val = resolveField({ tags: [{ name: "a" }] }, "{{ item.tags }}");
    expect(val).toBe('[{"name":"a"}]');
  });

  it("stringifies a plain object as JSON", () => {
    const val = resolveField({ stats: { hp: 45, attack: 49 } }, "{{ item.stats }}");
    expect(val).toBe('{"hp":45,"attack":49}');
  });
});

describe("resolveItemFields", () => {
  const item = {
    name: "Luke",
    role: "Jedi",
    bio: "A Jedi Knight",
    avatar: "/luke.png",
    emblem: "star",
  };

  const mappings = {
    titleField: "{{ item.name }}",
    subtitleField: "{{ item.role }}",
    teaserField: "{{ item.bio }}",
    imageField: "{{ item.avatar }}",
    iconField: "{{ item.emblem }}",
  };

  it("resolves all fields into a ResolvedItem", () => {
    const resolved = resolveItemFields(item, mappings);
    expect(resolved.title).toBe("Luke");
    expect(resolved.subtitle).toBe("Jedi");
    expect(resolved.teaser).toBe("A Jedi Knight");
    expect(resolved.image).toBe("/luke.png");
    expect(resolved.icon).toBe("star");
  });

  it("preserves the raw item", () => {
    const resolved = resolveItemFields(item, mappings);
    expect(resolved._raw).toBe(item);
  });

  it("returns empty strings for unmapped fields", () => {
    const resolved = resolveItemFields(item, {
      titleField: "",
      subtitleField: "",
      teaserField: "",
      imageField: "",
      iconField: "",
    });
    expect(resolved.title).toBe("");
    expect(resolved.subtitle).toBe("");
    expect(resolved.teaser).toBe("");
    expect(resolved.image).toBe("");
    expect(resolved.icon).toBe("");
  });
});

describe("normalizeItems", () => {
  it("returns an array as-is", () => {
    const arr = [{ a: 1 }, { b: 2 }];
    expect(normalizeItems(arr)).toBe(arr);
  });

  it("parses a JSON string array", () => {
    const json = JSON.stringify([{ x: 1 }]);
    expect(normalizeItems(json)).toEqual([{ x: 1 }]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(normalizeItems('{"a":1}')).toEqual([]);
  });

  it("returns empty array for invalid JSON string", () => {
    expect(normalizeItems("not json")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(normalizeItems("")).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(normalizeItems(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(normalizeItems(undefined)).toEqual([]);
  });

  it("returns empty array for number", () => {
    expect(normalizeItems(42)).toEqual([]);
  });
});
