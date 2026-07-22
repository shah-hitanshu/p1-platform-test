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
  },
});
