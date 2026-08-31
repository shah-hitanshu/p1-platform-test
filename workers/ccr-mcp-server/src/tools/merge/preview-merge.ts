import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { MergeBranchesInputSchema } from './shared-schemas.js';

const PreviewMergeInputSchema = MergeBranchesInputSchema.extend({
  include_content: z
    .boolean()
    .optional()
    .describe('Include full document snapshots and diff operations in the preview.'),
  exclude_path_prefixes: z
    .array(z.string())
    .optional()
    .describe('Skip documents whose path starts with any of these prefixes (e.g. "_registry/").'),
});

export const previewMergeTool = defineTool({
  description:
    'Preview which documents a merge would change, before committing to it. Pass include_content to see full snapshots and diff operations, and exclude_path_prefixes to skip paths such as "_registry/". Read-only.',
  inputSchema: PreviewMergeInputSchema,
  annotations: { title: 'Preview merge', readOnlyHint: true },
  // POST, but read-only, so it stays on the looser read limiter.
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const body: {
        sourceBranchId: string;
        targetBranchId: string;
        includeContent?: boolean;
        excludePathPrefixes?: string[];
      } = {
        sourceBranchId: input.source_branch_id,
        targetBranchId: input.target_branch_id,
      };
      if (input.include_content !== undefined) body.includeContent = input.include_content;
      if (input.exclude_path_prefixes !== undefined) {
        body.excludePathPrefixes = input.exclude_path_prefixes;
      }

      const result = await ctx.apiClient.previewMerge(input.site_id, body);
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
