import z from 'zod';
import { UpdateSiteSettingsRequest } from '../../shared/api-client.js';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { SiteLocalesSchema } from './shared-schemas.js';
import { formatSiteSettings } from './site-formatters.js';

const UpdateSiteSettingsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  cache_ttl_main: z
    .number()
    .nullable()
    .optional()
    .describe(
      'Seconds to cache published pages on the main workstream. 1 to 86400 (one day). Pass null to restore the default of 60.',
    ),
  cache_ttl_branch: z
    .number()
    .nullable()
    .optional()
    .describe(
      'Seconds to cache pages on non-main workstreams. 1 to 86400. Pass null to restore the default of 5.',
    ),
  og_image: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Site-wide og:image URL, inherited by any page that does not set its own. Max 2048 characters. Pass null to remove it.',
    ),
  og_locale: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Site-wide og:locale, inherited by any page that does not set its own, e.g. "en_US". Max 35 characters. Pass null to remove it.',
    ),
  locales: SiteLocalesSchema.nullable()
    .optional()
    .describe(
      'Localization policy for the site. Replaces the stored value wholesale — read it with get_site_settings first. Pass null to make the site non-localized.',
    ),
});

export const updateSiteSettingsTool = defineTool({
  description:
    "Update a site's cache TTLs, social sharing defaults or localization policy. Only the fields you pass change; pass null to clear one and fall back to its default. Requires admin on the site — an editor cannot change these.",
  inputSchema: UpdateSiteSettingsInputSchema,
  annotations: { title: 'Update site settings', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      // Same key-presence contract as update_site: the backend reads
      // `'ogImage' in body`, so an omitted key means "leave as-is" and an
      // explicit null deletes the key and restores its default.
      const body: UpdateSiteSettingsRequest = {};
      if ('cache_ttl_main' in input) body.cacheTtlMain = input.cache_ttl_main;
      if ('cache_ttl_branch' in input) body.cacheTtlBranch = input.cache_ttl_branch;
      if ('og_image' in input) body.ogImage = input.og_image;
      if ('og_locale' in input) body.ogLocale = input.og_locale;
      if ('locales' in input) body.locales = input.locales;

      if (Object.keys(body).length === 0) {
        return formatError(new Error('No settings supplied — nothing to update.'));
      }

      const result = await ctx.apiClient.updateSiteSettings(input.site_id, body);
      return formatResult(`Updated site settings.\n\n${formatSiteSettings(result)}`);
    } catch (error) {
      return formatError(error);
    }
  },
});
