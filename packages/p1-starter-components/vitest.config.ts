import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
