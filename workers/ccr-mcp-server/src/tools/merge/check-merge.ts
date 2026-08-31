import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const CheckMergeInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  source_branch_id: z.string().describe('The branch ID (UUID) holding the changes to merge'),
  target_branch_id: z.string().describe('The branch ID (UUID) to merge into (often the main branch)'),
});

export const checkMergeTool = defineTool({
  description:
    'Check whether a source branch can merge cleanly into a target branch, and report any conflicting documents. Run this before execute_merge so you know whether conflict resolutions are needed. Read-only — it does not change anything.',
  inputSchema: CheckMergeInputSchema,
  annotations: { title: 'Check merge', readOnlyHint: true },
  // POST, but read-only, so it stays on the looser read limiter.
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.checkMerge(input.site_id, {
        sourceBranchId: input.source_branch_id,
        targetBranchId: input.target_branch_id,
      });
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
