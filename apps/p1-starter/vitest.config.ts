import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    // Inlining below means the first test to import puck-css pays for Vite
    // transforming that whole graph — seconds on a cold machine, and the default
    // 5s timeout fails it on slower CI runners while every later test in the file
    // runs in milliseconds.
    testTimeout: 30_000,
    server: {
      deps: {
        // pds-toolkit-react's entry point imports its own dist/index.css, and
        // puck-css imports pds-toolkit-react. Left external, vitest hands that
        // chain to Node's ESM loader, which has no loader for .css; inlining
        // routes it through Vite instead. Both must be listed — inlining only the
        // leaf leaves puck-css external, and Node then loads the whole subtree
        // without consulting this list. The patterns match a resolved path, so
        // they allow pnpm's `@pantheon-systems+puck-css` directory form too.
        inline: [/@pantheon-systems[/+]puck-css/, /@pantheon-systems[/+]pds-toolkit-react/],
      },
    },
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
