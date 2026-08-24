import reactConfig from '@pantheon-systems/eslint-config/react';
import prettierConfig from '@pantheon-systems/eslint-config/prettier';
import testsConfig from '@pantheon-systems/eslint-config/tests';

export default [...reactConfig, ...prettierConfig, ...testsConfig];
