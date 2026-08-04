/**
 * PCC-3406 Phase 0 spike config.
 *
 * Deliberately omits the `@puckeditor/core` alias from the package's main
 * vitest config — that alias points at a hand-written stub, so a test using it
 * can tell us nothing about real resolveFields behaviour.
 */
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@pantheon-systems/pds-toolkit-react': resolve(
        __dirname,
        '../../src/__mocks__/@pantheon-systems/pds-toolkit-react.ts'
      ),
    },
  },
  test: {
    include: ['*.spike.test.tsx'],
    root: __dirname,
    environment: 'jsdom',
    globals: false,
    setupFiles: [resolve(__dirname, '../../tests-puck/setup.ts')],
  },
});
