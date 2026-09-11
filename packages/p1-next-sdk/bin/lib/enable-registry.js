/**
 * Wires an existing P1 app up to the @p1 code registry, so `shadcn add @p1/…`
 * works in a project that was scaffolded before the registry existed.
 *
 * `enableRegistry()` takes a directory and returns what it did, so it is
 * testable without a process. These are the customer's files, so nothing is
 * rewritten: a `components.json` that already exists gains only the `registries`
 * entry, every other step is skipped when it is already in place, and a second
 * run changes nothing.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The registry is served from a public host; nothing here depends on how it is
// built. A test holds this against the registry's own manifest.
export const REGISTRY_NAMESPACE = "@p1";
export const REGISTRY_URL = "https://components.p1.pantheon.io/r/{name}.json";

const BARREL = "components/puck/blocks/index.ts";

// vite.config too: a Next project that runs vitest often keeps one config.
const VITEST_CONFIGS = ["vitest.config.ts", "vitest.config.js", "vite.config.ts", "vite.config.js"];

// create-next-app writes app/globals.css (or src/app/… with the src layout); a
// pages-router project keeps styles/globals.css. @p1/tokens appends its import
// to whichever file components.json names, so naming one that is not there
// installs blocks that never get styled.
const CSS_CANDIDATES = [
  "app/globals.css",
  "src/app/globals.css",
  "app/styles.css",
  "styles/globals.css",
];

const DEFAULT_CSS = "app/styles.css";

export const VITEST_ALIAS_STEP = [
  "your vitest config does not alias @/, so a test importing an installed block",
  "  will fail to resolve rather than to assert. Add, alongside `test`:",
  "",
  '    import { fileURLToPath } from "node:url";',
  "",
  "    resolve: {",
  '      alias: { "@/": `${fileURLToPath(new URL(".", import.meta.url))}` },',
  "    },",
].join("\n");

export class EnableError extends Error {}

/**
 * shadcn rejects a components.json missing style, rsc, tsx or tailwind with a
 * bare "Invalid configuration found", so all four are written even though only
 * `registries` is what we are here for.
 *
 * `css` is the stylesheet the project actually has; @p1/tokens adds its import
 * to that file.
 */
export function componentsJson(css = DEFAULT_CSS) {
  return {
    $schema: "https://ui.shadcn.com/schema.json",
    style: "p1",
    rsc: true,
    tsx: true,
    tailwind: {
      config: "",
      css,
      baseColor: "neutral",
      cssVariables: true,
    },
    aliases: {
      components: "@/components",
      ui: "@/components/ui",
      lib: "@/lib",
      hooks: "@/hooks",
      utils: "@/lib/utils",
    },
    registries: { [REGISTRY_NAMESPACE]: REGISTRY_URL },
  };
}

export const BARREL_CONTENTS = `import type { Config } from "@puckeditor/core";

/**
 * Blocks installed from the P1 code registry land in this directory and are
 * registered below. Installing a block prints the lines to paste.
 */
export const p1Blocks = {} satisfies Config["components"];

export const p1Categories = {} satisfies NonNullable<Config["categories"]>;
`;

/**
 * Adds "@/*" to an existing `paths` block by editing the text.
 *
 * A tsconfig carries comments and trailing commas, so parsing and re-writing it
 * would silently reformat a file we do not own. Returns null when the shape is
 * not one we can edit safely, and the caller prints the lines to add by hand.
 */
/**
 * Blanks comments while keeping every offset, so a position found in the result
 * is the same position in the original. Deleting them instead would shift
 * everything after the first comment, and an edit placed at a shifted offset
 * lands in the wrong part of the file.
 *
 * String literals are matched by the same pass and kept, so a `/*` inside one
 * cannot open a comment span that swallows the rest of the file — `"@/*"`, the
 * mapping this module looks for, contains exactly that. Only whole-line `//`
 * comments are blanked, because a `//` mid-line is far more likely to be inside
 * a URL than to start a comment.
 */
const QUOTES = ['"', "'", "`"];
const STRING_OR_COMMENT =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|^[ \t]*\/\/[^\n]*/gm;

function blankComments(source) {
  return source.replace(STRING_OR_COMMENT, (match) =>
    QUOTES.includes(match[0]) ? match : match.replace(/[^\n]/g, " "),
  );
}

export function addPathAlias(source) {
  // Both the search and the insertion point come from the blanked copy, so a
  // comment can neither read as a real mapping nor attract the edit — a comment
  // mentioning `"paths": {` would otherwise have the alias spliced into it,
  // reported as success, leaving invalid JSON and the real block untouched.
  const bare = blankComments(source);
  if (/["']@\/\*["']\s*:/.test(bare)) return { source, changed: false };

  const pathsAt = bare.search(/["']paths["']\s*:\s*\{/);
  if (pathsAt === -1) return null;

  const braceAt = bare.indexOf("{", pathsAt);
  const rest = bare.slice(braceAt + 1);
  // Indentation of whatever entry already follows, so the insert does not stand
  // out in a file with its own formatting; one step in from `paths` if the block
  // is empty and there is nothing to copy.
  const pathsIndent = /[ \t]*$/.exec(bare.slice(0, pathsAt))[0];

  // `"paths": {}` is the shape `tsc --init` leaves behind. Splicing an entry in
  // front of the closing brace gives `["./*"],}` — a trailing comma, which tsc
  // tolerates and JSON.parse does not, so anything reading the file afterwards
  // breaks on a config this command promised not to damage. The whole block is
  // rewritten instead, which is safe only because it holds nothing to preserve.
  if (/^\s*\}/.test(source.slice(braceAt + 1))) {
    const closeAt = braceAt + 1 + rest.indexOf("}");
    const block = `{\n${pathsIndent}  "@/*": ["./*"]\n${pathsIndent}}`;
    return { source: source.slice(0, braceAt) + block + source.slice(closeAt + 1), changed: true };
  }

  // Indentation of whatever entry already follows, so the insert does not stand
  // out in a file with its own formatting.
  const indent = /^[^\n]*\n([ \t]+)\S/.exec(source.slice(braceAt + 1))?.[1] ?? `${pathsIndent}  `;

  // Only comments between the braces: same missing key, but the comment is the
  // customer's, so the block is added to rather than rewritten.
  const comma = /^\s*\}/.test(rest) ? "" : ",";
  const inserted = `\n${indent}"@/*": ["./*"]${comma}`;
  return { source: source.slice(0, braceAt + 1) + inserted + source.slice(braceAt + 1), changed: true };
}

/**
 * Reads a file, returning null when it is absent.
 *
 * Every step below acts and handles the failure rather than testing first:
 * checking existence and then reading or writing leaves a window in which the
 * answer changes, and in a directory the user is working in that is a real one.
 */
function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Writes a file only if it does not exist, in one operation.
 *
 * The `wx` flag is O_CREAT | O_EXCL, so the kernel decides and an existing file
 * is never truncated — the guarantee this command needs, since every one of
 * these files may be one the customer has already written.
 */
function writeIfAbsent(path, contents) {
  try {
    writeFileSync(path, contents, { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Whether both spreads come before the project's own keys in their objects.
 *
 * Presence alone is not enough: a spread placed after the project's own keys
 * lets a registry category overwrite one of theirs, and the blocks then stay
 * registered while vanishing from the drawer, with no error. Same offset
 * comparison the scaffold validator makes.
 */
export function spreadsMergeFirst(body) {
  for (const [key, spread] of [
    ["categories", "p1Categories"],
    ["components", "p1Blocks"],
  ]) {
    const blockAt = body.search(new RegExp(`^\\s*${key}:\\s*\\{`, "m"));
    if (blockAt === -1) return false;

    const rest = body.slice(blockAt);
    const spreadAt = rest.search(new RegExp(`\\.\\.\\.\\s*${spread}\\b`));
    if (spreadAt === -1) return false;

    const ownAt = rest.search(/^\s{4}[A-Za-z][A-Za-z0-9]*:/m);
    if (ownAt !== -1 && spreadAt > ownAt) return false;
  }
  return true;
}

export function enableRegistry(dir) {
  if (readIfPresent(join(dir, "package.json")) === null) {
    throw new EnableError(
      `${dir} has no package.json — run this from the root of your P1 project.`,
    );
  }

  const done = [];
  const skipped = [];
  const manual = [];

  const componentsPath = join(dir, "components.json");
  const existingComponents = readIfPresent(componentsPath);
  if (existingComponents === null) {
    // Only relevant when writing the file: an existing one already names a
    // stylesheet, and it is not ours to second-guess.
    const cssPath = CSS_CANDIDATES.find((candidate) => readIfPresent(join(dir, candidate)) !== null);
    if (!cssPath) {
      manual.push(
        `no stylesheet found at ${CSS_CANDIDATES.join(", ")}, so components.json now ` +
          `names "${DEFAULT_CSS}". Point tailwind.css at your real stylesheet, or ` +
          `@p1/tokens will write its variables to a file nothing imports and blocks ` +
          `will render unstyled.`,
      );
    }
    writeFileSync(componentsPath, JSON.stringify(componentsJson(cssPath), null, 2) + "\n");
    done.push("components.json");
  } else {
    // A project that already has this file is the audience for this command, so
    // skipping it whole would never deliver the one key the command exists for.
    // Only `registries` is touched; the rest of the file is the customer's.
    //
    // Anything that is not a JSON object gets the by-hand step: an array would
    // take the property and lose it on stringify, and a number or string throws.
    let parsed = null;
    try {
      const candidate = JSON.parse(existingComponents);
      if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsed = candidate;
      }
    } catch {
      // Falls through to the same step as a non-object.
    }
    if (parsed === null) {
      manual.push(
        `components.json is not a JSON object — add "registries": ` +
          `{ "${REGISTRY_NAMESPACE}": "${REGISTRY_URL}" } to it by hand.`,
      );
    } else if (parsed.registries?.[REGISTRY_NAMESPACE] === REGISTRY_URL) {
      skipped.push(`components.json already registers ${REGISTRY_NAMESPACE}`);
    } else {
      parsed.registries = { ...parsed.registries, [REGISTRY_NAMESPACE]: REGISTRY_URL };
      writeFileSync(componentsPath, JSON.stringify(parsed, null, 2) + "\n");
      done.push(`components.json (registered ${REGISTRY_NAMESPACE})`);
    }
  }

  const barrelPath = join(dir, BARREL);
  // Idempotent, so it needs no existence check of its own.
  mkdirSync(dirname(barrelPath), { recursive: true });
  if (writeIfAbsent(barrelPath, BARREL_CONTENTS)) {
    done.push(BARREL);
  } else {
    skipped.push(`${BARREL} already exists`);
  }

  const tsconfigPath = join(dir, "tsconfig.json");
  const tsconfig = readIfPresent(tsconfigPath);
  if (tsconfig === null) {
    manual.push("tsconfig.json is missing — add a `paths` entry mapping `@/*` to `./*`.");
  } else {
    const result = addPathAlias(tsconfig);
    if (result === null) {
      manual.push(
        'tsconfig.json has no `paths` block to extend — add `"paths": { "@/*": ["./*"] }` under compilerOptions.',
      );
    } else if (!result.changed) {
      skipped.push("tsconfig.json already maps @/*");
    } else {
      writeFileSync(tsconfigPath, result.source);
      done.push("tsconfig.json (@/* path alias)");
    }
  }

  // vitest does not read tsconfig `paths`, so a test importing an installed
  // block through @/ fails to resolve rather than to assert. Reported, not
  // edited: a vitest config is arbitrary TypeScript, not the JSON shape above.
  const vitestConfig = VITEST_CONFIGS.map((name) => readIfPresent(join(dir, name))).find(
    (contents) => contents !== null,
  );
  if (vitestConfig !== undefined && !/["']@\/?["']\s*:/.test(blankComments(vitestConfig))) {
    manual.push(VITEST_ALIAS_STEP);
  }

  // Never edited: puck.config.tsx is the customer's, and they have changed it.
  // Rewriting a file someone owns is the mistake this command exists to avoid.
  const puckConfig = ["puck.config.tsx", "puck.config.ts"]
    .map((name) => readIfPresent(join(dir, name)))
    .find((contents) => contents !== null);
  // Both spreads, not the bare identifier: a half-finished edit that imports the
  // barrel without spreading it would otherwise report success while every
  // installed block stays out of the drawer.
  const puckConfigBody = puckConfig === undefined ? "" : blankComments(puckConfig);
  const spreadsPresent =
    /\.\.\.\s*p1Blocks\b/.test(puckConfigBody) && /\.\.\.\s*p1Categories\b/.test(puckConfigBody);
  const puckConfigWired = spreadsPresent && spreadsMergeFirst(puckConfigBody);
  if (spreadsPresent && !puckConfigWired) {
    manual.push(
      "puck.config.tsx spreads the barrel after your own keys. Move both spreads to " +
        "the top of their objects: later keys win, so a registry category overwrites " +
        "yours and its blocks vanish from the drawer with no error.",
    );
  }

  return { done, skipped, manual, puckConfigWired };
}
