import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The `test` script runs from this package root, where it discovers the
// generated `template/__tests__` suites. Those import `.tsx` block modules
// (e.g. paragraph-block), so the JSX transform must be wired up here — the
// template's own vitest.config.ts is not loaded from this root.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    // Mirrors the template's own vitest.config.ts, which explains both settings:
    // the pds-toolkit-react → .css import chain has to go through Vite, and the
    // first test to trigger that transform needs more than the default 5s.
    testTimeout: 30_000,
    server: {
      deps: {
        inline: [/@pantheon-systems[/+]puck-css/, /@pantheon-systems[/+]pds-toolkit-react/],
      },
    },
  },
});
