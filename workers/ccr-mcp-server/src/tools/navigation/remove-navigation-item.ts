import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { StructureScopedInputSchema } from './shared-schemas.js';

const RemoveNavigationItemInputSchema = StructureScopedInputSchema.extend({
  node_id: z.string().describe('The navigation node ID (UUID) to remove'),
});

export const removeNavigationItemTool = defineTool({
  description:
    'Remove an item from the navigation tree. This unlinks the item from navigation; it does not archive the underlying page (use archive_page for that). Confirm with the user before removing unless they have authorized cleanup.',
  inputSchema: RemoveNavigationItemInputSchema,
  annotations: { title: 'Remove navigation item', destructiveHint: true, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      await ctx.apiClient.deleteNode(
        input.site_id,
        input.branch_id,
        input.structure_id,
        input.node_id,
      );
      return formatResult({
        message: 'Navigation item removed.',
        nodeId: input.node_id,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
