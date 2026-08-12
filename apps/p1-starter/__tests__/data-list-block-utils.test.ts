import { describe, expect, it } from "vitest";

describe("data-list-block utils", () => {
  describe("getByDotPath", () => {
    it("traverses nested objects", async () => {
      const { getByDotPath } = await import(
        "@pantheon-systems/puck-css/fields"
      );
      expect(getByDotPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
    });

    it("returns undefined for missing paths", async () => {
      const { getByDotPath } = await import(
        "@pantheon-systems/puck-css/fields"
      );
      expect(getByDotPath({ a: 1 }, "b")).toBeUndefined();
    });

    it("rejects unsafe keys", async () => {
      const { getByDotPath } = await import(
        "@pantheon-systems/puck-css/fields"
      );
      expect(getByDotPath({}, "__proto__")).toBeUndefined();
      expect(getByDotPath({}, "constructor")).toBeUndefined();
      expect(getByDotPath({}, "prototype")).toBeUndefined();
    });
  });

  describe("viewExtractKey", () => {
    it("extracts the key from a template token", async () => {
      const { viewExtractKey } = await import(
        "@pantheon-systems/puck-css/fields"
      );
      expect(viewExtractKey("{{ item.title }}")).toBe("title");
    });

    it("returns empty string for non-template values", async () => {
      const { viewExtractKey } = await import(
        "@pantheon-systems/puck-css/fields"
      );
      expect(viewExtractKey("plain text")).toBe("");
      expect(viewExtractKey("")).toBe("");
    });
  });

  describe("resolveField", () => {
    it("resolves a template value against an item", async () => {
      const { resolveField } = await import(
        "@pantheon-systems/puck-css/fields"
      );
      const item = { name: "Luke" };
      expect(resolveField(item, "{{ item.name }}")).toBe("Luke");
    });

    it("returns empty string for missing fields", async () => {
      const { resolveField } = await import(
        "@pantheon-systems/puck-css/fields"
      );
      expect(resolveField({}, "{{ item.missing }}")).toBe("");
    });
  });

  describe("resolveItemFields", () => {
    it("resolves all field mappings for an item", async () => {
      const { resolveItemFields } = await import(
        "@pantheon-systems/puck-css/fields"
      );
      const item = { name: "Luke", desc: "Jedi", img: "/luke.png" };
      const result = resolveItemFields(item, {
        titleField: "{{ item.name }}",
        subtitleField: "",
        teaserField: "{{ item.desc }}",
        imageField: "{{ item.img }}",
        iconField: "",
      });
      expect(result.title).toBe("Luke");
      expect(result.subtitle).toBe("");
      expect(result.teaser).toBe("Jedi");
      expect(result.image).toBe("/luke.png");
      expect(result.icon).toBe("");
      expect(result._raw).toBe(item);
    });
  });
});
