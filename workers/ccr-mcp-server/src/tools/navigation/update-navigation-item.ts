import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { StructureScopedInputSchema } from './shared-schemas.js';

const UpdateNavigationItemInputSchema = StructureScopedInputSchema.extend({
  node_id: z.string().describe('The navigation node ID (UUID)'),
  name: z.string().min(1).optional().describe('New display label.'),
  slug: z.string().min(1).optional().describe('New slug, unique within the parent.'),
  position: z.number().optional().describe('New order among siblings.'),
});

export const updateNavigationItemTool = defineTool({
  description:
    'Rename a navigation item, change its slug, or change its position among its siblings. Provide at least one of name, slug, or position. To reparent an item, use move_navigation_item instead.',
  inputSchema: UpdateNavigationItemInputSchema,
  annotations: { title: 'Update navigation item', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      if (input.name === undefined && input.slug === undefined && input.position === undefined) {
        return formatError(
          new Error('Provide at least one of name, slug, or position to update.'),
        );
      }
      const body: { name?: string; slug?: string; position?: number } = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.slug !== undefined) body.slug = input.slug;
      if (input.position !== undefined) body.position = input.position;

      const node = await ctx.apiClient.updateNode(
        input.site_id,
        input.branch_id,
        input.structure_id,
        input.node_id,
        body,
      );
      return formatResult({ message: 'Navigation item updated.', ...node });
    } catch (error) {
      return formatError(error);
    }
  },
});
