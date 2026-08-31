import z from 'zod';
import { UpdateSiteRequest } from '../../shared/api-client.js';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { WorkflowSettingsSchema } from './shared-schemas.js';
import { formatSiteConfig } from './site-formatters.js';

const UpdateSiteInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('New name for the site. Cannot be blank — there is no way to clear a site name.'),
  url: z
    .string()
    .nullable()
    .optional()
    .describe(
      'New public URL. Pass null to clear it. Omit the field entirely to leave the current value alone.',
    ),
  pantheon_site_id: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Pantheon hosting site to link to. Pass null to unlink. Omit the field entirely to leave the current value alone.',
    ),
  allowed_origins: z
    .array(z.string())
    .optional()
    .describe(
      'Replacement list of allowed origin patterns — this overwrites the stored list rather than appending, so call get_site first and send the full intended set. Never send [] to loosen a site that has origins configured: an empty list makes CORS accept every origin AND makes the login redirect flow refuse every origin, breaking sign-in. Send the intended origins instead.',
    ),
  workflow_settings: WorkflowSettingsSchema.optional().describe(
    'Merge-approval workflow fields to change. Merged with the stored settings.',
  ),
});

export const updateSiteTool = defineTool({
  description:
    "Update a site's configuration: name, public URL, linked Pantheon site, allowed origins, or merge-approval workflow. Requires admin on the site.",
  inputSchema: UpdateSiteInputSchema,
  annotations: { title: 'Update site', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      // Key presence is the wire contract: the backend distinguishes "leave
      // as-is" (key absent) from "clear" (key present, null) via `'url' in
      // body`, so a spread of undefined would silently mean the wrong thing.
      const body: UpdateSiteRequest = {};
      if (input.name !== undefined) body.name = input.name;
      if ('url' in input) body.url = input.url;
      if ('pantheon_site_id' in input) body.pantheonSiteId = input.pantheon_site_id;
      if (input.allowed_origins !== undefined) body.allowedOrigins = input.allowed_origins;
      if (input.workflow_settings !== undefined) body.workflowSettings = input.workflow_settings;

      if (Object.keys(body).length === 0) {
        return formatError(new Error('No configuration fields supplied — nothing to update.'));
      }

      const site = await ctx.apiClient.updateSite(input.site_id, body);
      return formatResult(`Updated site.\n\n${formatSiteConfig(site)}`);
    } catch (error) {
      return formatError(error);
    }
  },
});
