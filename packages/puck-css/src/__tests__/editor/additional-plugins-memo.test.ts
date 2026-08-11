import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "../..");

/**
 * The plugin array is deliberately identity-stable: new plugin objects mean new
 * override component identities, which remounts the canvas and every field. It
 * only rebuilds when the plugin count changes, so plugin *content* does not
 * propagate through it — plugin-rendered components read live state through
 * their own hooks instead (see useLiveRemoteDatasources).
 */
describe("useP1Editor additionalPlugins reactivity", () => {
  const content = readFileSync(
    resolve(srcDir, "editor/useP1Editor.ts"),
    "utf-8",
  );

  it("keeps the plugin array identity-stable across content changes", () => {
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
