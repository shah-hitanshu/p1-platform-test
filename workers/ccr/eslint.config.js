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
    ignores: ['node_modules/**', 'dist/**', '**/*.js'],
  },
];
