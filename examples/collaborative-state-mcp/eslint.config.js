import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import testsConfig from '@pantheon-systems/eslint-config/tests';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  ...testsConfig,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
);
