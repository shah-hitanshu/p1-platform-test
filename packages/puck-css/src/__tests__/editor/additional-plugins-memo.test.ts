import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "../..");

describe("useP1Editor additionalPlugins reactivity", () => {
  const content = readFileSync(
    resolve(srcDir, "editor/useP1Editor.ts"),
    "utf-8",
  );

  it("uses a ref-guarded useMemo so plugin content changes propagate without unstable deps", () => {
    const pluginsBlock = content.slice(
      content.indexOf("const plugins = useMemo"),
      content.indexOf("const plugins = useMemo") + 300,
    );
    expect(pluginsBlock).toContain("additionalPluginsRef.current");
    expect(pluginsBlock).toContain("[p1Plugin, documentSyncPlugin, pluginCount]");
  });

  it("warns in dev mode when additionalPlugins ref changes every render (unstable caller)", () => {
    expect(content).toContain("additionalPlugins ref is changing every render");
  });
});
