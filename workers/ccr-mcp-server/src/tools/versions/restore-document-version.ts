import z from 'zod';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { DocumentScopedInputSchema } from './shared-schemas.js';

const RestoreDocumentVersionInputSchema = DocumentScopedInputSchema.extend({
  version_id: z
    .string()
    .uuid('Must be the version UUID from list_document_versions.')
    .describe('The version ID (UUID) to roll the document back to'),
});

export const restoreDocumentVersionTool = defineTool({
  description:
    "Roll a document back to a prior version by writing that version's snapshot as a new, current version. History is append-only, so the older versions are preserved and the rollback can itself be undone. Confirm with the user before overwriting current content.",
  inputSchema: RestoreDocumentVersionInputSchema,
  annotations: { title: 'Restore document version', destructiveHint: false, idempotentHint: false },
  mutates: true,
  // TODO(PCC-3294): the restored version is written as a plain edit with no
  // marker that it is a rollback, so history cannot distinguish a restore
  // from a normal change. Record restore provenance, ideally via the
  // server-side restore endpoint proposed in PCC-3206.
  handler: async (ctx, input) => {
    try {
      const version = await ctx.apiClient.getDocumentVersion(
        input.site_id,
        input.branch_id,
        input.document_id,
        input.version_id,
      );
      const snapshot = version.snapshot;
      if (snapshot === undefined || snapshot === null) {
        return formatError(new Error('The target version has no snapshot to restore.'));
      }
      const created = await ctx.apiClient.createDocumentVersion(
        input.site_id,
        input.branch_id,
        input.document_id,
        snapshot,
      );
      return formatResult({
        message: `Document rolled back to the contents of version ${input.version_id}.`,
        ...created,
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
