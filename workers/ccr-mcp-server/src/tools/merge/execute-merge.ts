import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { mapConflictResolutions, type ConflictResolution } from './conflict-resolutions.js';
import { ConflictResolutionSchema, MergeBranchesInputSchema } from './shared-schemas.js';

const ExecuteMergeInputSchema = MergeBranchesInputSchema.extend({
  message: z.string().optional().describe('Merge message describing the change.'),
  conflict_resolutions: z
    .array(ConflictResolutionSchema)
    .optional()
    .describe('Per-document conflict resolutions. Run check_merge first to discover conflicts.'),
});

export const executeMergeTool = defineTool({
  description:
    'Merge a source workstream into a target workstream. Hard to reverse — confirm with the user before merging into main. Long merges return a jobId to poll with get_merge_job.',
  inputSchema: ExecuteMergeInputSchema,
  annotations: { title: 'Execute merge', destructiveHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const body: {
        sourceBranchId: string;
        targetBranchId: string;
        message?: string;
        conflictResolutions?: ConflictResolution[];
      } = {
        sourceBranchId: input.source_branch_id,
        targetBranchId: input.target_branch_id,
      };
      if (input.message !== undefined) body.message = input.message;
      const resolutions = mapConflictResolutions(input.conflict_resolutions);
      if (resolutions !== undefined) body.conflictResolutions = resolutions;

      const result = await ctx.apiClient.executeMerge(input.site_id, body);
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
