/**
 * Health Check Handler
 *
 * Extracted to a separate module so it can be imported by tests
 * without pulling in @cloudflare/workers-oauth-provider dependencies
 * that rely on the cloudflare: protocol.
 */

export function handleHealthCheck(environment: string): Response {
  return new Response(JSON.stringify({
    status: 'healthy',
    service: 'ccr-mcp-server',
    environment,
    timestamp: new Date().toISOString(),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
