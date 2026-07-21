import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs'],
    plugins: { import: importPlugin },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-var-requires': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Import rules
      'import/extensions': 'off',
      'import/prefer-default-export': 'off',
      'import/no-unresolved': 'off',
      'import/order': 'warn',
      'import/no-extraneous-dependencies': 'warn',

      // General ESLint rules
      'no-console': 'off',
      'no-debugger': 'error',
      'lines-between-class-members': 'off',
      camelcase: 'off',
      'no-undef': 'off',
      'no-underscore-dangle': 'off',
      'no-unused-vars': 'off',
      'no-use-before-define': 'off',
      'no-redeclare': 'off',
      'no-restricted-syntax': 'off',
      'no-shadow': 'off',
      'no-else-return': 'off',
      'operator-linebreak': 'off',
      'no-plusplus': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/entrypoint',
              message:
                'Do not import from the entrypoint within source files. Import directly from the module instead.',
            },
          ],
        },
      ],

      // Stricter rules (warn to resolve over time)
      '@typescript-eslint/consistent-generic-constructors': 'warn',
      '@typescript-eslint/consistent-indexed-object-style': 'warn',
      '@typescript-eslint/no-shadow': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'no-async-promise-executor': 'warn',
      '@typescript-eslint/consistent-type-definitions': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-catch': 'warn',
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'prefer-const': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-wrapper-object-types': 'warn',
      'no-constant-binary-expression': 'warn',
      '@typescript-eslint/array-type': 'warn',
      '@typescript-eslint/prefer-for-of': 'warn',
      '@typescript-eslint/no-redeclare': 'warn',
      'no-case-declarations': 'warn',
      'no-empty': 'warn',
      '@typescript-eslint/no-dynamic-delete': 'warn',
      'no-constant-condition': 'warn',
      'no-empty-pattern': 'warn',
      'no-var': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/no-extraneous-class': 'warn',
      '@typescript-eslint/unified-signatures': 'warn',
      '@typescript-eslint/no-invalid-void-type': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    languageOptions: {
      globals: {
        jest: true,
      },
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.next/**',
      'coverage/**',
      '**/*.d.ts',
      '**/generated/**',
      '**/.puppeteerrc.cjs',
    ],
  },
);
