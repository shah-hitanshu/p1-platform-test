/**
 * Flattens the shared @pantheon-systems/eslint-config presets into one
 * self-contained flat config, so a scaffolded project lints exactly like
 * apps/p1-starter without depending on a private workspace package.
 *
 * The preset list is read from the app's own config rather than hardcoded, so
 * adding a preset there carries it into scaffolds instead of silently dropping it.
 */

const IMPORT_LINE = /^import\s+(\w+)\s+from\s+'([^']+)';$/gm;
const PRESET_SPECIFIER = /^@pantheon-systems\/eslint-config\/(\w+)$/;

function parseImports(source) {
  return [...source.matchAll(IMPORT_LINE)].map(([, binding, specifier]) => ({ binding, specifier }));
}

function stripImports(source) {
  return source.replace(IMPORT_LINE, '');
}

/**
 * Order comes from the spread in `export default [...]`, not from the import
 * lines. ESLint takes precedence from the spread, so reading import order would
 * let a reorder that changes nothing about how the app lints silently change
 * which preset wins in the scaffold.
 */
export function readPresetImports(appConfigSource) {
  const byBinding = new Map();
  for (const { binding, specifier } of parseImports(appConfigSource)) {
    const match = PRESET_SPECIFIER.exec(specifier);
    if (match) {
      byBinding.set(binding, match[1]);
    }
  }

  const defaultExport = /^export default\s+([\s\S]*)$/m.exec(appConfigSource);
  if (!defaultExport) {
    throw new Error('App eslint config has no default export to read preset order from');
  }

  const spread = [...defaultExport[1].matchAll(/\.\.\.(\w+)/g)].map((m) => m[1]);
  const ordered = spread.map((binding) => byBinding.get(binding)).filter(Boolean);

  const unspread = [...byBinding].filter(([binding]) => !spread.includes(binding));
  if (unspread.length > 0) {
    throw new Error(
      `App eslint config imports ${unspread.map(([, name]) => name).join(', ')} but never ` +
      'spreads it into the default export, so its position is undefined. Spread it or drop the import.'
    );
  }

  return ordered;
}

/**
 * Depth-first over each preset's relative imports so a preset that spreads a
 * sibling (react.js spreads base.js) is emitted after the sibling it needs.
 */
export function collectPresets(presetNames, readPreset) {
  const ordered = [];
  const seen = new Set();

  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);

    const source = readPreset(name);
    for (const { specifier } of parseImports(source)) {
      if (specifier.startsWith('.')) {
        visit(specifier.replace(/^.*\//, '').replace(/\.js$/, ''));
      }
    }
    ordered.push({ name, source });
  }

  presetNames.forEach(visit);
  return ordered;
}

/**
 * An import shape IMPORT_LINE misses is neither stripped nor followed, so its
 * specifier ships verbatim into a config whose siblings do not exist in the
 * scaffold. Fail the build instead.
 */
function assertEveryImportParsed(name, source) {
  const statements = (source.match(/^import\b/gm) || []).length;
  const parsed = [...source.matchAll(IMPORT_LINE)].length;

  if (statements !== parsed) {
    throw new Error(
      `${name}.js has ${statements - parsed} import statement(s) this inliner cannot parse ` +
      '(only `import <ident> from \'<specifier>\';` on one line is supported). ' +
      'Rewrite them in that form, or teach IMPORT_LINE the new shape.'
    );
  }
}

function unwrapDefaultExport(name, expression, siblingBindings) {
  let body = expression.trim();

  if (body.startsWith('tseslint.config(')) {
    body = body.slice('tseslint.config('.length).replace(/\)\s*;?\s*$/, '');
  } else if (body.startsWith('[')) {
    body = body.slice(1).replace(/\]\s*;?\s*$/, '');
  } else {
    throw new Error(
      `${name}.js exports a shape this inliner does not understand. ` +
      'Expected `export default tseslint.config(...)` or `export default [...]`.'
    );
  }

  // Siblings are inlined as their own section, so their spreads would duplicate
  // them. Unanchored: a preset short enough for the formatter to keep on one line
  // puts the spread mid-line, where a line-anchored pattern would miss it.
  for (const binding of siblingBindings) {
    body = body.replace(new RegExp(`[ \\t]*\\.\\.\\.${binding}\\s*,?`, 'g'), '');
  }

  return body.trim().replace(/,$/, '');
}

export function inlinePresets(presets) {
  const externalImports = new Map();
  const declarations = [];
  const sections = [];

  const allSiblingBindings = new Set();

  for (const { name, source } of presets) {
    assertEveryImportParsed(name, source);
    const siblingBindings = new Set();
    for (const { binding, specifier } of parseImports(source)) {
      if (specifier.startsWith('.')) {
        siblingBindings.add(binding);
        allSiblingBindings.add(binding);
      } else {
        externalImports.set(specifier, binding);
      }
    }

    const defaultExport = /^export default\s+/m.exec(source);
    if (!defaultExport) {
      throw new Error(`${name}.js has no default export to inline`);
    }

    const preamble = stripImports(source.slice(0, defaultExport.index)).trim();
    if (preamble) {
      declarations.push(preamble.replace(/^export\s+/gm, ''));
    }

    const entries = unwrapDefaultExport(
      name,
      source.slice(defaultExport.index + defaultExport[0].length),
      siblingBindings
    );
    sections.push(`  // @pantheon-systems/eslint-config/${name}\n  ${entries},`);
  }

  const imports = [...externalImports]
    .map(([specifier, binding]) => `import ${binding} from '${specifier}';`)
    .join('\n');

  const config = [
    imports,
    ...declarations,
    `export default tseslint.config(\n${sections.join('\n')}\n);`,
  ].join('\n\n') + '\n';

  // Checks the transformation actually happened rather than that a particular
  // regex matched — a sibling binding left in the output is an undefined
  // identifier that throws on the scaffold's first lint run.
  const leaked = [...allSiblingBindings].filter((binding) =>
    new RegExp(`\\.\\.\\.${binding}\\b`).test(config)
  );
  if (leaked.length > 0) {
    throw new Error(
      `Sibling preset spread(s) survived inlining: ${leaked.map((b) => `...${b}`).join(', ')}. ` +
      'They reference bindings that do not exist in the generated config.'
    );
  }

  return config;
}

export function validateConfig(config, requiredPresets) {
  const errors = [];

  if (!config.includes('export default tseslint.config(')) {
    errors.push('missing export default tseslint.config(');
  }
  if (!config.includes("import tseslint from 'typescript-eslint'")) {
    errors.push('missing typescript-eslint import');
  }
  if (!config.includes("import eslint from '@eslint/js'")) {
    errors.push('missing @eslint/js import');
  }
  if (/,,/.test(config)) {
    errors.push('contains double commas (,,)');
  }
  // Relative specifiers resolve to monorepo siblings that the scaffold does not have.
  for (const [, specifier] of config.matchAll(/^import\b[^\n]*?from\s+'(\.[^']*)'/gm)) {
    errors.push(`imports '${specifier}', which will not exist in a scaffolded project`);
  }
  for (const preset of requiredPresets) {
    if (!config.includes(`// @pantheon-systems/eslint-config/${preset}`)) {
      errors.push(`preset "${preset}" is imported by the app config but was not inlined`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Generated eslint.config.js failed validation:\n  - ${errors.join('\n  - ')}\n` +
      'The shared eslint-config source format may have changed. Update eslint-inline.js accordingly.'
    );
  }

  return config;
}
