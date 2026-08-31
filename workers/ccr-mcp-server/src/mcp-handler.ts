/**
 * MCP Handler - Creates and configures the MCP server.
 *
 * This module creates an McpServer instance from @modelcontextprotocol/sdk,
 * wires up the McpApiClient, and registers each tool with its schema and
 * handler.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpApiClient } from './shared/api-client.js';
import type { ActingUser } from './shared/types.js';
import { allTools } from './tools/index.js';
import type { P1McpToolContext } from './tools/types/p1-mcp-tool-context.js';
import {
  checkToolRateLimit,
  type RateLimiters,
  type RateLimitContext,
} from './rate-limit.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types';

export interface McpHandlerConfig {
  baseUrl: string;
  /** Agent id for actor attribution headers; omitted on the agent-key pass-through. */
  agentId?: string;
  /** Auth0 access token for the signed-in user; forwarded as Authorization: Bearer. */
  accessToken?: string;
  /** Agent API key; forwarded as X-API-Key for autonomous-agent requests. */
  agentApiKey?: string;
  serverName: string;
  serverVersion: string;
  actingUser?: ActingUser;
  fetcher?: Fetcher;
  // PCC-3192 — per-tool rate-limit context. Both optional so the wrapper
  // can fail OPEN with a one-shot warn when missing (mirrors PCC-3193
  // binding-mode pattern).
  rateLimiters?: RateLimiters;
  rateLimitContext?: RateLimitContext;
}

interface ToolErrorResult {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError: true;
}

function formatRateLimitError(tool: string, scope: 'user' | 'ip'): ToolErrorResult {
  // Wording chosen to give the LLM enough signal to back off and retry
  // later — without leaking the exact bucket configuration.
  const scopeLabel = scope === 'user' ? 'per-user' : 'per-IP';
  return {
    content: [{
      type: 'text',
      text: `Rate limit exceeded for tool "${tool}" (${scopeLabel} quota). ` +
            'Please wait a minute before retrying.',
    }],
    isError: true,
  };
}

/**
 * Pre-check: returns a ToolErrorResult if the rate-limit denies the call,
 * or null to proceed. No-op when rate limiters are absent (local dev).
 */
async function rateLimitPreCheck(
  toolName: string,
  mutates: boolean,
  config: McpHandlerConfig,
): Promise<ToolErrorResult | null> {
  if (!config.rateLimiters || !config.rateLimitContext) {
    return null;
  }
  const verdict = await checkToolRateLimit(
    config.rateLimiters,
    toolName,
    mutates,
    config.rateLimitContext,
  );
  return verdict.allowed ? null : formatRateLimitError(toolName, verdict.scope);
}

export function createMcpServer(config: McpHandlerConfig): McpServer {
  const apiClient = new McpApiClient({
    baseUrl: config.baseUrl,
    agentId: config.agentId,
    accessToken: config.accessToken,
    agentApiKey: config.agentApiKey,
    actingUser: config.actingUser,
    fetcher: config.fetcher,
    enableValidation: true,
  });

  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  // PCC-3189: pass actingUser so handlers can attribute edit-session calls
  // to a real human (trigger='human_requested' + requestedById) instead of
  // hardcoding 'autonomous' for everything.
  const requestedById =
    config.actingUser?.id !== undefined && config.actingUser.id !== ''
      ? config.actingUser.id
      : undefined;
  const toolContext: P1McpToolContext = {
    apiClient,
    ...(config.actingUser !== undefined ? { actingUser: config.actingUser } : {}),
    ...(requestedById !== undefined ? { requestedById } : {}),
    trigger: requestedById !== undefined ? 'human_requested' : 'autonomous',
  };

  for (const [name, tool] of Object.entries(allTools)) {
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
      },
      async (args: unknown) => {
        const denied = await rateLimitPreCheck(name, tool.mutates, config);
        if (denied) {
          return denied;
        }
        // Object.entries widens the map to a union of tool types, so the
        // handler is cast here; each tool's own definition is what type-checks
        // its schema against its input.
        const handler = tool.handler as (
          ctx: P1McpToolContext,
          input: unknown,
        ) => Promise<CallToolResult>;
        return handler(toolContext, args);
      },
    );
  }

  return server;
}
