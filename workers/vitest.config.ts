import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],

    // Environment
    environment: 'node',

    // Global test APIs (describe, it, expect)
    globals: false,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    },

    // TypeScript support
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },

    // Test timeout
    testTimeout: 10000,

    // Reporter for console output
    reporters: ['default'],
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
