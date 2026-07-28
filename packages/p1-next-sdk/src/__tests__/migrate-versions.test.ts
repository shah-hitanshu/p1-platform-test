/**
 * Tests for the p1-migrate codemod's installed-suite version guard.
 *
 * The codemod is fetched by `npx` from the registry, so it runs at `latest`
 * regardless of what the consumer has installed — restructuring routes to call
 * `pages.Layout` against an installed SDK that has no such export. Ranges in the
 * consumer's package.json can't detect this (a `^0.5.0` caret is pinned to the
 * 0.5.x minor, and an exact-pinned internal dep is satisfied by a nested private
 * copy), so the guard reads the installed tree instead.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { assertSuiteVersions } from "../../bin/lib/detect.js";
// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { migrate } from "../../bin/lib/cli.js";
// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { BailError } from "../../bin/lib/transform.js";

const SDK = "@pantheon-systems/p1-next-sdk";
const PUCK_CSS = "@pantheon-systems/puck-css";
const CSS_CLIENT = "@pantheon-systems/css-client";

const tmpDirs: string[] = [];

function makeProject(installed: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "p1-versions-"));
  tmpDirs.push(root);
  for (const [pkg, version] of Object.entries(installed)) {
    install(root, pkg, version);
  }
  return root;
}

/** Write a minimal installed package.json into `root`'s node_modules. */
function install(root: string, pkg: string, version: string): void {
  const dir = join(root, "node_modules", ...pkg.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg, version }));
}

/** Write a nested private copy — what pnpm does when an exact internal dep can't be hoisted. */
function installNested(root: string, owner: string, pkg: string, version: string): void {
  const dir = join(root, "node_modules", ...owner.split("/"), "node_modules", ...pkg.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg, version }));
}

function makeLegacyApp(root: string): void {
  const catchAll = join(root, "app/p1/[[...p1]]");
  mkdirSync(catchAll, { recursive: true });
  writeFileSync(
    join(catchAll, "page.tsx"),
    'import "@puckeditor/core/puck.css";\n' +
      'import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";\n' +
      'import config from "../../../puck.config";\n' +
      'import { EditorClientWrapper } from "./editor-client";\n' +
      "\n" +
      "const pages = createP1Pages({ config, EditorClient: EditorClientWrapper });\n" +
      "\n" +
      "export default pages.Page;\n" +
      "export const generateMetadata = pages.generateMetadata;\n" +
      'export const dynamic = "force-dynamic";\n',
  );
  writeFileSync(
    join(catchAll, "editor-client.tsx"),
    '"use client";\n' +
      'import { useRouter } from "next/navigation";\n' +
      'import { P1NextRouterProvider } from "@pantheon-systems/p1-next-sdk";\n' +
      "\n" +
      "export function EditorClientWrapper({ path }: { path: string }) {\n" +
      "  return null;\n" +
      "}\n",
  );
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d && existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

describe("assertSuiteVersions", () => {
  it("reports unverified when no suite package is resolvable", () => {
    // Matches git.js's posture: if we can't inspect it, proceed rather than block.
    expect(assertSuiteVersions(makeProject()).status).toBe("unverified");
  });

  it("accepts a consistent suite at the minimum version", () => {
    const root = makeProject({
      [SDK]: "0.8.0",
      [PUCK_CSS]: "0.8.0",
      [CSS_CLIENT]: "0.8.0",
    });
    expect(assertSuiteVersions(root)).toEqual({ status: "ok", version: "0.8.0" });
  });

  it("accepts a consistent suite newer than the minimum", () => {
    const root = makeProject({
      [SDK]: "0.9.1",
      [PUCK_CSS]: "0.9.1",
      [CSS_CLIENT]: "0.9.1",
    });
    expect(assertSuiteVersions(root).status).toBe("ok");
  });

  it("bails when the suite is consistent but older than the layout release", () => {
    const root = makeProject({
      [SDK]: "0.5.0",
      [PUCK_CSS]: "0.5.0",
      [CSS_CLIENT]: "0.5.0",
    });
    expect(() => assertSuiteVersions(root)).toThrow(BailError);
    expect(() => assertSuiteVersions(root)).toThrow(/0\.5\.0/);
  });

  it("bails when installed suite versions disagree", () => {
    const root = makeProject({
      [SDK]: "0.8.0",
      [PUCK_CSS]: "0.5.0",
      [CSS_CLIENT]: "0.8.0",
    });
    expect(() => assertSuiteVersions(root)).toThrow(BailError);
    expect(() => assertSuiteVersions(root)).toThrow(/puck-css/);
  });

  it("treats a package absent from the root as transitive, not broken", () => {
    // pnpm's isolated node_modules links only direct dependencies at the root, so
    // css-client — a transitive dep of the SDK — legitimately isn't there. Real
    // apps look exactly like this; requiring it would bail on every one of them.
    const root = makeProject({ [SDK]: "0.8.0", [PUCK_CSS]: "0.8.0" });
    expect(assertSuiteVersions(root)).toEqual({ status: "ok", version: "0.8.0" });
  });

  it("still flags version skew among only the root-level packages", () => {
    const root = makeProject({ [SDK]: "0.8.0", [PUCK_CSS]: "0.5.0" });
    expect(() => assertSuiteVersions(root)).toThrow(BailError);
    expect(() => assertSuiteVersions(root)).toThrow(/puck-css/);
  });

  it("bails on a nested duplicate copy even when root versions agree", () => {
    // The silent failure mode: `pnpm add p1-next-sdk@latest` with a stale direct
    // puck-css range leaves two copies of puck-css, and post-0.8 there is no
    // internal peerDependency left to warn about it.
    const root = makeProject({
      [SDK]: "0.8.0",
      [PUCK_CSS]: "0.8.0",
      [CSS_CLIENT]: "0.8.0",
    });
    installNested(root, SDK, PUCK_CSS, "0.5.0");

    expect(() => assertSuiteVersions(root)).toThrow(BailError);
    expect(() => assertSuiteVersions(root)).toThrow(/more than one copy/i);
  });

  it("ignores a nested copy at the same version as the root", () => {
    const root = makeProject({
      [SDK]: "0.8.0",
      [PUCK_CSS]: "0.8.0",
      [CSS_CLIENT]: "0.8.0",
    });
    installNested(root, SDK, PUCK_CSS, "0.8.0");

    expect(assertSuiteVersions(root).status).toBe("ok");
  });

  it("treats a prerelease of the minimum version as acceptable", () => {
    const root = makeProject({
      [SDK]: "0.8.0-beta.1",
      [PUCK_CSS]: "0.8.0-beta.1",
      [CSS_CLIENT]: "0.8.0-beta.1",
    });
    expect(assertSuiteVersions(root).status).toBe("ok");
  });

  it("reports unverified rather than bailing on an unparseable version", () => {
    const root = makeProject({
      [SDK]: "workspace:*",
      [PUCK_CSS]: "workspace:*",
      [CSS_CLIENT]: "workspace:*",
    });
    expect(assertSuiteVersions(root).status).toBe("unverified");
  });
});

describe("migrate version guard", () => {
  it("refuses to restructure an app whose installed SDK predates pages.Layout", async () => {
    const root = makeProject({
      [SDK]: "0.5.0",
      [PUCK_CSS]: "0.5.0",
      [CSS_CLIENT]: "0.5.0",
    });
    makeLegacyApp(root);

    await expect(migrate({ dir: root, force: true })).rejects.toThrow(BailError);
    // The bail must happen before any write, so the tree is left untouched.
    expect(existsSync(join(root, "app/p1/(editor)"))).toBe(false);
    expect(existsSync(join(root, "app/p1/[[...p1]]/page.tsx"))).toBe(true);
  });

  it("checks versions on --dry-run too", async () => {
    const root = makeProject({
      [SDK]: "0.5.0",
      [PUCK_CSS]: "0.5.0",
      [CSS_CLIENT]: "0.5.0",
    });
    makeLegacyApp(root);

    await expect(migrate({ dir: root, dryRun: true })).rejects.toThrow(BailError);
  });

  it("migrates normally when the installed suite is current", async () => {
    const root = makeProject({
      [SDK]: "0.8.0",
      [PUCK_CSS]: "0.8.0",
      [CSS_CLIENT]: "0.8.0",
    });
    makeLegacyApp(root);

    await expect(migrate({ dir: root, force: true })).resolves.toMatchObject({ changed: true });
    expect(existsSync(join(root, "app/p1/(editor)/layout.tsx"))).toBe(true);
  });

  it("skips the version check for an already-migrated app", async () => {
    const root = makeProject({
      [SDK]: "0.5.0",
      [PUCK_CSS]: "0.5.0",
      [CSS_CLIENT]: "0.5.0",
    });
    mkdirSync(join(root, "app/p1/(editor)"), { recursive: true });

    await expect(migrate({ dir: root, force: true })).resolves.toMatchObject({ changed: false });
  });
});
