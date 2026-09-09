import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const CreateTranslationInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
  canonical_document_id: z
    .string()
    .describe('The canonical document ID (UUID from list_documents) to translate'),
  locale: z
    .string()
    .min(1)
    .describe('BCP-47 locale for the new variant (e.g. "fr", "es-419", "pt-BR").'),
  path: z
    .string()
    .optional()
    .describe('Optional path for the translation. Defaults to "{canonicalPath}.{locale}".'),
  mode: z
    .enum(['copy'])
    .optional()
    .describe(
      'How the locale\'s content is seeded. "copy", the default and currently the only mode, takes the canonical\'s content verbatim to translate in place.',
    ),
});

export const createTranslationTool = defineTool({
  description:
    "Create a locale variant of a canonical document. Clones the canonical's current content into a new document for the given locale, preserving every component slot id so the translation and its canonical stay slot-aligned, and pins a localization edge to the canonical version cloned from. Returns the created document, its first version, and the localization edge. Use get_drift on the new document later to see what the canonical has changed since.",
  inputSchema: CreateTranslationInputSchema,
  annotations: { title: 'Create translation', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const body: { locale: string; path?: string; mode?: 'copy' } = {
        locale: input.locale,
      };
      if (input.path !== undefined) {
        body.path = input.path;
      }
      if (input.mode !== undefined) {
        body.mode = input.mode;
      }
      const result = await ctx.apiClient.createTranslation(
        input.site_id,
        input.branch_id,
        input.canonical_document_id,
        body,
      );
      return formatResult({ message: 'Translation created.', ...result });
    } catch (error) {
      return formatError(error);
    }
  },
});
