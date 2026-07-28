/**
 * Codemod orchestration.
 *
 * `migrate()` is pure-ish and testable (takes a dir, returns a result, throws
 * BailError on unrecognized input). `runCLI()` wraps it with argv parsing and
 * process exit codes for the bin entrypoint.
 *
 * All transforms run before any write, so a bail leaves the tree untouched —
 * the app is never left half-migrated.
 */

import { join, relative } from "node:path";
import { detectApp, assertSuiteVersions, isRouteSpecial } from "./detect.js";
import { assertCleanTree } from "./git.js";
import * as fsops from "./fs-ops.js";
import * as msg from "./messages.js";
import {
  BailError,
  rewriteEditorClient,
  splitPageFile,
  buildLayoutFile,
} from "./transform.js";

const show = (dir, target) => relative(dir, target) || target;

/**
 * The codemod's only irreversible act is removing the old catch-all, so when it
 * holds anything else the bail has to be worth reading: name every file, and
 * separate the ones that just need moving from the ones whose destination is a
 * real decision.
 */
function extraFilesMessage({ catchAll, extras, p1Dir }, dir) {
  const special = extras.filter(isRouteSpecial);
  const plain = extras.filter((entry) => !isRouteSpecial(entry));
  const group = show(dir, join(p1Dir, "(editor)"));
  const lines = [
    `${show(dir, catchAll)} contains files this codemod does not know how to move:`,
  ];
  if (plain.length > 0) {
    lines.push(
      "",
      ...plain.map((entry) => `  ${entry}`),
      `Move these into ${join(group, "[[...p1]]")}/ and add one ../ to each parent-relative import.`,
    );
  }
  if (special.length > 0) {
    lines.push(
      "",
      ...special.map((entry) => `  ${entry}`),
      "These wrap the route segment. The editor now renders from " +
        `${join(group, "layout.tsx")}, one level up, so they likely belong beside it in ${group}/.`,
    );
  }
  lines.push(
    "",
    "Move them, then re-run — the page split, import depth, and layout are still handled for you.",
  );
  return lines.join("\n");
}

function partialMessage({ catchAll, p1Dir }, dir) {
  return (
    `Both ${show(dir, join(p1Dir, "(editor)"))} and ${show(dir, catchAll)} exist, so an ` +
    "earlier run was interrupted before it removed the old route. Check which files you " +
    `want to keep, delete ${show(dir, catchAll)}, then re-run.`
  );
}

export async function migrate(opts = {}) {
  const dir = opts.dir ?? process.cwd();
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;

  const app = detectApp(dir);
  if (app.status === "already-migrated") {
    msg.alreadyMigrated();
    return { changed: false };
  }
  if (app.status === "not-found") {
    throw new BailError(
      `Could not find app/p1/[[...p1]]/page.tsx under ${dir}. Run this from your project root.`,
    );
  }
  if (app.status === "partial") {
    throw new BailError(partialMessage(app, dir));
  }
  if (app.status === "extra-files") {
    throw new BailError(extraFilesMessage(app, dir));
  }

  // Runs on --dry-run too: a plan the installed suite cannot render is not a
  // plan worth previewing.
  if (assertSuiteVersions(dir).status === "unverified") msg.versionsUnverified();

  if (!force && !dryRun && assertCleanTree(dir).status === "no-repo") msg.noGitRepo();

  const { catchAll, p1Dir } = app;
  const editorGroup = join(p1Dir, "(editor)");
  const newCatchAll = join(editorGroup, "[[...p1]]");

  // Transform everything up front — any bail happens before we touch disk.
  const newEditorClient = rewriteEditorClient(fsops.read(join(catchAll, "editor-client.tsx")));
  const { p1Pages, page } = splitPageFile(fsops.read(join(catchAll, "page.tsx")));
  const layout = buildLayoutFile();

  const writes = [
    [join(newCatchAll, "editor-client.tsx"), newEditorClient],
    [join(newCatchAll, "p1-pages.tsx"), p1Pages],
    [join(newCatchAll, "page.tsx"), page],
    [join(editorGroup, "layout.tsx"), layout],
  ];

  for (const [path] of writes) fsops.assertWithin(dir, path);
  fsops.assertWithin(dir, catchAll);

  if (dryRun) {
    msg.dryRunPlan(writes.map(([path]) => path), catchAll);
    return { changed: false, dryRun: true };
  }

  fsops.ensureDir(newCatchAll);
  for (const [path, content] of writes) fsops.write(path, content);
  fsops.removeDir(catchAll);

  msg.success(writes.map(([path]) => path), catchAll);
  return { changed: true };
}

/**
 * Strict on purpose: a silently-ignored `--dryrun` would run the real migration,
 * and a `--dir` given with a space would migrate the current directory instead
 * of the one the user named.
 */
export function parseArgs(argv) {
  const opts = { dir: process.cwd(), force: false, dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === "--force" || arg === "-f") opts.force = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--dir=")) opts.dir = arg.slice("--dir=".length);
    else {
      throw new BailError(
        `Unrecognized argument: ${arg}. Run with --help to see the supported options.`,
      );
    }
  }
  return opts;
}

export async function runCLI(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof BailError) msg.bail(err.message);
    else msg.unexpected(err);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    msg.help();
    return;
  }
  try {
    await migrate(opts);
  } catch (err) {
    if (err instanceof BailError) msg.bail(err.message);
    else msg.unexpected(err);
    process.exitCode = 1;
  }
}
