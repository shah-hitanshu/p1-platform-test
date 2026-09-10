import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { RelationTypeEnum } from './shared-schemas.js';

const GetDriftInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
  document_id: z
    .string()
    .describe('The source document ID (UUID). For localization this is the translation; for template it is the page.'),
  relation_type: RelationTypeEnum.optional().describe(
    'Which upstream edge to diff: "localization" (translation vs canonical, the default) or "template" (page vs template).',
  ),
  include_resolved: z
    .boolean()
    .optional()
    .describe(
      'Also list the changes already marked reconciled by resolve_drift. Off by default, so the answer is what is left to reconcile.',
    ),
});

export const getDriftTool = defineTool({
  description:
    'Report how a document\'s upstream edge target has drifted since the document was last synced, with each change classified. relation_type selects the edge: "localization" (default) diffs a translation against its canonical and buckets each prop change as advisory (translation owns it), needsTranslation (canonical owns translatable text), or autoApplied (canonical owns a non-translatable prop); "template" diffs a page against its template with structural and prop changes. Returns the classified summary (slotDelta, changes, per-bucket counts, and resolvedCount). For a localization edge, changes already marked reconciled are left out unless include_resolved is set, and a listed change carries resolvedAt when a mark still covers it. Read-only. To reconcile the drift, apply the changes on a workstream with the existing edit tools (start_edit_session, apply_document_edits, complete_edit_session) — inserts pass through the slot-id backstop so ids stay unique — then call resolve_drift for the props you settled, or they will be reported again on the next call.',
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
        input.include_resolved ?? false,
      );
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
