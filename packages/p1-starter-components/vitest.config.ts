import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: { '@/registry': path.join(dirname, 'registry') },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['registry/**/*.test.{ts,tsx}'],
        },
      },
      {
        // Renders every story in headless Chromium. Not part of the default
        // `test` task: CI's `verify` job installs no browsers, and adding a
        // Playwright download to it would slow every run in the repo. The
        // storybook job in ci.yml runs this instead.
        extends: true,
        plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
