import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { EditIntentInputSchema } from './shared-schemas.js';

export const startEditSessionTool = defineTool({
  description:
    'Start an edit session on a document. This reserves your target regions and creates a checkpoint that enables rollback if something goes wrong. You must call check_edit_permission first. IMPORTANT WORKFLOW: (1) You MUST have called get_document already to understand the current content. (2) Describe your intent clearly — this is visible to other collaborators. (3) Only reserve target_regions you actually plan to modify. (4) If the user\'s request is ambiguous (e.g., "update the content"), confirm with them whether they want to overwrite existing content or add new content before starting the session.',
  inputSchema: EditIntentInputSchema,
  annotations: { title: 'Start edit session', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.startAgentEdit({
        siteId: input.site_id,
        branchId: input.branch_id,
        documentPath: input.document_path,
        intent: input.intent,
        targetRegions: input.target_regions,
        trigger: ctx.trigger,
        requestedById: ctx.requestedById,
      });
      return formatResult({
        editSessionId: result.editSessionId,
        checkpointId: result.checkpointId,
        expiresAt: result.expiresAt,
        reservedRegions: result.reservedRegions,
        message:
          'Edit session started. Use apply_document_edits to make changes, then complete_edit_session when done.',
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
