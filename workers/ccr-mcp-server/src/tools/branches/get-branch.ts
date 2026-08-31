import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { BranchIdInputSchema } from './shared-schemas.js';

export const getBranchTool = defineTool({
  description:
    "Get a single branch's details: name, status, description, source branch, and timestamps. Use this to check a branch's current state before updating, archiving, or merging it.",
  inputSchema: BranchIdInputSchema,
  annotations: { title: 'Get branch', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const branch = await ctx.apiClient.getBranch(input.site_id, input.branch_id);
      return formatResult(branch);
    } catch (error) {
      return formatError(error);
    }
  },
});
