/**
 * Classify a consumer project's editor route so the codemod knows whether to
 * run, skip (already migrated), or bail (unrecognized), and verify the installed
 * package suite is new enough for the shape this codemod writes.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BailError } from "./transform.js";

/** The only two files the codemod knows how to transform and carry across. */
const MOVABLE = ["page.tsx", "editor-client.tsx"];

/**
 * App Router files whose behavior depends on where they sit. The editor moves
 * up into `(editor)/layout.tsx`, so these stop wrapping it even when relocated
 * faithfully — the destination is a judgment call the codemod should not make.
 */
const ROUTE_SPECIAL = new Set([
  "layout",
  "template",
  "error",
  "global-error",
  "loading",
  "not-found",
  "default",
  "route",
]);

export function isRouteSpecial(entry) {
  return ROUTE_SPECIAL.has(entry.replace(/\.(tsx|ts|jsx|js)$/, ""));
}

function extraEntries(catchAll) {
  return readdirSync(catchAll, { withFileTypes: true })
    .filter((entry) => !MOVABLE.includes(entry.name))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();
}

export function detectApp(dir) {
  const p1Dir = [join(dir, "app", "p1"), join(dir, "src", "app", "p1")].find((p) =>
    existsSync(p),
  );
  if (!p1Dir) return { status: "not-found" };

  const catchAll = join(p1Dir, "[[...p1]]");

  if (existsSync(join(p1Dir, "(editor)"))) {
    // Both trees present means a previous run died between the writes and the
    // cleanup; calling that "already migrated" would strand the old route.
    if (existsSync(catchAll)) return { status: "partial", p1Dir, catchAll };
    return { status: "already-migrated", p1Dir };
  }

  if (
    existsSync(join(catchAll, "page.tsx")) &&
    existsSync(join(catchAll, "editor-client.tsx"))
  ) {
    const extras = extraEntries(catchAll);
    if (extras.length > 0) return { status: "extra-files", p1Dir, catchAll, extras };
    return { status: "legacy", p1Dir, catchAll };
  }

  return { status: "not-found" };
}

/**
 * The release that moved the editor from `pages.Page` to `pages.Layout`. The
 * codemod writes routes that call `Layout`, so anything older would be
 * restructured to import an export that does not exist yet.
 */
export const MIN_SUITE_VERSION = "0.8.0";

/**
 * The lockstep-versioned packages a consumer app actually installs.
 * `create-p1-starter-kit` is in the same `fixed` group but only ever scaffolds,
 * so it is never present in the tree being migrated.
 */
const SUITE = [
  "@pantheon-systems/p1-next-sdk",
  "@pantheon-systems/puck-css",
  "@pantheon-systems/css-client",
];

function readVersion(packageJsonPath) {
  if (!existsSync(packageJsonPath)) return null;
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf-8")).version ?? null;
  } catch {
    return null;
  }
}

function manifestPath(...segments) {
  return join(...segments, "package.json");
}

/** Numeric release triple, ignoring any prerelease tag. Null when unparseable. */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isOlderThan(version, floor) {
  for (let i = 0; i < 3; i++) {
    if (version[i] !== floor[i]) return version[i] < floor[i];
  }
  return false;
}

/**
 * Verify the installed suite is consistent and new enough.
 *
 * Reads the installed tree rather than the consumer's declared ranges: a
 * pre-1.0 caret is pinned to its minor, and an exact-pinned internal dep is
 * satisfied by a nested private copy, so ranges cannot reveal either a stale
 * install or a duplicated package. When nothing is resolvable we cannot verify
 * anything — proceed rather than block, matching the clean-tree check.
 *
 * Only root-level packages are checked. Under pnpm's isolated node_modules just
 * the app's direct dependencies are linked at the root, so a suite package
 * missing from there is transitive, not broken — and a genuinely absent one
 * fails loudly at build time anyway.
 */
export function assertSuiteVersions(dir) {
  const modules = join(dir, "node_modules");
  const resolved = SUITE.map((pkg) => ({
    pkg,
    version: readVersion(manifestPath(modules, pkg)),
  })).filter((entry) => entry.version !== null);

  if (resolved.length === 0) return { status: "unverified" };

  const duplicates = [];
  for (const { pkg: owner } of resolved) {
    for (const { pkg: nested, version: root } of resolved) {
      if (owner === nested) continue;
      const version = readVersion(manifestPath(modules, owner, "node_modules", nested));
      if (version !== null && version !== root) {
        duplicates.push(`${nested}@${version} nested under ${owner}, and ${nested}@${root} at the root`);
      }
    }
  }
  if (duplicates.length > 0) {
    throw new BailError(
      `Your install has more than one copy of a P1 package: ${duplicates.join("; ")}. ` +
        "Two copies mean two React contexts and the editor will misbehave at runtime. " +
        "Upgrade every @pantheon-systems/* dependency in your package.json to the same " +
        "version, reinstall, then re-run.",
    );
  }

  const versions = [...new Set(resolved.map((entry) => entry.version))];
  if (versions.length > 1) {
    throw new BailError(
      "Installed P1 packages are on different versions " +
        `(${resolved.map((e) => `${e.pkg}@${e.version}`).join(", ")}). ` +
        "They are released in lockstep and must match. Upgrade them together, then re-run.",
    );
  }

  const [version] = versions;
  const parsed = parseVersion(version);
  if (parsed === null) return { status: "unverified" };

  if (isOlderThan(parsed, parseVersion(MIN_SUITE_VERSION))) {
    throw new BailError(
      `Installed P1 packages are at ${version}, but the persistent (editor) layout ` +
        `needs ${MIN_SUITE_VERSION} or newer. This codemod runs at the latest published ` +
        "version because npx fetches it from the registry, so it can restructure routes " +
        `your installed version cannot render. Note a "^${version}" range will not resolve ` +
        `${MIN_SUITE_VERSION} — pre-1.0 carets are pinned to their minor — so upgrade ` +
        "explicitly, reinstall, then re-run.",
    );
  }

  return { status: "ok", version };
}
