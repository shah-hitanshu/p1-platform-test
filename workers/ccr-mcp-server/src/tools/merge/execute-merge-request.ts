import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { mapConflictResolutions } from './conflict-resolutions.js';
import { ConflictResolutionSchema } from './shared-schemas.js';

const ExecuteMergeRequestInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  merge_request_id: z.string().describe('The merge request ID (UUID). Must be approved or conflicted.'),
  resolutions: z
    .array(ConflictResolutionSchema)
    .optional()
    .describe('Per-document conflict resolutions when the request has conflicts.'),
});

export const executeMergeRequestTool = defineTool({
  description:
    'Execute an approved (or conflicted) merge request. Hard to reverse — confirm with the user first. Long merges return a jobId to poll with get_merge_job.',
  inputSchema: ExecuteMergeRequestInputSchema,
  annotations: { title: 'Execute merge request', destructiveHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const resolutions = mapConflictResolutions(input.resolutions);
      const result = await ctx.apiClient.executeMergeRequest(
        input.site_id,
        input.merge_request_id,
        resolutions !== undefined ? { resolutions } : undefined,
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
