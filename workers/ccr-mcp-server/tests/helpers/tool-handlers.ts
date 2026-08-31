/**
 * Builds a by-name handler map from the tool registry, so a spec can call
 * `handlers.get_site({...})` without constructing a tool context itself.
 */

import type { McpApiClient } from '../../src/shared/api-client.js';
import type { ActingUser } from '../../src/shared/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import type { P1McpToolContext } from '../../src/tools/types/p1-mcp-tool-context.js';

type AnyHandler = (input?: unknown) => Promise<CallToolResult>;

export async function createTestHandlers(
  apiClient: McpApiClient,
  actingUser?: ActingUser,
): Promise<Record<string, AnyHandler>> {
  const { allTools } = await import('../../src/tools/index.js');

  const requestedById =
    actingUser?.id !== undefined && actingUser.id !== '' ? actingUser.id : undefined;
  const ctx: P1McpToolContext = {
    apiClient,
    ...(actingUser !== undefined ? { actingUser } : {}),
    ...(requestedById !== undefined ? { requestedById } : {}),
    trigger: requestedById !== undefined ? 'human_requested' : 'autonomous',
  };

  return Object.fromEntries(
    Object.entries(allTools).map(([name, tool]) => [
      name,
      (input?: unknown) =>
        (tool.handler as (c: P1McpToolContext, i: unknown) => Promise<CallToolResult>)(ctx, input),
    ]),
  );
}
