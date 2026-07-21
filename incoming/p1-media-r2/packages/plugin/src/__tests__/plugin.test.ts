import { describe, it, expect } from "vitest";
import { createMediaPlugin } from "../plugin";

describe("createMediaPlugin", () => {
  const defaultOptions = {
    workerUrl: "https://media.example.com",
    siteId: "test-site",
    workstreamId: "test-workstream",
    getAuthToken: () => "test-token",
  };

  it("returns a plugin with the correct name", () => {
    const plugin = createMediaPlugin(defaultOptions);
    expect(plugin.name).toBe("p1-media-r2");
  });

  it("returns a plugin with fieldTypes.text override", () => {
    const plugin = createMediaPlugin(defaultOptions);
    expect(plugin.overrides.fieldTypes.text).toBeTypeOf("function");
  });

  it("accepts custom field name patterns", () => {
    const plugin = createMediaPlugin({
      ...defaultOptions,
      fieldNamePatterns: [/^hero$/],
    });
    expect(plugin.overrides.fieldTypes.text).toBeTypeOf("function");
  });

  it("registers the rich p1-media field type alongside the text hijack", () => {
    const plugin = createMediaPlugin(defaultOptions);
    expect(plugin.overrides.fieldTypes["p1-media"]).toBeTypeOf("function");
    // basic mode preserved
    expect(plugin.overrides.fieldTypes.text).toBeTypeOf("function");
  });

  it("registers a p1-media fieldTransform that normalizes strings for preview", () => {
    const plugin = createMediaPlugin(defaultOptions);
    const transform = plugin.fieldTransforms["p1-media"];
    expect(transform).toBeTypeOf("function");
    // legacy string → object shape (preview only, never written back)
    expect(transform({ value: "https://cdn/x.jpg" })).toEqual({
      url: "https://cdn/x.jpg",
      alt: "",
    });
    // an existing MediaValue passes through untouched
    const obj = { assetId: "a", versionId: "v", url: "https://cdn/x.jpg", alt: "cat" };
    expect(transform({ value: obj })).toBe(obj);
  });
});
