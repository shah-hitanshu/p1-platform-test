import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { RelationTypeEnum } from './shared-schemas.js';

const GetDriftInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_id: z
    .string()
    .describe('The source document ID (UUID). For localization this is the translation; for template it is the page.'),
  relation_type: RelationTypeEnum.optional().describe(
    'Which upstream edge to diff: "localization" (translation vs canonical, the default) or "template" (page vs template).',
  ),
});

export const getDriftTool = defineTool({
  description:
    'Report how a document\'s upstream edge target has drifted since the document was last synced, with each change classified. relation_type selects the edge: "localization" (default) diffs a translation against its canonical and buckets each prop change as advisory (translation owns it), needsTranslation (canonical owns translatable text), or autoApplied (canonical owns a non-translatable prop); "template" diffs a page against its template with structural and prop changes. Returns the classified summary (slotDelta, changes, and per-bucket counts). Read-only. To reconcile the drift, apply the changes on a branch with the existing edit tools (start_edit_session, apply_document_edits, complete_edit_session) — inserts pass through the slot-id backstop so ids stay unique.',
  inputSchema: GetDriftInputSchema,
  annotations: { title: 'Get drift', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const relationType = input.relation_type ?? 'localization';
      const result = await ctx.apiClient.getUpstreamDiff(
        input.site_id,
        input.branch_id,
        input.document_id,
        relationType,
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
