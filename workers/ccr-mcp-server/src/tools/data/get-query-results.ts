import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { NamedQueryInputSchema } from './shared-schemas.js';

const QueryResultsInputSchema = NamedQueryInputSchema.extend({
  limit: z.number().optional().describe('Max results to return'),
  offset: z.number().optional().describe('Number of results to skip'),
});

export const getQueryResultsTool = defineTool({
  description:
    'Retrieve documents matching a named query. Returns document IDs, paths, and metadata. Use list_queries first to discover available queries.',
  inputSchema: QueryResultsInputSchema,
  annotations: { title: 'Get query results', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.getQueryResults(
        input.site_id,
        input.branch_id,
        input.query_name,
        { limit: input.limit, offset: input.offset },
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
