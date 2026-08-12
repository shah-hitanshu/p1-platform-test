import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@pantheon-systems/puck-css/fields": resolve(
        __dirname,
        "../..",
        "packages/puck-css/src/data/fields.tsx",
      ),
      "@pantheon-systems/pds-toolkit-react": resolve(
        __dirname,
        "../..",
        "packages/puck-css/src/__mocks__/@pantheon-systems/pds-toolkit-react.ts",
      ),
      "@puckeditor/core": resolve(
        __dirname,
        "../..",
        "packages/puck-css/src/__mocks__/@puckeditor/core.ts",
      ),
    },
  },
  test: {
    environment: "node",
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
