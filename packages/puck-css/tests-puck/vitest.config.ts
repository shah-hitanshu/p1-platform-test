/**
 * Tests that need real Puck.
 *
 * The package's main vitest config aliases `@puckeditor/core` to a hand-written
 * stub (`src/__mocks__/@puckeditor/core.ts`) with no store and no fields slice.
 * Anything asserting Puck's own behaviour — what reaches the persisted snapshot,
 * how fields resolve — has to run without that alias, so it lives here and is
 * wired into the package's `test` script.
 */
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@pantheon-systems/pds-toolkit-react': resolve(
        __dirname,
        '../src/__mocks__/@pantheon-systems/pds-toolkit-react.ts'
      ),
    },
  },
  test: {
    include: ['*.test.tsx'],
    root: __dirname,
    environment: 'jsdom',
    globals: false,
    setupFiles: [resolve(__dirname, '../tests/setup.ts')],
  },
});
