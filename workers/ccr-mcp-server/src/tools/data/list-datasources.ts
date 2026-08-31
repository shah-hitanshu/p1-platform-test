import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { BranchScopedInputSchema } from './shared-schemas.js';

export const listDatasourcesTool = defineTool({
  description:
    'List all datasources on a branch. Datasources define WHERE data comes from (content type templates). Auto-generated when templates are created.',
  inputSchema: BranchScopedInputSchema,
  annotations: { title: 'List datasources', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.listDatasources(input.site_id, input.branch_id);
      if (result.datasources.length === 0) {
        return formatResult('No datasources found on this branch.');
      }
      const formatted = result.datasources
        .map((ds: Record<string, unknown>) => {
          const rawDesc = ds.description;
          const desc = typeof rawDesc === 'string' ? ` — ${rawDesc}` : '';
          return `- ${String(ds.name)} (template: ${String(ds.templateName)})${desc}`;
        })
        .join('\n');
      return formatResult(`Datasources:\n${formatted}`);
    } catch (error) {
      return formatError(error);
    }
  },
});
