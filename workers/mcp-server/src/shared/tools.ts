/**
 * MCP Tools for Collaborative State System
 *
 * Defines the tools that expose the Agent Politeness workflow
 * to MCP clients via the Model Context Protocol.
 * Adapted from examples/collaborative-state-mcp/src/tools.ts
 * for use in the Cloudflare Worker MCP server.
 */

import { z } from 'zod';
import type { McpApiClient } from './api-client.js';
import type { ActingUser } from './types.js';
import { validateOps } from '@pantheon-systems/p1-content-validator';
import type { ValidationError } from '@pantheon-systems/p1-content-validator';

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

const BranchStatusEnum = z.enum(['active', 'review', 'merged', 'archived']);
const MergeRequestStatusEnum = z.enum(['open', 'approved', 'conflicted', 'merged', 'closed']);
const ConflictStrategyEnum = z.enum(['take-source', 'take-target', 'manual']);

const ConflictResolutionSchema = z.object({
  document_id: z.string().describe('The document ID (UUID) with the conflict'),
  strategy: ConflictStrategyEnum.describe(
    'take-source keeps the source branch version, take-target keeps the target version, ' +
    'manual supplies a merged snapshot.',
  ),
  resolved_snapshot: z
    .record(z.unknown())
    .optional()
    .describe('The merged document snapshot. Required when strategy is "manual".'),
});

const GetBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
});

const UpdateBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches, NOT the name)'),
  name: z.string().min(1).optional().describe('New branch name. Must be unique within the site.'),
  description: z.string().optional().describe('New one-line description for the branch.'),
  status: BranchStatusEnum.optional().describe(
    'New lifecycle status: active, review, merged, or archived.',
  ),
});

const ArchiveBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID). The main branch cannot be archived.'),
});

const RestoreBranchInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID) of an archived branch'),
});

const CheckMergeInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  source_branch_id: z.string().describe('The branch ID (UUID) holding the changes to merge'),
  target_branch_id: z.string().describe('The branch ID (UUID) to merge into (often the main branch)'),
});

const PreviewMergeInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  source_branch_id: z.string().describe('The branch ID (UUID) holding the changes to merge'),
  target_branch_id: z.string().describe('The branch ID (UUID) to merge into'),
  include_content: z
    .boolean()
    .optional()
    .describe('Include full document snapshots and diff operations in the preview.'),
  exclude_path_prefixes: z
    .array(z.string())
    .optional()
    .describe('Skip documents whose path starts with any of these prefixes (e.g. "_registry/").'),
});

const ExecuteMergeInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  source_branch_id: z.string().describe('The branch ID (UUID) holding the changes to merge'),
  target_branch_id: z.string().describe('The branch ID (UUID) to merge into'),
  message: z.string().optional().describe('Merge message describing the change.'),
  conflict_resolutions: z
    .array(ConflictResolutionSchema)
    .optional()
    .describe('Per-document conflict resolutions. Run check_merge first to discover conflicts.'),
});

const CreateMergeRequestInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  source_branch_id: z.string().describe('The branch ID (UUID) holding the changes to merge'),
  target_branch_id: z.string().describe('The branch ID (UUID) to merge into'),
  title: z.string().min(1).describe('Title summarising the proposed change.'),
  description: z.string().optional().describe('Longer description of the proposed change.'),
});

const ListMergeRequestsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  status: MergeRequestStatusEnum.optional().describe(
    'Filter by status: open, approved, conflicted, merged, or closed.',
  ),
});

const GetMergeRequestInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  merge_request_id: z.string().describe('The merge request ID (UUID)'),
});

const UpdateMergeRequestInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  merge_request_id: z.string().describe('The merge request ID (UUID)'),
  title: z.string().min(1).optional().describe('New title.'),
  description: z.string().optional().describe('New description.'),
  status: MergeRequestStatusEnum.optional().describe(
    'New status. Set to "approved" to clear it for execution.',
  ),
});

const ExecuteMergeRequestInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  merge_request_id: z.string().describe('The merge request ID (UUID). Must be approved or conflicted.'),
  resolutions: z
    .array(ConflictResolutionSchema)
    .optional()
    .describe('Per-document conflict resolutions when the request has conflicts.'),
});

const StructureTypeEnum = z.enum(['hierarchy', 'collection']);
const NodeTypeEnum = z.enum(['section', 'document', 'external']);

const ListStructuresInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_type: StructureTypeEnum.optional().describe(
    'Filter by type: hierarchy (nested navigation) or collection (flat list).',
  ),
});

const GetNavigationInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
});

const AddNavigationItemInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
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

const UpdateNavigationItemInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
  node_id: z.string().describe('The navigation node ID (UUID)'),
  name: z.string().min(1).optional().describe('New display label.'),
  slug: z.string().min(1).optional().describe('New slug, unique within the parent.'),
  position: z.number().optional().describe('New order among siblings.'),
});

const MoveNavigationItemInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
  node_id: z.string().describe('The navigation node ID (UUID) to move'),
  new_parent_id: z
    .string()
    .optional()
    .describe('New parent node ID (UUID). Omit to move to the top level.'),
  new_position: z.number().optional().describe('New order under the new parent (default 0).'),
});

const ReorderNavigationItemsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
  parent_node_id: z
    .string()
    .optional()
    .describe('Parent whose children to reorder. Omit for top-level items.'),
  node_order: z.array(z.string()).describe('Node IDs (UUIDs) in the desired order.'),
});

const RemoveNavigationItemInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
  node_id: z.string().describe('The navigation node ID (UUID) to remove'),
});

const GetPageMetadataInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
});

const SetPageMetadataInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  structure_id: z.string().describe('The structure ID (UUID from list_structures)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
  metadata: z
    .record(z.unknown())
    .describe(
      'The full metadata object to store. Validated against the structure schema when enforcement is enabled.',
    ),
});

// Group C — Version history & page lifecycle

const ListDocumentVersionsInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
});

const GetDocumentVersionInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
  version_id: z
    .string()
    .uuid('Must be the version UUID from list_document_versions.')
    .describe('The version ID (UUID from list_document_versions)'),
});

const RestoreDocumentVersionInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
  version_id: z
    .string()
    .uuid('Must be the version UUID from list_document_versions.')
    .describe('The version ID (UUID) to roll the document back to'),
});

const PublishPageInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
});

const ArchivePageInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  branch_id: z.string().describe('The branch ID (UUID from list_branches)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
});

const RestorePageInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID, not a path.')
    .describe('The document ID (UUID) of an archived page'),
});

const RenamePageInputSchema = z.object({
  site_id: z.string().describe('The site ID (UUID from list_sites)'),
  document_id: z
    .string()
    .uuid('Must be the document UUID from list_documents, not a path.')
    .describe('The document ID (UUID from list_documents)'),
  path: z.string().min(1).describe('The new document path (e.g. "plans" or "products/widget").'),
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
    {
      name: 'get_branch',
      description:
        'Get a single branch\'s details: name, status, description, source branch, and timestamps. Use this to check a branch\'s current state before updating, archiving, or merging it.',
      inputSchema: GetBranchInputSchema,
    },
    {
      name: 'update_branch',
      description:
        'Update a branch\'s name, description, or lifecycle status. Provide at least one of name, description, or status. Status moves a branch through its lifecycle (active → review → merged → archived). Renaming must keep the name unique within the site.',
      inputSchema: UpdateBranchInputSchema,
    },
    {
      name: 'archive_branch',
      description:
        'Archive a branch once its work is merged or abandoned. Archiving hides the branch from the active list but preserves its history; use restore_branch to bring it back. The main branch cannot be archived. Confirm with the user before archiving unless they have authorized cleanup.',
      inputSchema: ArchiveBranchInputSchema,
    },
    {
      name: 'restore_branch',
      description:
        'Restore a previously archived branch, returning it to the active list. Errors if the branch does not exist or is not archived.',
      inputSchema: RestoreBranchInputSchema,
    },
    {
      name: 'check_merge',
      description:
        'Check whether a source branch can merge cleanly into a target branch, and report any conflicting documents. Run this before execute_merge so you know whether conflict resolutions are needed. Read-only — it does not change anything.',
      inputSchema: CheckMergeInputSchema,
    },
    {
      name: 'preview_merge',
      description:
        'Preview which documents a merge would change, before committing to it. Pass include_content to see full snapshots and diff operations, and exclude_path_prefixes to skip paths such as "_registry/". Read-only.',
      inputSchema: PreviewMergeInputSchema,
    },
    {
      name: 'execute_merge',
      description:
        'Merge a source branch into a target branch. This publishes the source branch\'s changes into the target and is hard to reverse — confirm with the user before merging into the main branch. If check_merge reported conflicts, supply conflict_resolutions; otherwise the merge proceeds directly.',
      inputSchema: ExecuteMergeInputSchema,
    },
    {
      name: 'create_merge_request',
      description:
        'Open a merge request proposing that a source branch be merged into a target branch, for human review before it lands. Use this instead of execute_merge when the work should be approved by a person first.',
      inputSchema: CreateMergeRequestInputSchema,
    },
    {
      name: 'list_merge_requests',
      description:
        'List a site\'s merge requests, optionally filtered by status (open, approved, conflicted, merged, closed). Use this to find work awaiting review or to check the state of a proposal.',
      inputSchema: ListMergeRequestsInputSchema,
    },
    {
      name: 'get_merge_request',
      description:
        'Get a single merge request\'s details, including its source and target branches and current status.',
      inputSchema: GetMergeRequestInputSchema,
    },
    {
      name: 'update_merge_request',
      description:
        'Update a merge request\'s title, description, or status. Provide at least one field. Set status to "approved" to clear the request for execution. Confirm approvals with the user — approving is a human decision.',
      inputSchema: UpdateMergeRequestInputSchema,
    },
    {
      name: 'execute_merge_request',
      description:
        'Execute an approved (or conflicted) merge request, merging its source branch into its target. Hard to reverse — confirm with the user first. Supply resolutions when the request has conflicts.',
      inputSchema: ExecuteMergeRequestInputSchema,
    },
    {
      name: 'list_structures',
      description:
        'List the navigation structures on a branch. A structure is the container for a navigation tree; every navigation and metadata tool needs a structure_id, and this is how you discover one. Filter by type with structure_type. Use the structure_id UUID in subsequent calls.',
      inputSchema: ListStructuresInputSchema,
    },
    {
      name: 'get_navigation',
      description:
        'Get the full navigation tree for a structure — every section, page, and link, with their nesting and order. Call this before adding or moving items so you understand where things currently sit.',
      inputSchema: GetNavigationInputSchema,
    },
    {
      name: 'add_navigation_item',
      description:
        'Place a new item in the navigation tree: a section (a grouping), a document (a link to a page, requires document_id), or an external link (requires external_url). position sets the order among siblings; omit parent_node_id for a top-level item. The slug must be unique within the parent.',
      inputSchema: AddNavigationItemInputSchema,
    },
    {
      name: 'update_navigation_item',
      description:
        'Rename a navigation item, change its slug, or change its position among its siblings. Provide at least one of name, slug, or position. To reparent an item, use move_navigation_item instead.',
      inputSchema: UpdateNavigationItemInputSchema,
    },
    {
      name: 'move_navigation_item',
      description:
        'Move a navigation item to a new parent and/or position. Omit new_parent_id to move it to the top level. The backend rejects a move that would make an item its own ancestor.',
      inputSchema: MoveNavigationItemInputSchema,
    },
    {
      name: 'reorder_navigation_items',
      description:
        'Reorder all the children under one parent in a single call. node_order lists the sibling node IDs in the order you want; omit parent_node_id to reorder the top-level items. Get the current node IDs from get_navigation first.',
      inputSchema: ReorderNavigationItemsInputSchema,
    },
    {
      name: 'remove_navigation_item',
      description:
        'Remove an item from the navigation tree. This unlinks the item from navigation; it does not archive the underlying page (use archive_page for that). Confirm with the user before removing unless they have authorized cleanup.',
      inputSchema: RemoveNavigationItemInputSchema,
    },
    {
      name: 'get_page_metadata',
      description:
        'Read a page\'s metadata within a structure (e.g. title, SEO fields, publish date). Metadata is scoped to a structure, so pass the structure_id the page belongs to.',
      inputSchema: GetPageMetadataInputSchema,
    },
    {
      name: 'set_page_metadata',
      description:
        'Set a page\'s metadata within a structure. metadata replaces the stored object in full, so include every field you want to keep. When the structure enforces a schema, the backend rejects metadata that does not conform.',
      inputSchema: SetPageMetadataInputSchema,
    },
    {
      name: 'list_document_versions',
      description:
        'List a document\'s version history on a branch, newest first. Use this to find the version_id to inspect with get_document_version or roll back to with restore_document_version.',
      inputSchema: ListDocumentVersionsInputSchema,
    },
    {
      name: 'get_document_version',
      description:
        'Get the full snapshot of a specific document version. Use this to inspect what a page looked like at a past point before deciding whether to restore it.',
      inputSchema: GetDocumentVersionInputSchema,
    },
    {
      name: 'restore_document_version',
      description:
        'Roll a document back to a prior version by writing that version\'s snapshot as a new, current version. History is append-only, so the older versions are preserved and the rollback can itself be undone. Confirm with the user before overwriting current content.',
      inputSchema: RestoreDocumentVersionInputSchema,
    },
    {
      name: 'publish_page',
      description:
        'Publish a single page so its current version becomes the live, content-delivery version on the branch. This is the per-page counterpart to merging a whole branch. Publishing is outward-facing — confirm with the user before publishing to a live branch.',
      inputSchema: PublishPageInputSchema,
    },
    {
      name: 'archive_page',
      description:
        'Archive (soft-delete) a page on a branch. The page is hidden but its history is preserved; use restore_page to bring it back. Confirm with the user before archiving unless they have authorized cleanup.',
      inputSchema: ArchivePageInputSchema,
    },
    {
      name: 'restore_page',
      description:
        'Restore a previously archived page. This is site-scoped: it acts on the document record across the site, not on a single branch. Errors if the page does not exist or is not archived.',
      inputSchema: RestorePageInputSchema,
    },
    {
      name: 'rename_page',
      description:
        'Change a page\'s path. This is site-scoped: the new path applies across the site, not only on your working branch. Errors if another document already occupies the new path.',
      inputSchema: RenamePageInputSchema,
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

interface ConflictResolutionInputShape {
  document_id: string;
  strategy: 'take-source' | 'take-target' | 'manual';
  resolved_snapshot?: Record<string, unknown>;
}

function mapConflictResolutions(
  resolutions: ConflictResolutionInputShape[] | undefined,
): { documentId: string; strategy: 'take-source' | 'take-target' | 'manual'; resolvedSnapshot?: Record<string, unknown> }[] | undefined {
  return resolutions?.map((r) => ({
    documentId: r.document_id,
    strategy: r.strategy,
    ...(r.resolved_snapshot !== undefined && { resolvedSnapshot: r.resolved_snapshot }),
  }));
}

function formatValidationError(errors: ValidationError[]): ToolResult {
  const n = errors.length;
  const summary = `Validation failed: ${String(n)} error${n === 1 ? '' : 's'}. Correct the errors below and retry.`;
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(errors, null, 2)}` }],
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
type GetBranchInput = z.infer<typeof GetBranchInputSchema>;
type UpdateBranchInput = z.infer<typeof UpdateBranchInputSchema>;
type ArchiveBranchInput = z.infer<typeof ArchiveBranchInputSchema>;
type RestoreBranchInput = z.infer<typeof RestoreBranchInputSchema>;
type CheckMergeInput = z.infer<typeof CheckMergeInputSchema>;
type PreviewMergeInput = z.infer<typeof PreviewMergeInputSchema>;
type ExecuteMergeInput = z.infer<typeof ExecuteMergeInputSchema>;
type CreateMergeRequestInput = z.infer<typeof CreateMergeRequestInputSchema>;
type ListMergeRequestsInput = z.infer<typeof ListMergeRequestsInputSchema>;
type GetMergeRequestInput = z.infer<typeof GetMergeRequestInputSchema>;
type UpdateMergeRequestInput = z.infer<typeof UpdateMergeRequestInputSchema>;
type ExecuteMergeRequestInput = z.infer<typeof ExecuteMergeRequestInputSchema>;
type ListStructuresInput = z.infer<typeof ListStructuresInputSchema>;
type GetNavigationInput = z.infer<typeof GetNavigationInputSchema>;
type AddNavigationItemInput = z.infer<typeof AddNavigationItemInputSchema>;
type UpdateNavigationItemInput = z.infer<typeof UpdateNavigationItemInputSchema>;
type MoveNavigationItemInput = z.infer<typeof MoveNavigationItemInputSchema>;
type ReorderNavigationItemsInput = z.infer<typeof ReorderNavigationItemsInputSchema>;
type RemoveNavigationItemInput = z.infer<typeof RemoveNavigationItemInputSchema>;
type GetPageMetadataInput = z.infer<typeof GetPageMetadataInputSchema>;
type SetPageMetadataInput = z.infer<typeof SetPageMetadataInputSchema>;
type ListDocumentVersionsInput = z.infer<typeof ListDocumentVersionsInputSchema>;
type GetDocumentVersionInput = z.infer<typeof GetDocumentVersionInputSchema>;
type RestoreDocumentVersionInput = z.infer<typeof RestoreDocumentVersionInputSchema>;
type PublishPageInput = z.infer<typeof PublishPageInputSchema>;
type ArchivePageInput = z.infer<typeof ArchivePageInputSchema>;
type RestorePageInput = z.infer<typeof RestorePageInputSchema>;
type RenamePageInput = z.infer<typeof RenamePageInputSchema>;

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
  get_branch: (input: GetBranchInput) => Promise<ToolResult>;
  update_branch: (input: UpdateBranchInput) => Promise<ToolResult>;
  archive_branch: (input: ArchiveBranchInput) => Promise<ToolResult>;
  restore_branch: (input: RestoreBranchInput) => Promise<ToolResult>;
  check_merge: (input: CheckMergeInput) => Promise<ToolResult>;
  preview_merge: (input: PreviewMergeInput) => Promise<ToolResult>;
  execute_merge: (input: ExecuteMergeInput) => Promise<ToolResult>;
  create_merge_request: (input: CreateMergeRequestInput) => Promise<ToolResult>;
  list_merge_requests: (input: ListMergeRequestsInput) => Promise<ToolResult>;
  get_merge_request: (input: GetMergeRequestInput) => Promise<ToolResult>;
  update_merge_request: (input: UpdateMergeRequestInput) => Promise<ToolResult>;
  execute_merge_request: (input: ExecuteMergeRequestInput) => Promise<ToolResult>;
  list_structures: (input: ListStructuresInput) => Promise<ToolResult>;
  get_navigation: (input: GetNavigationInput) => Promise<ToolResult>;
  add_navigation_item: (input: AddNavigationItemInput) => Promise<ToolResult>;
  update_navigation_item: (input: UpdateNavigationItemInput) => Promise<ToolResult>;
  move_navigation_item: (input: MoveNavigationItemInput) => Promise<ToolResult>;
  reorder_navigation_items: (input: ReorderNavigationItemsInput) => Promise<ToolResult>;
  remove_navigation_item: (input: RemoveNavigationItemInput) => Promise<ToolResult>;
  get_page_metadata: (input: GetPageMetadataInput) => Promise<ToolResult>;
  set_page_metadata: (input: SetPageMetadataInput) => Promise<ToolResult>;
  list_document_versions: (input: ListDocumentVersionsInput) => Promise<ToolResult>;
  get_document_version: (input: GetDocumentVersionInput) => Promise<ToolResult>;
  restore_document_version: (input: RestoreDocumentVersionInput) => Promise<ToolResult>;
  publish_page: (input: PublishPageInput) => Promise<ToolResult>;
  archive_page: (input: ArchivePageInput) => Promise<ToolResult>;
  restore_page: (input: RestorePageInput) => Promise<ToolResult>;
  rename_page: (input: RenamePageInput) => Promise<ToolResult>;
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
        const contentDocs = result.documents.filter((doc) => !doc.path.startsWith('_registry/'));
        if (contentDocs.length === 0) {
          return formatResult('No documents found in this branch.');
        }
        const formatted = contentDocs
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

        // Validate ops against the component registry before sending to CSS.
        // Only runs when enableValidation is set on the client config (production).
        // If the registry fetch fails for any reason, proceed without validation
        // (graceful degradation — the backend will still enforce its own rules).
        if (apiClient.validationEnabled) {
          try {
            const registry = await apiClient.fetchRegistrySchemas(input.site_id, input.branch_id);

            // Fetch the current document snapshot so validateOps can resolve component
            // types for targeted prop writes (e.g. content.2.props.background = "steve").
            // Without the snapshot those ops look like primitive-content replacements
            // and slip past content-shape validation.
            let currentSnapshot: Record<string, unknown> | undefined;
            try {
              const doc = await apiClient.getDocument(
                input.site_id,
                input.branch_id,
                input.document_path,
              );
              currentSnapshot = doc.snapshot;
            } catch {
              // Proceed without snapshot — content-shape ops still validate
            }

            const { errors } = validateOps({
              operations: normalizedOperations,
              registry,
              currentSnapshot,
            });
            if (errors.length > 0) {
              return formatValidationError(errors);
            }
          } catch {
            // Registry fetch failed — proceed without validation
          }
        }

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
        // The _registry/ prefix is reserved whether or not the caller writes a
        // leading slash, so compare against the path with any leading slash removed.
        if (input.document_path.replace(/^\//, '').startsWith('_registry/')) {
          return formatError(
            new Error(
              'Cannot create pages at the _registry/ path prefix — this is reserved for system use.',
            ),
          );
        }

        // Validate component types and props against the registry before writing.
        // Construct synthetic add ops so we can reuse validateOps from the library.
        // Only runs when enableValidation is set on the client config (production).
        if (apiClient.validationEnabled) {
          try {
            const registry = await apiClient.fetchRegistrySchemas(input.site_id, input.branch_id);
            const syntheticOps = input.components.map((component, i) => ({
              type: 'add' as const,
              path: `content.${String(i)}`,
              content: {
                type: component.type,
                props: { id: generateULID(), ...component.props },
              },
            }));
            const { errors } = validateOps({ operations: syntheticOps, registry });
            if (errors.length > 0) {
              return formatValidationError(errors);
            }
          } catch {
            // Registry fetch failed — proceed without validation
          }
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

    async get_branch(input: GetBranchInput): Promise<ToolResult> {
      try {
        const branch = await apiClient.getBranch(input.site_id, input.branch_id);
        return formatResult(branch);
      } catch (error) {
        return formatError(error);
      }
    },

    async update_branch(input: UpdateBranchInput): Promise<ToolResult> {
      try {
        if (input.name === undefined && input.description === undefined && input.status === undefined) {
          return formatError(
            new Error('Provide at least one of name, description, or status to update.'),
          );
        }
        const body: { name?: string; description?: string; status?: string } = {};
        if (input.name !== undefined) body.name = input.name;
        if (input.description !== undefined) body.description = input.description;
        if (input.status !== undefined) body.status = input.status;

        const branch = await apiClient.updateBranch(input.site_id, input.branch_id, body);
        return formatResult({ message: `Branch "${branch.name}" updated.`, ...branch });
      } catch (error) {
        return formatError(error);
      }
    },

    async archive_branch(input: ArchiveBranchInput): Promise<ToolResult> {
      try {
        await apiClient.archiveBranch(input.site_id, input.branch_id);
        return formatResult({
          message: 'Branch archived. Use restore_branch to bring it back.',
          branchId: input.branch_id,
        });
      } catch (error) {
        return formatError(error);
      }
    },

    async restore_branch(input: RestoreBranchInput): Promise<ToolResult> {
      try {
        const branch = await apiClient.restoreBranch(input.site_id, input.branch_id);
        return formatResult({ message: `Branch "${branch.name}" restored.`, ...branch });
      } catch (error) {
        return formatError(error);
      }
    },

    async check_merge(input: CheckMergeInput): Promise<ToolResult> {
      try {
        const result = await apiClient.checkMerge(input.site_id, {
          sourceBranchId: input.source_branch_id,
          targetBranchId: input.target_branch_id,
        });
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async preview_merge(input: PreviewMergeInput): Promise<ToolResult> {
      try {
        const body: {
          sourceBranchId: string;
          targetBranchId: string;
          includeContent?: boolean;
          excludePathPrefixes?: string[];
        } = {
          sourceBranchId: input.source_branch_id,
          targetBranchId: input.target_branch_id,
        };
        if (input.include_content !== undefined) body.includeContent = input.include_content;
        if (input.exclude_path_prefixes !== undefined) {
          body.excludePathPrefixes = input.exclude_path_prefixes;
        }

        const result = await apiClient.previewMerge(input.site_id, body);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async execute_merge(input: ExecuteMergeInput): Promise<ToolResult> {
      try {
        const body: {
          sourceBranchId: string;
          targetBranchId: string;
          message?: string;
          conflictResolutions?: ReturnType<typeof mapConflictResolutions>;
        } = {
          sourceBranchId: input.source_branch_id,
          targetBranchId: input.target_branch_id,
        };
        if (input.message !== undefined) body.message = input.message;
        const resolutions = mapConflictResolutions(input.conflict_resolutions);
        if (resolutions !== undefined) body.conflictResolutions = resolutions;

        const result = await apiClient.executeMerge(input.site_id, body);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async create_merge_request(input: CreateMergeRequestInput): Promise<ToolResult> {
      try {
        const body: {
          sourceBranchId: string;
          targetBranchId: string;
          title: string;
          description?: string;
        } = {
          sourceBranchId: input.source_branch_id,
          targetBranchId: input.target_branch_id,
          title: input.title,
        };
        if (input.description !== undefined) body.description = input.description;

        const mergeRequest = await apiClient.createMergeRequest(input.site_id, body);
        return formatResult({ message: 'Merge request created.', ...mergeRequest });
      } catch (error) {
        return formatError(error);
      }
    },

    async list_merge_requests(input: ListMergeRequestsInput): Promise<ToolResult> {
      try {
        const result = await apiClient.listMergeRequests(
          input.site_id,
          input.status !== undefined ? { status: input.status } : undefined,
        );
        if (result.mergeRequests.length === 0) {
          return formatResult('No merge requests found.');
        }
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async get_merge_request(input: GetMergeRequestInput): Promise<ToolResult> {
      try {
        const mergeRequest = await apiClient.getMergeRequest(
          input.site_id,
          input.merge_request_id,
        );
        return formatResult(mergeRequest);
      } catch (error) {
        return formatError(error);
      }
    },

    async update_merge_request(input: UpdateMergeRequestInput): Promise<ToolResult> {
      try {
        if (input.title === undefined && input.description === undefined && input.status === undefined) {
          return formatError(
            new Error('Provide at least one of title, description, or status to update.'),
          );
        }
        const body: { title?: string; description?: string; status?: string } = {};
        if (input.title !== undefined) body.title = input.title;
        if (input.description !== undefined) body.description = input.description;
        if (input.status !== undefined) body.status = input.status;

        const mergeRequest = await apiClient.updateMergeRequest(
          input.site_id,
          input.merge_request_id,
          body,
        );
        return formatResult({ message: 'Merge request updated.', ...mergeRequest });
      } catch (error) {
        return formatError(error);
      }
    },

    async execute_merge_request(input: ExecuteMergeRequestInput): Promise<ToolResult> {
      try {
        const resolutions = mapConflictResolutions(input.resolutions);
        const result = await apiClient.executeMergeRequest(
          input.site_id,
          input.merge_request_id,
          resolutions !== undefined ? { resolutions } : undefined,
        );
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async list_structures(input: ListStructuresInput): Promise<ToolResult> {
      try {
        const result = await apiClient.listStructures(
          input.site_id,
          input.branch_id,
          input.structure_type !== undefined ? { structureType: input.structure_type } : undefined,
        );
        if (result.structures.length === 0) {
          return formatResult('No structures found on this branch.');
        }
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async get_navigation(input: GetNavigationInput): Promise<ToolResult> {
      try {
        const result = await apiClient.getNavigation(
          input.site_id,
          input.branch_id,
          input.structure_id,
        );
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async add_navigation_item(input: AddNavigationItemInput): Promise<ToolResult> {
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

        const node = await apiClient.createNode(
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

    async update_navigation_item(input: UpdateNavigationItemInput): Promise<ToolResult> {
      try {
        if (input.name === undefined && input.slug === undefined && input.position === undefined) {
          return formatError(
            new Error('Provide at least one of name, slug, or position to update.'),
          );
        }
        const body: { name?: string; slug?: string; position?: number } = {};
        if (input.name !== undefined) body.name = input.name;
        if (input.slug !== undefined) body.slug = input.slug;
        if (input.position !== undefined) body.position = input.position;

        const node = await apiClient.updateNode(
          input.site_id,
          input.branch_id,
          input.structure_id,
          input.node_id,
          body,
        );
        return formatResult({ message: 'Navigation item updated.', ...node });
      } catch (error) {
        return formatError(error);
      }
    },

    async move_navigation_item(input: MoveNavigationItemInput): Promise<ToolResult> {
      try {
        const body: { newParentId: string | null; newPosition?: number } = {
          newParentId: input.new_parent_id ?? null,
        };
        if (input.new_position !== undefined) body.newPosition = input.new_position;

        const node = await apiClient.moveNode(
          input.site_id,
          input.branch_id,
          input.structure_id,
          input.node_id,
          body,
        );
        return formatResult({ message: 'Navigation item moved.', ...node });
      } catch (error) {
        return formatError(error);
      }
    },

    async reorder_navigation_items(input: ReorderNavigationItemsInput): Promise<ToolResult> {
      try {
        const result = await apiClient.reorderNodes(
          input.site_id,
          input.branch_id,
          input.structure_id,
          {
            parentNodeId: input.parent_node_id ?? null,
            nodeOrder: input.node_order,
          },
        );
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async remove_navigation_item(input: RemoveNavigationItemInput): Promise<ToolResult> {
      try {
        await apiClient.deleteNode(
          input.site_id,
          input.branch_id,
          input.structure_id,
          input.node_id,
        );
        return formatResult({
          message: 'Navigation item removed.',
          nodeId: input.node_id,
        });
      } catch (error) {
        return formatError(error);
      }
    },

    async get_page_metadata(input: GetPageMetadataInput): Promise<ToolResult> {
      try {
        const result = await apiClient.getDocumentMetadata(
          input.site_id,
          input.branch_id,
          input.structure_id,
          input.document_id,
        );
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async set_page_metadata(input: SetPageMetadataInput): Promise<ToolResult> {
      try {
        const result = await apiClient.setDocumentMetadata(
          input.site_id,
          input.branch_id,
          input.structure_id,
          input.document_id,
          input.metadata,
        );
        return formatResult({ message: 'Page metadata saved.', ...result });
      } catch (error) {
        return formatError(error);
      }
    },

    async list_document_versions(input: ListDocumentVersionsInput): Promise<ToolResult> {
      try {
        const result = await apiClient.listDocumentVersions(
          input.site_id,
          input.branch_id,
          input.document_id,
        );
        if (result.versions.length === 0) {
          return formatResult('No versions found for this document.');
        }
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async get_document_version(input: GetDocumentVersionInput): Promise<ToolResult> {
      try {
        const version = await apiClient.getDocumentVersion(
          input.site_id,
          input.branch_id,
          input.document_id,
          input.version_id,
        );
        return formatResult(version);
      } catch (error) {
        return formatError(error);
      }
    },

    async restore_document_version(input: RestoreDocumentVersionInput): Promise<ToolResult> {
      // TODO(PCC-3294): the restored version is written as a plain edit with no
      // marker that it is a rollback, so history cannot distinguish a restore
      // from a normal change. Record restore provenance, ideally via the
      // server-side restore endpoint proposed in PCC-3206.
      try {
        const version = await apiClient.getDocumentVersion(
          input.site_id,
          input.branch_id,
          input.document_id,
          input.version_id,
        );
        const snapshot = version.snapshot;
        if (snapshot === undefined || snapshot === null) {
          return formatError(new Error('The target version has no snapshot to restore.'));
        }
        const created = await apiClient.createDocumentVersion(
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

    async publish_page(input: PublishPageInput): Promise<ToolResult> {
      try {
        const result = await apiClient.publishDocument(
          input.site_id,
          input.branch_id,
          input.document_id,
        );
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    },

    async archive_page(input: ArchivePageInput): Promise<ToolResult> {
      try {
        await apiClient.archiveDocumentOnBranch(
          input.site_id,
          input.branch_id,
          input.document_id,
        );
        return formatResult({
          message: 'Page archived. Use restore_page to bring it back.',
          documentId: input.document_id,
        });
      } catch (error) {
        return formatError(error);
      }
    },

    async restore_page(input: RestorePageInput): Promise<ToolResult> {
      try {
        const document = await apiClient.restoreDocument(input.site_id, input.document_id);
        return formatResult({ message: 'Page restored.', ...document });
      } catch (error) {
        return formatError(error);
      }
    },

    async rename_page(input: RenamePageInput): Promise<ToolResult> {
      try {
        const document = await apiClient.renameDocument(
          input.site_id,
          input.document_id,
          input.path,
        );
        return formatResult({ message: `Page renamed to "${input.path}".`, ...document });
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
  get_branch: GetBranchInputSchema,
  update_branch: UpdateBranchInputSchema,
  archive_branch: ArchiveBranchInputSchema,
  restore_branch: RestoreBranchInputSchema,
  check_merge: CheckMergeInputSchema,
  preview_merge: PreviewMergeInputSchema,
  execute_merge: ExecuteMergeInputSchema,
  create_merge_request: CreateMergeRequestInputSchema,
  list_merge_requests: ListMergeRequestsInputSchema,
  get_merge_request: GetMergeRequestInputSchema,
  update_merge_request: UpdateMergeRequestInputSchema,
  execute_merge_request: ExecuteMergeRequestInputSchema,
  list_structures: ListStructuresInputSchema,
  get_navigation: GetNavigationInputSchema,
  add_navigation_item: AddNavigationItemInputSchema,
  update_navigation_item: UpdateNavigationItemInputSchema,
  move_navigation_item: MoveNavigationItemInputSchema,
  reorder_navigation_items: ReorderNavigationItemsInputSchema,
  remove_navigation_item: RemoveNavigationItemInputSchema,
  get_page_metadata: GetPageMetadataInputSchema,
  set_page_metadata: SetPageMetadataInputSchema,
  list_document_versions: ListDocumentVersionsInputSchema,
  get_document_version: GetDocumentVersionInputSchema,
  restore_document_version: RestoreDocumentVersionInputSchema,
  publish_page: PublishPageInputSchema,
  archive_page: ArchivePageInputSchema,
  restore_page: RestorePageInputSchema,
  rename_page: RenamePageInputSchema,
};
