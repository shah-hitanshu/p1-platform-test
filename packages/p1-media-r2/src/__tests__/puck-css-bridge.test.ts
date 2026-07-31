import { describe, it, expect } from "vitest";
import { resolveSiteId, resolveGetAuthToken, buildMediaConfig, type GetAuthToken } from "../puck-css-bridge";
import type { MediaPluginOptions } from "../plugin";

describe("resolveSiteId", () => {
  it("prefers the explicit value over the ambient context value", () => {
    expect(resolveSiteId("explicit-site", "context-site")).toBe("explicit-site");
  });

  it("falls back to the ambient context value when explicit is absent", () => {
    expect(resolveSiteId(undefined, "context-site")).toBe("context-site");
  });

  it("throws when both are absent", () => {
    expect(() => resolveSiteId(undefined, undefined)).toThrow(/siteId is required/);
  });
});

describe("resolveGetAuthToken", () => {
  const explicitFn: GetAuthToken = () => "explicit-token";
  const contextFn: GetAuthToken = () => "context-token";

  it("prefers the explicit function over the ambient context function", () => {
    expect(resolveGetAuthToken(explicitFn, contextFn)).toBe(explicitFn);
  });

  it("falls back to the ambient context function when explicit is absent", () => {
    expect(resolveGetAuthToken(undefined, contextFn)).toBe(contextFn);
  });

  it("throws when both are absent", () => {
    expect(() => resolveGetAuthToken(undefined, undefined)).toThrow(/getAuthToken is required/);
  });
});

describe("buildMediaConfig", () => {
  const baseOptions: MediaPluginOptions = {
    siteId: "opt-site",
    getAuthToken: () => "opt-token",
  };

  it("resolves entirely from explicit options when no ambient context is given", () => {
    const config = buildMediaConfig(baseOptions);
    expect(config.workerUrl).toBe("https://media.p1.pantheon.io");
    expect(config.siteId).toBe("opt-site");
    expect(config.workstreamId).toBeUndefined();
    expect(config.getAuthToken).toBe(baseOptions.getAuthToken);
  });

  it("does not override an explicitly-passed workerUrl with the production default", () => {
    const config = buildMediaConfig({ ...baseOptions, workerUrl: "https://media.example.com" });
    expect(config.workerUrl).toBe("https://media.example.com");
  });

  it("falls back to ambient siteId/getAuthToken when options omit them", () => {
    const contextGetToken: GetAuthToken = () => "context-token";
    const config = buildMediaConfig({}, { siteId: "ambient-site", getAuthToken: contextGetToken });
    expect(config.siteId).toBe("ambient-site");
    expect(config.getAuthToken).toBe(contextGetToken);
  });

  it("prefers explicit options over ambient context when both are present", () => {
    const config = buildMediaConfig(baseOptions, {
      siteId: "ambient-site",
      getAuthToken: () => "context-token",
    });
    expect(config.siteId).toBe("opt-site");
    expect(config.getAuthToken).toBe(baseOptions.getAuthToken);
  });

  it("throws when siteId is missing from both options and ambient context", () => {
    expect(() => buildMediaConfig({ getAuthToken: () => "t" })).toThrow(/siteId is required/);
  });

  it("throws when getAuthToken is missing from both options and ambient context", () => {
    expect(() => buildMediaConfig({ siteId: "s" })).toThrow(/getAuthToken is required/);
  });

  it("passes workstreamId and metadataFields through unchanged", () => {
    const config = buildMediaConfig({
      ...baseOptions,
      workstreamId: "ws-1",
      metadataFields: [{ name: "alt", label: "Alt text", type: "string" }],
    });
    expect(config.workstreamId).toBe("ws-1");
    expect(config.metadataFields).toEqual([{ name: "alt", label: "Alt text", type: "string" }]);
  });
});
