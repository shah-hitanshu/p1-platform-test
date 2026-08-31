import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const ListDocumentsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches, NOT the branch name)'),
});

export const listDocumentsTool = defineTool({
  description:
    'List all documents in a site branch. Returns document paths (e.g., "/home", "/about") and their IDs. Use the document path when calling get_document or starting edit sessions.',
  inputSchema: ListDocumentsInputSchema,
  annotations: { title: 'List documents', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.listDocuments(input.site_id, input.branch_id);
      const contentDocs = result.documents.filter((doc) => !doc.path.startsWith('_registry/'));
      if (contentDocs.length === 0) {
        return formatResult('No documents found in this branch.');
      }
      const formatted = contentDocs.map((doc) => `- ${doc.path} (id: ${doc.id})`).join('\n');
      return formatResult(`Documents:\n${formatted}`);
    } catch (error) {
      return formatError(error);
    }
  },
});
