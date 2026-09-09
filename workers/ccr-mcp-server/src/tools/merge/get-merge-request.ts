import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { MergeRequestIdInputSchema } from './shared-schemas.js';

export const getMergeRequestTool = defineTool({
  description:
    "Get a single merge request's details, including its source and target workstreams and current status.",
  inputSchema: MergeRequestIdInputSchema,
  annotations: { title: 'Get merge request', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const mergeRequest = await ctx.apiClient.getMergeRequest(
        input.site_id,
        input.merge_request_id,
      );
      return formatResult(mergeRequest);
    } catch (error) {
      return formatError(error);
    }
  },
});
