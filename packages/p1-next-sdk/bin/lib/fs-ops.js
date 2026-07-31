/**
 * Filesystem helpers for the codemod, with a path-traversal guard so a write
 * can never land outside the project being migrated.
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { BailError } from "./transform.js";

export function read(path) {
  return readFileSync(path, "utf-8");
}

export function assertWithin(root, target) {
  const r = resolve(root);
  const t = resolve(target);
  if (t !== r && !t.startsWith(r + sep)) {
    throw new BailError(`Refusing to touch a path outside the project: ${target}`);
  }
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function write(path, content) {
  writeFileSync(path, content);
}

export function removeDir(path) {
  rmSync(path, { recursive: true, force: true });
}
