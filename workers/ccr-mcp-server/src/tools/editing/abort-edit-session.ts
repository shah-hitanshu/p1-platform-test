import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { DocumentOnBranchInputSchema } from './shared-schemas.js';

const AbortEditSessionInputSchema = DocumentOnBranchInputSchema.extend({
  edit_session_id: z.string().describe('The edit session ID from start_edit_session'),
  reason: z.string().optional().describe('Reason for aborting the edit'),
});

export const abortEditSessionTool = defineTool({
  description:
    'Abort an edit session and roll back all changes to the pre-edit checkpoint. Use this when: something went wrong during editing, the user wants to cancel, or you realize your edits produced unexpected results (use get_document to check). Provide a reason so the rollback is auditable. After aborting, you can start a fresh edit session if needed.',
  inputSchema: AbortEditSessionInputSchema,
  annotations: { title: 'Abort edit session', destructiveHint: true, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.abortAgentEdit({
        siteId: input.site_id,
        branchId: input.branch_id,
        documentPath: input.document_path,
        editSessionId: input.edit_session_id,
        reason: input.reason,
      });
      return formatResult({
        success: result.success,
        rolledBack: result.rolledBack,
        message: result.rolledBack
          ? 'Edit session aborted and changes rolled back.'
          : 'Edit session aborted.',
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
