import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { NodeTypeEnum, StructureScopedInputSchema } from './shared-schemas.js';

const AddNavigationItemInputSchema = StructureScopedInputSchema.extend({
  name: z.string().min(1).describe('Display label for the navigation item.'),
  slug: z.string().min(1).describe('URL slug, unique within the parent.'),
  node_type: NodeTypeEnum.describe(
    'section groups other items, document links to a page, external links to a URL.',
  ),
  position: z.number().describe('Order among siblings (0 is first).'),
  parent_node_id: z
    .string()
    .optional()
    .describe('Parent node ID (UUID). Omit for a top-level item.'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .optional()
    .describe('Document ID (UUID). Required when node_type is "document".'),
  external_url: z
    .string()
    .optional()
    .describe('Destination URL. Required when node_type is "external".'),
});

export const addNavigationItemTool = defineTool({
  description:
    'Place a new item in the navigation tree: a section (a grouping), a document (a link to a page, requires document_id), or an external link (requires external_url). position sets the order among siblings; omit parent_node_id for a top-level item. The slug must be unique within the parent.',
  inputSchema: AddNavigationItemInputSchema,
  annotations: { title: 'Add navigation item', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      if (input.node_type === 'document' && (input.document_id === undefined || input.document_id === '')) {
        return formatError(new Error('document_id is required when node_type is "document".'));
      }
      if (input.node_type === 'external' && (input.external_url === undefined || input.external_url === '')) {
        return formatError(new Error('external_url is required when node_type is "external".'));
      }
      const body: {
        name: string;
        slug: string;
        nodeType: string;
        position: number;
        parentNodeId?: string;
        documentId?: string;
        externalUrl?: string;
      } = {
        name: input.name,
        slug: input.slug,
        nodeType: input.node_type,
        position: input.position,
      };
      if (input.parent_node_id !== undefined) body.parentNodeId = input.parent_node_id;
      if (input.document_id !== undefined) body.documentId = input.document_id;
      if (input.external_url !== undefined) body.externalUrl = input.external_url;

      const node = await ctx.apiClient.createNode(
        input.site_id,
        input.branch_id,
        input.structure_id,
        body,
      );
      return formatResult({ message: 'Navigation item created.', ...node });
    } catch (error) {
      return formatError(error);
    }
  },
});
