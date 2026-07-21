import { describe, expect, it } from "vitest";
import { validateEnv, resolveConfigModule, resolveBranchId, NoBranchMatchError } from "../sync-puck-registry.js";

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
