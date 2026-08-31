import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { DocumentOnBranchInputSchema } from './shared-schemas.js';

const CompleteEditSessionInputSchema = DocumentOnBranchInputSchema.extend({
  edit_session_id: z.string().describe('The edit session ID from start_edit_session'),
});

export const completeEditSessionTool = defineTool({
  description:
    'Complete an edit session successfully and save your changes. This creates a post-edit checkpoint. Always call this when you are done making edits — do not leave sessions open. Before completing, consider using get_document to verify your changes look correct. If the result is not what you expected, use abort_edit_session instead.',
  inputSchema: CompleteEditSessionInputSchema,
  annotations: { title: 'Complete edit session', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.completeAgentEdit({
        siteId: input.site_id,
        branchId: input.branch_id,
        documentPath: input.document_path,
        editSessionId: input.edit_session_id,
      });
      const message = result.checkpointId
        ? `Edit session completed. Checkpoint: ${result.checkpointId}`
        : 'Edit session completed.';
      return formatResult({
        success: result.success,
        ...(result.checkpointId && { checkpointId: result.checkpointId }),
        message,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
