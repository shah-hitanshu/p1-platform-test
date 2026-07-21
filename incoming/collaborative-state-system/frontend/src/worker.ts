/**
 * Frontend Cloudflare Worker
 *
 * Serves the Vite-built SPA via Workers Static Assets with runtime
 * config injection. HTML responses get a <script> tag injected into
 * <head> that sets window.__CSS_CONFIG__ from Worker env vars.
 *
 * Non-HTML requests (JS, CSS, images) pass through to static assets
 * at no compute cost.
 */

interface Env {
  ASSETS: Fetcher;
  FRONTEND_API_BASE_URL: string;
  FRONTEND_GOOGLE_CLIENT_ID: string;
  FRONTEND_AUTH0_DOMAIN: string;
  FRONTEND_AUTH0_CLIENT_ID: string;
  FRONTEND_AUTH0_AUDIENCE: string;
  FRONTEND_ENABLE_MOCK_LOGIN: string;
}

/** Build the config JSON string from environment variables. */
function buildConfigScript(env: Env): string {
  const config = {
    apiBaseUrl: env.FRONTEND_API_BASE_URL || '',
    googleClientId: env.FRONTEND_GOOGLE_CLIENT_ID || '',
    auth0Domain: env.FRONTEND_AUTH0_DOMAIN || '',
    auth0ClientId: env.FRONTEND_AUTH0_CLIENT_ID || '',
    auth0Audience: env.FRONTEND_AUTH0_AUDIENCE || '',
    enableMockLogin: env.FRONTEND_ENABLE_MOCK_LOGIN === 'true',
  };
  return `<script>window.__CSS_CONFIG__=${JSON.stringify(config)};</script>`;
}

/** HTMLRewriter handler that injects config script into <head>. */
class HeadInjector {
  private script: string;

  constructor(script: string) {
    this.script = script;
  }

  element(element: Element): void {
    element.prepend(this.script, { html: true });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // For non-navigation requests (assets), let static assets handle directly
    const accept = request.headers.get('Accept') || '';
    const isNavigationRequest =
      request.method === 'GET' &&
      accept.includes('text/html') &&
      !url.pathname.match(/\.\w+$/);

    if (!isNavigationRequest) {
      return env.ASSETS.fetch(request);
    }

    // For navigation requests, fetch index.html and inject config
    const assetResponse = await env.ASSETS.fetch(request);
    const script = buildConfigScript(env);

    return new HTMLRewriter()
      .on('head', new HeadInjector(script))
      .transform(assetResponse);
  },
} satisfies ExportedHandler<Env>;
