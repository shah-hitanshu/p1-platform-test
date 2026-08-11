import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginFile = resolve(
  __dirname,
  "../../p1/editor/remote-datasources/remote-datasource-explorer-plugin.tsx",
);

describe("datasource explorer skeleton loading", () => {
  const content = readFileSync(pluginFile, "utf-8");

  it("uses loadingIds to determine skeleton rendering", () => {
    expect(content).toContain("loadingIds");
    expect(content).not.toContain("loadingIds: _loadingIds");
  });

  it("renders a DatasourceSkeleton component when datasource is loading", () => {
    expect(content).toContain("DatasourceSkeleton");
  });

  it("renders skeleton bars with pulse animation", () => {
    expect(content).toContain("@keyframes");
    expect(content).toContain("pulse");
  });

  it("shows skeleton instead of JsonTree or empty message when loading", () => {
    expect(content).toContain("loadingIds.has(def.id)");
  });
});
