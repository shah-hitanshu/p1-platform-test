import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const CreateBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  name: z.string().min(1).describe(
    'Workstream name, as a human would write it. Must be unique per site '
    + '(server returns 409 on duplicate). No style is imposed — take the wording '
    + 'from how the user described the work.',
  ),
  description: z.string().optional().describe(
    'Optional one-line note about why this workstream exists, visible to humans '
    + 'in the dashboard. Recommended: include the task or ticket reference.',
  ),
  parent_branch_id: z.string().optional().describe(
    'Optional UUID of the main workstream. Only the site\'s main workstream is supported as a source — '
    + 'passing any other workstream UUID will result in an error. Omit to use the main workstream automatically.',
  ),
});

export const createBranchTool = defineTool({
  description:
    'Create a new workstream on a site. Workstreams are isolated workspaces — edits made on a non-main workstream do not affect the live site until the workstream is published to main. Use this when starting a new piece of work that should be reviewable before going live. WORKFLOW: (1) Call `list_branches` first to confirm the desired name is not already in use. (2) Name it the way the user would: the workstream is identified by its `branch_id`, so the name exists purely for people reading the dashboard. Take the wording from how the user described the work, and match the naming style of the workstreams already on the site. (3) After creating the workstream, all subsequent edit-session calls should reference the new `branch_id`. The workstream appears in the human dashboard immediately — confirm with the user before creating a workstream unless they have explicitly authorized you to start new work.',
  inputSchema: CreateBranchInputSchema,
  annotations: { title: 'Create workstream', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const request: { name: string; description?: string; parentBranchId?: string } = {
        name: input.name,
      };
      if (input.description !== undefined) {
        request.description = input.description;
      }
      if (input.parent_branch_id !== undefined) {
        request.parentBranchId = input.parent_branch_id;
      }

      const branch = await ctx.apiClient.createBranch(input.site_id, request);

      return formatResult({
        message: `Workstream "${branch.name}" created.`,
        branchId: branch.id,
        name: branch.name,
        siteId: branch.siteId,
        status: branch.status,
        isMain: branch.isMain,
        ...(branch.description !== undefined && { description: branch.description }),
        ...(branch.sourceBranchId !== undefined && { sourceBranchId: branch.sourceBranchId }),
        ...(branch.sourceCheckpointId !== undefined && { sourceCheckpointId: branch.sourceCheckpointId }),
        createdById: branch.createdById,
        createdByType: branch.createdByType,
        createdAt: branch.createdAt,
        updatedAt: branch.updatedAt,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
