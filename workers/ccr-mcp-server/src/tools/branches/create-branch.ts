import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const CreateBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  name: z.string().min(1).describe(
    'Branch name. Must be unique per site (server returns 409 on duplicate). '
    + 'Recommended: lowercase-kebab, e.g. "draft-hero-rewrite" or "fix-pricing-typo".',
  ),
  description: z.string().optional().describe(
    'Optional one-line note about why this branch exists, visible to humans '
    + 'in the dashboard. Recommended: include the task or ticket reference.',
  ),
  parent_branch_id: z.string().optional().describe(
    'Optional UUID of the main branch. Only the site\'s main branch is supported as a source — '
    + 'passing any other branch UUID will result in an error. Omit to use the main branch automatically.',
  ),
});

export const createBranchTool = defineTool({
  description:
    'Create a new branch on a site. Branches are isolated workspaces — edits made on a non-main branch do not affect the live site until the branch is published to main. Use this when starting a new piece of work that should be reviewable before going live. WORKFLOW: (1) Call `list_branches` first to confirm the desired name is not already in use. (2) Choose a name that hints at the work, lowercase-kebab style (e.g. "draft-hero-rewrite"). (3) After creating the branch, all subsequent edit-session calls should reference the new `branch_id`. The branch appears in the human dashboard immediately — confirm with the user before creating a branch unless they have explicitly authorized you to start new work.',
  inputSchema: CreateBranchInputSchema,
  annotations: { title: 'Create branch', destructiveHint: false, idempotentHint: false },
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
        message: `Branch "${branch.name}" created.`,
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
