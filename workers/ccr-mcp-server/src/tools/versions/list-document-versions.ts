import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { DocumentScopedInputSchema } from './shared-schemas.js';

export const listDocumentVersionsTool = defineTool({
  description:
    "List a document's version history on a branch, newest first. Use this to find the version_id to inspect with get_document_version or roll back to with restore_document_version.",
  inputSchema: DocumentScopedInputSchema,
  annotations: { title: 'List document versions', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.listDocumentVersions(
        input.site_id,
        input.branch_id,
        input.document_id,
      );
      if (result.versions.length === 0) {
        return formatResult('No versions found for this document.');
      }
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
