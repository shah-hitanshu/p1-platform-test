import base from './base.js';

export { default as base } from './base.js';
export { default as react } from './react.js';
export { default as prettier } from './prettier.js';

// Default export preserved for consumers that `import config from '@pantheon-systems/eslint-config'`
// (the collaborative-state-system convention before the monorepo merge).
export default base;
