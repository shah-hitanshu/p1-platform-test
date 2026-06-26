import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for database schema tests.
 * Run with: vitest run --config vitest.db.config.ts
 *
 * Prerequisites:
 * - PostgreSQL running: make docker-up
 * - Migrations applied: npm run db:migrate
 */
export default defineConfig({
  test: {
    // Only include database tests
    include: ['tests/db/**/*.spec.ts', 'tests/db/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],

    // Environment
    environment: 'node',

    // Global test APIs (describe, it, expect)
    globals: false,

    // Test timeout - longer for database operations
    testTimeout: 30000,

    // Reporter for console output
    reporters: ['verbose'],

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
