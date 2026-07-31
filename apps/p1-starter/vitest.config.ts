import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
