import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Type-aware config for Cloudflare Workers packages.
 *
 * Stricter than `base` on purpose: workers run untrusted input at the edge, so
 * they carry the full `strictTypeChecked` preset rather than the non-type-aware
 * `recommended` + `strict` that library packages use.
 *
 * @param {object} options
 * @param {string} options.project        tsconfig used for type-aware rules
 * @param {string} options.tsconfigRootDir  usually `import.meta.dirname`
 * @param {boolean} [options.restrictWorkersTypes]  ban importing @cloudflare/workers-types
 */
export function createWorkerConfig({ project, tsconfigRootDir, restrictWorkersTypes = false }) {
  return tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: { ...globals.node, ...globals.worker },
        parserOptions: { project, tsconfigRootDir },
      },
      rules: {
        // Google JavaScript Style Guide adaptations. These are formatting rules
        // living in the linter, which is the wrong home for them — they move to
        // the formatter once one is adopted. Until then they are the only thing
        // holding these two packages to a consistent shape.
        indent: ['error', 2, { SwitchCase: 1 }],
        'linebreak-style': ['error', 'unix'],
        quotes: ['error', 'single', { avoidEscape: true }],
        semi: ['error', 'always'],
        'comma-dangle': ['error', 'always-multiline'],
        'no-trailing-spaces': 'error',
        'eol-last': ['error', 'always'],
        'max-len': ['error', { code: 120, ignoreUrls: true, ignoreStrings: true }],

        // Comes in via stylisticTypeChecked. Off for the same reason as in base:
        // autofixing a type alias to an interface silently breaks assignability
        // to Record<string, unknown>.
        '@typescript-eslint/consistent-type-definitions': 'off',

        '@typescript-eslint/explicit-function-return-type': 'error',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/prefer-nullish-coalescing': 'error',
        '@typescript-eslint/prefer-optional-chain': 'error',
        '@typescript-eslint/strict-boolean-expressions': 'error',
        '@typescript-eslint/no-floating-promises': 'error',

        // Workers hand void-returning callbacks to event APIs constantly.
        '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],

        ...(restrictWorkersTypes
          ? {
              // Importing from @cloudflare/workers-types loads its 15k-line index.ts
              // source as a second copy of the entire Workers type universe, which
              // tsserver/tsc must structurally compare against the ambient globals —
              // hanging type checking for minutes. The types are already global via
              // the tsconfig "types" array; use them without importing.
              'no-restricted-imports': [
                'error',
                {
                  paths: [
                    {
                      name: '@cloudflare/workers-types',
                      message:
                        'These types are ambient globals (tsconfig "types"). Importing this package loads a duplicate 15k-line type universe and hangs tsserver/tsc. Use the global types directly.',
                    },
                  ],
                },
              ],
            }
          : {}),
      },
    }
  );
}

export default createWorkerConfig;
