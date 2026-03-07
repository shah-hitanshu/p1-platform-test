import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useRemoteBackend = !!env.VITE_API_BASE_URL;

  return {
    plugins: [react()],
    optimizeDeps: {
      // Force pre-bundling of design-toolkit-react and its problematic dependencies
      // This transforms JSX in .js files during the dependency optimization phase
      include: ['@pantheon-systems/design-toolkit-react', 'react-csv'],
      esbuildOptions: {
        // Allow JSX in .js files for packages that don't properly transpile
        loader: {
          '.js': 'jsx',
        },
      },
    },
    build: {
      rollupOptions: {
        // Externalize react-csv as we don't use CSV export functionality
        external: ['react-csv'],
      },
    },
    server: {
      port: 5173,
      // Only proxy when using local backend (no VITE_API_BASE_URL set)
      proxy: useRemoteBackend ? undefined : {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
  };
});
