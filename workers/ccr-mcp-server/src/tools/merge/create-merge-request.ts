import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { MergeBranchesInputSchema } from './shared-schemas.js';

const CreateMergeRequestInputSchema = MergeBranchesInputSchema.extend({
  title: z.string().min(1).describe('Title summarising the proposed change.'),
  description: z.string().optional().describe('Longer description of the proposed change.'),
});

export const createMergeRequestTool = defineTool({
  description:
    'Open a merge request proposing that a source workstream be merged into a target workstream, for human review before it lands. Use this instead of execute_merge when the work should be approved by a person first.',
  inputSchema: CreateMergeRequestInputSchema,
  annotations: { title: 'Create merge request', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const body: {
        sourceBranchId: string;
        targetBranchId: string;
        title: string;
        description?: string;
      } = {
        sourceBranchId: input.source_branch_id,
        targetBranchId: input.target_branch_id,
        title: input.title,
      };
      if (input.description !== undefined) body.description = input.description;

      const mergeRequest = await ctx.apiClient.createMergeRequest(input.site_id, body);
      return formatResult({ message: 'Merge request created.', ...mergeRequest });
    } catch (error) {
      return formatError(error);
    }
  },
});
