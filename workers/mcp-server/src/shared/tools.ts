/**
 * MCP Tools for Collaborative State System
 *
 * Defines the tools that expose the Agent Politeness workflow
 * to MCP clients via the Model Context Protocol.
 * Adapted from examples/collaborative-state-mcp/src/tools.ts
 * for use in the Cloudflare Worker MCP server.
 */

import { z } from 'zod';
import type { McpApiClient, EditOperation } from './api-client.js';
import type { ActingUser } from './types.js';

// =============================================================================
// ULID generator (inline — no external dependency required in Workers)
// =============================================================================

const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateULID(): string {
  const now = Date.now();
  let id = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    id = ULID_ENCODING[t % 32] + id;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  let rnd = BigInt(0);
  for (const byte of rand) {
    rnd = (rnd << BigInt(8)) | BigInt(byte);
  }
  for (let i = 0; i < 16; i++) {
    id += ULID_ENCODING[Number(rnd % BigInt(32))];
    rnd >>= BigInt(5);
  }
  return id;
}

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
  content: { type: 'text'; text: string }[];
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
    .describe('Edit operations to apply'),
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

const ListComponentsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
});

const CreateBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  name: z.string().min(1).describe(
    'Branch name. Must be unique per site (server returns 409 on duplicate). ' +
    'Recommended: lowercase-kebab, e.g. "draft-hero-rewrite" or "fix-pricing-typo".',
  ),
  description: z.string().optional().describe(
    'Optional one-line note about why this branch exists, visible to humans ' +
    'in the dashboard. Recommended: include the task or ticket reference.',
  ),
  parent_branch_id: z.string().optional().describe(
    'Optional UUID of the main branch. Only the site\'s main branch is supported as a source — ' +
    'passing any other branch UUID will result in an error. Omit to use the main branch automatically.',
  ),
});

const CreatePageInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_path: z.string().describe('Path for the new page (e.g. "about" or "products/widget"). Must not start with _registry/.'),
  components: z.array(z.object({
    type: z.string().describe('Component type name (from list_components)'),
    props: z.record(z.unknown()).describe('Component props matching the registered fields'),
    zone: z.string().optional().describe('Slot field name when placing in a nested slot (requires parentId)'),
    parentId: z.string().optional().describe('ID of the parent component for slot placement (must match a component\'s generated id)'),
  })).describe('Components to place on the page, in order'),
  root_props: z.record(z.unknown()).optional().describe('Page-level root props'),
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
      name: 'list_components',
      description:
        'List all Puck components registered in the site\'s component registry. Returns component names, provenance (site/upstream/overridden), field count, and any AI instructions. The special component __root__ describes the page-level root props accepted by root_props in create_page. Use this to discover what components and root fields are available before calling create_page.',
      inputSchema: ListComponentsInputSchema,
    },
    {
      name: 'create_page',
      description:
        'Create a new page with a structured set of Puck components. Use list_components first to discover available component types and their field schemas. Each component is given a unique ID automatically. Returns the new document path and ID.',
      inputSchema: CreatePageInputSchema,
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

function normalizePath(path: string): string {
  if (path.startsWith('/')) {
    return path
      .slice(1)
      .split('/')
      .join('.');
  }
  return path.replace(/^\.+/, '');
}

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
type ListComponentsInput = z.infer<typeof ListComponentsInputSchema>;
type CreatePageInput = z.infer<typeof CreatePageInputSchema>;
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
  list_components: (input: ListComponentsInput) => Promise<ToolResult>;
  create_page: (input: CreatePageInput) => Promise<ToolResult>;
  create_branch: (input: CreateBranchInput) => Promise<ToolResult>;
}

// =============================================================================
// Tool Handlers Factory
// =============================================================================

export function createToolHandlers(
  apiClient: McpApiClient,
  actingUser?: ActingUser,
): ToolHandlers {
  // PCC-3189: when an OAuth user authenticated this request, attribute
  // edit-session calls to that human. When actingUser is absent (or
  // present but missing a usable id) we fall back to the historical
  // 'autonomous' default. The empty-id fallback matters because the
  // backend's validateAgentContext rejects trigger='human_requested'
  // with an empty requestedById (HTTP 400) — better to ship an
  // attributed-as-autonomous request than to fail the user's call.
  // The actingUser-undefined branch fires when OAuth props are missing
  // (already warned about at index.ts:57-59).
  const requestedById =
    actingUser?.id !== undefined && actingUser.id !== '' ? actingUser.id : undefined;
  const trigger: 'human_requested' | 'autonomous' =
    requestedById !== undefined ? 'human_requested' : 'autonomous';

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
        if (input.region !== undefined && input.region !== '') {
          const extracted = extractRegion(result.snapshot, input.region);
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
          trigger,
          requestedById,
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
          trigger,
          requestedById,
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

    async list_components(input: ListComponentsInput): Promise<ToolResult> {
      try {
        const docs = await apiClient.listDocuments(input.site_id, input.branch_id, {
          pathPrefix: '_registry/components/',
        });

        if (docs.documents.length === 0) {
          return formatResult('No components registered in this site. The site editor must be opened at least once to populate the registry.');
        }

        // Fetch each component's snapshot (N+1 is acceptable — called rarely, not in hot path)
        const componentLines: string[] = [];
        const counts = { site: 0, upstream: 0, overridden: 0 };

        await Promise.all(
          docs.documents.map(async (doc) => {
            const name = doc.path.slice('_registry/components/'.length);
            try {
              // Use doc.id (UUID) — NOT doc.path. The backend versions/latest route
              // performs a UUID-based lookup; passing a path would return 404.
              const version = await apiClient.getDocumentLatestVersion(
                input.site_id,
                input.branch_id,
                doc.id,
              );
              const descriptor = version.snapshot;
              const provenance = typeof descriptor.provenance === 'string' ? descriptor.provenance : 'site';
              const fields = Array.isArray(descriptor.fields) ? descriptor.fields : [];
              const ai = descriptor.ai as { instructions?: string } | undefined;
              const label = typeof descriptor.label === 'string' ? descriptor.label : name;

              if (provenance in counts) counts[provenance as keyof typeof counts]++;

              const aiNote =
                ai?.instructions !== undefined && ai.instructions !== ''
                  ? ` — AI: "${ai.instructions.slice(0, 60)}${ai.instructions.length > 60 ? '...' : ''}"`
                  : '';
              const fieldNote = fields.length === 1 ? '1 field' : `${String(fields.length)} fields`;

              componentLines.push(`- ${name} (${label}) [${provenance}] — ${fieldNote}${aiNote}`);
            } catch {
              componentLines.push(`- ${name} [error fetching descriptor]`);
            }
          }),
        );

        componentLines.sort(); // Alphabetical order for readability

        const summary = `Components registered in this site (${String(docs.documents.length)} total — ${String(counts.site)} site, ${String(counts.upstream)} upstream, ${String(counts.overridden)} overridden):\n${componentLines.join('\n')}`;
        return formatResult(summary);
      } catch (error) {
        return formatError(error);
      }
    },

    async create_page(input: CreatePageInput): Promise<ToolResult> {
      try {
        if (input.document_path.startsWith('_registry/')) {
          return formatError(
            new Error(
              'Cannot create pages at the _registry/ path prefix — this is reserved for system use.',
            ),
          );
        }

        // Build valid Puck Data
        interface PuckComponent { type: string; props: Record<string, unknown> & { id: string } }
        const content: PuckComponent[] = [];
        const zones: Record<string, PuckComponent[]> = {};

        for (const component of input.components) {
          const id = generateULID();
          const instance: PuckComponent = {
            type: component.type,
            props: { ...component.props, id },
          };

          if (component.parentId !== undefined && component.zone !== undefined) {
            const zoneKey = `${component.parentId}:${component.zone}`;
            zones[zoneKey] ??= [];
            zones[zoneKey].push(instance);
          } else {
            content.push(instance);
          }
        }

        const puckData = {
          content,
          root: { props: input.root_props ?? {} },
          ...(Object.keys(zones).length > 0 && { zones }),
        };

        const { documentId, documentPath } = await apiClient.createDocument(
          input.site_id,
          input.branch_id,
          input.document_path,
          puckData,
        );

        return formatResult({
          message: `Page created at "${documentPath}".`,
          documentPath,
          documentId,
          componentCount:
            content.length +
            Object.values(zones).reduce((n, arr) => n + arr.length, 0),
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
  list_components: ListComponentsInputSchema,
  create_page: CreatePageInputSchema,
  create_branch: CreateBranchInputSchema,
};
