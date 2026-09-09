import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { extractRegion } from './extract-region.js';

const GetDocumentInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path (e.g., "/home")'),
  region: z
    .string()
    .optional()
    .describe('Optional JSON path to extract a specific region (e.g., "/content/body")'),
});

export const getDocumentTool = defineTool({
  description:
    'Get the full content of a document, or a specific region of it. IMPORTANT: Always call this BEFORE making any edits to understand the document\'s current structure. Documents follow the Puck editor schema: "content" is an array of components (each with a "type" and "props" object), and "root" is a props object for page-level settings. After retrieving a document, summarize its structure to the user (e.g., "This document has 3 components: Hero, TextBlock, Footer") before proposing changes. This prevents accidentally duplicating or misplacing content. Use the optional "region" parameter with a JSON Pointer path (e.g., "/content") to retrieve just a portion of a large document.',
  inputSchema: GetDocumentInputSchema,
  annotations: { title: 'Get document', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.getDocument(
        input.site_id,
        input.branch_id,
        input.document_path,
      );
      let content: unknown = result.snapshot;
      if (input.region !== undefined && input.region !== '') {
        const extracted = extractRegion(result.snapshot, input.region);
        if (extracted === undefined) {
          return formatResult(`Region "${input.region}" not found in document.`);
        }
        content = extracted;
      }
      return formatResult(content);
    } catch (error) {
      return formatError(error);
    }
  },
});
