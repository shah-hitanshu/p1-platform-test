import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..");

describe("editor-context route", () => {
  it("editor-context route file exists", () => {
    expect(existsSync(resolve(srcDir, "routes/editor-context.ts"))).toBe(true);
  });

  it("does not block on loadRemoteDatasourceContext", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/editor-context.ts"),
      "utf-8",
    );
    expect(content).not.toContain("loadRemoteDatasourceContext");
    expect(content).toContain("@pantheon-systems/puck-css/server");
  });

  it("imports listRoutes and listRouteTemplateKeysFromDatabase", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/editor-context.ts"),
      "utf-8",
    );
    expect(content).toContain("listRoutes");
    expect(content).toContain("listRouteTemplateKeysFromDatabase");
  });

  it("imports getPageEditorPreviewParams", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/editor-context.ts"),
      "utf-8",
    );
    expect(content).toContain("getPageEditorPreviewParams");
  });

  it("imports buildRemoteDatasourceRegistry", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/editor-context.ts"),
      "utf-8",
    );
    expect(content).toContain("buildRemoteDatasourceRegistry");
  });

  it("validates path parameter", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/editor-context.ts"),
      "utf-8",
    );
    expect(content).toContain("normalizePath");
  });

  it("returns JSON response", () => {
    const content = readFileSync(
      resolve(srcDir, "routes/editor-context.ts"),
      "utf-8",
    );
    expect(content).toContain("NextResponse.json");
  });
});

describe("handler config accepts fetcher options", () => {
  it("handler.ts exports P1HandlerConfig with builtinFetchers", () => {
    const content = readFileSync(resolve(srcDir, "handler.ts"), "utf-8");
    expect(content).toContain("builtinFetchers");
  });

  it("handler.ts exports P1HandlerConfig with builtinDatasourceRegistry", () => {
    const content = readFileSync(resolve(srcDir, "handler.ts"), "utf-8");
    expect(content).toContain("builtinDatasourceRegistry");
  });

  it("handler.ts routes editor-context action to GET", () => {
    const content = readFileSync(resolve(srcDir, "handler.ts"), "utf-8");
    expect(content).toContain("editor-context");
  });
});

describe("handler-actions exports", () => {
  it("handler-actions.ts exports getEditorContext", () => {
    const content = readFileSync(
      resolve(srcDir, "handler-actions.ts"),
      "utf-8",
    );
    expect(content).toContain("getEditorContext");
  });
});
