import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { EditIntentInputSchema } from './shared-schemas.js';

export const checkEditPermissionTool = defineTool({
  description:
    'Check if you have permission to edit a document. You MUST call this before start_edit_session to verify no humans are actively editing the same regions. Specify target_regions as the path of each block you intend to modify (e.g., ["content.0.props", "content.1"]). Be specific — only claim regions you actually plan to change. If permission is denied due to conflicts, inform the user and wait rather than retrying immediately.',
  inputSchema: EditIntentInputSchema,
  annotations: { title: 'Check edit permission', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.canAgentEdit({
        siteId: input.site_id,
        branchId: input.branch_id,
        documentPath: input.document_path,
        intent: input.intent,
        targetRegions: input.target_regions,
        trigger: ctx.trigger,
        requestedById: ctx.requestedById,
      });
      if (result.canEdit) {
        return formatResult({
          canEdit: true,
          message: 'Permission granted. You may proceed with start_edit_session.',
        });
      }
      return formatResult({
        canEdit: false,
        reason: result.reason,
        message:
          result.message ?? 'Edit permission denied. Please wait and try again.',
        conflictingRegions: result.conflictingRegions,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
