/**
 * Tests for the `p1-next-sdk` dispatcher.
 *
 * The bin is a top-level-await script that calls process.exit, so it is driven
 * as a process rather than imported. What matters here is the wiring: each
 * subcommand has to reach its runner with the subcommand name stripped, or the
 * runner parses that name as a user argument and the command does nothing.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";

const BIN = join(import.meta.dirname, "../../bin/p1-next-sdk.js");

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function project() {
  dir = mkdtempSync(join(tmpdir(), "p1-bin-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-p1-app" }) + "\n");
  return dir;
}

const run = (args: string[], cwd: string) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

describe("p1-next-sdk dispatcher", () => {
  it("reports usage and fails without a subcommand", () => {
    const result = run([], project());
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage: p1-next-sdk <migrate\|enable-registry>/);
  });

  it("enable-registry accepts a directory argument", () => {
    const target = project();
    const result = run(["enable-registry", target], target);
    // The subcommand name reaching parseArgs as a positional is what this
    // guards: it read as a second directory and exited 2.
    expect(result.stderr).not.toMatch(/expected at most one directory/);
    expect(result.status).toBe(0);
    expect(existsSync(join(target, "components.json"))).toBe(true);
  });

  it("enable-registry defaults to the working directory, not ./enable-registry", () => {
    const target = project();
    const result = run(["enable-registry"], target);
    expect(result.stdout + result.stderr).not.toMatch(/enable-registry has no package\.json/);
    expect(existsSync(join(target, "components.json"))).toBe(true);
  });

  it("migrate reaches its runner instead of rejecting its own name", () => {
    const target = project();
    const result = run(["migrate", "--dry-run"], target);
    expect(result.stdout + result.stderr).not.toMatch(/Unrecognized argument: migrate/);
  });

  it("passes a flag through to the subcommand", () => {
    // A positive assertion on purpose: migrate's parser walks every argument
    // and throws on the first it does not know, so an unstripped subcommand
    // name means the help it was asked for never prints.
    const target = project();
    const result = run(["migrate", "--help"], target);
    expect(result.stdout).toMatch(/Usage: npx @pantheon-systems\/p1-next-sdk migrate/);
    expect(result.stdout).toMatch(/--dry-run/);
  });
});
