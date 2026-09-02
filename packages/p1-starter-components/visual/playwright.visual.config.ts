import { defineConfig, devices } from '@playwright/test';

// Local-only visual gate for the phase-2 Tailwind removal (PCC-3580).
// Baselines are machine-specific and gitignored — regenerate with
// `test:visual:update` before starting a conversion task.
export default defineConfig({
  testDir: '.',
  testMatch: 'stories.spec.ts',
  snapshotDir: './baselines',
  outputDir: './results',
  fullyParallel: true,
  reporter: [['list'], ['html', { outputFolder: './report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:6099',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'pnpm exec http-server ../storybook-static -p 6099 --silent',
    url: 'http://127.0.0.1:6099/iframe.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
