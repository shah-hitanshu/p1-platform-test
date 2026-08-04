import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const cloudflareRuntime = fileURLToPath(new URL('./test-stubs/cloudflare-runtime.ts', import.meta.url));

export default defineConfig({
  resolve: {
    // `agents` and `partyserver` import the Workers built-ins at module load, so agent.ts
    // can't be imported at all without these.
    alias: {
      'cloudflare:workers': cloudflareRuntime,
      'cloudflare:email': cloudflareRuntime,
    },
  },
  test: {
    // Aliases don't reach a dependency vitest leaves externalized.
    server: { deps: { inline: ['agents', 'partyserver'] } },
  },
});
