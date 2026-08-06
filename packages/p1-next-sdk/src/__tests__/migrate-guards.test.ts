/**
 * Tests for the p1-migrate codemod's safety guards.
 *
 * The codemod's one irreversible act is removing the old catch-all directory,
 * so everything that decides whether it may run belongs here: refusing to
 * delete files it cannot move, refusing arguments it does not understand,
 * verifying the tree is recoverable, and recognizing a half-finished run.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";

// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { migrate, parseArgs } from "../../bin/lib/cli.js";
// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { detectApp } from "../../bin/lib/detect.js";
// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { assertCleanTree } from "../../bin/lib/git.js";
// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { BailError } from "../../bin/lib/transform.js";

const LEGACY_PAGE =
  'import "@puckeditor/core/puck.css";\n' +
  'import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";\n' +
  'import config from "../../../puck.config";\n' +
  'import { EditorClientWrapper } from "./editor-client";\n' +
  "\n" +
  "const pages = createP1Pages({ config, EditorClient: EditorClientWrapper });\n" +
  "\n" +
  "export default pages.Page;\n" +
  "export const generateMetadata = pages.generateMetadata;\n" +
  'export const dynamic = "force-dynamic";\n';

const LEGACY_CLIENT =
  'import { useRouter } from "next/navigation";\n' +
  'import { P1NextRouterProvider } from "@pantheon-systems/p1-next-sdk";\n' +
  "\n" +
  "export function EditorClientWrapper({ path }: { path: string }) {\n" +
  "  return null;\n" +
  "}\n";

const tmpDirs: string[] = [];

function makeLegacyApp(extras: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "p1-guards-"));
  tmpDirs.push(root);
  const catchAll = join(root, "app/p1/[[...p1]]");
  mkdirSync(catchAll, { recursive: true });
  writeFileSync(join(catchAll, "page.tsx"), LEGACY_PAGE);
  writeFileSync(join(catchAll, "editor-client.tsx"), LEGACY_CLIENT);
  for (const [rel, content] of Object.entries(extras)) {
    const target = join(catchAll, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "p1-guards-git-"));
  tmpDirs.push(root);
  git(root, "init");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "README.md"), "seed\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "seed");
  return root;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d && existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

describe("extra files in the old catch-all", () => {
  it("bails rather than deleting a co-located component", async () => {
    const root = makeLegacyApp({ "Foo.tsx": "export const Foo = () => null;\n" });

    await expect(migrate({ dir: root, force: true })).rejects.toThrow(BailError);
  });

  it("leaves the whole tree untouched when it bails", async () => {
    const root = makeLegacyApp({ "loading.tsx": "export default function L() {}\n" });

    await expect(migrate({ dir: root, force: true })).rejects.toThrow(BailError);

    expect(existsSync(join(root, "app/p1/[[...p1]]/loading.tsx"))).toBe(true);
    expect(existsSync(join(root, "app/p1/[[...p1]]/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "app/p1/(editor)"))).toBe(false);
  });

  it("names every unmovable file in the bail message", async () => {
    const root = makeLegacyApp({
      "error.tsx": "export default function E() {}\n",
      "editor.module.css": ".a { color: red; }\n",
    });

    await expect(migrate({ dir: root, force: true })).rejects.toThrow(
      /error\.tsx[\s\S]*editor\.module\.css|editor\.module\.css[\s\S]*error\.tsx/,
    );
  });

  it("explains that route-special files belong beside the new layout", async () => {
    const root = makeLegacyApp({ "error.tsx": "export default function E() {}\n" });

    await expect(migrate({ dir: root, force: true })).rejects.toThrow(/\(editor\)/);
  });

  it("bails on an extra directory, not just files", async () => {
    const root = makeLegacyApp();
    mkdirSync(join(root, "app/p1/[[...p1]]/components"), { recursive: true });
    writeFileSync(join(root, "app/p1/[[...p1]]/components/Card.tsx"), "export const C = 1;\n");

    await expect(migrate({ dir: root, force: true })).rejects.toThrow(BailError);
  });

  it("still migrates an app with exactly the two known files", async () => {
    const root = makeLegacyApp();

    await expect(migrate({ dir: root, force: true })).resolves.toMatchObject({ changed: true });
  });

  it("reports the extras through detectApp", () => {
    const root = makeLegacyApp({ "error.tsx": "x\n" });

    expect(detectApp(root)).toMatchObject({ status: "extra-files", extras: ["error.tsx"] });
  });
});

describe("argument parsing", () => {
  it("accepts the documented flags", () => {
    expect(parseArgs(["--dry-run", "--force", "--dir=/tmp/x"])).toMatchObject({
      dryRun: true,
      force: true,
      dir: "/tmp/x",
    });
  });

  it("rejects a misspelled --dry-run rather than silently running for real", () => {
    expect(() => parseArgs(["--dryrun"])).toThrow(BailError);
  });

  it("rejects --dir passed with a space instead of =", () => {
    expect(() => parseArgs(["--dir", "/tmp/x"])).toThrow(BailError);
  });

  it("rejects an unknown short flag", () => {
    expect(() => parseArgs(["-n"])).toThrow(BailError);
  });

  it("rejects a stray positional argument", () => {
    expect(() => parseArgs(["migrate"])).toThrow(BailError);
  });

  it("names the offending argument", () => {
    expect(() => parseArgs(["--dryrun"])).toThrow(/--dryrun/);
  });
});

describe("clean-tree verification", () => {
  it("passes on a clean repo", () => {
    expect(assertCleanTree(makeRepo())).toMatchObject({ status: "clean" });
  });

  it("bails on a dirty target", () => {
    const root = makeRepo();
    writeFileSync(join(root, "stray.txt"), "x\n");

    expect(() => assertCleanTree(root)).toThrow(BailError);
  });

  it("ignores dirt outside the directory being migrated", () => {
    const root = makeRepo();
    const app = join(root, "packages/app");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, "keep.txt"), "x\n");
    git(root, "add", "-A");
    git(root, "commit", "-m", "app");
    writeFileSync(join(root, "elsewhere.txt"), "dirty\n");

    expect(assertCleanTree(app)).toMatchObject({ status: "clean" });
  });

  it("reports no-repo instead of throwing when the target is not a git repo", () => {
    const root = mkdtempSync(join(tmpdir(), "p1-guards-nogit-"));
    tmpDirs.push(root);

    expect(assertCleanTree(root)).toMatchObject({ status: "no-repo" });
  });

  it("bails when git itself fails, rather than skipping the check", () => {
    const exploded = () => {
      const err = new Error("Command failed");
      // @ts-expect-error - mimicking execFileSync's error shape
      err.stderr = "fatal: detected dubious ownership in repository at '/x'\n";
      throw err;
    };

    expect(() => assertCleanTree("/x", exploded)).toThrow(BailError);
  });

  it("surfaces git's own error text in the bail", () => {
    const exploded = () => {
      const err = new Error("Command failed");
      // @ts-expect-error - mimicking execFileSync's error shape
      err.stderr = "fatal: detected dubious ownership in repository at '/x'\n";
      throw err;
    };

    expect(() => assertCleanTree("/x", exploded)).toThrow(/dubious ownership/);
  });
});

describe("interrupted-run detection", () => {
  it("does not report success when both layouts are present", async () => {
    const root = makeLegacyApp();
    mkdirSync(join(root, "app/p1/(editor)/[[...p1]]"), { recursive: true });
    writeFileSync(join(root, "app/p1/(editor)/layout.tsx"), "export default function L() {}\n");

    await expect(migrate({ dir: root, force: true })).rejects.toThrow(BailError);
  });

  it("classifies the half-migrated tree as partial", () => {
    const root = makeLegacyApp();
    mkdirSync(join(root, "app/p1/(editor)/[[...p1]]"), { recursive: true });

    expect(detectApp(root)).toMatchObject({ status: "partial" });
  });

  it("still no-ops on a fully migrated app", async () => {
    const root = mkdtempSync(join(tmpdir(), "p1-guards-done-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "app/p1/(editor)/[[...p1]]"), { recursive: true });

    await expect(migrate({ dir: root, force: true })).resolves.toMatchObject({ changed: false });
  });
});
