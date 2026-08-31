import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { BranchStatusEnum } from './shared-schemas.js';

const UpdateBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches, NOT the name)'),
  name: z.string().min(1).optional().describe('New branch name. Must be unique within the site.'),
  description: z.string().optional().describe('New one-line description for the branch.'),
  status: BranchStatusEnum.optional().describe(
    'New lifecycle status: active, review, merged, or archived.',
  ),
});

export const updateBranchTool = defineTool({
  description:
    "Update a branch's name, description, or lifecycle status. Provide at least one of name, description, or status. Status moves a branch through its lifecycle (active → review → merged → archived). Renaming must keep the name unique within the site.",
  inputSchema: UpdateBranchInputSchema,
  annotations: { title: 'Update branch', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      if (input.name === undefined && input.description === undefined && input.status === undefined) {
        return formatError(
          new Error('Provide at least one of name, description, or status to update.'),
        );
      }
      const body: { name?: string; description?: string; status?: string } = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.description !== undefined) body.description = input.description;
      if (input.status !== undefined) body.status = input.status;

      const branch = await ctx.apiClient.updateBranch(input.site_id, input.branch_id, body);
      return formatResult({ message: `Branch "${branch.name}" updated.`, ...branch });
    } catch (error) {
      return formatError(error);
    }
  },
});
