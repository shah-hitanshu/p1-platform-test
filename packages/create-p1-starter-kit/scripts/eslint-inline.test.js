import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import {
  readPresetImports,
  collectPresets,
  inlinePresets,
  validateConfig,
} from './eslint-inline.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslintConfigDir = path.join(repoRoot, 'packages/eslint-config');
const readRealPreset = (name) => fs.readFileSync(path.join(eslintConfigDir, `${name}.js`), 'utf-8');

const fakePresets = {
  base: [
    "import eslint from '@eslint/js';",
    "import tseslint from 'typescript-eslint';",
    '',
    'export default tseslint.config(',
    '  eslint.configs.recommended,',
    '  { rules: { "no-debugger": "error" } },',
    ');',
    '',
  ].join('\n'),
  react: [
    "import react from 'eslint-plugin-react';",
    "import baseConfig from './base.js';",
    '',
    'export default [',
    '  ...baseConfig,',
    '  { plugins: { react } },',
    '];',
    '',
  ].join('\n'),
  tests: [
    'export const TEST_FILES = [',
    "  '**/*.test.ts',",
    '];',
    '',
    'export default [',
    '  { files: TEST_FILES, rules: { "no-console": "off" } },',
    '];',
    '',
  ].join('\n'),
};

const appConfigWith = (imports, spread) =>
  `${imports.join('\n')}\n\nexport default [${spread.join(', ')}];\n`;

describe('readPresetImports', () => {
  const imports = [
    "import reactConfig from '@pantheon-systems/eslint-config/react';",
    "import prettierConfig from '@pantheon-systems/eslint-config/prettier';",
    "import testsConfig from '@pantheon-systems/eslint-config/tests';",
  ];
  const spread = ['...reactConfig', '...prettierConfig', '...testsConfig'];

  it('reads the preset list from the app config instead of a hardcoded list', () => {
    expect(readPresetImports(appConfigWith(imports, spread))).toEqual([
      'react',
      'prettier',
      'tests',
    ]);
  });

  // ESLint takes precedence from the spread. Reading import order let a reorder
  // that changes nothing about how the app lints put `tests` first in the
  // scaffold, where base/react then override the test relaxations.
  it('takes order from the spread, not the import lines', () => {
    const reordered = [imports[2], imports[0], imports[1]];

    expect(readPresetImports(appConfigWith(reordered, spread))).toEqual([
      'react',
      'prettier',
      'tests',
    ]);
  });

  it('refuses a preset that is imported but never spread', () => {
    const config = appConfigWith(imports, ['...reactConfig', '...prettierConfig']);

    expect(() => readPresetImports(config)).toThrow(/never spreads it/);
  });

  it('ignores imports that are not shared presets', () => {
    const appConfig = appConfigWith(
      ["import globals from 'globals';", "import local from './local.js';"],
      ['...local']
    );

    expect(readPresetImports(appConfig)).toEqual([]);
  });

  it('finds every preset the real starter app composes', () => {
    const appConfig = fs.readFileSync(path.join(repoRoot, 'apps/p1-starter/eslint.config.js'), 'utf-8');

    expect(readPresetImports(appConfig)).toContain('tests');
  });
});

describe('collectPresets', () => {
  it('emits a preset after the sibling it spreads', () => {
    const collected = collectPresets(['react'], (name) => fakePresets[name]);

    expect(collected.map((p) => p.name)).toEqual(['base', 'react']);
  });

  it('visits each preset once even when several depend on it', () => {
    const presets = { ...fakePresets, extra: fakePresets.react };
    const collected = collectPresets(['react', 'extra'], (name) => presets[name]);

    expect(collected.map((p) => p.name)).toEqual(['base', 'react', 'extra']);
  });
});

describe('inlinePresets', () => {
  const inline = (names) => inlinePresets(collectPresets(names, (name) => fakePresets[name]));

  it('drops the sibling spread so base is not duplicated', () => {
    const config = inline(['react']);

    expect(config).not.toContain('...baseConfig');
    expect(config).toContain('eslint.configs.recommended');
  });

  it('keeps only external imports, deduplicated', () => {
    const config = inline(['react']);

    expect(config).toContain("import react from 'eslint-plugin-react';");
    expect(config).not.toContain("from './base.js'");
  });

  it('hoists a named export the default export references', () => {
    const config = inline(['tests']);

    expect(config).toContain('const TEST_FILES = [');
    expect(config).not.toContain('export const TEST_FILES');
    expect(config.indexOf('const TEST_FILES')).toBeLessThan(config.indexOf('export default'));
  });

  it('labels each section so a missing preset is detectable', () => {
    expect(inline(['react'])).toContain('// @pantheon-systems/eslint-config/base');
  });

  it('refuses a default export shape it does not understand', () => {
    const presets = { odd: 'export default someFactory();' };

    expect(() => inlinePresets(collectPresets(['odd'], (name) => presets[name]))).toThrow(
      /shape this inliner does not understand/
    );
  });

  // Each of these produced a green build and a green suite, then a config that
  // died on the scaffolded project's first `npm run lint`.
  it('refuses an import shape it cannot parse rather than shipping it verbatim', () => {
    const presets = {
      next: "import { GLOBS } from './globs.js';\n\nexport default [\n  { files: GLOBS },\n];",
    };

    expect(() => inlinePresets(collectPresets(['next'], (name) => presets[name]))).toThrow(
      /cannot parse/
    );
  });

  it('strips a sibling spread that shares its line with other entries', () => {
    const presets = {
      base: 'export default tseslint.config(\n  eslint.configs.recommended,\n);',
      compact: "import baseConfig from './base.js';\n\nexport default [...baseConfig, { files: ['x'] }];",
    };

    const config = inlinePresets(collectPresets(['compact'], (name) => presets[name]));

    expect(config).not.toContain('...baseConfig');
    expect(config).toContain('eslint.configs.recommended');
  });

  it('refuses a preset with no default export', () => {
    const presets = { odd: 'export const RULES = {};' };

    expect(() => inlinePresets(collectPresets(['odd'], (name) => presets[name]))).toThrow(
      /no default export/
    );
  });
});

describe('validateConfig', () => {
  const valid = [
    "import eslint from '@eslint/js';",
    "import tseslint from 'typescript-eslint';",
    '',
    'export default tseslint.config(',
    '  // @pantheon-systems/eslint-config/base',
    '  {},',
    ');',
  ].join('\n');

  it('passes a config that inlined every required preset', () => {
    expect(() => validateConfig(valid, ['base'])).not.toThrow();
  });

  it('fails loudly when the app gained a preset the inliner did not emit', () => {
    expect(() => validateConfig(valid, ['base', 'tests'])).toThrow(
      /preset "tests" is imported by the app config but was not inlined/
    );
  });

  it('fails on double commas from a bad unwrap', () => {
    expect(() => validateConfig(valid.replace('{},', '{},,'), ['base'])).toThrow(/double commas/);
  });

  it('fails on a relative import, which resolves to nothing in a scaffold', () => {
    const withSibling = valid.replace(
      "import eslint from '@eslint/js';",
      "import eslint from '@eslint/js';\nimport globs from './globs.js';"
    );

    expect(() => validateConfig(withSibling, ['base'])).toThrow(/will not exist in a scaffolded/);
  });
});

describe('the real shared presets', () => {
  const appConfig = fs.readFileSync(path.join(repoRoot, 'apps/p1-starter/eslint.config.js'), 'utf-8');
  const requested = readPresetImports(appConfig);
  const config = validateConfig(
    inlinePresets(collectPresets(requested, readRealPreset)),
    requested
  );

  it('produces a module Node can parse', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eslint-inline-'));
    const file = path.join(dir, 'eslint.config.mjs');
    fs.writeFileSync(file, config);

    expect(() => execFileSync(process.execPath, ['--check', file])).not.toThrow();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('carries the test-file relaxations into the flattened config', () => {
    expect(config).toContain("'@typescript-eslint/no-non-null-assertion': 'off'");
    expect(config).toContain('files: TEST_FILES');
  });

  it('keeps the base rules that the test layer is meant to override', () => {
    expect(config).toContain("'@typescript-eslint/no-non-null-assertion': 'error'");
    expect(config.lastIndexOf("'@typescript-eslint/no-non-null-assertion': 'off'")).toBeGreaterThan(
      config.indexOf("'@typescript-eslint/no-non-null-assertion': 'error'")
    );
  });

  it('inlines base exactly once even though react spreads it', () => {
    expect(config.match(/(?<!ts)eslint\.configs\.recommended/g)).toHaveLength(1);
  });
});
