import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@pantheon-systems/pds-toolkit-react': resolve(
        __dirname,
        'src/__mocks__/@pantheon-systems/pds-toolkit-react.ts'
      ),
      '@puckeditor/core': resolve(
        __dirname,
        'src/__mocks__/@puckeditor/core.ts'
      ),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts', './src/__tests__/setup.ts'],
  },
});
