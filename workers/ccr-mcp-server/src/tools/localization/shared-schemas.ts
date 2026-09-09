import z from 'zod';

export const RelationTypeEnum = z.enum(['template', 'localization']);

export const CanonicalDocumentInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
  canonical_document_id: z
    .string()
    .describe('The canonical document ID (UUID from list_documents)'),
});
