import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { CanonicalDocumentInputSchema } from './shared-schemas.js';

export const listLocaleVariantsTool = defineTool({
  description:
    'List a canonical document together with every locale variant derived from it. Returns the canonical document and, for each variant, its document and the localization edge (including the canonical version it is synced to). Read-only.',
  inputSchema: CanonicalDocumentInputSchema,
  annotations: { title: 'List locale variants', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.listLocaleVariants(
        input.site_id,
        input.branch_id,
        input.canonical_document_id,
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
