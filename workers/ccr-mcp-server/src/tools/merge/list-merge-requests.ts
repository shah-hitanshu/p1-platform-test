import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { MergeRequestStatusEnum, SiteIdInputSchema } from './shared-schemas.js';

const ListMergeRequestsInputSchema = SiteIdInputSchema.extend({
  status: MergeRequestStatusEnum.optional().describe(
    'Filter by status: open, approved, merging, conflicted, merged, or closed.',
  ),
});

export const listMergeRequestsTool = defineTool({
  description:
    "List a site's merge requests, optionally filtered by status (open, approved, merging, conflicted, merged, closed). Use this to find work awaiting review or to check the state of a proposal.",
  inputSchema: ListMergeRequestsInputSchema,
  annotations: { title: 'List merge requests', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.listMergeRequests(
        input.site_id,
        input.status !== undefined ? { status: input.status } : undefined,
      );
      if (result.mergeRequests.length === 0) {
        return formatResult('No merge requests found.');
      }
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
