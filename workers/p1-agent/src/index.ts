import { routeAgentRequest } from 'agents';
import { contextFromRequest, withRequestContext } from '@pantheon-systems/p1-telemetry';
import type { Env } from './env.js';
import { ensureLogger } from './telemetry.js';
export { ChatAgent } from './durable-objects/chat-agent.js';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    const logger = ensureLogger(env);
    const telemetry = contextFromRequest(request, {
      route: url.pathname.startsWith('/agents/') ? '/agents/:agent/:id' : 'unmatched',
    });

    return withRequestContext(telemetry, async () => {
      try {
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
      } finally {
        ctx.waitUntil(logger.flush());
      }
    });
  },
} satisfies ExportedHandler<Env>;
