import baseConfig from '@pantheon-systems/eslint-config/base';
import prettierConfig from '@pantheon-systems/eslint-config/prettier';
import testsConfig from '@pantheon-systems/eslint-config/tests';

export default [
  ...baseConfig,
  ...prettierConfig,
  ...testsConfig,
  {
    // This package already lives under the rule it exists to make possible; the repo-wide
    // flip lands separately. The only sanctioned `console` calls are inside the console
    // sink and the log sink's own transport-failure warning, each individually disabled.
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
];
