/**
 * API Documentation Routes
 *
 * Serves Swagger UI and the OpenAPI specification at /docs and
 * /docs/openapi.yaml. Both routes are unauthenticated so the API
 * surface is publicly browseable.
 */

import OPENAPI_SPEC from '../../docs/openapi.yaml';

// Pinned exact version (not a floating "@5") so the SRI hashes below stay valid —
// a floating tag would resolve to a different file on the next patch release and
// break integrity checking rather than protect it.
const SWAGGER_UI_VERSION = '5.32.8';
const SWAGGER_UI_CSS_SRI = 'sha384-9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT';
const SWAGGER_UI_JS_SRI = 'sha384-IKpAWwsTL0pcw7/Amtnt2eXF4P1BK64WNuY2E/RG15SWLUW5HXzFuyqCSAr/DP8C';

const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>P1 Media API</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css"
      integrity="${SWAGGER_UI_CSS_SRI}"
      crossorigin="anonymous"
    />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script
      src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"
      integrity="${SWAGGER_UI_JS_SRI}"
      crossorigin="anonymous"
    ></script>
    <script>
      window.addEventListener('load', function () {
        window.ui = SwaggerUIBundle({
          url: '/docs/openapi.yaml',
          dom_id: '#swagger-ui',
          deepLinking: true,
          docExpansion: 'list',
          defaultModelsExpandDepth: 1,
          tryItOutEnabled: true,
        });
      });
    </script>
  </body>
</html>
`;

/**
 * Serve the Swagger UI HTML page at /docs.
 */
export function handleDocsRoute(_request: Request): Response {
  return new Response(SWAGGER_UI_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

/**
 * Serve the raw OpenAPI YAML spec at /docs/openapi.yaml.
 */
export function handleDocsSpecRoute(_request: Request): Response {
  return new Response(OPENAPI_SPEC, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-yaml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
