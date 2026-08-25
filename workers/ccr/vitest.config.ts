import { fileURLToPath } from 'node:url';
import { defineConfig, Plugin } from 'vitest/config';

const yamlRawPlugin: Plugin = {
  name: 'yaml-raw',
  transform(code, id) {
    if ((id.endsWith('.yaml') || id.endsWith('.yml')) && !id.includes('node_modules')) {
      return `export default ${JSON.stringify(code)};`;
    }
  },
};

export default defineConfig({
  plugins: [yamlRawPlugin],
  test: {
    // Test file patterns
    // Exclude integration tests by default (run with: npm run test:integration)
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/integration/**', 'tests/db/**'],

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
      // Stub Cloudflare Workers-specific packages: these tests run in Node,
      // where cloudflare: protocol imports do not resolve. The integration
      // config runs in Node too and needs the same aliases.
      '@cloudflare/workers-oauth-provider': fileURLToPath(
        new URL('tests/stubs/workers-oauth-provider.ts', import.meta.url),
      ),
      'cloudflare:workers': fileURLToPath(
        new URL('tests/stubs/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
});
