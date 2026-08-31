import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const ArchiveBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID). The main branch cannot be archived.'),
});

export const archiveBranchTool = defineTool({
  description:
    'Archive a branch once its work is merged or abandoned. Archiving hides the branch from the active list but preserves its history; use restore_branch to bring it back. The main branch cannot be archived. Confirm with the user before archiving unless they have authorized cleanup.',
  inputSchema: ArchiveBranchInputSchema,
  annotations: { title: 'Archive branch', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      await ctx.apiClient.archiveBranch(input.site_id, input.branch_id);
      return formatResult({
        message: 'Branch archived. Use restore_branch to bring it back.',
        branchId: input.branch_id,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
