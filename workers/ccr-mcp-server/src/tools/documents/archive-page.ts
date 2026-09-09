import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { PageOnBranchInputSchema } from './shared-schemas.js';

export const archivePageTool = defineTool({
  description:
    'Archive (soft-delete) a page on a workstream. The page is hidden but its history is preserved; use restore_page to bring it back. Confirm with the user before archiving unless they have authorized cleanup.',
  inputSchema: PageOnBranchInputSchema,
  annotations: { title: 'Archive page', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      await ctx.apiClient.archiveDocumentOnBranch(
        input.site_id,
        input.branch_id,
        input.document_id,
      );
      return formatResult({
        message: 'Page archived. Use restore_page to bring it back.',
        documentId: input.document_id,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
