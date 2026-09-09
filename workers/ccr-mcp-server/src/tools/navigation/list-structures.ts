import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { StructureTypeEnum } from './shared-schemas.js';

const ListStructuresInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
  structure_type: StructureTypeEnum.optional().describe(
    'Filter by type: hierarchy (nested navigation) or collection (flat list).',
  ),
});

export const listStructuresTool = defineTool({
  description:
    'List the navigation structures on a workstream. A structure is the container for a navigation tree; every navigation and metadata tool needs a structure_id, and this is how you discover one. Filter by type with structure_type. Use the structure_id UUID in subsequent calls.',
  inputSchema: ListStructuresInputSchema,
  annotations: { title: 'List structures', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.listStructures(
        input.site_id,
        input.branch_id,
        input.structure_type !== undefined ? { structureType: input.structure_type } : undefined,
      );
      if (result.structures.length === 0) {
        return formatResult('No structures found on this workstream.');
      }
      return formatResult(result);
    } catch (error) {
      return formatError(error);
    }
  },
});
