import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { StructureScopedInputSchema } from './shared-schemas.js';

export const getNavigationTool = defineTool({
  description:
    'Get the full navigation tree for a structure — every section, page, and link, with their nesting and order. Call this before adding or moving items so you understand where things currently sit.',
  inputSchema: StructureScopedInputSchema,
  annotations: { title: 'Get navigation', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.getNavigation(
        input.site_id,
        input.branch_id,
        input.structure_id,
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
