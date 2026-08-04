import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        // Rendering any PDS component pulls in the package's `dist/index.css`, which
        // Node cannot load as ESM. Inlining routes it through Vite, which understands
        // CSS imports (and no-ops them under happy-dom).
        inline: ['@pantheon-systems/pds-toolkit-react'],
      },
    },
  },
});
