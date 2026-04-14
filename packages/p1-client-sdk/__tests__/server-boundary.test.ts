import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ensures server.ts only adds server-safe modules on top of the client barrel.
 * Any file it directly imports (other than the client re-export) must NOT
 * contain a "use client" directive — that would be a boundary violation.
 */
describe("server.ts boundary", () => {
  const serverSrc = fs.readFileSync(
    path.resolve(__dirname, "../src/server.ts"),
    "utf-8",
  );

  // Match `from "./some/path"` but skip the client barrel re-export
  const importPaths = [
    ...new Set(
      [...serverSrc.matchAll(/from\s+["'](\.[^"']+)["']/g)]
        .map((m) => m[1])
        .filter((p) => p !== "./index"),
    ),
  ];

  it("has server-only imports to check", () => {
    expect(importPaths.length).toBeGreaterThan(0);
  });

  for (const importPath of importPaths) {
    it(`${importPath} does not contain "use client"`, () => {
      // Resolve the import to an actual file (check file extensions before bare path)
      const base = path.resolve(__dirname, "../src", importPath);
      const candidates = [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ];
      const resolved = candidates.find(
        (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
      );
      expect(resolved, `could not resolve ${importPath}`).toBeDefined();

      const contents = fs.readFileSync(resolved!, "utf-8");
      const firstLine = contents.trimStart().split("\n")[0];
      expect(firstLine).not.toMatch(/["']use client["']/);
    });
  }
});
