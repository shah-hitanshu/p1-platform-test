import z from 'zod';

export const PageInStructureInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
});
