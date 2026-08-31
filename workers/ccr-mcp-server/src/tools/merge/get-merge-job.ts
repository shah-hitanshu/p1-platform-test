import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const GetMergeJobInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  merge_job_id: z.string().describe(
    'The merge job ID (UUID) from an execute_merge / execute_merge_request response. '
    + 'Poll every few seconds until status is terminal: completed, completed_with_errors, '
    + 'blocked_on_conflicts, failed, or cancelled.',
  ),
});

export const getMergeJobTool = defineTool({
  description: "Get a merge job's status and progress.",
  inputSchema: GetMergeJobInputSchema,
  annotations: { readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.getMergeJob(input.site_id, input.merge_job_id);
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
