import z from 'zod';

export const BranchStatusEnum = z.enum(['active', 'review', 'merged', 'archived']);

export const SiteIdInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
});

export const BranchIdInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
});
