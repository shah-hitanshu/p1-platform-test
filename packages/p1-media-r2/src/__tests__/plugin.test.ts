import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { createMediaPlugin } from "../plugin";
import type { MediaConfig } from "../context";

// `text` field-type overrides return `<MediaConfigProvider config={...}>` as
// their outermost element — no renderer needed to read the resolved config
// straight off its props (same element-tree inspection approach used in
// render.test.ts / media-figure-block.test.ts; react-dom is intentionally
// absent from this package).
function resolvedConfig(
  plugin: ReturnType<typeof createMediaPlugin>,
  fieldName: string,
): MediaConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = (plugin.overrides.fieldTypes.text as (p: any) => unknown)({
    name: fieldName,
    field: { label: fieldName },
    value: "",
    onChange: () => {},
    readOnly: false,
    id: fieldName,
    children: null,
  });
  if (!isValidElement(element)) throw new Error("expected a MediaConfigProvider element");
  return (element.props as { config: MediaConfig }).config;
}

describe("createMediaPlugin", () => {
  const defaultOptions = {
    workerUrl: "https://media.example.com",
    siteId: "test-site",
    workstreamId: "test-workstream",
    getAuthToken: () => "test-token",
  };

  it("returns a plugin with the correct name", () => {
    const plugin = createMediaPlugin(defaultOptions);
    expect(plugin.name).toBe("p1-media");
  });

  it("works without workerUrl or workstreamId — both are now optional", () => {
    const plugin = createMediaPlugin({
      siteId: "test-site",
      getAuthToken: () => "test-token",
    });
    expect(plugin.name).toBe("p1-media");
    expect(plugin.overrides.fieldTypes.text).toBeTypeOf("function");
    expect(plugin.overrides.fieldTypes["p1-media"]).toBeTypeOf("function");
  });

  it("defaults workerUrl to the production host when omitted, and leaves workstreamId unset", () => {
    const plugin = createMediaPlugin({
      siteId: "test-site",
      getAuthToken: () => "test-token",
    });
    const config = resolvedConfig(plugin, "heroImageUrl");
    expect(config.workerUrl).toBe("https://media.p1.pantheon.io");
    expect(config.workstreamId).toBeUndefined();
  });

  it("does not override an explicitly-passed workerUrl with the production default", () => {
    const plugin = createMediaPlugin(defaultOptions);
    const config = resolvedConfig(plugin, "heroImageUrl");
    expect(config.workerUrl).toBe("https://media.example.com");
    expect(config.workstreamId).toBe("test-workstream");
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
