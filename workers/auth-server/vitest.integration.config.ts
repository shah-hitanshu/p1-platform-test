import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['tests/integration/**/*.integration.spec.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          kvNamespaces: ['OAUTH_KV'],
          // Set INTERNAL_SECRET so the /internal/token/validate endpoint can validate it.
          // The test that sends no X-Internal-Secret header must receive 401,
          // and the test that sends the correct header must receive 200.
          // Without this, env.INTERNAL_SECRET is undefined and the comparison
          // `secret !== env.INTERNAL_SECRET` becomes `undefined !== undefined = false`,
          // making the auth check silently pass for all requests.
          // Note: miniflare 4.x uses 'bindings' for plain env vars (vars)
          // The wrangler.jsonc vars are merged at runtime; bindings here override/add to them.
          bindings: {
            INTERNAL_SECRET: 'test-internal-secret',
            GOOGLE_CLIENT_ID: 'test-google-client-id',
            GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
            COOKIE_ENCRYPTION_KEY: 'test-cookie-encryption-key-32chars!!',
            ENVIRONMENT: 'test',
          },
          // Stub CSS_BACKEND service binding — returns site auth config for test site IDs
          serviceBindings: {
            CSS_BACKEND: async (request: Request) => {
              const url = new URL(request.url);
              if (url.pathname.includes('/internal/site-auth-config/test-site-123')) {
                return new Response(JSON.stringify({
                  siteId: 'test-site-123',
                  allowedOrigins: ['http://localhost:3000', '*-testsite.pantheonsite.io'],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
              }
              return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
            },
          },
        },
      },
    },
  },
});
