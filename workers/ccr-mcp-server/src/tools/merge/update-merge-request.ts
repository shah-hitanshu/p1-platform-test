import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { MergeRequestIdInputSchema, SettableMergeRequestStatusEnum } from './shared-schemas.js';

const UpdateMergeRequestInputSchema = MergeRequestIdInputSchema.extend({
  title: z.string().min(1).optional().describe('New title.'),
  description: z.string().optional().describe('New description.'),
  status: SettableMergeRequestStatusEnum.optional().describe(
    'New status. Set to "approved" to clear it for execution.',
  ),
});

export const updateMergeRequestTool = defineTool({
  description:
    "Update a merge request's title, description, or status. Provide at least one field. Set status to \"approved\" to clear the request for execution. Confirm approvals with the user — approving is a human decision.",
  inputSchema: UpdateMergeRequestInputSchema,
  annotations: { title: 'Update merge request', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      if (input.title === undefined && input.description === undefined && input.status === undefined) {
        return formatError(
          new Error('Provide at least one of title, description, or status to update.'),
        );
      }
      const body: { title?: string; description?: string; status?: string } = {};
      if (input.title !== undefined) body.title = input.title;
      if (input.description !== undefined) body.description = input.description;
      if (input.status !== undefined) body.status = input.status;

      const mergeRequest = await ctx.apiClient.updateMergeRequest(
        input.site_id,
        input.merge_request_id,
        body,
      );
      return formatResult({ message: 'Merge request updated.', ...mergeRequest });
    } catch (error) {
      return formatError(error);
    }
  },
});
