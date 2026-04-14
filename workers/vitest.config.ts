import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    // Exclude integration tests by default (run with: npm run test:integration)
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/integration/**'],

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
      // Stub Cloudflare Workers-specific package for Node-based unit tests.
      // The real package uses cloudflare: protocol imports unavailable in Node.
      // Integration tests (vitest.integration.config.ts) use the real module via
      // @cloudflare/vitest-pool-workers which provides the CF runtime.
      '@cloudflare/workers-oauth-provider': new URL(
        'tests/stubs/workers-oauth-provider.ts',
        import.meta.url,
      ).pathname,
    },
  },
});
