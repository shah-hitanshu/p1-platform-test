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
});
