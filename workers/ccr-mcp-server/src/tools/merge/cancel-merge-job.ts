import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const CancelMergeJobInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  merge_job_id: z.string().describe(
    'The merge job ID (UUID) to cancel. Cooperative: the job stops at its next chunk '
    + 'boundary, the merge request returns to its prior status, and already-copied '
    + 'documents stay unpublished.',
  ),
});

export const cancelMergeJobTool = defineTool({
  description: 'Request cancellation of a running merge job.',
  inputSchema: CancelMergeJobInputSchema,
  annotations: { idempotentHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.cancelMergeJob(input.site_id, input.merge_job_id);
      return formatResult({
        message:
          'Cancellation requested. The job stops at its next chunk boundary; poll get_merge_job for the final state.',
        ...result,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
