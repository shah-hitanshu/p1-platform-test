import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/__tests__/**/*.spec.ts', 'src/__tests__/**/*.spec.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/__tests__/setup.ts'],
    css: false,
    testTimeout: 10000,
    reporters: ['default'],
    server: {
      deps: {
        // Force pds-toolkit-react through Vitest's transform pipeline
        // so that css:false can stub the package's internal CSS side-effect imports
        inline: ['@pantheon-systems/pds-toolkit-react'],
      },
    },
  },
});
