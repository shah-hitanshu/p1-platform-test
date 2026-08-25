import { describe, expect, it } from "vitest";
import {
  validateEnv,
  resolveConfigModule,
  resolveBranchId,
  filterAssetStubbedDescriptors,
  NoBranchMatchError,
} from "../sync-puck-registry.js";
import { ASSET_STUB_MARKER } from "../asset-stub-hooks.mjs";

function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    CSS_BASE_URL: "https://css.example.com",
    CSS_SITE_ID: "site-123",
    CSS_REGISTRY_API_KEY: "sat_registrytoken",
    ...overrides,
  };
}

describe("validateEnv", () => {
  it("accepts CSS_BASE_URL/CSS_SITE_ID/CSS_REGISTRY_API_KEY directly", () => {
    const result = validateEnv(baseEnv());
    expect(result.baseUrl).toBe("https://css.example.com");
    expect(result.siteId).toBe("site-123");
    expect(result.apiKey).toBe("sat_registrytoken");
    expect(result.branchOverride).toBeUndefined();
    expect(result.puckConfigPath).toBe("puck.config.tsx");
  });

  it("falls back to NEXT_PUBLIC_CSS_BASE_URL and NEXT_PUBLIC_CSS_SITE_ID", () => {
    const result = validateEnv(
      baseEnv({
        CSS_BASE_URL: undefined,
        CSS_SITE_ID: undefined,
        NEXT_PUBLIC_CSS_BASE_URL: "https://fallback.example.com",
        NEXT_PUBLIC_CSS_SITE_ID: "site-fallback",
      }),
    );
    expect(result.baseUrl).toBe("https://fallback.example.com");
    expect(result.siteId).toBe("site-fallback");
  });

  it("falls back to NEXT_PUBLIC_CSS_BRANCH_ID for the branch override", () => {
    const result = validateEnv(baseEnv({ NEXT_PUBLIC_CSS_BRANCH_ID: "staging" }));
    expect(result.branchOverride).toBe("staging");
  });

  it("prefers CSS_BRANCH_ID over the NEXT_PUBLIC_ fallback when both are set", () => {
    const result = validateEnv(baseEnv({ CSS_BRANCH_ID: "explicit", NEXT_PUBLIC_CSS_BRANCH_ID: "staging" }));
    expect(result.branchOverride).toBe("explicit");
  });

  it("reads CSS_DEFAULT_BRANCH into defaultBranchName, overriding the default", () => {
    const result = validateEnv(baseEnv({ CSS_DEFAULT_BRANCH: "master" }));
    expect(result.defaultBranchName).toBe("master");
  });

  it("defaults defaultBranchName to 'main' when CSS_DEFAULT_BRANCH is not set", () => {
    // Safe because the CCR main content branch is always literally named
    // "main": a push override of "main" resolves to the same branch either
    // by name match or by isMain, so the default only adds semantics.
    const result = validateEnv(baseEnv());
    expect(result.defaultBranchName).toBe("main");
  });

  it("defaults PUCK_CONFIG_PATH to puck.config.tsx", () => {
    const result = validateEnv(baseEnv());
    expect(result.puckConfigPath).toBe("puck.config.tsx");
  });

  it("honors an explicit PUCK_CONFIG_PATH", () => {
    const result = validateEnv(baseEnv({ PUCK_CONFIG_PATH: "config/puck.config.tsx" }));
    expect(result.puckConfigPath).toBe("config/puck.config.tsx");
  });

  it("reports all missing required vars together, not just the first", () => {
    expect(() => validateEnv({})).toThrowError(/CSS_BASE_URL[\s\S]*CSS_SITE_ID[\s\S]*CSS_REGISTRY_API_KEY/);
  });

  it("gives an explicit, actionable message when only P1_CSS_API_KEY is set (do not reuse the read-only token)", () => {
    expect(() =>
      validateEnv(baseEnv({ CSS_REGISTRY_API_KEY: undefined, P1_CSS_API_KEY: "sat_readonlytoken" })),
    ).toThrowError(/write:registry/);
  });

  it("does not accidentally accept P1_CSS_API_KEY as a substitute for CSS_REGISTRY_API_KEY", () => {
    const result = () =>
      validateEnv(baseEnv({ CSS_REGISTRY_API_KEY: undefined, P1_CSS_API_KEY: "sat_readonlytoken" }));
    expect(result).toThrow();
  });
});

describe("resolveConfigModule", () => {
  it("prefers a default export", () => {
    const mod = { default: { components: {} }, config: { wrong: true } };
    expect(resolveConfigModule(mod)).toBe(mod.default);
  });

  it("falls back to a named config export when there is no default", () => {
    const mod = { config: { components: {} } };
    expect(resolveConfigModule(mod)).toBe(mod.config);
  });

  it("falls back to the module itself when neither default nor config is present", () => {
    const mod = { components: {} };
    expect(resolveConfigModule(mod)).toBe(mod);
  });
});

describe("resolveBranchId", () => {
  const branches = [
    { id: "b-1", siteId: "site-123", name: "main", isMain: true },
    { id: "b-2", siteId: "site-123", name: "staging", isMain: false },
  ];

  it("resolves to the main branch when no override is given", () => {
    expect(resolveBranchId(branches as never, "site-123")).toBe("b-1");
  });

  it("resolves an override by branch id", () => {
    expect(resolveBranchId(branches as never, "site-123", "b-2")).toBe("b-2");
  });

  it("resolves an override by branch name", () => {
    expect(resolveBranchId(branches as never, "site-123", "staging")).toBe("b-2");
  });

  it("throws NoBranchMatchError ('No main branch found') when there is no override and no isMain branch", () => {
    const noMain = [{ id: "b-2", siteId: "site-123", name: "staging", isMain: false }];
    expect(() => resolveBranchId(noMain as never, "site-123")).toThrowError(
      "No main branch found for site site-123",
    );
    try {
      resolveBranchId(noMain as never, "site-123");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(NoBranchMatchError);
    }
  });

  it("throws NoBranchMatchError when an explicit override matches no branch by id or name", () => {
    expect(() => resolveBranchId(branches as never, "site-123", "nonexistent")).toThrow(NoBranchMatchError);
  });
});

describe("resolveBranchId default-branch semantics", () => {
  // In CI the override is always the pushed git ref's name, so a repo whose
  // default branch is not literally named "main" would never match the CCR
  // main branch (whose name is always "main") — the sync silently skips on
  // every default-branch push. When the caller also supplies the repo's
  // default branch name, an override equal to it must resolve via isMain.
  const branches = [
    { id: "b-1", siteId: "site-123", name: "main", isMain: true },
    { id: "b-2", siteId: "site-123", name: "staging", isMain: false },
  ];

  it("resolves the isMain branch when the override is the repo's default branch name", () => {
    expect(resolveBranchId(branches as never, "site-123", "master", "master")).toBe("b-1");
  });

  it("prefers isMain over a coincidental name match for the default branch", () => {
    const withDecoy = [...branches, { id: "b-3", siteId: "site-123", name: "master", isMain: false }];
    expect(resolveBranchId(withDecoy as never, "site-123", "master", "master")).toBe("b-1");
  });

  it("throws NoBranchMatchError for a default-branch override when no isMain branch exists", () => {
    const noMain = [{ id: "b-2", siteId: "site-123", name: "staging", isMain: false }];
    expect(() => resolveBranchId(noMain as never, "site-123", "master", "master")).toThrow(NoBranchMatchError);
  });

  it("keeps plain name matching for overrides that are not the default branch", () => {
    expect(resolveBranchId(branches as never, "site-123", "staging", "master")).toBe("b-2");
  });

  it("keeps the silent-skip path for non-default refs that match nothing", () => {
    expect(() => resolveBranchId(branches as never, "site-123", "feature-x", "master")).toThrow(NoBranchMatchError);
  });
});

describe("filterAssetStubbedDescriptors", () => {
  // CI loads puck.config.tsx under the asset-stub loader, so any defaultProps
  // value derived from an asset import is a branded sentinel, not the real
  // bundler-resolved value. CI cannot faithfully describe those components —
  // it skips them (loudly) and leaves them to the editor path.

  const descriptor = (name: string, defaultProps: Record<string, unknown>) =>
    ({ name, label: name, fields: [], defaultProps, descriptorHash: "h" }) as never;

  it("keeps descriptors whose defaults are plain values", () => {
    const clean = descriptor("heroBlock", { title: "Hello", count: 3, nested: { a: [1, "x"] } });
    const { writable, skipped } = filterAssetStubbedDescriptors([clean]);
    expect(writable).toEqual([clean]);
    expect(skipped).toEqual([]);
  });

  it("skips a descriptor whose default carries the asset-stub marker string (placeholder.src pattern)", () => {
    const stubbed = descriptor("imageBlock", { src: ASSET_STUB_MARKER, alt: "Mountain" });
    const { writable, skipped } = filterAssetStubbedDescriptors([stubbed]);
    expect(writable).toEqual([]);
    expect(skipped.map((d: { name: string }) => d.name)).toEqual(["imageBlock"]);
  });

  it("skips a descriptor whose default is a branded stub object (whole-import pattern)", () => {
    const stubbed = descriptor("imageBlock", { src: { __p1AssetStub: true } });
    const { skipped } = filterAssetStubbedDescriptors([stubbed]);
    expect(skipped).toHaveLength(1);
  });

  it("detects the marker arbitrarily deep in defaultProps", () => {
    const stubbed = descriptor("gallery", { items: [{ media: { src: `prefix ${ASSET_STUB_MARKER}` } }] });
    const { skipped } = filterAssetStubbedDescriptors([stubbed]);
    expect(skipped).toHaveLength(1);
  });

  it("partitions a mixed list preserving order of writable descriptors", () => {
    const a = descriptor("a", { t: "1" });
    const b = descriptor("b", { src: ASSET_STUB_MARKER });
    const c = descriptor("c", { t: "2" });
    const { writable, skipped } = filterAssetStubbedDescriptors([a, b, c]);
    expect(writable.map((d: { name: string }) => d.name)).toEqual(["a", "c"]);
    expect(skipped.map((d: { name: string }) => d.name)).toEqual(["b"]);
  });

  it("does not hang on circular defaultProps", () => {
    const circular: Record<string, unknown> = { title: "ok" };
    circular.self = circular;
    const { skipped } = filterAssetStubbedDescriptors([descriptor("looper", circular)]);
    expect(skipped).toEqual([]);
  });
});
