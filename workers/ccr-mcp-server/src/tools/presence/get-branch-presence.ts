import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

const GetBranchPresenceInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
});

export const getBranchPresenceTool = defineTool({
  description:
    'Get presence information for all documents on a workstream. Shows who is currently viewing or editing each document. Use this to understand the collaboration landscape before making edits — it helps you avoid conflicts with other editors.',
  inputSchema: GetBranchPresenceInputSchema,
  annotations: { title: 'Get workstream presence', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const result = await ctx.apiClient.getBranchPresence(input.site_id, input.branch_id);
      if (result.totalDocuments === 0) {
        return formatResult('No active presence on this workstream.');
      }
      const documentsSummary = result.documents.map((doc) => {
        const actorsList = doc.actors
          .map((actor) => {
            const roleTag = actor.role === 'agent' ? ' [agent]' : '';
            const stateTag = actor.state === 'editing' ? ' (editing)' : '';
            const intentInfo = actor.intent !== undefined && actor.intent !== '' ? ` - intent: ${actor.intent}` : '';
            return `    - ${actor.name}${roleTag}${stateTag}${intentInfo}`;
          })
          .join('\n');
        return `Document: ${doc.documentPath}\n  Active actors (${String(doc.actorCount)}):\n${actorsList}`;
      });
      return formatResult({
        siteId: result.siteId,
        branchId: result.branchId,
        totalActors: result.totalActors,
        totalDocuments: result.totalDocuments,
        summary: documentsSummary.join('\n\n'),
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
