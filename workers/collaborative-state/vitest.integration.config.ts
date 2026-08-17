import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for integration tests.
 * Run with: npm run test:integration
 *
 * Prerequisites:
 * - PostgreSQL running: make docker-up
 * - Migrations applied: npm run db:migrate
 */
export default defineConfig({
  test: {
    // Only include integration tests
    include: ['tests/integration/**/*.spec.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],

    // Environment
    environment: 'node',

    // Global test APIs (describe, it, expect)
    globals: false,

    // Test timeout - longer for database operations
    testTimeout: 30000,

    // Reporter for console output
    reporters: ['default'],

    // Integration suites share one database, so no two test files may run at once:
    // fileParallelism: false pins the run to a single worker.
    pool: 'forks',
    fileParallelism: false,
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': './src',
      // These run in Node, not the Workers runtime, so cloudflare: imports do
      // not resolve. Reached transitively via the publish services, which
      // purge the edge cache.
      'cloudflare:workers': fileURLToPath(
        new URL('tests/stubs/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
});
