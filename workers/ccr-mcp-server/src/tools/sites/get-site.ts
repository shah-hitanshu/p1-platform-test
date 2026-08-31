import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { SiteIdInputSchema } from './shared-schemas.js';
import { formatSiteConfig } from './site-formatters.js';

export const getSiteTool = defineTool({
  description:
    "Read a site's configuration: name, public URL, linked Pantheon site, allowed origins, and merge-approval workflow settings.",
  inputSchema: SiteIdInputSchema,
  annotations: { title: 'Get site', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const site = await ctx.apiClient.getSite(input.site_id);
      return formatResult(formatSiteConfig(site));
    } catch (error) {
      return formatError(error);
    }
  },
});
