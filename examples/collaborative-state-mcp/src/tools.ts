/**
 * MCP Tools for Collaborative State System
 *
 * Defines the tools that expose the Agent Politeness workflow
 * to Claude Desktop via the Model Context Protocol.
 */

import { z } from 'zod';
import type { ApiClient, EditOperation } from './api-client.js';

// =============================================================================
// Tool Definition Types
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// =============================================================================
// Input Schemas
// =============================================================================

const ListSitesInputSchema = z.object({});

const ListBranchesInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
});

const ListDocumentsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches, NOT the branch name)'),
});

const GetDocumentInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path (e.g., "/home")'),
  region: z
    .string()
    .optional()
    .describe('Optional JSON path to extract a specific region (e.g., "/content/body")'),
});

const CheckEditPermissionInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path'),
  intent: z.string().describe('Description of what you intend to do'),
  target_regions: z.array(z.string()).describe('JSON paths of regions to edit'),
});

const StartEditSessionInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path'),
  intent: z.string().describe('Description of what you intend to do'),
  target_regions: z.array(z.string()).describe('JSON paths of regions to edit'),
});

const ApplyDocumentEditsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path'),
  edit_session_id: z.string().describe('The edit session ID from start_edit_session (REQUIRED)'),
  operations: z
    .array(
      z.object({
        type: z.enum(['add', 'remove', 'replace', 'move', 'reorder']).describe('Operation type'),
        path: z.string().describe('Dot-notation path to the property (e.g., "content.0.props.title" NOT "/content/0/props/title")'),
        content: z.unknown().optional().describe('Content for add/replace operations'),
        index: z.number().optional().describe('Index for array operations'),
        fromIndex: z.number().optional().describe('Source index for reorder operations'),
        toIndex: z.number().optional().describe('Target index for reorder operations'),
      }),
    )
    .describe('Edit operations to apply. IMPORTANT: Use dot-notation paths like "content.0.props.title"'),
});

const CompleteEditSessionInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path'),
  edit_session_id: z.string().describe('The edit session ID from start_edit_session'),
});

const AbortEditSessionInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path'),
  edit_session_id: z.string().describe('The edit session ID from start_edit_session'),
  reason: z.string().optional().describe('Reason for aborting the edit'),
});

const GetBranchPresenceInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
});

const GetDocumentPresenceInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('The document path'),
});

// =============================================================================
// Tool Definitions
// =============================================================================

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_sites',
      description:
        'List all sites accessible to you. Use this to discover what sites are available before working with documents.',
      inputSchema: ListSitesInputSchema,
    },
    {
      name: 'list_branches',
      description:
        'List all branches for a site. Use this to discover what branches are available (e.g., "main", "staging").',
      inputSchema: ListBranchesInputSchema,
    },
    {
      name: 'list_documents',
      description:
        'List all documents in a site branch. Use this to discover what documents are available to edit.',
      inputSchema: ListDocumentsInputSchema,
    },
    {
      name: 'get_document',
      description:
        'Get the content of a document. Optionally specify a region to get just a portion of the document.',
      inputSchema: GetDocumentInputSchema,
    },
    {
      name: 'check_edit_permission',
      description:
        'Check if you have permission to edit a document. Always call this before starting an edit session to ensure no humans are actively editing.',
      inputSchema: CheckEditPermissionInputSchema,
    },
    {
      name: 'start_edit_session',
      description:
        'Start an edit session on a document. This reserves the regions for editing and creates a checkpoint for rollback. Call check_edit_permission first.',
      inputSchema: StartEditSessionInputSchema,
    },
    {
      name: 'apply_document_edits',
      description:
        'Apply edit operations to modify document content. REQUIRES a valid edit_session_id from start_edit_session - the backend enforces this. Use dot-notation paths like "content.0.props.title" (NOT JSON Pointer format).',
      inputSchema: ApplyDocumentEditsInputSchema,
    },
    {
      name: 'complete_edit_session',
      description:
        'Complete an edit session successfully. This creates a checkpoint with your changes. Always call this after finishing edits.',
      inputSchema: CompleteEditSessionInputSchema,
    },
    {
      name: 'abort_edit_session',
      description:
        'Abort an edit session and roll back changes. Use this if something goes wrong or the user wants to cancel.',
      inputSchema: AbortEditSessionInputSchema,
    },
    {
      name: 'get_branch_presence',
      description:
        'Get presence information for all documents on a branch. Shows who is currently viewing or editing each document.',
      inputSchema: GetBranchPresenceInputSchema,
    },
    {
      name: 'get_document_presence',
      description:
        'Get presence information for a specific document. Shows actors currently viewing or editing, their state, and intent.',
      inputSchema: GetDocumentPresenceInputSchema,
    },
  ];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize a path to dot-notation format.
 * Converts JSON Pointer format (/content/0/props) to dot-notation (content.0.props)
 * and removes leading slashes or dots.
 */
function normalizePath(path: string): string {
  // If path starts with /, it's JSON Pointer format - convert to dot-notation
  if (path.startsWith('/')) {
    return path
      .slice(1) // Remove leading /
      .split('/')
      .join('.');
  }
  // Already in dot-notation, just remove any leading dots
  return path.replace(/^\.+/, '');
}

/**
 * Extract a value from an object using a JSON path
 */
function extractRegion(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('/').filter((p) => p !== '');
  let current: unknown = obj;

  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Format a result as a tool response
 */
function formatResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Format an error as a tool response
 */
function formatError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

// =============================================================================
// Tool Handler Types
// =============================================================================

type ListBranchesInput = z.infer<typeof ListBranchesInputSchema>;
type ListDocumentsInput = z.infer<typeof ListDocumentsInputSchema>;
type GetDocumentInput = z.infer<typeof GetDocumentInputSchema>;
type CheckEditPermissionInput = z.infer<typeof CheckEditPermissionInputSchema>;
type StartEditSessionInput = z.infer<typeof StartEditSessionInputSchema>;
type ApplyDocumentEditsInput = z.infer<typeof ApplyDocumentEditsInputSchema>;
type CompleteEditSessionInput = z.infer<typeof CompleteEditSessionInputSchema>;
type AbortEditSessionInput = z.infer<typeof AbortEditSessionInputSchema>;
type GetBranchPresenceInput = z.infer<typeof GetBranchPresenceInputSchema>;
type GetDocumentPresenceInput = z.infer<typeof GetDocumentPresenceInputSchema>;

export interface ToolHandlers {
  list_sites: () => Promise<ToolResult>;
  list_branches: (input: ListBranchesInput) => Promise<ToolResult>;
  list_documents: (input: ListDocumentsInput) => Promise<ToolResult>;
  get_document: (input: GetDocumentInput) => Promise<ToolResult>;
  check_edit_permission: (input: CheckEditPermissionInput) => Promise<ToolResult>;
  start_edit_session: (input: StartEditSessionInput) => Promise<ToolResult>;
  apply_document_edits: (input: ApplyDocumentEditsInput) => Promise<ToolResult>;
  complete_edit_session: (input: CompleteEditSessionInput) => Promise<ToolResult>;
  abort_edit_session: (input: AbortEditSessionInput) => Promise<ToolResult>;
  get_branch_presence: (input: GetBranchPresenceInput) => Promise<ToolResult>;
  get_document_presence: (input: GetDocumentPresenceInput) => Promise<ToolResult>;
}

// =============================================================================
// Tool Handlers Factory
// =============================================================================

export function createToolHandlers(apiClient: ApiClient): ToolHandlers {
  return {
    async list_sites(): Promise<ToolResult> {
      try {
        const result = await apiClient.listSites();

        if (result.sites.length === 0) {
          return formatResult('No sites found.');
        }

        const formatted = result.sites
          .map((site) => `- "${site.name}"\n  site_id: ${site.id}`)
          .join('\n');

        return formatResult(`Sites (use the site_id UUID in subsequent calls):\n${formatted}`);
      } catch (error) {
        return formatError(error);
      }
    },

    async list_branches(input: ListBranchesInput): Promise<ToolResult> {
      try {
        const result = await apiClient.listBranches(input.site_id);

        if (result.branches.length === 0) {
          return formatResult('No branches found for this site.');
        }

        const formatted = result.branches
          .map((branch) => {
            const mainTag = branch.isMain ? ' [default]' : '';
            return `- "${branch.name}"${mainTag}\n  branch_id: ${branch.id}\n  status: ${branch.status}`;
          })
          .join('\n');

        return formatResult(`Branches (use the branch_id UUID, not the name):\n${formatted}`);
      } catch (error) {
        return formatError(error);
      }
    },

    async list_documents(input: ListDocumentsInput): Promise<ToolResult> {
      try {
        const result = await apiClient.listDocuments(input.site_id, input.branch_id);

        if (result.documents.length === 0) {
          return formatResult('No documents found in this branch.');
        }

        const formatted = result.documents
          .map((doc) => `- ${doc.path} (id: ${doc.id})`)
          .join('\n');

        return formatResult(`Documents:\n${formatted}`);
      } catch (error) {
        return formatError(error);
      }
    },

    async get_document(input: GetDocumentInput): Promise<ToolResult> {
      try {
        const result = await apiClient.getDocument(
          input.site_id,
          input.branch_id,
          input.document_path,
        );

        let content: unknown = result.snapshot;

        // Extract region if specified
        if (input.region) {
          const extracted = extractRegion(
            result.snapshot,
            input.region,
          );
          if (extracted === undefined) {
            return formatResult(`Region "${input.region}" not found in document.`);
          }
          content = extracted;
        }

        return formatResult(content);
      } catch (error) {
        return formatError(error);
      }
    },

    async check_edit_permission(input: CheckEditPermissionInput): Promise<ToolResult> {
      try {
        const result = await apiClient.canAgentEdit({
          siteId: input.site_id,
          branchId: input.branch_id,
          documentPath: input.document_path,
          intent: input.intent,
          targetRegions: input.target_regions,
          trigger: 'autonomous', // TODO: Changed for testing checkpoint creation - revert after validation
        });

        if (result.canEdit) {
          return formatResult({
            canEdit: true,
            message: 'Permission granted. You may proceed with start_edit_session.',
          });
        }

        return formatResult({
          canEdit: false,
          reason: result.reason,
          message:
            result.message ?? 'Edit permission denied. Please wait and try again.',
          conflictingRegions: result.conflictingRegions,
        });
      } catch (error) {
        return formatError(error);
      }
    },

    async start_edit_session(input: StartEditSessionInput): Promise<ToolResult> {
      try {
        console.error('[MCP DEBUG] start_edit_session called with trigger: autonomous');
        const result = await apiClient.startAgentEdit({
          siteId: input.site_id,
          branchId: input.branch_id,
          documentPath: input.document_path,
          intent: input.intent,
          targetRegions: input.target_regions,
          trigger: 'autonomous', // TODO: Changed for testing checkpoint creation - revert after validation
        });

        console.error('[MCP DEBUG] start_edit_session result:', JSON.stringify(result, null, 2));

        return formatResult({
          editSessionId: result.editSessionId,
          checkpointId: result.checkpointId,
          expiresAt: result.expiresAt,
          reservedRegions: result.reservedRegions,
          message:
            'Edit session started. Use apply_document_edits to make changes, then complete_edit_session when done.',
        });
      } catch (error) {
        console.error('[MCP DEBUG] start_edit_session error:', error);
        return formatError(error);
      }
    },

    async apply_document_edits(input: ApplyDocumentEditsInput): Promise<ToolResult> {
      try {
        // Normalize paths to dot-notation format before sending to worker
        // This handles cases where Claude sends JSON Pointer format (/content/0)
        // even though the tool description specifies dot-notation (content.0)
        const normalizedOperations = input.operations.map((op) => ({
          ...op,
          path: normalizePath(op.path),
        }));

        const result = await apiClient.applyEdits({
          siteId: input.site_id,
          branchId: input.branch_id,
          documentPath: input.document_path,
          editSessionId: input.edit_session_id,
          operations: normalizedOperations as EditOperation[],
        });

        return formatResult({
          success: result.success,
          version: result.version,
          message: 'Edits applied successfully.',
        });
      } catch (error) {
        return formatError(error);
      }
    },

    async complete_edit_session(input: CompleteEditSessionInput): Promise<ToolResult> {
      try {
        const result = await apiClient.completeAgentEdit({
          siteId: input.site_id,
          branchId: input.branch_id,
          documentPath: input.document_path,
          editSessionId: input.edit_session_id,
        });

        const message = result.checkpointId
          ? `Edit session completed. Checkpoint: ${result.checkpointId}`
          : 'Edit session completed.';

        return formatResult({
          success: result.success,
          ...(result.checkpointId && { checkpointId: result.checkpointId }),
          message,
        });
      } catch (error) {
        return formatError(error);
      }
    },

    async abort_edit_session(input: AbortEditSessionInput): Promise<ToolResult> {
      try {
        const result = await apiClient.abortAgentEdit({
          siteId: input.site_id,
          branchId: input.branch_id,
          documentPath: input.document_path,
          editSessionId: input.edit_session_id,
          reason: input.reason,
        });

        return formatResult({
          success: result.success,
          rolledBack: result.rolledBack,
          message: result.rolledBack
            ? 'Edit session aborted and changes rolled back.'
            : 'Edit session aborted.',
        });
      } catch (error) {
        return formatError(error);
      }
    },

    async get_branch_presence(input: GetBranchPresenceInput): Promise<ToolResult> {
      try {
        const result = await apiClient.getBranchPresence(input.site_id, input.branch_id);

        if (result.totalDocuments === 0) {
          return formatResult('No active presence on this branch.');
        }

        const documentsSummary = result.documents.map((doc) => {
          const actorsList = doc.actors
            .map((actor) => {
              const roleTag = actor.role === 'agent' ? ' [agent]' : '';
              const stateTag = actor.state === 'editing' ? ' (editing)' : '';
              const intentInfo = actor.intent ? ` - intent: ${actor.intent}` : '';
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

    async get_document_presence(input: GetDocumentPresenceInput): Promise<ToolResult> {
      try {
        const result = await apiClient.getDocumentPresence(
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
          const intentInfo = actor.intent ? `, intent: "${actor.intent}"` : '';
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
  };
}

// =============================================================================
// Export Zod Schemas for MCP Server Registration
// =============================================================================

export const schemas = {
  list_sites: ListSitesInputSchema,
  list_branches: ListBranchesInputSchema,
  list_documents: ListDocumentsInputSchema,
  get_document: GetDocumentInputSchema,
  check_edit_permission: CheckEditPermissionInputSchema,
  start_edit_session: StartEditSessionInputSchema,
  apply_document_edits: ApplyDocumentEditsInputSchema,
  complete_edit_session: CompleteEditSessionInputSchema,
  abort_edit_session: AbortEditSessionInputSchema,
  get_branch_presence: GetBranchPresenceInputSchema,
  get_document_presence: GetDocumentPresenceInputSchema,
};
