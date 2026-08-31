import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const RestorePageInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID, not a path.')
    .describe('The document ID (UUID) of an archived page'),
});

export const restorePageTool = defineTool({
  description:
    'Restore a previously archived page. This is site-scoped: it acts on the document record across the site, not on a single branch. Errors if the page does not exist or is not archived.',
  inputSchema: RestorePageInputSchema,
  annotations: { title: 'Restore page', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const document = await ctx.apiClient.restoreDocument(input.site_id, input.document_id);
      return formatResult({ message: 'Page restored.', ...document });
    } catch (error) {
      return formatError(error);
    }
  },
});
