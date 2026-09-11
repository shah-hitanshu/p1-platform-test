/**
 * End-to-end proof for the p1-migrate codemod: reconstruct the OLD starter
 * editor layout from the vendored `fixtures/legacy-editor` snapshot, run the
 * codemod, and assert the result. Also proves sibling routes are left alone,
 * that a second run is a no-op, and that an unrecognized app bails.
 *
 * The legacy sources are vendored rather than read via `git show main:…`
 * because this migration deletes them from the starter — once it lands there is
 * no revision left to read them from.
 *
 * The expected output is checked two different ways, because the codemod does
 * two different things:
 *
 * - `layout.tsx`, `page.tsx` and `p1-pages.tsx` are *written from templates the
 *   codemod carries*, so comparing them to the starter at HEAD is a real
 *   invariant: it fails if those templates drift from the app they are meant to
 *   produce.
 * - `editor-client.tsx` is *transformed from the app's own file*. Its output is
 *   whatever the transform makes of the legacy input, which has nothing to do
 *   with how the starter's editor looks today. Pinning it to HEAD meant every
 *   ordinary edit to the starter's editor broke this test, fixable only by
 *   hand-editing the frozen `legacy-editor` snapshot — rewriting history to
 *   match the present. It is pinned to `fixtures/migrated-editor` instead: a
 *   golden file that moves only when the transform itself changes.
 *
 * Regenerate the golden file with `UPDATE_MIGRATE_FIXTURE=1 pnpm test`, and read
 * the diff — the codemod is frozen migration history, so a change here is
 * either a deliberate fix to the transform or a bug.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";

// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { migrate } from "../../bin/lib/cli.js";
// @ts-expect-error - hand-written ESM JS codemod, no type declarations
import { BailError } from "../../bin/lib/transform.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const headP1 = resolve(repoRoot, "apps/p1-starter/app/p1");
const legacyDir = resolve(__dirname, "fixtures/legacy-editor");
const migratedDir = resolve(__dirname, "fixtures/migrated-editor");

function legacy(name: string): string {
  return readFileSync(join(legacyDir, name), "utf-8");
}

function head(rel: string): string {
  return readFileSync(join(headP1, rel), "utf-8");
}

function expectMatchesGolden(actual: string, name: string): void {
  const goldenPath = join(migratedDir, name);
  if (process.env.UPDATE_MIGRATE_FIXTURE) {
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, "utf-8"));
}

const tmpDirs: string[] = [];
function makeOldApp(): string {
  const root = mkdtempSync(join(tmpdir(), "p1-migrate-"));
  tmpDirs.push(root);
  const oldCatchAll = join(root, "app/p1/[[...p1]]");
  mkdirSync(oldCatchAll, { recursive: true });
  writeFileSync(join(oldCatchAll, "page.tsx"), legacy("page.tsx"));
  writeFileSync(join(oldCatchAll, "editor-client.tsx"), legacy("editor-client.tsx"));
  // A sibling route that must be left untouched.
  const merge = join(root, "app/p1/merge");
  mkdirSync(merge, { recursive: true });
  writeFileSync(join(merge, "page.tsx"), "export default function Merge() { return null; }\n");
  return root;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d && existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

describe("p1-migrate end-to-end", () => {
  it("reproduces the (editor) tree byte-for-byte", async () => {
    const root = makeOldApp();

    await migrate({ dir: root, force: true });

    const editor = join(root, "app/p1/(editor)");
    expect(readFileSync(join(editor, "layout.tsx"), "utf-8")).toBe(head("(editor)/layout.tsx"));
    expect(readFileSync(join(editor, "[[...p1]]/page.tsx"), "utf-8")).toBe(head("(editor)/[[...p1]]/page.tsx"));
    expect(readFileSync(join(editor, "[[...p1]]/p1-pages.tsx"), "utf-8")).toBe(head("(editor)/[[...p1]]/p1-pages.tsx"));
    expectMatchesGolden(
      readFileSync(join(editor, "[[...p1]]/editor-client.tsx"), "utf-8"),
      "editor-client.tsx",
    );
  });

  it("removes the old catch-all directory and leaves siblings untouched", async () => {
    const root = makeOldApp();
    await migrate({ dir: root, force: true });

    expect(existsSync(join(root, "app/p1/[[...p1]]"))).toBe(false);
    expect(readFileSync(join(root, "app/p1/merge/page.tsx"), "utf-8")).toBe(
      "export default function Merge() { return null; }\n",
    );
  });

  it("is idempotent — a second run changes nothing", async () => {
    const root = makeOldApp();
    await migrate({ dir: root, force: true });
    const editorClient = join(root, "app/p1/(editor)/[[...p1]]/editor-client.tsx");
    const first = readFileSync(editorClient, "utf-8");

    await migrate({ dir: root, force: true });

    expect(readFileSync(editorClient, "utf-8")).toBe(first);
  });

  it("bails on an app whose editor-client diverged from the template", async () => {
    const root = mkdtempSync(join(tmpdir(), "p1-migrate-custom-"));
    tmpDirs.push(root);
    const oldCatchAll = join(root, "app/p1/[[...p1]]");
    mkdirSync(oldCatchAll, { recursive: true });
    writeFileSync(join(oldCatchAll, "page.tsx"), legacy("page.tsx"));
    writeFileSync(
      join(oldCatchAll, "editor-client.tsx"),
      `export function EditorClientWrapper({ path, custom }: MyProps) {\n  return null;\n}\n`,
    );

    await expect(migrate({ dir: root, force: true })).rejects.toThrow(BailError);
  });
});
