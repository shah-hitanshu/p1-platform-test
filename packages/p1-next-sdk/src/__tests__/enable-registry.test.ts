/**
 * Tests for `p1-next-sdk enable-registry`.
 *
 * The command edits files in a project nobody on this team owns, so what
 * matters is what it refuses to do: never overwrite, never reformat a tsconfig
 * it cannot edit safely, never touch puck.config.tsx.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";

// @ts-expect-error - hand-written ESM JS bin script, no type declarations
import {
  enableRegistry,
  addPathAlias,
  componentsJson,
  EnableError,
  REGISTRY_URL,
  VITEST_ALIAS_STEP,
} from "../../bin/lib/enable-registry.js";
// @ts-expect-error - hand-written ESM JS bin script, no type declarations
import { parseArgs } from "../../bin/lib/enable-cli.js";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A project scaffolded before the registry existed. */
function project(tsconfig?: string) {
  dir = mkdtempSync(join(tmpdir(), "p1-enable-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-p1-app" }) + "\n");
  if (tsconfig !== undefined) writeFileSync(join(dir, "tsconfig.json"), tsconfig);
  return dir;
}

const read = (file: string) => readFileSync(join(dir, file), "utf8");

const PLAIN_TSCONFIG = `{
  "compilerOptions": {
    "paths": {
      "react": ["./node_modules/@types/react"]
    }
  }
}
`;

describe("enableRegistry", () => {
  it("refuses a directory that is not a project root", () => {
    dir = mkdtempSync(join(tmpdir(), "p1-enable-"));
    expect(() => enableRegistry(dir)).toThrow(EnableError);
    expect(() => enableRegistry(dir)).toThrow(/no package\.json/);
  });

  it("writes components.json registering the namespace", () => {
    enableRegistry(project(PLAIN_TSCONFIG));
    const config = JSON.parse(read("components.json"));
    expect(config.registries["@p1"]).toBe(REGISTRY_URL);
    // shadcn rejects the file outright when any of these is absent.
    expect(config.style).toBe("p1");
    expect(config.tsx).toBe(true);
    expect(config.rsc).toBe(true);
    expect(config.tailwind.css).toBe("app/styles.css");
  });

  it("creates the barrel, exporting both objects empty", () => {
    enableRegistry(project(PLAIN_TSCONFIG));
    const barrel = read("components/puck/blocks/index.ts");
    expect(barrel).toContain("p1Blocks = {} satisfies Config");
    expect(barrel).toContain('p1Categories = {} satisfies NonNullable<Config["categories"]>');
  });

  it("adds the path alias without disturbing what is already there", () => {
    enableRegistry(project(PLAIN_TSCONFIG));
    const tsconfig = read("tsconfig.json");
    expect(tsconfig).toContain('"@/*": ["./*"]');
    expect(tsconfig).toContain('"react": ["./node_modules/@types/react"]');
    expect(JSON.parse(tsconfig).compilerOptions.paths["@/*"]).toEqual(["./*"]);
  });

  it("keeps comments in a tsconfig it edits", () => {
    // The starter kit's own tsconfig carries comments, so a parse-and-rewrite
    // would silently strip them out of a file the customer owns.
    const commented = `{
  // Extends the shared Next config.
  "compilerOptions": {
    "paths": {
      // Types only.
      "react": ["./node_modules/@types/react"]
    }
  }
}
`;
    enableRegistry(project(commented));
    const tsconfig = read("tsconfig.json");
    expect(tsconfig).toContain("// Extends the shared Next config.");
    expect(tsconfig).toContain("// Types only.");
    expect(tsconfig).toContain('"@/*": ["./*"]');
  });

  it("asks for the alias by hand rather than guessing when there is no paths block", () => {
    const result = enableRegistry(project(`{\n  "compilerOptions": {}\n}\n`));
    expect(result.manual.join(" ")).toMatch(/no `paths` block/);
    expect(read("tsconfig.json")).not.toContain("@/*");
  });

  it("reports a missing tsconfig instead of creating one", () => {
    const result = enableRegistry(project());
    expect(result.manual.join(" ")).toMatch(/tsconfig\.json is missing/);
    expect(existsSync(join(dir, "tsconfig.json"))).toBe(false);
  });

  it("never overwrites files the project already has", () => {
    project(PLAIN_TSCONFIG);
    writeFileSync(join(dir, "components.json"), '{"mine":true}\n');
    mkdirSync(join(dir, "components/puck/blocks"), { recursive: true });
    writeFileSync(join(dir, "components/puck/blocks/index.ts"), "// mine\n");

    const result = enableRegistry(dir);
    // The file is the audience for this command, so it gains the one key the
    // command exists for — and keeps everything else.
    const config = JSON.parse(read("components.json"));
    expect(config.mine).toBe(true);
    expect(config.registries["@p1"]).toBe(REGISTRY_URL);
    expect(read("components/puck/blocks/index.ts")).toBe("// mine\n");
    expect(result.done.join(" ")).toMatch(/components\.json/);
  });

  it("adds @p1 to a components.json that already registers another namespace", () => {
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "components.json"),
      JSON.stringify({ registries: { "@acme": "https://acme.test/r/{name}.json" } }) + "\n",
    );

    enableRegistry(dir);
    const config = JSON.parse(read("components.json"));
    expect(config.registries["@acme"]).toBe("https://acme.test/r/{name}.json");
    expect(config.registries["@p1"]).toBe(REGISTRY_URL);
  });

  // An array takes the property and loses it again on stringify — reporting
  // success over an unchanged file — and a number or string throws outright.
  it.each(["[]", "null", "42", '"str"', '{\n  // mine\n  "style": "default"\n}\n'])(
    "reports components.json %j as a by-hand step instead of writing to it",
    (contents) => {
      project(PLAIN_TSCONFIG);
      writeFileSync(join(dir, "components.json"), contents);

      const result = enableRegistry(dir);
      expect(read("components.json")).toBe(contents);
      expect(result.done.join(" ")).not.toMatch(/components\.json/);
      expect(result.manual.join(" ")).toMatch(/components\.json is not a JSON object/);
      expect(result.manual.join(" ")).toContain(REGISTRY_URL);
    },
  );

  it("leaves the stylesheet an existing components.json names alone", () => {
    project(PLAIN_TSCONFIG);
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app/main.css"), "@import 'tailwindcss';\n");
    writeFileSync(
      join(dir, "components.json"),
      JSON.stringify({ style: "new-york", tailwind: { css: "app/main.css" } }) + "\n",
    );

    const result = enableRegistry(dir);
    // The command did not write this file, so it must not claim it names a
    // stylesheet the project does not use.
    expect(result.manual.join(" ")).not.toMatch(/stylesheet/);
    expect(JSON.parse(read("components.json")).tailwind.css).toBe("app/main.css");
  });

  it("names the stylesheet the project actually has", () => {
    project(PLAIN_TSCONFIG);
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app/globals.css"), "body{}\n");

    const result = enableRegistry(dir);
    expect(JSON.parse(read("components.json")).tailwind.css).toBe("app/globals.css");
    expect(result.manual.join(" ")).not.toMatch(/no stylesheet found/);
  });

  it("reports a manual step when the project has no stylesheet to point at", () => {
    const result = enableRegistry(project(PLAIN_TSCONFIG));
    // Naming a file that is not there is the silent failure: @p1/tokens would
    // write its variables where no layout imports them.
    expect(result.manual.join(" ")).toMatch(/no stylesheet found/);
    expect(JSON.parse(read("components.json")).tailwind.css).toBe("app/styles.css");
  });

  it("reports a write it could not make rather than calling it 'already exists'", () => {
    // The existence checks were replaced by acting and catching EEXIST, so the
    // catch must not swallow a real failure — an unwritable project would
    // otherwise be reported as already configured.
    //
    // The barrel directory is created first on purpose: mkdirSync is recursive
    // and returns without error on a path that exists, so the components.json
    // write is then the only operation that can fail, and the assertion is
    // about the catch rather than about mkdirSync.
    project(PLAIN_TSCONFIG);
    mkdirSync(join(dir, "components/puck/blocks"), { recursive: true });
    chmodSync(dir, 0o500);
    try {
      expect(() => enableRegistry(dir)).toThrow(/EACCES|EPERM/);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("is a no-op on a second run", () => {
    enableRegistry(project(PLAIN_TSCONFIG));
    const after = ["components.json", "tsconfig.json", "components/puck/blocks/index.ts"].map(read);
    const result = enableRegistry(dir);
    expect(["components.json", "tsconfig.json", "components/puck/blocks/index.ts"].map(read)).toEqual(after);
    expect(result.done).toEqual([]);
  });

  it("leaves puck.config.tsx alone and reports whether it is wired", () => {
    project(PLAIN_TSCONFIG);
    const mine = "export const config = { components: { HeadingBlock } } as Config;\n";
    writeFileSync(join(dir, "puck.config.tsx"), mine);
    expect(enableRegistry(dir).puckConfigWired).toBe(false);
    expect(read("puck.config.tsx")).toBe(mine);

    writeFileSync(
      join(dir, "puck.config.tsx"),
      [
        'import { p1Blocks, p1Categories } from "./components/puck/blocks";',
        "export const config = {",
        "  categories: { ...p1Categories },",
        "  components: { ...p1Blocks },",
        "} as Config;",
      ].join("\n"),
    );
    expect(enableRegistry(dir).puckConfigWired).toBe(true);
  });

  it("does not count an import of the barrel as wiring it", () => {
    // The likeliest state in the field is a half-finished edit. Reporting it as
    // wired prints a success line while every installed block stays out of the
    // drawer, which is the one outcome with no error to go on.
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "puck.config.tsx"),
      [
        'import { p1Blocks, p1Categories } from "./components/puck/blocks";',
        "export const config = { components: { HeadingBlock } } as Config;",
      ].join("\n"),
    );
    expect(enableRegistry(dir).puckConfigWired).toBe(false);
  });

  it("does not count one spread on its own as wiring", () => {
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "puck.config.tsx"),
      "export const config = { components: { ...p1Blocks } } as Config;\n",
    );
    expect(enableRegistry(dir).puckConfigWired).toBe(false);
  });

  it("does not count spreads placed after the project's own keys as wiring", () => {
    // The ordering this command, the README and the changeset all warn about.
    // Counting it as wired suppresses that warning for the one project that
    // needs it: later keys win, so a registry category overwrites one of theirs
    // and its blocks vanish from the drawer with no error.
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "puck.config.tsx"),
      [
        'import { p1Blocks, p1Categories } from "./components/puck/blocks";',
        "export const config = {",
        "  categories: {",
        '    myLayout: { title: "Mine", components: ["MyHero"] },',
        "    ...p1Categories,",
        "  },",
        "  components: {",
        "    MyHero: myHeroBlock,",
        "    ...p1Blocks,",
        "  },",
        "} as Config;",
      ].join("\n"),
    );

    const result = enableRegistry(dir);
    expect(result.puckConfigWired).toBe(false);
    expect(result.manual.join(" ")).toMatch(/spreads the barrel after your own keys/);
  });

  it("counts spreads before the project's own keys as wiring", () => {
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "puck.config.tsx"),
      [
        'import { p1Blocks, p1Categories } from "./components/puck/blocks";',
        "export const config = {",
        "  categories: {",
        "    ...p1Categories,",
        '    myLayout: { title: "Mine", components: ["MyHero"] },',
        "  },",
        "  components: {",
        "    ...p1Blocks,",
        "    MyHero: myHeroBlock,",
        "  },",
        "} as Config;",
      ].join("\n"),
    );

    const result = enableRegistry(dir);
    expect(result.puckConfigWired).toBe(true);
    expect(result.manual.join(" ")).not.toMatch(/spreads the barrel after/);
  });

  it("asks for the vitest @/ alias, which tsconfig paths does not give it", () => {
    // The scaffold template carries this alias. A migrated project does not, and
    // a test importing an installed block through @/ then fails to resolve.
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "vitest.config.ts"),
      'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: {} });\n',
    );
    expect(enableRegistry(dir).manual).toContain(VITEST_ALIAS_STEP);
  });

  it("says nothing about vitest when the alias is already there", () => {
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "vitest.config.ts"),
      'export default defineConfig({ resolve: { alias: { "@/": root } }, test: {} });\n',
    );
    expect(enableRegistry(dir).manual).not.toContain(VITEST_ALIAS_STEP);
  });

  it("says nothing about vitest in a project that has no vitest config", () => {
    // Not every P1 project runs tests. An unconditional step is noise there.
    project(PLAIN_TSCONFIG);
    expect(enableRegistry(dir).manual).not.toContain(VITEST_ALIAS_STEP);
  });

  it("reads vite.config.ts too, which a Next project often uses instead", () => {
    project(PLAIN_TSCONFIG);
    writeFileSync(join(dir, "vite.config.ts"), "export default defineConfig({ test: {} });\n");
    expect(enableRegistry(dir).manual).toContain(VITEST_ALIAS_STEP);
  });

  it("sees an alias that follows a template literal containing /*", () => {
    // A backtick string is not a comment either. Without it in the same pass the
    // `/*` inside one opens a span that the next block comment closes, blanking
    // the alias and telling a correctly configured project to add one it has.
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "vitest.config.ts"),
      [
        "const glob = `src/*.tsx`;",
        "export default defineConfig({",
        '  resolve: { alias: { "@/": root } },',
        "  /* keep this */",
        "  test: {},",
        "});",
      ].join("\n"),
    );
    expect(enableRegistry(dir).manual).not.toContain(VITEST_ALIAS_STEP);
  });

  it("does not count an aliased example inside a comment", () => {
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "vitest.config.ts"),
      '// alias: { "@/": root }\nexport default defineConfig({ test: {} });\n',
    );
    expect(enableRegistry(dir).manual).toContain(VITEST_ALIAS_STEP);
  });

  it("does not count a spread inside a comment as wiring", () => {
    project(PLAIN_TSCONFIG);
    writeFileSync(
      join(dir, "puck.config.tsx"),
      [
        "// categories: { ...p1Categories },",
        "// components: { ...p1Blocks },",
        "export const config = { components: { HeadingBlock } } as Config;",
      ].join("\n"),
    );
    expect(enableRegistry(dir).puckConfigWired).toBe(false);
  });
});

describe("the hardcoded registry URL", () => {
  // The SDK cannot read p1-starter-components at runtime — it is private, and
  // the SDK build is two tsc passes with no codegen step. So the URL is a
  // constant, and this holds it against the registry's own manifest.
  it("matches the registry manifest and the scaffolder's stamped copy", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../p1-starter-components/registry.json"), "utf8"),
    );
    const expected = `${String(manifest.homepage).replace(/\/$/, "")}/r/{name}.json`;
    expect(REGISTRY_URL).toBe(expected);
    expect(`@${manifest.name}`).toBe("@p1");
  });

  it("matches what the @p1/base item tells shadcn to use", () => {
    const base = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../p1-starter-components/registry/p1/base/registry.json"),
        "utf8",
      ),
    );
    expect(base.items[0].config.registries["@p1"]).toBe(REGISTRY_URL);
  });
});

describe("agreement with the scaffolder", () => {
  // The scaffolder keeps its own copy on purpose: importing the SDK would put
  // its peer dependencies behind `npx create-p1-starter-kit` in an empty
  // directory. That is the price, so this is the guard — a project wired by
  // this command and one wired by the scaffolder must be configured alike.
  it("writes the same components.json the scaffolder does", async () => {
    const scaffolder = await import(
      /* @vite-ignore */ "../../../create-p1-starter-kit/lib/registry-config.js"
    );
    expect(componentsJson()).toEqual(
      scaffolder.buildComponentsJson({ namespace: "@p1", url: REGISTRY_URL }),
    );
  });
});

describe("addPathAlias", () => {
  it("leaves a tsconfig that already maps @/* untouched", () => {
    const source = `{ "paths": { "@/*": ["./*"] } }`;
    expect(addPathAlias(source)).toEqual({ source, changed: false });
  });

  it("returns null when there is nothing safe to edit", () => {
    expect(addPathAlias(`{ "compilerOptions": {} }`)).toBeNull();
  });

  it("does not mistake a commented-out mapping for a real one", () => {
    // Reading it as already mapped would leave the project unwired and print
    // no guidance, which is worse than either editing or reporting it.
    const source = `{\n  "compilerOptions": {\n    // "@/*": ["./*"],\n    "paths": { "react": ["x"] }\n  }\n}`;
    const result = addPathAlias(source);
    expect(result).not.toBeNull();
    expect(result.changed).toBe(true);
    expect(result.source).toContain('"@/*": ["./*"]');
  });

  it("edits the real paths block when a comment also mentions one", () => {
    // Detection and insertion must share offsets. Taking the position from the
    // original text while detecting on a comment-stripped copy splices the
    // alias into the comment, reports success, and leaves invalid JSON.
    const source = [
      "{",
      '  // was: "paths": { "x": ["./x"] }',
      '  "compilerOptions": {',
      '    "paths": {',
      '      "react": ["y"]',
      "    }",
      "  }",
      "}",
    ].join("\n");

    const result = addPathAlias(source);
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(result.source.replace(/^[ \t]*\/\/.*$/gm, ""));
    expect(parsed.compilerOptions.paths["@/*"]).toEqual(["./*"]);
    expect(parsed.compilerOptions.paths.react).toEqual(["y"]);
    // The comment is left exactly as it was.
    expect(result.source).toContain('// was: "paths": { "x": ["./x"] }');
  });

  // Comments are stripped, trailing commas deliberately are not: tsc tolerates
  // one and JSON.parse does not, and emitting one is the bug these cases exist
  // for. The strip is string-aware, or `"@/*"` opens a comment span of its own.
  const parseTsconfig = (source: string) =>
    JSON.parse(
      source.replace(/"(?:[^"\\\n]|\\.)*"|\/\*[\s\S]*?\*\/|^[ \t]*\/\/[^\n]*/gm, (m) =>
        m[0] === '"' ? m : "",
      ),
    );

  it.each([
    ["an empty block", '{\n  "compilerOptions": {\n    "paths": {}\n  }\n}\n'],
    ["an empty block spread over lines", '{\n  "compilerOptions": {\n    "paths": {\n    }\n  }\n}\n'],
    ["an empty block on one line", '{ "compilerOptions": { "paths": {  } } }'],
    ["a tab-indented empty block", '{\n\t"compilerOptions": {\n\t\t"paths": {}\n\t}\n}\n'],
    [
      "a block holding only a comment",
      '{\n  "compilerOptions": {\n    "paths": {\n      // none yet\n    }\n  }\n}\n',
    ],
    [
      "an empty block with a comment after it",
      '{\n  "compilerOptions": {\n    "paths": {}\n  }\n  /* keep */\n}\n',
    ],
    ["an existing entry", '{\n  "compilerOptions": {\n    "paths": {\n      "react": ["y"]\n    }\n  }\n}\n'],
  ])("still parses after adding the alias to %s", (_label, source) => {
    // `"paths": {}` is what `tsc --init` leaves behind, so this is the common
    // case, not the exotic one. Splicing an entry in front of the closing brace
    // left `["./*"],}` and every later reader of the file threw.
    const result = addPathAlias(source);
    expect(result.changed).toBe(true);
    expect(parseTsconfig(result.source).compilerOptions.paths["@/*"]).toEqual(["./*"]);
    // And a second run must still be a no-op on what the first one wrote.
    expect(addPathAlias(result.source).changed).toBe(false);
  });

  it("keeps a comment that is the only thing in the paths block", () => {
    const source = '{\n  "compilerOptions": {\n    "paths": {\n      // none yet\n    }\n  }\n}\n';
    expect(addPathAlias(source).source).toContain("// none yet");
  });

  it("returns null when only a commented-out paths block exists", () => {
    expect(addPathAlias(`{\n  // "paths": { "a": ["b"] }\n}`)).toBeNull();
  });

  it("sees an existing mapping in a tsconfig that also has a block comment", () => {
    // `"@/*"` contains `/*`. Treated as the start of a comment, the span runs to
    // the next `*/` anywhere in the file and hides the mapping already there.
    const source = [
      "{",
      '  "compilerOptions": {',
      '    "paths": {',
      '      "@/*": ["./src/*"]',
      "    }",
      "  }",
      "  /* keep this comment */",
      "}",
    ].join("\n");

    expect(addPathAlias(source)).toEqual({ source, changed: false });
  });

  it("adds the mapping exactly once however many times it runs", () => {
    const source = [
      "{",
      '  "compilerOptions": {',
      '    "paths": {',
      '      "react": ["y"]',
      "    }",
      "  }",
      "  /* keep this comment */",
      "}",
    ].join("\n");

    const first = addPathAlias(source);
    expect(first.changed).toBe(true);
    expect(addPathAlias(first.source)).toEqual({ source: first.source, changed: false });
    expect(first.source.match(/"@\/\*"/g)).toHaveLength(1);
  });
});

describe("parseArgs", () => {
  it("defaults to the working directory", () => {
    expect(parseArgs([]).dir).toBe(process.cwd());
  });

  it("takes one directory", () => {
    expect(parseArgs(["some/app"]).dir).toBe(join(process.cwd(), "some/app"));
  });

  it("refuses a second directory and an unknown flag", () => {
    expect(() => parseArgs(["a", "b"])).toThrow(/at most one directory/);
    expect(() => parseArgs(["--wat"])).toThrow(/unrecognized option/);
  });

  it("recognizes help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});
