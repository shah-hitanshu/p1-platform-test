import z from 'zod';

export const BranchScopedInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
});
