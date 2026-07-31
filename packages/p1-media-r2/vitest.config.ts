import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    // @pantheon-systems/puck-css only exposes a single monolithic `.` entry
    // point (no narrower subpath for the two hooks we need), so importing it
    // at all pulls in its full editor/UI bundle — including a raw `.css`
    // import inside @pantheon-systems/pds-toolkit-react. By default Vitest
    // externalizes node_modules packages to Node's native loader, which has
    // no CSS loader and throws. Inlining both here routes them through
    // Vite's transform instead, which turns CSS imports into no-ops.
    server: {
      deps: {
        inline: ["@pantheon-systems/puck-css", "@pantheon-systems/pds-toolkit-react"],
      },
    },
  },
});
