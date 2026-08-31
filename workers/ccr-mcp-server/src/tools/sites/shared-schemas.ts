import z from 'zod';

export const WorkflowSettingsSchema = z.object({
  mergeApprovalMode: z
    .enum(['none', 'optional', 'required'])
    .optional()
    .describe('Whether merges into main need approval. Defaults to "optional".'),
  minApprovers: z.number().optional().describe('How many approvals a merge needs. Defaults to 1.'),
  allowSelfApproval: z
    .boolean()
    .optional()
    .describe('Whether the author of a change may approve it. Defaults to true.'),
  approverMode: z
    .enum(['role_based', 'explicit', 'both'])
    .optional()
    .describe('How approvers are determined. Defaults to "both".'),
  approverMinRole: z
    .enum(['EDITOR', 'ADMIN'])
    .optional()
    .describe('Lowest role that may approve when approverMode is role_based or both.'),
});

export const SiteLocalesSchema = z.object({
  markets: z
    .array(z.string())
    .describe('Locale codes this site publishes, e.g. ["en-US", "fr-FR"]. At most 1000.'),
  policy: z
    .enum(['fallback', 'localized-only'])
    .describe(
      '"fallback" serves the default locale when a translation is missing; "localized-only" serves nothing.',
    ),
});

export const SiteIdInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
});
