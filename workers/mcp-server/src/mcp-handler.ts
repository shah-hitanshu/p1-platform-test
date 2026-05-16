/**
 * MCP Handler - Creates and configures the MCP server with all 14 tools.
 *
 * This module creates an McpServer instance from @modelcontextprotocol/sdk,
 * wires up the McpApiClient, and registers all 14 tools with their schemas
 * and handlers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpApiClient } from './shared/api-client.js';
import { createToolHandlers, getToolDefinitions, schemas } from './shared/tools.js';
import type { ActingUser } from './shared/types.js';
import {
  checkToolRateLimit,
  type RateLimiters,
  type RateLimitContext,
} from './rate-limit.js';

export interface McpHandlerConfig {
  baseUrl: string;
  agentId: string;
  agentApiKey: string;
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
// reads from one source of truth.
const MUTATION_TOOLS = new Set<string>([
  'apply_document_edits',
  'create_page',
  'start_edit_session',
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
    agentApiKey: config.agentApiKey,
    actingUser: config.actingUser,
    fetcher: config.fetcher,
  });

  // PCC-3189: pass actingUser so handlers can attribute edit-session calls
  // to a real human (trigger='human_requested' + requestedById) instead of
  // hardcoding 'autonomous' for everything.
  const handlers = createToolHandlers(apiClient, config.actingUser);
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  const toolDefinitions = getToolDefinitions();

  // PCC-3192 — every tool's invocation is gated by a rate-limit pre-check.
  // When rateLimiters/rateLimitContext are absent (local dev) the check is
  // a no-op so existing tests don't need to thread a binding through.
  // Register all 14 tools
  server.registerTool(
    'list_sites',
    {
      description: toolDefinitions.find((t) => t.name === 'list_sites')?.description ?? '',
      inputSchema: schemas.list_sites,
    },
    async () => {
      const denied = await rateLimitPreCheck('list_sites', config);
      return denied ?? await handlers.list_sites();
    },
  );

  server.registerTool(
    'list_branches',
    {
      description: toolDefinitions.find((t) => t.name === 'list_branches')?.description ?? '',
      inputSchema: schemas.list_branches,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('list_branches', config);
      return denied ?? await handlers.list_branches(params);
    },
  );

  server.registerTool(
    'list_documents',
    {
      description: toolDefinitions.find((t) => t.name === 'list_documents')?.description ?? '',
      inputSchema: schemas.list_documents,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('list_documents', config);
      return denied ?? await handlers.list_documents(params);
    },
  );

  server.registerTool(
    'get_document',
    {
      description: toolDefinitions.find((t) => t.name === 'get_document')?.description ?? '',
      inputSchema: schemas.get_document,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('get_document', config);
      return denied ?? await handlers.get_document(params);
    },
  );

  server.registerTool(
    'check_edit_permission',
    {
      description: toolDefinitions.find((t) => t.name === 'check_edit_permission')?.description ?? '',
      inputSchema: schemas.check_edit_permission,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('check_edit_permission', config);
      return denied ?? await handlers.check_edit_permission(params);
    },
  );

  server.registerTool(
    'start_edit_session',
    {
      description: toolDefinitions.find((t) => t.name === 'start_edit_session')?.description ?? '',
      inputSchema: schemas.start_edit_session,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('start_edit_session', config);
      return denied ?? await handlers.start_edit_session(params);
    },
  );

  server.registerTool(
    'apply_document_edits',
    {
      description: toolDefinitions.find((t) => t.name === 'apply_document_edits')?.description ?? '',
      inputSchema: schemas.apply_document_edits,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('apply_document_edits', config);
      return denied ?? await handlers.apply_document_edits(params);
    },
  );

  server.registerTool(
    'complete_edit_session',
    {
      description: toolDefinitions.find((t) => t.name === 'complete_edit_session')?.description ?? '',
      inputSchema: schemas.complete_edit_session,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('complete_edit_session', config);
      return denied ?? await handlers.complete_edit_session(params);
    },
  );

  server.registerTool(
    'abort_edit_session',
    {
      description: toolDefinitions.find((t) => t.name === 'abort_edit_session')?.description ?? '',
      inputSchema: schemas.abort_edit_session,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('abort_edit_session', config);
      return denied ?? await handlers.abort_edit_session(params);
    },
  );

  server.registerTool(
    'get_branch_presence',
    {
      description: toolDefinitions.find((t) => t.name === 'get_branch_presence')?.description ?? '',
      inputSchema: schemas.get_branch_presence,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('get_branch_presence', config);
      return denied ?? await handlers.get_branch_presence(params);
    },
  );

  server.registerTool(
    'get_document_presence',
    {
      description: toolDefinitions.find((t) => t.name === 'get_document_presence')?.description ?? '',
      inputSchema: schemas.get_document_presence,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('get_document_presence', config);
      return denied ?? await handlers.get_document_presence(params);
    },
  );

  server.registerTool(
    'list_components',
    {
      description: toolDefinitions.find((t) => t.name === 'list_components')?.description ?? '',
      inputSchema: schemas.list_components,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('list_components', config);
      return denied ?? await handlers.list_components(params);
    },
  );

  server.registerTool(
    'create_page',
    {
      description: toolDefinitions.find((t) => t.name === 'create_page')?.description ?? '',
      inputSchema: schemas.create_page,
    },
    async (params) => {
      const denied = await rateLimitPreCheck('create_page', config);
      return denied ?? await handlers.create_page(params);
    },
  );

  server.registerTool(
    'create_branch',
    {
      description: toolDefinitions.find((t) => t.name === 'create_branch')?.description ?? '',
      inputSchema: schemas.create_branch,
    },
    async (params) => handlers.create_branch(params),
  );

  return server;
}
