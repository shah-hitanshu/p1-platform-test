import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { BranchScopedInputSchema } from './shared-schemas.js';

export const listTemplatesTool = defineTool({
  description:
    'List available templates on a branch. Returns template metadata including id, name, label, description, and deprecation status. Use this to discover available templates before calling create_page with template_id.',
  inputSchema: BranchScopedInputSchema,
  annotations: { title: 'List templates', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const templates = await ctx.apiClient.listTemplates(input.site_id, input.branch_id);

      if (templates.length === 0) {
        return formatResult('No templates found on this branch.');
      }

      const templateLines = templates.map((template) => {
        const label = template.label ?? template.name;
        const description = template.description ?? '';

        const deprecatedNote = template.deprecated === true ? ' [DEPRECATED]' : '';
        const descriptionNote = description !== '' ? ` — ${description}` : '';

        return `- ${template.name} (${label})${deprecatedNote}${descriptionNote}\n  template_id: ${template.id}`;
      });

      return formatResult(`Templates available on this branch (${String(templates.length)} total):\n${templateLines.join('\n')}`);
    } catch (error) {
      return formatError(error);
    }
  },
});
