import z from 'zod';

export const BranchScopedInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
});

export const NamedQueryInputSchema = BranchScopedInputSchema.extend({
  query_name: z.string().describe('The query name (from list_queries)'),
});
