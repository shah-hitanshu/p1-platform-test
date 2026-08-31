import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { PageInStructureInputSchema } from './shared-schemas.js';

export const getPageMetadataTool = defineTool({
  description:
    "Read a page's metadata within a structure (e.g. title, SEO fields, publish date). Metadata is scoped to a structure, so pass the structure_id the page belongs to.",
  inputSchema: PageInStructureInputSchema,
  annotations: { title: 'Get page metadata', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.getDocumentMetadata(
        input.site_id,
        input.branch_id,
        input.structure_id,
        input.document_id,
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
