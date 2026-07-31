import { describe, expect, it, vi } from "vitest";
import { extractDescriptors } from "@pantheon-systems/puck-css/registry-sync";
import { resolve, load, ASSET_STUB_MARKER } from "../asset-stub-hooks.mjs";
import { filterAssetStubbedDescriptors } from "../sync-puck-registry.js";

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
  it("returns a branded stub default export for asset-stub URLs without calling nextLoad", async () => {
    const nextLoad = vi.fn();
    const result = await load("asset-stub:.%2Fstyles.css", {}, nextLoad);
    expect(result.format).toBe("module");
    expect(result.shortCircuit).toBe(true);
    expect(result.source).toContain("__p1AssetStub");
    expect(nextLoad).not.toHaveBeenCalled();
  });

  describe("branded sentinel", () => {
    // The stub must be *recognizable* after import, so the CI sync can detect
    // descriptors built from stubbed assets and skip them instead of writing
    // content it cannot faithfully compute. A bare {} erases that provenance.

    async function importStub(): Promise<Record<string, unknown>> {
      const { source } = await load("asset-stub:.%2Flogo.png", {}, vi.fn());
      const mod = (await import(
        /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source as string)}`
      )) as { default: Record<string, unknown> };
      return mod.default;
    }

    it("brands the default export with __p1AssetStub", async () => {
      const stub = await importStub();
      expect(stub.__p1AssetStub).toBe(true);
    });

    it("returns the marker string for arbitrary property reads (placeholder.src pattern)", async () => {
      const stub = await importStub();
      expect(stub.src).toBe(ASSET_STUB_MARKER);
      expect((stub as { anythingAtAll?: unknown }).anythingAtAll).toBe(ASSET_STUB_MARKER);
    });

    it("stringifies to the marker so template-literal usage stays detectable", async () => {
      const stub = await importStub();
      expect(String(stub)).toContain(ASSET_STUB_MARKER);
    });
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

describe("integration: stubbed asset imports hash differently than bundler-resolved values", () => {
  // The same puck.config.tsx yields different descriptor hashes depending on
  // who loaded it — this loader stubs asset imports while the browser bundler
  // resolves them to real values — so the CI sync and the editor perpetually
  // disagree about whether an asset-bearing component "changed", and the
  // CI-written descriptor content is missing the real default values entirely.

  // Evaluate the module source load() actually emits — not a hand-written {} —
  // so these tests track the real artifact if the stub's shape ever changes.
  async function importStubbedAsset(): Promise<Record<string, unknown>> {
    const { source } = await load("asset-stub:.%2Frandom-image.png", {}, vi.fn());
    const mod = (await import(
      /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source as string)}`
    )) as { default: Record<string, unknown> };
    return mod.default;
  }

  function configWithImageDefault(src: unknown) {
    return {
      components: {
        imageBlock: {
          label: "Image",
          fields: { src: { type: "text", label: "Image URL" } },
          defaultProps: { src },
        },
      },
    };
  }

  it("`placeholder.src` (stub-derived under the loader) hashes differently than the browser's URL string", async () => {
    const stub = await importStubbedAsset();

    const [ciDescriptor] = extractDescriptors(configWithImageDefault(stub.src));
    const [browserDescriptor] = extractDescriptors(
      configWithImageDefault("/_next/static/media/random-image.abc123.png"),
    );

    expect(ciDescriptor.name).toBe(browserDescriptor.name);
    expect(ciDescriptor.descriptorHash).not.toBe(browserDescriptor.descriptorHash);
  });

  it("a whole stubbed import ({} under the stub) hashes differently than the browser's StaticImageData", async () => {
    const stub = await importStubbedAsset();

    const [ciDescriptor] = extractDescriptors(configWithImageDefault(stub));
    const [browserDescriptor] = extractDescriptors(
      configWithImageDefault({
        src: "/_next/static/media/random-image.abc123.png",
        width: 800,
        height: 600,
      }),
    );

    expect(ciDescriptor.descriptorHash).not.toBe(browserDescriptor.descriptorHash);
  });

  it("control: a plain string default hashes identically no matter who loaded the config", async () => {
    // Same shapes as above but with a value the stub loader never touches —
    // proves the divergence is caused by asset stubbing, not by hashing noise.
    const [first] = extractDescriptors(configWithImageDefault("/images/static-path.png"));
    const [second] = extractDescriptors(configWithImageDefault("/images/static-path.png"));

    expect(first.descriptorHash).toBe(second.descriptorHash);
  });

  it("end to end: descriptors built from stubbed assets are detected and skipped, clean ones kept", async () => {
    const stub = await importStubbedAsset();

    const [viaPropertyRead] = extractDescriptors(configWithImageDefault(stub.src));
    const [viaWholeImport] = extractDescriptors(configWithImageDefault(stub));
    const [clean] = extractDescriptors(configWithImageDefault("/images/static-path.png"));

    const { writable, skipped } = filterAssetStubbedDescriptors([viaPropertyRead, viaWholeImport, clean]);

    expect(skipped).toHaveLength(2);
    expect(writable).toEqual([clean]);
  });
});
