import baseConfig from './base.js';
import prettierConfig from './prettier.js';
import testsConfig from './tests.js';

export default [...baseConfig, ...prettierConfig, ...testsConfig];
