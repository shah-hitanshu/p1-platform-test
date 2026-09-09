import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { WorkflowSettingsSchema } from './shared-schemas.js';

const CreateSiteInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .describe('Human-readable name for the new site. Required and cannot be blank.'),
  url: z
    .string()
    .optional()
    .describe('Public URL of the site, e.g. "https://example.com". Must be http or https.'),
  pantheon_site_id: z
    .string()
    .optional()
    .describe(
      'ID of the Pantheon hosting site to link this site to. Omit to create an unlinked site — it can be linked later with update_site.',
    ),
  allowed_origins: z
    .array(z.string())
    .optional()
    .describe(
      'Origin patterns permitted to embed or authenticate against the site, e.g. ["https://example.com", "https://*.example.com"]. Each entry must include the scheme, carry at most one "*" in the leftmost label, and have no path. An empty or omitted list is not a neutral default: CORS then accepts every origin, while the login redirect flow refuses all of them. Configure the real origins instead of relying on it.',
    ),
  workflow_settings: WorkflowSettingsSchema.optional().describe(
    'Merge-approval workflow for the site. Omit to accept the defaults.',
  ),
});

export const createSiteTool = defineTool({
  description:
    'Create a new site, provisioned with a "main" workstream and a welcome page at "/". Requires an authenticated user session; agent API keys cannot create sites.',
  inputSchema: CreateSiteInputSchema,
  annotations: { title: 'Create site', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    // An agent-key site would be granted to the agent alone, and every later
    // call intersects the agent's access with its acting user's roles — the
    // site would be invisible to list_sites and unusable. The backend rejects
    // this too; checking here just saves a round trip and says why.
    if (ctx.apiClient.actorType !== 'user') {
      return formatError(
        new Error(
          'Site creation requires an authenticated user session. This connection uses an agent API key, so it cannot create sites. Ask the user to connect over OAuth and create the site from their own session.',
        ),
      );
    }

    try {
      const site = await ctx.apiClient.createSite({
        name: input.name,
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.pantheon_site_id !== undefined
          ? { pantheonSiteId: input.pantheon_site_id }
          : {}),
        ...(input.allowed_origins !== undefined
          ? { allowedOrigins: input.allowed_origins }
          : {}),
        ...(input.workflow_settings !== undefined
          ? { workflowSettings: input.workflow_settings }
          : {}),
      });

      return formatResult(
        `Created site "${site.name}".\n`
          + `  site_id: ${site.id}\n`
          + '\nThe site is ready to use: a "main" workstream exists and a welcome page is seeded at "/". '
          + 'Call list_branches to get the main branch_id, then list_documents or create_page to start authoring.',
      );
    } catch (error) {
      return formatError(error);
    }
  },
});
