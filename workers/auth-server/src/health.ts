export function handleHealthCheck(environment: string): Response {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      service: 'css-auth-server',
      environment,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
