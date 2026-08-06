import baseConfig from '@pantheon-systems/eslint-config/base';
import prettierConfig from '@pantheon-systems/eslint-config/prettier';
import testsConfig from '@pantheon-systems/eslint-config/tests';

export default [...baseConfig, ...prettierConfig, ...testsConfig];
