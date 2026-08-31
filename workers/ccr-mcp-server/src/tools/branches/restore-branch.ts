import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const RestoreBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID) of an archived branch'),
});

export const restoreBranchTool = defineTool({
  description:
    'Restore a previously archived branch, returning it to the active list. Errors if the branch does not exist or is not archived.',
  inputSchema: RestoreBranchInputSchema,
  annotations: { title: 'Restore branch', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const branch = await ctx.apiClient.restoreBranch(input.site_id, input.branch_id);
      return formatResult({ message: `Branch "${branch.name}" restored.`, ...branch });
    } catch (error) {
      return formatError(error);
    }
  },
});
