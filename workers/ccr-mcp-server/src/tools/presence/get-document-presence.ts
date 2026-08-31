import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const GetDocumentPresenceInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path'),
});

export const getDocumentPresenceTool = defineTool({
  description:
    'Get detailed presence information for a specific document. Shows all actors (humans and agents) currently viewing or editing, their focus regions, state, and intent. Check this before editing to understand if anyone else is actively working on the document.',
  inputSchema: GetDocumentPresenceInputSchema,
  annotations: { title: 'Get document presence', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.getDocumentPresence(
        input.site_id,
        input.branch_id,
        input.document_path,
      );
      if (result.presences.length === 0) {
        return formatResult(`No one is currently viewing or editing "${input.document_path}".`);
      }
      const presenceList = result.presences.map((actor) => {
        const roleTag = actor.role === 'agent' ? ' [agent]' : ' [human]';
        const stateInfo = `state: ${actor.state}`;
        const intentInfo = actor.intent !== undefined && actor.intent !== '' ? `, intent: "${actor.intent}"` : '';
        const regionsInfo =
          actor.focusRegions && actor.focusRegions.length > 0
            ? `, focus: ${actor.focusRegions.join(', ')}`
            : '';
        return `- ${actor.name}${roleTag}: ${stateInfo}${intentInfo}${regionsInfo}`;
      });
      return formatResult({
        documentPath: input.document_path,
        actorCount: result.presences.length,
        actors: presenceList.join('\n'),
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
