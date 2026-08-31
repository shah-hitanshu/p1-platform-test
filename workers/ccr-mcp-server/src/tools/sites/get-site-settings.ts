import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { SiteIdInputSchema } from './shared-schemas.js';
import { formatSiteSettings } from './site-formatters.js';

export const getSiteSettingsTool = defineTool({
  description:
    "Read a site's cache TTLs, social sharing defaults (og:image, og:locale) and localization policy. These are separate from get_site, which covers the name, public URL and allowed origins. A localized site also reports how many documents exist per locale.",
  inputSchema: SiteIdInputSchema,
  annotations: { title: 'Get site settings', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.getSiteSettings(input.site_id);
      return formatResult(formatSiteSettings(result));
    } catch (error) {
      return formatError(error);
    }
  },
});
