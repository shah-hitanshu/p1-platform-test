#!/usr/bin/env node
/**
 * Collaborative State System MCP Server
 *
 * This MCP server exposes the Agent Politeness workflow to Claude Desktop,
 * allowing users to edit documents collaboratively while respecting human
 * presence and creating proper checkpoints.
 *
 * Usage:
 *   WORKER_API_URL=http://localhost:8787 \
 *   AGENT_ID=a0000000-0000-0000-0000-000000000001 \
 *   AGENT_API_KEY=test-agent-key-zappy \
 *   node dist/index.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { ApiClient } from './api-client.js';
import { getToolDefinitions, createToolHandlers, schemas } from './tools.js';

// =============================================================================
// Server Setup
// =============================================================================

async function main(): Promise<void> {
  // Load configuration from environment
  const config = loadConfig();

  // Create API client
  const apiClient = new ApiClient({
    baseUrl: config.workerApiUrl,
    agentId: config.agentId,
    agentApiKey: config.agentApiKey,
  });

  // Create tool handlers
  const handlers = createToolHandlers(apiClient);

  // Create MCP server
  const server = new McpServer({
    name: 'collaborative-state',
    version: '0.1.0',
  });

  // Register tools
  const toolDefinitions = getToolDefinitions();

  // list_sites
  server.registerTool(
    'list_sites',
    {
      description: toolDefinitions.find((t) => t.name === 'list_sites')?.description ?? '',
      inputSchema: schemas.list_sites,
    },
    async () => {
      const result = await handlers.list_sites();
      return result;
    },
  );

  // list_branches
  server.registerTool(
    'list_branches',
    {
      description: toolDefinitions.find((t) => t.name === 'list_branches')?.description ?? '',
      inputSchema: schemas.list_branches,
    },
    async (params) => {
      const result = await handlers.list_branches(params);
      return result;
    },
  );

  // list_documents
  server.registerTool(
    'list_documents',
    {
      description: toolDefinitions.find((t) => t.name === 'list_documents')?.description ?? '',
      inputSchema: schemas.list_documents,
    },
    async (params) => {
      const result = await handlers.list_documents(
        params,
      );
      return result;
    },
  );

  // get_document
  server.registerTool(
    'get_document',
    {
      description: toolDefinitions.find((t) => t.name === 'get_document')?.description ?? '',
      inputSchema: schemas.get_document,
    },
    async (params) => {
      const result = await handlers.get_document(
        params,
      );
      return result;
    },
  );

  // check_edit_permission
  server.registerTool(
    'check_edit_permission',
    {
      description:
        toolDefinitions.find((t) => t.name === 'check_edit_permission')?.description ?? '',
      inputSchema: schemas.check_edit_permission,
    },
    async (params) => {
      const result = await handlers.check_edit_permission(
        params,
      );
      return result;
    },
  );

  // start_edit_session
  server.registerTool(
    'start_edit_session',
    {
      description:
        toolDefinitions.find((t) => t.name === 'start_edit_session')?.description ?? '',
      inputSchema: schemas.start_edit_session,
    },
    async (params) => {
      const result = await handlers.start_edit_session(
        params,
      );
      return result;
    },
  );

  // apply_document_edits
  server.registerTool(
    'apply_document_edits',
    {
      description:
        toolDefinitions.find((t) => t.name === 'apply_document_edits')?.description ?? '',
      inputSchema: schemas.apply_document_edits,
    },
    async (params) => {
      const result = await handlers.apply_document_edits(
        params,
      );
      return result;
    },
  );

  // complete_edit_session
  server.registerTool(
    'complete_edit_session',
    {
      description:
        toolDefinitions.find((t) => t.name === 'complete_edit_session')?.description ?? '',
      inputSchema: schemas.complete_edit_session,
    },
    async (params) => {
      const result = await handlers.complete_edit_session(
        params,
      );
      return result;
    },
  );

  // abort_edit_session
  server.registerTool(
    'abort_edit_session',
    {
      description:
        toolDefinitions.find((t) => t.name === 'abort_edit_session')?.description ?? '',
      inputSchema: schemas.abort_edit_session,
    },
    async (params) => {
      const result = await handlers.abort_edit_session(
        params,
      );
      return result;
    },
  );

  // Create transport and connect
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('Collaborative State MCP Server started');
  console.error(`Connected to: ${config.workerApiUrl}`);
  console.error(`Agent ID: ${config.agentId}`);
}

// Run the server
main().catch((error: unknown) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
