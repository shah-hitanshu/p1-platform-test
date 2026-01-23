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

    // Run tests sequentially to avoid database conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
