import { defineConfig } from "tsup";

// No sourcemaps: the TypeScript sources they reference are not in the
// published tarball (and must not be), so shipped maps only make consumer
// bundlers warn about missing sources.

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
    sourcemap: false,
    clean: true,
    external: ["react", "@puckeditor/core", "@pantheon-systems/puck-css"],
    noExternal: ["react-image-crop"],
    injectStyle: true,
    banner: { js: '"use client";' },
  },
  {
    // Server bundle — only pure utilities safe for React Server Components.
    // No React hooks, no createContext, no "use client".
    entry: { server: "src/server.ts" },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: false,
    external: ["react", "@puckeditor/core"],
  },
]);
