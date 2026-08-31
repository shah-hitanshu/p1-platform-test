import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Client bundle — full package including React components and Context.
    // "use client" marks the entire bundle as a client boundary for RSC.
    // react-image-crop is bundled (noExternal) with its CSS injected at
    // runtime (injectStyle) so consumers need no extra install or CSS import.
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    external: ["react", "@puckeditor/core", "@pantheon-systems/puck-css"],
    noExternal: ["react-image-crop"],
    injectStyle: true,
    banner: { js: '"use client";' },
    // esbuild inlines full original source into sourcemaps by default, which
    // would ship every internal comment verbatim regardless of dts/js output.
    esbuildOptions(options) {
      options.sourcesContent = false;
    },
  },
  {
    // Server bundle — only pure utilities safe for React Server Components.
    // No React hooks, no createContext, no "use client".
    entry: { server: "src/server.ts" },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    external: ["react", "@puckeditor/core"],
    esbuildOptions(options) {
      options.sourcesContent = false;
    },
  },
]);
