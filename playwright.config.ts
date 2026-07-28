import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'p1-starter',
      testMatch: /p1-starter\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3001',
      },
    },
    {
      name: 'p1-editor',
      testMatch: /p1-editor\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3001',
      },
    },
  ],

  webServer: [
    {
      command: 'npx tsx e2e/mock-p1-server.ts',
      url: 'http://localhost:4444/api/sites/test-site/branches',
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: {
        MOCK_CSS_PORT: '4444',
      },
    },
    {
      command: 'cd apps/p1-starter && pnpm next dev --port 3001',
      url: 'http://localhost:3001',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_CSS_BASE_URL: 'http://localhost:4444',
        NEXT_PUBLIC_CSS_SITE_ID: 'test-site',
        CSS_API_KEY: 'test-api-key',
        // Editor specs sign in against the mock server's /api/auth/* routes.
        NEXT_PUBLIC_CSS_AUTH_MODE: 'mock',
        // The mock server speaks HTTP only — no websocket for Yjs sync or presence.
        NEXT_PUBLIC_CSS_ENABLE_REALTIME: 'false',
        NEXT_PUBLIC_CSS_ENABLE_PRESENCE: 'false',
      },
    },
  ],
});
