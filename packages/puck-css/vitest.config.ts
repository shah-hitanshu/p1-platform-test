import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts', './src/__tests__/setup.ts'],
  },
});
