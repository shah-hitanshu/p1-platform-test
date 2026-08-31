import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const RenamePageInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
  path: z.string().min(1).describe('The new document path (e.g. "plans" or "products/widget").'),
});

export const renamePageTool = defineTool({
  description:
    "Change a page's path. This is site-scoped: the new path applies across the site, not only on your working branch. Errors if another document already occupies the new path.",
  inputSchema: RenamePageInputSchema,
  annotations: { title: 'Rename page', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const document = await ctx.apiClient.renameDocument(
        input.site_id,
        input.document_id,
        input.path,
      );
      return formatResult({ message: `Page renamed to "${input.path}".`, ...document });
    } catch (error) {
      return formatError(error);
    }
  },
});
