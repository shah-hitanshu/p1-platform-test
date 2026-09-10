import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';

/** Ceiling on how many changes one call settles, so a single tool call stays bounded. */
const MAX_FIELDS = 100;

const ResolveDriftInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The workstream ID (UUID from list_branches)'),
  document_id: z.string().describe('The translation document ID (UUID) whose drift was reconciled'),
  fields: z
    .array(
      z.object({
        slot_id: z
          .string()
          .min(1)
          .describe('Slot id of the component the change is on, or "__root__" for a page prop'),
        prop_path: z
          .string()
          .min(1)
          .describe('The change\'s propPath from get_drift, verbatim, e.g. "/title" or "/badge/label"'),
      }),
    )
    .min(1)
    .max(MAX_FIELDS)
    .describe('The changes to mark, each taken from a get_drift change\'s componentId and propPath'),
  upstream_version_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The toVersionId from the get_drift call these changes were read from. Required when recording, so what gets settled is the state you were shown; a change the canonical made after that stays outstanding. Not used when clearing.',
    ),
  resolved: z
    .boolean()
    .optional()
    .describe(
      'True (the default) records the changes as reconciled. False clears those records, so get_drift reports them again.',
    ),
});

export const resolveDriftTool = defineTool({
  description:
    'Record that changes get_drift reported on a translation have been reconciled against their canonical, so it stops reporting them. Mark a change once you have taken the canonical value, written your own translation of it, or decided the translation should keep what it has — all three settle it. Name each change by its componentId and its propPath exactly as get_drift gave them, so marking one change leaves the others on that field outstanding. Pass upstream_version_id as the toVersionId from the get_drift call the changes came from, so what gets settled is the state you were shown: a change the canonical made after that stays outstanding, and one it makes again later returns to the list on its own. Marks are held per workstream. Pass resolved: false to undo a mark. Structural changes cannot be marked, since reconciling one means moving blocks on the canvas, and a slot the canonical no longer holds is refused.',
  inputSchema: ResolveDriftInputSchema,
  annotations: { title: 'Resolve drift', destructiveHint: false, idempotentHint: true },
  mutates: true,
  handler: async (ctx, input) => {
    const resolved = input.resolved ?? true;
    if (resolved && input.upstream_version_id === undefined) {
      return formatError(
        new Error(
          'upstream_version_id is required when recording; pass the toVersionId from get_drift.',
        ),
      );
    }

    try {
      // One request for the batch, which the route settles in one statement: the
      // whole batch lands or none of it does.
      const result = await ctx.apiClient.setUpstreamResolutions(
        input.site_id,
        input.branch_id,
        input.document_id,
        input.fields.map((field) => ({ slotId: field.slot_id, propPath: field.prop_path })),
        resolved,
        input.upstream_version_id,
      );
      const count = String(input.fields.length);
      return formatResult({
        message: resolved
          ? `Marked ${count} change(s) as reconciled.`
          : `Cleared ${count} mark(s).`,
        upstreamResolutions: result.upstreamResolutions,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
