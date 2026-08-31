import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const ListSitesInputSchema = z.object({});

export const listSitesTool = defineTool({
  description:
    'List all sites accessible to you. Use this as your starting point to discover available sites before working with documents. Each site has a unique UUID — use that site_id in all subsequent calls.',
  inputSchema: ListSitesInputSchema,
  mutates: false,
  handler: async (ctx) => {
    try {
      const result = await ctx.apiClient.listSites();
      if (result.sites.length === 0) {
        return formatResult('No sites found.');
      }
      const formatted = result.sites
        .map((site) => `- "${site.name}"\n  site_id: ${site.id}`)
        .join('\n');
      return formatResult(`Sites (use the site_id UUID in subsequent calls):\n${formatted}`);
    } catch (error) {
      return formatError(error);
    }
  },
});
