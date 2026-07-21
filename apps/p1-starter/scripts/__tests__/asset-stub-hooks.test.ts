import { describe, expect, it, vi } from "vitest";
import { resolve, load } from "../asset-stub-hooks.mjs";

describe("resolve", () => {
  it("short-circuits CSS imports to an asset-stub URL without calling nextResolve", async () => {
    const nextResolve = vi.fn();
    const result = await resolve("./styles.css", {}, nextResolve);
    expect(result.shortCircuit).toBe(true);
    expect(result.url.startsWith("asset-stub:")).toBe(true);
    expect(nextResolve).not.toHaveBeenCalled();
  });

  it.each([
    "./logo.png", "./photo.jpg", "./photo.jpeg", "./icon.svg", "./anim.gif",
    "./banner.webp", "./favicon.ico", "./sprite.bmp", "./photo.avif",
    "./font.woff", "./font.woff2", "./font.ttf", "./font.eot", "./font.otf",
    "./clip.mp4", "./clip.webm", "./clip.mov", "./audio.mp3", "./audio.wav",
    "./theme.scss", "./theme.sass", "./theme.less",
  ])("short-circuits %s", async (specifier) => {
    const nextResolve = vi.fn();
    const result = await resolve(specifier, {}, nextResolve);
    expect(result.shortCircuit).toBe(true);
    expect(nextResolve).not.toHaveBeenCalled();
  });

  it("passes .ts specifiers through to nextResolve unchanged", async () => {
    const nextResolve = vi.fn().mockResolvedValue({ url: "file:///abs/path.ts", shortCircuit: true });
    const result = await resolve("./puck.config.tsx", {}, nextResolve);
    expect(nextResolve).toHaveBeenCalledWith("./puck.config.tsx", {});
    expect(result.url).toBe("file:///abs/path.ts");
  });

  it("passes bare package specifiers through to nextResolve unchanged", async () => {
    const nextResolve = vi.fn().mockResolvedValue({ url: "file:///node_modules/react/index.js", shortCircuit: true });
    await resolve("react", {}, nextResolve);
    expect(nextResolve).toHaveBeenCalledWith("react", {});
  });

  it("propagates a real module-resolution error from nextResolve instead of masking it", async () => {
    const nextResolve = vi.fn().mockRejectedValue(new Error("Cannot find module"));
    await expect(resolve("./missing-module", {}, nextResolve)).rejects.toThrow("Cannot find module");
  });
});

describe("load", () => {
  it("returns an empty default export for asset-stub URLs without calling nextLoad", async () => {
    const nextLoad = vi.fn();
    const result = await load("asset-stub:.%2Fstyles.css", {}, nextLoad);
    expect(result).toEqual({ format: "module", source: "export default {};", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
  });

  it("passes non-asset-stub URLs through to nextLoad unchanged", async () => {
    const nextLoad = vi.fn().mockResolvedValue({ format: "module", source: "export default 1;", shortCircuit: true });
    const result = await load("file:///abs/path.ts", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///abs/path.ts", {});
    expect(result.source).toBe("export default 1;");
  });

  it("propagates a real load error from nextLoad instead of masking it", async () => {
    const nextLoad = vi.fn().mockRejectedValue(new Error("Syntax error"));
    await expect(load("file:///abs/broken.ts", {}, nextLoad)).rejects.toThrow("Syntax error");
  });
});
