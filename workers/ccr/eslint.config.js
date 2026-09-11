import { createWorkerConfig } from '@pantheon-systems/eslint-config/worker';
import testsConfig from '@pantheon-systems/eslint-config/tests';

export default [
  ...createWorkerConfig({
    project: './tsconfig.eslint.json',
    tsconfigRootDir: import.meta.dirname,
    restrictWorkersTypes: true,
  }),
  ...testsConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportSpecifier[imported.name='installDatabase']",
          message:
            'installDatabase is the test fallback for db(). Production code opens a scope with runWithConnection.',
        },
      ],
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '**/*.js'],
  },
];
