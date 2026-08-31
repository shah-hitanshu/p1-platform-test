import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { DocumentScopedInputSchema } from './shared-schemas.js';

const GetDocumentVersionInputSchema = DocumentScopedInputSchema.extend({
  version_id: z
    .string()
    .uuid('Must be the version UUID from list_document_versions.')
    .describe('The version ID (UUID from list_document_versions)'),
});

export const getDocumentVersionTool = defineTool({
  description:
    'Get the full snapshot of a specific document version. Use this to inspect what a page looked like at a past point before deciding whether to restore it.',
  inputSchema: GetDocumentVersionInputSchema,
  annotations: { title: 'Get document version', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const version = await ctx.apiClient.getDocumentVersion(
        input.site_id,
        input.branch_id,
        input.document_id,
        input.version_id,
      );
      return formatResult(version);
    } catch (error) {
      return formatError(error);
    }
  },
});
