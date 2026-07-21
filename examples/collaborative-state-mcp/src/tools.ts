/**
 * MCP Tools for Collaborative State System
 *
 * Defines the tools that expose the Agent Politeness workflow
 * to Claude Desktop via the Model Context Protocol.
 */

import { z } from 'zod';
import type { ApiClient } from './api-client.js';

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
        path: z.string().describe('Dot-notation path using numeric indices for arrays. Example: "content.0.props.title" — NOT "content[0].props.title" (bracket notation corrupts the document) and NOT "/content/0/props/title" (JSON Pointer format)'),
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

const CreateBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  name: z.string().min(1).describe(
    'Branch name. Must be unique per site (server returns 409 on duplicate). ' +
    'Recommended: lowercase-kebab, e.g. "draft-hero-rewrite" or "fix-pricing-typo".'
  ),
  description: z.string().optional().describe(
    'Optional one-line note about why this branch exists, visible to humans ' +
    'in the dashboard. Recommended: include the task or ticket reference.'
  ),
  parent_branch_id: z.string().optional().describe(
    'Optional UUID of the main branch. Only the site\'s main branch is supported as a source — ' +
    'passing any other branch UUID will result in an error. Omit to use the main branch automatically.'
  ),
});

// =============================================================================
// Tool Definitions
// =============================================================================

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_sites',
      description:
        'List all sites accessible to you. Use this as your starting point to discover available sites before working with documents. Each site has a unique UUID — use that site_id in all subsequent calls.',
      inputSchema: ListSitesInputSchema,
    },
    {
      name: 'list_branches',
      description:
        'List all branches for a site. Every site has a "main" branch (marked [default]). Edits typically happen on non-main branches and are published to main. Use the branch_id UUID in subsequent calls — never use the branch name as an identifier.',
      inputSchema: ListBranchesInputSchema,
    },
    {
      name: 'list_documents',
      description:
        'List all documents in a site branch. Returns document paths (e.g., "/home", "/about") and their IDs. Use the document path when calling get_document or starting edit sessions.',
      inputSchema: ListDocumentsInputSchema,
    },
    {
      name: 'get_document',
      description:
        'Get the full content of a document, or a specific region of it. IMPORTANT: Always call this BEFORE making any edits to understand the document\'s current structure. Documents follow the Puck editor schema: "content" is an array of components (each with a "type" and "props" object), and "root" is a props object for page-level settings. After retrieving a document, summarize its structure to the user (e.g., "This document has 3 components: Hero, TextBlock, Footer") before proposing changes. This prevents accidentally duplicating or misplacing content. Use the optional "region" parameter with a JSON Pointer path (e.g., "/content") to retrieve just a portion of a large document.',
      inputSchema: GetDocumentInputSchema,
    },
    {
      name: 'check_edit_permission',
      description:
        'Check if you have permission to edit a document. You MUST call this before start_edit_session to verify no humans are actively editing the same regions. Specify target_regions as JSON paths for the areas you intend to modify (e.g., ["/content/0/props", "/content/1"]). Be specific — only claim regions you actually plan to change. If permission is denied due to conflicts, inform the user and wait rather than retrying immediately.',
      inputSchema: CheckEditPermissionInputSchema,
    },
    {
      name: 'start_edit_session',
      description:
        'Start an edit session on a document. This reserves your target regions and creates a checkpoint that enables rollback if something goes wrong. You must call check_edit_permission first. IMPORTANT WORKFLOW: (1) You MUST have called get_document already to understand the current content. (2) Describe your intent clearly — this is visible to other collaborators. (3) Only reserve target_regions you actually plan to modify. (4) If the user\'s request is ambiguous (e.g., "update the content"), confirm with them whether they want to overwrite existing content or add new content before starting the session.',
      inputSchema: StartEditSessionInputSchema,
    },
    {
      name: 'apply_document_edits',
      description:
        'Apply edit operations to modify document content. REQUIRES a valid edit_session_id from start_edit_session. PATH FORMAT: Use dot-notation with numeric indices for arrays. CORRECT: "content.0.props.title". WRONG: "content[0].props.title" (creates a literal key "[0]" — corrupts the document). WRONG: "/content/0/props/title" (JSON Pointer format). OPERATIONS: "replace" overwrites a value at an existing path (use for modifying existing content). "add" inserts new content. "remove" deletes content at a path. "move" moves an array element from one index to another. "reorder" reorders elements within an array. CRITICAL GUIDELINES: Before using "add" on a path that already has content, ask the user if they want to overwrite (use "replace") or add alongside the existing content. Never create duplicate top-level keys — a document should have exactly one "content" array and one "root" object. When modifying a component\'s properties, target the specific property path (e.g., "content.0.props.title") rather than replacing the entire component, to preserve other properties. If you need to replace an entire component, use "replace" on "content.N" where N is the component\'s index.',
      inputSchema: ApplyDocumentEditsInputSchema,
    },
    {
      name: 'complete_edit_session',
      description:
        'Complete an edit session successfully and save your changes. This creates a post-edit checkpoint. Always call this when you are done making edits — do not leave sessions open. Before completing, consider using get_document to verify your changes look correct. If the result is not what you expected, use abort_edit_session instead.',
      inputSchema: CompleteEditSessionInputSchema,
    },
    {
      name: 'abort_edit_session',
      description:
        'Abort an edit session and roll back all changes to the pre-edit checkpoint. Use this when: something went wrong during editing, the user wants to cancel, or you realize your edits produced unexpected results (use get_document to check). Provide a reason so the rollback is auditable. After aborting, you can start a fresh edit session if needed.',
      inputSchema: AbortEditSessionInputSchema,
    },
    {
      name: 'get_branch_presence',
      description:
        'Get presence information for all documents on a branch. Shows who is currently viewing or editing each document. Use this to understand the collaboration landscape before making edits — it helps you avoid conflicts with other editors.',
      inputSchema: GetBranchPresenceInputSchema,
    },
    {
      name: 'get_document_presence',
      description:
        'Get detailed presence information for a specific document. Shows all actors (humans and agents) currently viewing or editing, their focus regions, state, and intent. Check this before editing to understand if anyone else is actively working on the document.',
      inputSchema: GetDocumentPresenceInputSchema,
    },
    {
      name: 'create_branch',
      description:
        'Create a new branch on a site. Branches are isolated workspaces — edits made on a non-main branch do not affect the live site until the branch is published to main. Use this when starting a new piece of work that should be reviewable before going live. WORKFLOW: (1) Call `list_branches` first to confirm the desired name is not already in use. (2) Choose a name that hints at the work, lowercase-kebab style (e.g. "draft-hero-rewrite"). (3) After creating the branch, all subsequent edit-session calls should reference the new `branch_id`. The branch appears in the human dashboard immediately — confirm with the user before creating a branch unless they have explicitly authorized you to start new work.',
      inputSchema: CreateBranchInputSchema,
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
type CreateBranchInput = z.infer<typeof CreateBranchInputSchema>;

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
  create_branch: (input: CreateBranchInput) => Promise<ToolResult>;
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
        const result = await apiClient.startAgentEdit({
          siteId: input.site_id,
          branchId: input.branch_id,
          documentPath: input.document_path,
          intent: input.intent,
          targetRegions: input.target_regions,
          trigger: 'autonomous',
        });

        return formatResult({
          editSessionId: result.editSessionId,
          checkpointId: result.checkpointId,
          expiresAt: result.expiresAt,
          reservedRegions: result.reservedRegions,
          message:
            'Edit session started. Use apply_document_edits to make changes, then complete_edit_session when done.',
        });
      } catch (error) {
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
          operations: normalizedOperations,
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

    async create_branch(input: CreateBranchInput): Promise<ToolResult> {
      try {
        const request: { name: string; description?: string; parentBranchId?: string } = {
          name: input.name,
        };
        if (input.description !== undefined) {
          request.description = input.description;
        }
        if (input.parent_branch_id !== undefined) {
          request.parentBranchId = input.parent_branch_id;
        }

        const branch = await apiClient.createBranch(input.site_id, request);

        return formatResult({
          message: `Branch "${branch.name}" created.`,
          branchId: branch.id,
          name: branch.name,
          siteId: branch.siteId,
          status: branch.status,
          isMain: branch.isMain,
          ...(branch.description !== undefined && { description: branch.description }),
          ...(branch.sourceBranchId !== undefined && { sourceBranchId: branch.sourceBranchId }),
          ...(branch.sourceCheckpointId !== undefined && { sourceCheckpointId: branch.sourceCheckpointId }),
          createdById: branch.createdById,
          createdByType: branch.createdByType,
          createdAt: branch.createdAt,
          updatedAt: branch.updatedAt,
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
  create_branch: CreateBranchInputSchema,
};
