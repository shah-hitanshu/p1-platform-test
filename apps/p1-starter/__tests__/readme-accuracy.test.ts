/**
 * This README documented two optional Content Publisher variables as the required
 * credentials, three paths that no longer existed, and a package name that never did.
 * Following it produced a site that could not reach its backend. Prose drifts without
 * anything failing, so the claims are checked against the app they describe.
 */
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(resolve(appDir, file), "utf-8");

const readme = read("README.md");
const envExample = read(".env.example");
const setupSection = /## Getting started\n([\s\S]*?)\n## /.exec(readme)![1];
const structure = /## Project structure\n+```\n([\s\S]*?)```/.exec(readme)![1];

describe("README describes the app as it exists", () => {
  it("names only paths that exist", () => {
    const stack: string[] = [];
    const claimed: string[] = [];

    for (const line of structure.split("\n")) {
      const entry = /^(\s*)(\S+?)\/?(\s+#.*)?$/.exec(line);
      if (!entry) continue;

      stack.length = entry[1].length / 2;
      stack.push(entry[2].replace(/\/$/, ""));
      claimed.push(stack.join("/"));
    }

    expect(claimed.length).toBeGreaterThan(5);
    expect(claimed.filter((p) => !existsSync(resolve(appDir, p)))).toEqual([]);
  });

  it("presents as required only the variables .env.example leaves uncommented", () => {
    // PCC_SITE_ID and PCC_TOKEN are real, but commented out as an optional
    // integration — being present in the file is what made the old table look right.
    const active = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    const rows = [...setupSection.matchAll(/^\s*\| `([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]);

    expect(rows).toContain("CSS_API_KEY");
    expect(rows.filter((v) => !active.includes(v))).toEqual([]);
  });

  it("mentions no variable the app does not have at all", () => {
    const known = [...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    const named = [...setupSection.matchAll(/`([A-Z][A-Z0-9_]{4,})`/g)].map((m) => m[1]);

    expect(named.length).toBeGreaterThan(2);
    expect(named.filter((v) => !known.includes(v))).toEqual([]);
  });

  it("names only @pantheon-systems packages this app depends on", () => {
    const manifest = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    const named = [...readme.matchAll(/`(@pantheon-systems\/[\w-]+)`/g)].map((m) => m[1]);

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((p) => !installed.includes(p))).toEqual([]);
  });
});
