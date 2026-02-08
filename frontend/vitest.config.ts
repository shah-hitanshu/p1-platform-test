import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/__tests__/**/*.spec.ts', 'src/__tests__/**/*.spec.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/__tests__/setup.ts'],
    css: true,
    testTimeout: 10000,
    reporters: ['default'],
  },
});
