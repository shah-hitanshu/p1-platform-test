import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { DocumentOnBranchInputSchema } from './shared-schemas.js';

const CompleteEditSessionInputSchema = DocumentOnBranchInputSchema.extend({
  edit_session_id: z.string().describe('The edit session ID from start_edit_session'),
});

export const completeEditSessionTool = defineTool({
  description:
    'Complete an edit session successfully and save your changes. This returns once the changes are readable, so there is no need to re-read the page to confirm they landed. It also creates a post-edit checkpoint. Always call this when you are done making edits — do not leave sessions open. If the result is not what you expected, use abort_edit_session instead.',
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
        ? `Edit session completed and changes are readable. Checkpoint: ${result.checkpointId}`
        : 'Edit session completed and changes are readable.';
      return formatResult({
        success: result.success,
        ...(result.checkpointId && { checkpointId: result.checkpointId }),
        ...(result.versionId !== undefined && result.versionId !== ''
          ? { versionId: result.versionId }
          : {}),
        message,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
