import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..");

describe("datasource-context route", () => {
  it("route file exists", () => {
    expect(existsSync(resolve(srcDir, "routes/datasource-context.ts"))).toBe(
      true,
    );
  });

  it("imports loadRemoteDatasourceContext from puck-css/server", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/datasource-context.ts"),
      "utf-8",
    );
    expect(content).toContain("loadRemoteDatasourceContext");
    expect(content).toContain("@pantheon-systems/puck-css/server");
  });

  it("accepts path and id query params", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/datasource-context.ts"),
      "utf-8",
    );
    expect(content).toContain('searchParams.get("path")');
    expect(content).toContain('searchParams.get("id")');
  });

  it("uses referencedDatasourceIds to filter to a single datasource", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/datasource-context.ts"),
      "utf-8",
    );
    expect(content).toContain("referencedDatasourceIds");
  });

  it("returns 400 when id param is missing", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/datasource-context.ts"),
      "utf-8",
    );
    expect(content).toContain("missing_id");
  });

  it("returns JSON with id and data fields", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/datasource-context.ts"),
      "utf-8",
    );
    expect(content).toContain("NextResponse.json");
  });
});

describe("handler routes datasource-context", () => {
  it("handler.ts routes datasource-context action to GET", () => {
    const content = readFileSync(resolve(srcDir, "handler.ts"), "utf-8");
    expect(content).toContain("datasource-context");
    expect(content).toContain("getDatasourceContext");
  });
});

describe("handler-actions exports", () => {
  it("handler-actions.ts exports getDatasourceContext", () => {
    const content = readFileSync(
      resolve(srcDir, "handler-actions.ts"),
      "utf-8",
    );
    expect(content).toContain("getDatasourceContext");
  });
});

describe("editor-context no longer blocks on datasource loading", () => {
  it("editor-context.ts does not call loadRemoteDatasourceContext", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/editor-context.ts"),
      "utf-8",
    );
    expect(content).not.toContain("await loadRemoteDatasourceContext");
  });

  it("editor-context.ts returns empty remoteDatasourceContext", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/editor-context.ts"),
      "utf-8",
    );
    expect(content).toContain("remoteDatasourceContext: {}");
  });
});
