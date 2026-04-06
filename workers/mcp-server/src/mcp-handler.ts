/**
 * MCP Handler - Creates and configures the MCP server with all 13 tools.
 *
 * This module creates an McpServer instance from @modelcontextprotocol/sdk,
 * wires up the McpApiClient, and registers all 13 tools with their schemas
 * and handlers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpApiClient } from './shared/api-client.js';
import { createToolHandlers, getToolDefinitions, schemas } from './shared/tools.js';
import type { ActingUser } from './shared/types.js';

export interface McpHandlerConfig {
  baseUrl: string;
  agentId: string;
  agentApiKey: string;
  serverName: string;
  serverVersion: string;
  actingUser?: ActingUser;
  fetcher?: Fetcher;
}

export function createMcpServer(config: McpHandlerConfig): McpServer {
  const apiClient = new McpApiClient({
    baseUrl: config.baseUrl,
    agentId: config.agentId,
    agentApiKey: config.agentApiKey,
    actingUser: config.actingUser,
    fetcher: config.fetcher,
  });

  const handlers = createToolHandlers(apiClient);
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  const toolDefinitions = getToolDefinitions();

  // Register all 13 tools
  server.registerTool(
    'list_sites',
    {
      description: toolDefinitions.find((t) => t.name === 'list_sites')?.description ?? '',
      inputSchema: schemas.list_sites,
    },
    async () => handlers.list_sites(),
  );

  server.registerTool(
    'list_branches',
    {
      description: toolDefinitions.find((t) => t.name === 'list_branches')?.description ?? '',
      inputSchema: schemas.list_branches,
    },
    async (params) => handlers.list_branches(params),
  );

  server.registerTool(
    'list_documents',
    {
      description: toolDefinitions.find((t) => t.name === 'list_documents')?.description ?? '',
      inputSchema: schemas.list_documents,
    },
    async (params) => handlers.list_documents(params),
  );

  server.registerTool(
    'get_document',
    {
      description: toolDefinitions.find((t) => t.name === 'get_document')?.description ?? '',
      inputSchema: schemas.get_document,
    },
    async (params) => handlers.get_document(params),
  );

  server.registerTool(
    'check_edit_permission',
    {
      description: toolDefinitions.find((t) => t.name === 'check_edit_permission')?.description ?? '',
      inputSchema: schemas.check_edit_permission,
    },
    async (params) => handlers.check_edit_permission(params),
  );

  server.registerTool(
    'start_edit_session',
    {
      description: toolDefinitions.find((t) => t.name === 'start_edit_session')?.description ?? '',
      inputSchema: schemas.start_edit_session,
    },
    async (params) => handlers.start_edit_session(params),
  );

  server.registerTool(
    'apply_document_edits',
    {
      description: toolDefinitions.find((t) => t.name === 'apply_document_edits')?.description ?? '',
      inputSchema: schemas.apply_document_edits,
    },
    async (params) => handlers.apply_document_edits(params),
  );

  server.registerTool(
    'complete_edit_session',
    {
      description: toolDefinitions.find((t) => t.name === 'complete_edit_session')?.description ?? '',
      inputSchema: schemas.complete_edit_session,
    },
    async (params) => handlers.complete_edit_session(params),
  );

  server.registerTool(
    'abort_edit_session',
    {
      description: toolDefinitions.find((t) => t.name === 'abort_edit_session')?.description ?? '',
      inputSchema: schemas.abort_edit_session,
    },
    async (params) => handlers.abort_edit_session(params),
  );

  server.registerTool(
    'get_branch_presence',
    {
      description: toolDefinitions.find((t) => t.name === 'get_branch_presence')?.description ?? '',
      inputSchema: schemas.get_branch_presence,
    },
    async (params) => handlers.get_branch_presence(params),
  );

  server.registerTool(
    'get_document_presence',
    {
      description: toolDefinitions.find((t) => t.name === 'get_document_presence')?.description ?? '',
      inputSchema: schemas.get_document_presence,
    },
    async (params) => handlers.get_document_presence(params),
  );

  server.registerTool(
    'list_components',
    {
      description: toolDefinitions.find((t) => t.name === 'list_components')?.description ?? '',
      inputSchema: schemas.list_components,
    },
    async (params) => handlers.list_components(params),
  );

  server.registerTool(
    'create_page',
    {
      description: toolDefinitions.find((t) => t.name === 'create_page')?.description ?? '',
      inputSchema: schemas.create_page,
    },
    async (params) => handlers.create_page(params),
  );

  return server;
}
