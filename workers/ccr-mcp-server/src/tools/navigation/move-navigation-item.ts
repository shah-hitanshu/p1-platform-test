import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { StructureScopedInputSchema } from './shared-schemas.js';

const MoveNavigationItemInputSchema = StructureScopedInputSchema.extend({
  node_id: z.string().describe('The navigation node ID (UUID) to move'),
  new_parent_id: z
    .string()
    .optional()
    .describe('New parent node ID (UUID). Omit to move to the top level.'),
  new_position: z.number().optional().describe('New order under the new parent (default 0).'),
});

export const moveNavigationItemTool = defineTool({
  description:
    'Move a navigation item to a new parent and/or position. Omit new_parent_id to move it to the top level. The backend rejects a move that would make an item its own ancestor.',
  inputSchema: MoveNavigationItemInputSchema,
  annotations: { title: 'Move navigation item', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const body: { newParentId: string | null; newPosition?: number } = {
        newParentId: input.new_parent_id ?? null,
      };
      if (input.new_position !== undefined) body.newPosition = input.new_position;

      const node = await ctx.apiClient.moveNode(
        input.site_id,
        input.branch_id,
        input.structure_id,
        input.node_id,
        body,
      );
      return formatResult({ message: 'Navigation item moved.', ...node });
    } catch (error) {
      return formatError(error);
    }
  },
});
