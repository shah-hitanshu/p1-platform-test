/**
 * A file-moving codemod needs a clean tree so the user can review its diff and
 * roll back. Not being a git repo is a state we can report and proceed from;
 * git being present but unable to answer is not — that is an unverified tree
 * wearing the same mask, and the caller would delete files on the strength of
 * a check that never ran.
 */

import { execFileSync } from "node:child_process";
import { BailError } from "./transform.js";

function runGit(args, dir) {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function describeFailure(err) {
  const stderr = typeof err?.stderr === "string" ? err.stderr.trim() : "";
  return stderr || (err instanceof Error ? err.message : String(err));
}

function unverified(err) {
  return new BailError(
    `git could not verify the working tree (${describeFailure(err)}). ` +
      "Fix that, or re-run with --force to migrate without a clean-tree check.",
  );
}

/**
 * @returns `{ status: "clean" }` when the target subtree has no pending changes,
 * or `{ status: "no-repo" }` when there is no repository to check. Throws
 * BailError when the tree is dirty or git could not answer.
 */
export function assertCleanTree(dir, run = runGit) {
  try {
    run(["rev-parse", "--git-dir"], dir);
  } catch (err) {
    if (/not a git repository/i.test(describeFailure(err))) return { status: "no-repo" };
    throw unverified(err);
  }

  let out;
  try {
    // Scoped to the target: `git status` is repo-wide by default, so an
    // unrelated dirty file elsewhere in a monorepo would block a clean subtree.
    out = run(["status", "--porcelain", "--", "."], dir);
  } catch (err) {
    throw unverified(err);
  }

  if (out.trim()) {
    throw new BailError(
      "Working tree is not clean. Commit or stash your changes first, or re-run with --force.",
    );
  }
  return { status: "clean" };
}
