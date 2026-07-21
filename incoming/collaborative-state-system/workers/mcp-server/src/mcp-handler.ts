/**
 * MCP Handler - Creates and configures the MCP server.
 *
 * This module creates an McpServer instance from @modelcontextprotocol/sdk,
 * wires up the McpApiClient, and registers each tool with its schema and
 * handler.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpApiClient } from './shared/api-client.js';
import {
  createToolHandlers,
  getToolDefinitions,
  schemas,
  type ToolHandlers,
  type ToolResult,
} from './shared/tools.js';
import type { ActingUser } from './shared/types.js';
import {
  checkToolRateLimit,
  type RateLimiters,
  type RateLimitContext,
} from './rate-limit.js';

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

// PCC-3192 — tools that mutate backend state get the tighter limiter.
// Centralised here so every place that decides "is this a mutation?"
// reads from one source of truth. check_merge and preview_merge are POST
// but read-only, so they stay on the looser read limiter.
const MUTATION_TOOLS = new Set<string>([
  'apply_document_edits',
  'create_page',
  'start_edit_session',
  'complete_edit_session',
  'abort_edit_session',
  'create_branch',
  'update_branch',
  'archive_branch',
  'restore_branch',
  'execute_merge',
  'create_merge_request',
  'update_merge_request',
  'execute_merge_request',
  'add_navigation_item',
  'update_navigation_item',
  'move_navigation_item',
  'reorder_navigation_items',
  'remove_navigation_item',
  'set_page_metadata',
  'restore_document_version',
  'publish_page',
  'archive_page',
  'restore_page',
  'rename_page',
]);

// Edit-session lease tools resolve a registered agent on the backend, so a human
// (user-principal) caller cannot use them. They are registered only when the
// caller presents an agent key; a human caller gets reads and document creation.
//
// TODO(PCC-3308): interim gating. Once edit sessions can be owned by a user
// principal, un-gate these for human callers.
const AGENT_ONLY_TOOLS = new Set<string>([
  'check_edit_permission',
  'start_edit_session',
  'apply_document_edits',
  'complete_edit_session',
  'abort_edit_session',
]);

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
  config: McpHandlerConfig,
): Promise<ToolErrorResult | null> {
  if (!config.rateLimiters || !config.rateLimitContext) {
    return null;
  }
  const verdict = await checkToolRateLimit(
    config.rateLimiters,
    toolName,
    MUTATION_TOOLS.has(toolName),
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

  // PCC-3189: pass actingUser so handlers can attribute edit-session calls
  // to a real human (trigger='human_requested' + requestedById) instead of
  // hardcoding 'autonomous' for everything.
  const handlers = createToolHandlers(apiClient, config.actingUser);
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  const isAgentCaller = config.agentApiKey !== undefined && config.agentApiKey !== '';

  // registerTool infers a tool's argument type from a static inputSchema;
  // indexing schemas and handlers by name yields unions instead, so the args
  // and handler are cast at the call site.
  for (const { name, description } of getToolDefinitions()) {
    if (!isAgentCaller && AGENT_ONLY_TOOLS.has(name)) {
      continue;
    }
    const toolName = name as keyof ToolHandlers;
    server.registerTool(
      name,
      { description, inputSchema: schemas[toolName] },
      async (args: unknown) => {
        const denied = await rateLimitPreCheck(name, config);
        if (denied) {
          return denied;
        }
        const handler = handlers[toolName] as (a: unknown) => Promise<ToolResult>;
        return handler(args);
      },
    );
  }

  return server;
}
