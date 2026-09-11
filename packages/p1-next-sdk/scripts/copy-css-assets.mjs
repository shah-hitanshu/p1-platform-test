/**
 * Puts this package's CSS where each kind of consumer resolves it from.
 *
 * `tsc` copies no assets, but it also does not rewrite specifiers: the emitted
 * JS still says `import "./role-switcher.module.css"`, resolved relative to the
 * compiled file. So CSS Modules have to land beside their `dist/` output or
 * that import points at nothing in the published package.
 *
 * The public `editor.css` entry point is different: it is named in `exports` as
 * `./src/editor-client/editor.css` and shipped from `src` via the files
 * allowlist, because a consumer imports it by package path rather than relative
 * to any compiled file. It needs no copying — only the modules do.
 */

import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(packageRoot, "src");
const distDir = join(packageRoot, "dist");

async function* cssModulesIn(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* cssModulesIn(path);
    else if (entry.name.endsWith(".module.css")) yield path;
  }
}

let copied = 0;
for await (const source of cssModulesIn(srcDir)) {
  const destination = join(distDir, relative(srcDir, source));
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
  copied += 1;
}

console.log(`copy-css-assets: ${copied} CSS module${copied === 1 ? "" : "s"} into dist`);
