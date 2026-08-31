import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { NamedQueryInputSchema } from './shared-schemas.js';

export const getQueryTool = defineTool({
  description:
    'Get the full definition of a query including its datasource reference, sort order, filters, and limits.',
  inputSchema: NamedQueryInputSchema,
  annotations: { title: 'Get query', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const query = await ctx.apiClient.getQuery(
        input.site_id,
        input.branch_id,
        input.query_name,
      );
      return formatResult(query);
    } catch (error) {
      return formatError(error);
    }
  },
});
