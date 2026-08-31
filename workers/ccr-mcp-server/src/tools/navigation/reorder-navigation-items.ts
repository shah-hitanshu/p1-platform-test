import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { StructureScopedInputSchema } from './shared-schemas.js';

const ReorderNavigationItemsInputSchema = StructureScopedInputSchema.extend({
  parent_node_id: z
    .string()
    .optional()
    .describe('Parent whose children to reorder. Omit for top-level items.'),
  node_order: z.array(z.string()).describe('Node IDs (UUIDs) in the desired order.'),
});

export const reorderNavigationItemsTool = defineTool({
  description:
    'Reorder all the children under one parent in a single call. node_order lists the sibling node IDs in the order you want; omit parent_node_id to reorder the top-level items. Get the current node IDs from get_navigation first.',
  inputSchema: ReorderNavigationItemsInputSchema,
  annotations: { title: 'Reorder navigation items', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.reorderNodes(
        input.site_id,
        input.branch_id,
        input.structure_id,
        {
          parentNodeId: input.parent_node_id ?? null,
          nodeOrder: input.node_order,
        },
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
