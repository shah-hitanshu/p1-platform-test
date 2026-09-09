import z from 'zod';

export const DocumentOnBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path'),
});

export const EditIntentInputSchema = DocumentOnBranchInputSchema.extend({
  intent: z.string().describe('Description of what you intend to do'),
  target_regions: z.array(z.string()).describe('JSON paths of regions to edit'),
});

export const EditOperationSchema = z.object({
  type: z.enum(['add', 'remove', 'replace', 'move', 'reorder']).describe('Operation type'),
  path: z.string().describe('Dot-notation path using numeric indices for arrays. Example: "content.0.props.title" — NOT "content[0].props.title" (bracket notation corrupts the document) and NOT "/content/0/props/title" (JSON Pointer format)'),
  content: z.unknown().optional().describe('Content for add/replace operations'),
  index: z.number().optional().describe('Index for array operations'),
  fromIndex: z.number().optional().describe('Source index for reorder operations'),
  toIndex: z.number().optional().describe('Target index for reorder operations'),
});

export type EditOperationShape = z.infer<typeof EditOperationSchema>;
