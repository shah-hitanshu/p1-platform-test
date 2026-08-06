import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");

describe("editor-client uses P1 plugins", () => {
  const content = readFileSync(
    resolve(appDir, "app/p1/(editor)/[[...p1]]/editor-client.tsx"),
    "utf-8",
  );

  it("imports useP1Plugins", () => {
    expect(content).toContain("useP1Plugins");
  });

  it("imports wrapConfigForEditorPreview", () => {
    expect(content).toContain("wrapConfigForEditorPreview");
  });

  it("passes additionalPlugins to useP1Editor", () => {
    expect(content).toContain("additionalPlugins");
  });

  it("wraps with P1QueryProvider for TanStack React Query", () => {
    expect(content).toContain("P1QueryProvider");
  });

  it("gates RoleSwitcher behind NEXT_PUBLIC_ENABLE_ROLE_SWITCHER", () => {
    expect(content).toContain("NEXT_PUBLIC_ENABLE_ROLE_SWITCHER");
  });
});

describe("API handler passes fetcher config", () => {
  const content = readFileSync(
    resolve(appDir, "app/p1/api/[...p1]/route.ts"),
    "utf-8",
  );

  it("imports REMOTE_DATASOURCE_FETCHERS", () => {
    expect(content).toContain("REMOTE_DATASOURCE_FETCHERS");
  });

  it("imports REMOTE_DATASOURCE_REGISTRY", () => {
    expect(content).toContain("REMOTE_DATASOURCE_REGISTRY");
  });

  it("passes builtinFetchers to createP1Handler", () => {
    expect(content).toContain("builtinFetchers");
  });

  it("passes builtinDatasourceRegistry to createP1Handler", () => {
    expect(content).toContain("builtinDatasourceRegistry");
  });
});
