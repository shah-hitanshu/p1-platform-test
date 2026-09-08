import type { Plugin } from 'vitest/config';
import { defineConfig } from 'vitest/config';

// Mirrors wrangler's Text module rule (wrangler.jsonc) for docs/openapi.yaml —
// Vite's own transform pipeline has no built-in loader for .yaml imports.
const yamlRawPlugin: Plugin = {
  name: 'yaml-raw',
  transform(code, id) {
    if (id.endsWith('.yaml') && !id.includes('node_modules')) {
      return `export default ${JSON.stringify(code)};`;
    }
  },
};

export default defineConfig({
  plugins: [yamlRawPlugin],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    alias: {
      // Tests run in Node, where cloudflare: protocol imports do not resolve.
      'cloudflare:workers': new URL('./src/__tests__/stubs/cloudflare-workers.ts', import.meta.url)
        .pathname,
    },
  },
});
