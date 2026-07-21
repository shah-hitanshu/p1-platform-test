import { routeAgentRequest } from 'agents';
import type { Env } from './types.js';
export { ChatAgent } from './agent.js';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Health check
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Route WebSocket and HTTP requests to the ChatAgent DO
    // routeAgentRequest handles /agents/:agentName/:agentId paths
    const agentResponse = await routeAgentRequest(request, env, {
      cors: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });

    if (agentResponse) {
      return agentResponse;
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
