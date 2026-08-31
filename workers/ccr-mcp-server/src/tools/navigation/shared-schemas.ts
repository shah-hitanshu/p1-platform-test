import z from 'zod';

export const StructureTypeEnum = z.enum(['hierarchy', 'collection']);
export const NodeTypeEnum = z.enum(['section', 'document', 'external']);

export const StructureScopedInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
});
