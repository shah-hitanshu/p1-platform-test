/**
 * Unit tests for the p1-migrate codemod's pure string transforms.
 *
 * These cover the mechanical building blocks in isolation; the byte-identical
 * end-to-end proof (OLD starter layout -> HEAD tree) lives in
 * migrate-integration.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  deepenRelativeImports,
  addNamedImport,
  rewriteWrapperSignature,
  splitPageFile,
  BailError,
  // @ts-expect-error - hand-written ESM JS codemod, no type declarations
} from "../../bin/lib/transform.js";

describe("deepenRelativeImports", () => {
  it("prepends one ../ to a `from` specifier", () => {
    expect(deepenRelativeImports(`import config from "../../../puck.config";`)).toBe(
      `import config from "../../../../puck.config";`,
    );
  });

  it("handles a single-level parent import", () => {
    expect(deepenRelativeImports(`import { X } from "../foo";`)).toBe(
      `import { X } from "../../foo";`,
    );
  });

  it("handles side-effect imports", () => {
    expect(deepenRelativeImports(`import "../styles.css";`)).toBe(
      `import "../../styles.css";`,
    );
  });

  it("handles dynamic imports", () => {
    expect(deepenRelativeImports(`const m = import("../x");`)).toBe(
      `const m = import("../../x");`,
    );
  });

  it("leaves sibling (./) imports untouched", () => {
    const src = `import { E } from "./editor-client";`;
    expect(deepenRelativeImports(src)).toBe(src);
  });

  it("leaves bare package imports untouched", () => {
    const src = `import { useRouter } from "next/navigation";\nimport "@scope/pkg/styles.css";`;
    expect(deepenRelativeImports(src)).toBe(src);
  });
});

describe("addNamedImport", () => {
  it("appends a name by default", () => {
    expect(
      addNamedImport(`import { P1NextRouterProvider } from "@pantheon-systems/p1-next-sdk";`, "@pantheon-systems/p1-next-sdk", "editorPagePathFromUrlPath"),
    ).toBe(
      `import { P1NextRouterProvider, editorPagePathFromUrlPath } from "@pantheon-systems/p1-next-sdk";`,
    );
  });

  it("prepends a name when asked", () => {
    expect(
      addNamedImport(`import { useRouter } from "next/navigation";`, "next/navigation", "usePathname", "prepend"),
    ).toBe(`import { usePathname, useRouter } from "next/navigation";`);
  });

  it("is idempotent when the name is already imported", () => {
    const src = `import { usePathname, useRouter } from "next/navigation";`;
    expect(addNamedImport(src, "next/navigation", "usePathname", "prepend")).toBe(src);
  });

  it("bails when the module import is absent", () => {
    expect(() =>
      addNamedImport(`import { A } from "other";`, "next/navigation", "usePathname"),
    ).toThrow(BailError);
  });
});

describe("rewriteWrapperSignature", () => {
  const legacy = `export function EditorClientWrapper({ path }: { path: string }) {\n  const [userRole] = useState('editor');\n}`;

  it("removes the path prop and injects the URL derivation", () => {
    const out = rewriteWrapperSignature(legacy);
    expect(out).toContain("export function EditorClientWrapper() {");
    expect(out).toContain("const pathname = usePathname();");
    expect(out).toContain("const path = editorPagePathFromUrlPath(pathname);");
    expect(out).not.toContain("{ path }: { path: string }");
    // body after the injection is preserved
    expect(out).toContain("const [userRole] = useState('editor');");
  });

  it("is idempotent when already migrated (no-arg signature)", () => {
    const migrated = `export function EditorClientWrapper() {\n  const pathname = usePathname();\n}`;
    expect(rewriteWrapperSignature(migrated)).toBe(migrated);
  });

  it("bails on an unrecognized signature", () => {
    const custom = `export function EditorClientWrapper({ path, extra }: Props) {\n}`;
    expect(() => rewriteWrapperSignature(custom)).toThrow(BailError);
  });
});

describe("splitPageFile", () => {
  const oldPage = [
    `import "@puckeditor/core/puck.css";`,
    `import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";`,
    `import config from "../../../puck.config";`,
    `import { EditorClientWrapper } from "./editor-client";`,
    ``,
    `const pages = createP1Pages({`,
    `  config,`,
    `  EditorClient: EditorClientWrapper,`,
    `});`,
    ``,
    `export default pages.Page;`,
    `export const generateMetadata = pages.generateMetadata;`,
    `export const dynamic = "force-dynamic";`,
    ``,
  ].join("\n");

  it("extracts an exported factory into p1-pages with a deepened config import", () => {
    const { p1Pages } = splitPageFile(oldPage);
    expect(p1Pages).toContain(`export const pages = createP1Pages({`);
    expect(p1Pages).toContain(`import config from "../../../../puck.config";`);
    expect(p1Pages).not.toContain(`@puckeditor/core/puck.css`);
    expect(p1Pages).not.toContain(`export default pages.Page;`);
    expect(p1Pages.endsWith("});\n")).toBe(true);
  });

  it("produces a thin page that re-exports from ./p1-pages", () => {
    const { page } = splitPageFile(oldPage);
    expect(page).toBe(
      [
        `import { pages } from "./p1-pages";`,
        ``,
        `export default pages.Page;`,
        `export const generateMetadata = pages.generateMetadata;`,
        `export const dynamic = "force-dynamic";`,
        ``,
      ].join("\n"),
    );
  });

  it("bails when the file is not the recognized createP1Pages page", () => {
    expect(() => splitPageFile(`export default function Page() { return null; }`)).toThrow(
      BailError,
    );
  });

  it("strips the page-level exports whatever order they appear in", () => {
    const reordered = [
      `import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";`,
      ``,
      `const pages = createP1Pages({});`,
      ``,
      `export const dynamic = "force-dynamic";`,
      `export const generateMetadata = pages.generateMetadata;`,
      `export default pages.Page;`,
      ``,
    ].join("\n");

    const { p1Pages } = splitPageFile(reordered);

    expect(p1Pages).not.toContain(`export default pages.Page;`);
    expect(p1Pages).not.toContain(`export const dynamic`);
    expect(p1Pages).not.toContain(`export const generateMetadata`);
    expect(p1Pages.endsWith("});\n")).toBe(true);
  });

  it("bails rather than emitting a p1-pages that never exports `pages`", () => {
    const unexported = [
      `import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";`,
      ``,
      `let pages = createP1Pages({});`,
      ``,
      `export default pages.Page;`,
      ``,
    ].join("\n");

    expect(() => splitPageFile(unexported)).toThrow(BailError);
  });
});
