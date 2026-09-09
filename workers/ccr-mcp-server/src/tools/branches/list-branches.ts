import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { SiteIdInputSchema } from './shared-schemas.js';

export const listBranchesTool = defineTool({
  description:
    'List all workstreams for a site. Every site has a "main" workstream (marked [default]). Edits typically happen on non-main workstreams and are published to main. Use the branch_id UUID in subsequent calls — never use the workstream name as an identifier.',
  inputSchema: SiteIdInputSchema,
  annotations: { title: 'List workstreams', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.listBranches(input.site_id);
      if (result.branches.length === 0) {
        return formatResult('No workstreams found for this site.');
      }
      const formatted = result.branches
        .map((branch) => {
          const mainTag = branch.isMain ? ' [default]' : '';
          return `- "${branch.name}"${mainTag}\n  branch_id: ${branch.id}\n  status: ${branch.status}`;
        })
        .join('\n');
      return formatResult(`Workstreams (use the branch_id UUID, not the name):\n${formatted}`);
    } catch (error) {
      return formatError(error);
    }
  },
});
