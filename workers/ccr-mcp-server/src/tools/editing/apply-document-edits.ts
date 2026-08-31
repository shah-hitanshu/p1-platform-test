import z from 'zod';
import { validateDocumentStructure } from '@pantheon-systems/p1-content-validator';
import { formatValidationError, validateOps } from '../shared/validate-ops.functions.js';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { collectAuthorityWarnings, formatAuthorityWarnings } from './authority-warnings.js';
import { normalizePath } from './normalize-path.js';
import { remintOperationIds } from './remint-operation-ids.js';
import { DocumentOnBranchInputSchema, EditOperationSchema } from './shared-schemas.js';
import { formatStructuralError } from './structural-errors.js';

const ApplyDocumentEditsInputSchema = DocumentOnBranchInputSchema.extend({
  edit_session_id: z.string().describe('The edit session ID from start_edit_session (REQUIRED)'),
  operations: z.array(EditOperationSchema).describe('Edit operations to apply'),
});

export const applyDocumentEditsTool = defineTool({
  description:
    'Apply edit operations to modify document content. REQUIRES a valid edit_session_id from start_edit_session. PATH FORMAT: Use dot-notation with numeric indices for arrays. CORRECT: "content.0.props.title". WRONG: "content[0].props.title" (creates a literal key "[0]" — corrupts the document). WRONG: "/content/0/props/title" (JSON Pointer format). OPERATIONS: "replace" overwrites a value at an existing path (use for modifying existing content). "add" inserts new content. "remove" deletes content at a path. "move" moves an array element from one index to another. "reorder" reorders elements within an array. CRITICAL GUIDELINES: Before using "add" on a path that already has content, ask the user if they want to overwrite (use "replace") or add alongside the existing content. Never create duplicate top-level keys — a document should have exactly one "content" array and one "root" object. When modifying a component\'s properties, target the specific property path (e.g., "content.0.props.title") rather than replacing the entire component, to preserve other properties. If you need to replace an entire component, use "replace" on "content.N" where N is the component\'s index.',
  inputSchema: ApplyDocumentEditsInputSchema,
  annotations: { title: 'Apply document edits', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      const normalizedOperations = input.operations.map((op) => ({
        ...op,
        path: normalizePath(op.path),
      }));

      // Fetch the current document snapshot for validation.
      // Used by both validateOps (component schema) and validateDocumentStructure (template conformance).
      let currentSnapshot: Record<string, unknown> | undefined;
      let documentTemplateId: string | undefined;
      let documentId: string | undefined;
      try {
        const doc = await ctx.apiClient.getDocument(
          input.site_id,
          input.branch_id,
          input.document_path,
        );
        currentSnapshot = doc.snapshot;
      } catch {
        // Proceed without snapshot — component validation still runs if enabled
      }

      // Look up document metadata to get templateId for structural validation.
      // The snapshot endpoint (realtime handler) doesn't return document metadata,
      // so we use the by-path endpoint which returns the Document record.
      try {
        const docInfo = await ctx.apiClient.lookupDocumentByPath(
          input.site_id,
          input.document_path,
        );
        if (docInfo !== null) {
          documentTemplateId = docInfo.templateId;
          documentId = docInfo.id;
        }
      } catch {
        // Proceed without template validation
      }

      // Agent-supplied component content is an injection boundary: re-mint
      // component ids before the ops reach the backend. A whole-component or
      // whole-array replace that cannot read a reliable current occupant rejects
      // the whole request before anything is forwarded.
      const prepared = remintOperationIds(normalizedOperations, currentSnapshot);
      if (!prepared.ok) {
        return formatError(prepared.reason);
      }
      const preparedOperations = prepared.operations;

      // Validate ops against the component registry before sending to CCR.
      // Only runs when enableValidation is set on the client config (production).
      // If the registry fetch fails for any reason, proceed without validation
      // (graceful degradation — the backend will still enforce its own rules).
      if (ctx.apiClient.validationEnabled) {
        try {
          const registry = await ctx.apiClient.fetchRegistrySchemas(input.site_id, input.branch_id);

          const result = validateOps({
            operations: preparedOperations,
            registry,
            currentSnapshot,
          });
          if (result.errors.length > 0) {
            return formatValidationError(result.errors);
          }
        } catch (error: unknown) {
          // Registry fetch failed — proceed without validation
          void error;
        }
      }

      const authorityWarnings = await collectAuthorityWarnings(
        ctx.apiClient,
        input.site_id,
        input.branch_id,
        documentId,
        currentSnapshot,
        preparedOperations,
      );

      // Apply edits to the backend
      const result = await ctx.apiClient.applyEdits({
        siteId: input.site_id,
        branchId: input.branch_id,
        documentPath: input.document_path,
        editSessionId: input.edit_session_id,
        operations: preparedOperations,
      });

      // Structure validation: if document has templateId, validate conformance AFTER applying.
      // Only runs when enableValidation is set on the client config (production).
      // NOTE: Validation happens post-edit because we need the backend to apply operations.
      // If validation fails, the agent should call abort_edit_session to rollback.
      if (ctx.apiClient.validationEnabled && documentTemplateId !== undefined) {
        try {
          // Fetch the updated document snapshot after edits
          const updatedDoc = await ctx.apiClient.getDocument(
            input.site_id,
            input.branch_id,
            input.document_path,
          );

          // Fetch the template's content-shaped snapshot (returns flat fields, not wrapped in .snapshot)
          const template = await ctx.apiClient.getTemplate(
            input.site_id,
            input.branch_id,
            documentTemplateId,
          );

          // Validate structure conformance
          const validationResult = validateDocumentStructure({
            documentSnapshot: updatedDoc.snapshot,
            templateSnapshot: template,
          });

          if (validationResult.errors.length > 0) {
            // Structure validation failed. Return error with guidance to abort the session.
            const errorResult = formatStructuralError(validationResult.errors);
            errorResult.content[0].text += '\n\nThe edits were applied but violate template structure. Call abort_edit_session to rollback these changes.';
            return errorResult;
          }
        } catch (error: unknown) {
          // Template fetch or validation failed — proceed without structure validation
          void error;
        }
      }

      const applied = formatResult({
        success: result.success,
        version: result.version,
        message: 'Edits applied successfully.',
      });
      if (authorityWarnings.length > 0) {
        applied.content[0].text += formatAuthorityWarnings(authorityWarnings);
      }
      return applied;
    } catch (error) {
      return formatError(error);
    }
  },
});
