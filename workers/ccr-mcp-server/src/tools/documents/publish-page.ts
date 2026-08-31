import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { PageOnBranchInputSchema } from './shared-schemas.js';

export const publishPageTool = defineTool({
  description:
    'Publish a single page so its current version becomes the live, content-delivery version on the branch. This is the per-page counterpart to merging a whole branch. Publishing is outward-facing — confirm with the user before publishing to a live branch.',
  inputSchema: PageOnBranchInputSchema,
  annotations: { title: 'Publish page', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.publishDocument(
        input.site_id,
        input.branch_id,
        input.document_id,
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
