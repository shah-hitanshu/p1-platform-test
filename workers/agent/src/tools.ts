import type Anthropic from '@anthropic-ai/sdk';
import type { McpApiClient } from './css-api.js';

// Inline ULID generator — no external dependency required in Workers
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

// Accepts dot-notation or JSON Pointer (/content/0/props/title → content.0.props.title)
function normalizePath(path: string): string {
  if (path.startsWith('/')) {
    return path.slice(1).split('/').join('.');
  }
  return path.replace(/^\.+/, '');
}

// Recursively inject ULID ids into any Puck component (or array of components)
// that is missing one. Handles both single-component and full-array replacements.
export function injectPuckIds(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content.map(injectPuckIds);
  }
  if (content !== null && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.type === 'string' && typeof obj.props === 'object' && obj.props !== null) {
      const props = obj.props as Record<string, unknown>;
      if (!props.id) {
        return { ...obj, props: { ...props, id: generateULID() } };
      }
    }
  }
  return content;
}

// Anthropic tool definitions for CSS capabilities.
// list_sites / list_branches / list_documents are intentionally excluded — the
// site, branch, and document are always provided in the editor context.
export const CSS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_components',
    description: 'List Puck components available for building a new page. Only needed when creating a new page — do not call when editing an existing page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
      },
      required: ['site_id', 'branch_id'],
    },
  },
  {
    name: 'get_document',
    description: 'Get the full Puck document snapshot. Only call when you need the page structure and do not already have it from earlier in this conversation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string', description: 'Document path e.g. /index' },
      },
      required: ['site_id', 'branch_id', 'document_path'],
    },
  },
  {
    name: 'check_edit_permission',
    description: 'Check if the agent can edit target regions on a document. MUST call before start_edit_session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        intent: { type: 'string', description: 'Human-readable description of what you intend to change' },
        target_regions: { type: 'array', items: { type: 'string' }, description: 'JSON paths of regions to edit, e.g. ["content.0", "content.1"]' },
      },
      required: ['site_id', 'branch_id', 'document_path', 'intent', 'target_regions'],
    },
  },
  {
    name: 'start_edit_session',
    description: 'Start an edit session and reserve regions. Requires prior check_edit_permission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        intent: { type: 'string' },
        target_regions: { type: 'array', items: { type: 'string' } },
      },
      required: ['site_id', 'branch_id', 'document_path', 'intent', 'target_regions'],
    },
  },
  {
    name: 'apply_document_edits',
    description: 'Apply edit operations to the document. Path uses dot-notation: "content.0.props.title" NOT "content[0]".',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        edit_session_id: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['add', 'remove', 'replace', 'move', 'reorder'] },
              path: { type: 'string' },
              content: {},
              index: { type: 'number' },
              fromIndex: { type: 'number' },
              toIndex: { type: 'number' },
            },
            required: ['type', 'path'],
          },
        },
      },
      required: ['site_id', 'branch_id', 'document_path', 'edit_session_id', 'operations'],
    },
  },
  {
    name: 'complete_edit_session',
    description: 'Finalize a successful edit session. MUST call when done — do not leave sessions open.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        edit_session_id: { type: 'string' },
      },
      required: ['site_id', 'branch_id', 'document_path', 'edit_session_id'],
    },
  },
  {
    name: 'abort_edit_session',
    description: 'Rollback an edit session. Use on conflict, user cancellation, or unexpected results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        edit_session_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['site_id', 'branch_id', 'document_path', 'edit_session_id'],
    },
  },
  {
    name: 'get_branch_presence',
    description: 'Get all actors currently active on a branch across all documents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
      },
      required: ['site_id', 'branch_id'],
    },
  },
  {
    name: 'get_document_presence',
    description: 'Get presence information for a specific document.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
      },
      required: ['site_id', 'branch_id', 'document_path'],
    },
  },
  {
    name: 'create_page',
    description: 'Create a brand-new page document with Puck components. ONLY call after the user has explicitly confirmed they want a new page — never call for editing requests. No edit session needed. IMPORTANT: component types must be names returned by list_components — never invent or guess component names.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string', description: 'Path for the new page, e.g. /about' },
        components: {
          type: 'array',
          description: 'Ordered list of Puck components for the page',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Component name from list_components' },
              props: { type: 'object' },
              zone: { type: 'string' },
              parentId: { type: 'string' },
            },
            required: ['type', 'props'],
          },
        },
        root_props: { type: 'object', description: 'Root-level page props (e.g. title)' },
      },
      required: ['site_id', 'branch_id', 'document_path', 'components'],
    },
  },
];

// Tool name union for type safety
type ToolName = (typeof CSS_TOOLS)[number]['name'];

// Execute a tool call from Claude against the CSS backend
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  cssApi: McpApiClient,
  userId: string,
  hints?: { documentId?: string },
): Promise<unknown> {
  const name = toolName as ToolName;

  switch (name) {
    case 'list_sites':
      return cssApi.listSites();

    case 'list_branches':
      return cssApi.listBranches(toolInput.site_id as string);

    case 'list_documents':
      return cssApi.listDocuments(toolInput.site_id as string, toolInput.branch_id as string);

    case 'list_components':
      return cssApi.listComponents(toolInput.site_id as string, toolInput.branch_id as string);

    case 'get_document': {
      const siteId = toolInput.site_id as string;
      const branchId = toolInput.branch_id as string;
      const documentPath = toolInput.document_path as string;
      if (hints?.documentId) {
        return cssApi.getDocumentLatestVersion(siteId, branchId, hints.documentId);
      }
      const docs = await cssApi.listDocuments(siteId, branchId, { pathPrefix: documentPath });
      const doc = docs.documents.find(d => d.path === documentPath);
      if (!doc) throw new Error(`Document not found: ${documentPath}`);
      return cssApi.getDocumentLatestVersion(siteId, branchId, doc.id);
    }

    case 'check_edit_permission':
      return cssApi.canAgentEdit({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        intent: toolInput.intent as string,
        targetRegions: toolInput.target_regions as string[],
        trigger: 'human_requested',
        requestedById: userId,
      });

    case 'start_edit_session':
      return cssApi.startAgentEdit({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        intent: toolInput.intent as string,
        targetRegions: toolInput.target_regions as string[],
        trigger: 'human_requested',
        requestedById: userId,
      });

    case 'apply_document_edits': {
      type RawOp = {
        type: 'add' | 'remove' | 'replace' | 'move' | 'reorder';
        path: string;
        content?: unknown;
        index?: number;
        fromIndex?: number;
        toIndex?: number;
      };
      const operations = (toolInput.operations as RawOp[]).map(op => {
        const normalized: RawOp = { ...op, path: normalizePath(op.path) };
        if ((op.type === 'add' || op.type === 'replace') && op.content !== undefined) {
          normalized.content = injectPuckIds(op.content);
        }
        return normalized;
      });
      return cssApi.applyEdits({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        editSessionId: toolInput.edit_session_id as string,
        operations,
      });
    }

    case 'complete_edit_session':
      return cssApi.completeAgentEdit({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        editSessionId: toolInput.edit_session_id as string,
      });

    case 'abort_edit_session':
      return cssApi.abortAgentEdit({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        editSessionId: toolInput.edit_session_id as string,
        reason: toolInput.reason as string | undefined,
      });

    case 'get_branch_presence':
      return cssApi.getBranchPresence(toolInput.site_id as string, toolInput.branch_id as string);

    case 'get_document_presence':
      return cssApi.getDocumentPresence(
        toolInput.site_id as string,
        toolInput.branch_id as string,
        toolInput.document_path as string,
      );

    case 'create_page': {
      const documentPath = toolInput.document_path as string;

      if (documentPath.replace(/^\//, '').startsWith('_registry/')) {
        throw new Error('Cannot create pages at the _registry/ path prefix — this is reserved for system use.');
      }

      const components = toolInput.components as Array<{
        type: string;
        props: Record<string, unknown>;
        zone?: string;
        parentId?: string;
      }>;

      // Validate all component types against the registry — never allow invented names
      const registryNames = await cssApi.listComponentNames(toolInput.site_id as string, toolInput.branch_id as string);
      const validNames = new Set(registryNames);
      const invalid = components.map(c => c.type).filter(t => !validNames.has(t));
      if (invalid.length > 0) {
        throw new Error(
          `Unknown component type(s): ${invalid.join(', ')}. Available: ${[...validNames].join(', ')}`
        );
      }

      // Build valid Puck data, routing slotted components into zones
      interface PuckComponent { type: string; props: Record<string, unknown> & { id: string } }
      const content: PuckComponent[] = [];
      const zones: Record<string, PuckComponent[]> = {};

      for (const component of components) {
        const id = generateULID();
        const instance: PuckComponent = { type: component.type, props: { ...component.props, id } };
        if (component.parentId !== undefined && component.zone !== undefined) {
          const zoneKey = `${component.parentId}:${component.zone}`;
          zones[zoneKey] ??= [];
          zones[zoneKey].push(instance);
        } else {
          content.push(instance);
        }
      }

      const snapshot = {
        content,
        root: { props: toolInput.root_props ?? {} },
        ...(Object.keys(zones).length > 0 && { zones }),
      };
      return cssApi.createDocument(
        toolInput.site_id as string,
        toolInput.branch_id as string,
        documentPath,
        snapshot,
      );
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
