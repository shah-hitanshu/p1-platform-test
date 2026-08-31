import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { PageInStructureInputSchema } from './shared-schemas.js';

const SetPageMetadataInputSchema = PageInStructureInputSchema.extend({
  metadata: z
    .record(z.unknown())
    .describe(
      'The full metadata object to store. Validated against the structure schema when enforcement is enabled.',
    ),
});

export const setPageMetadataTool = defineTool({
  description:
    "Set a page's metadata within a structure. metadata replaces the stored object in full, so include every field you want to keep. When the structure enforces a schema, the backend rejects metadata that does not conform.",
  inputSchema: SetPageMetadataInputSchema,
  annotations: { title: 'Set page metadata', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.setDocumentMetadata(
        input.site_id,
        input.branch_id,
        input.structure_id,
        input.document_id,
        input.metadata,
      );
      return formatResult({ message: 'Page metadata saved.', ...result });
    } catch (error) {
      return formatError(error);
    }
  },
});
