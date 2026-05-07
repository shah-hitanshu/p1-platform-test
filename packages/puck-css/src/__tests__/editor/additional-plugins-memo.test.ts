import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "../..");

describe("useCSSEditor additionalPlugins reactivity", () => {
  const content = readFileSync(
    resolve(srcDir, "editor/useCSSEditor.ts"),
    "utf-8",
  );

  it("tracks additionalPlugins length for plugin memo recomputation", () => {
    expect(content).toContain("pluginCount");
  });

  it("uses pluginCount in the plugins useMemo dependency array", () => {
    const pluginsBlock = content.slice(
      content.indexOf("const plugins = useMemo"),
      content.indexOf("const plugins = useMemo") + 300,
    );
    expect(pluginsBlock).toContain("additionalPluginsRef");
    expect(pluginsBlock).toContain("pluginCount");
  });
});
