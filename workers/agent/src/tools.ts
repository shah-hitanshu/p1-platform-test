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

function getAtPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) return cur[parseInt(key, 10)];
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

function containsPuckComponent(content: unknown): boolean {
  if (Array.isArray(content)) return content.some(containsPuckComponent);
  if (content !== null && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    return typeof obj.type === 'string' && typeof obj.props === 'object' && obj.props !== null;
  }
  return false;
}

function validateComponentsAgainstRegistry(
  content: unknown,
  schemaMap: Map<string, Record<string, unknown>>,
  path: string,
): void {
  if (Array.isArray(content)) {
    content.forEach((item, i) => validateComponentsAgainstRegistry(item, schemaMap, `${path}.${i}`));
    return;
  }
  if (content !== null && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.type === 'string' && typeof obj.props === 'object' && obj.props !== null) {
      const schema = schemaMap.get(obj.type);
      if (!schema) {
        throw new Error(
          `Unknown component type "${obj.type}" at "${path}". ` +
          `Available types: ${[...schemaMap.keys()].join(', ')}. ` +
          `Do not invent component names — only use types returned by list_components.`
        );
      }
      const defaultProps = schema.defaultProps as Record<string, unknown> | undefined;
      if (defaultProps) {
        const { id: _id, ...propsToValidate } = obj.props as Record<string, unknown>;
        assertNoNewKeys(defaultProps, propsToValidate, `${path}.props`);
      }
    }
  }
}

function isPuckComponentShape(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    typeof (v as Record<string, unknown>).type === 'string' &&
    typeof (v as Record<string, unknown>).props === 'object' &&
    (v as Record<string, unknown>).props !== null;
}

function assertNoNewKeys(existing: unknown, replacement: unknown, path: string): void {
  // Puck-component arrays are heterogeneous — a positional comparison against
  // existing[0] would reject any item whose type differs from the first.
  // Per-component validation against the registry runs separately.
  if (Array.isArray(existing) && Array.isArray(replacement)) {
    if (replacement.some(isPuckComponentShape)) return;
    const ref = existing[0];
    if (ref === undefined) return;
    for (let i = 0; i < replacement.length; i++) {
      assertNoNewKeys(ref, replacement[i], `${path}.${i}`);
    }
    return;
  }
  // Replacing a Puck component with one of a different type is legal — registry
  // validation handles per-type prop checking. Skip positional key comparison.
  if (isPuckComponentShape(existing) && isPuckComponentShape(replacement)) return;
  if (
    existing !== null && typeof existing === 'object' && !Array.isArray(existing) &&
    replacement !== null && typeof replacement === 'object' && !Array.isArray(replacement)
  ) {
    const existingKeys = Object.keys(existing as object);
    const invalidKeys = Object.keys(replacement as object).filter(k => !existingKeys.includes(k));
    if (invalidKeys.length > 0) {
      throw new Error(
        `Invalid key(s) at "${path}": ${invalidKeys.map(k => `"${k}"`).join(', ')} ` +
        `do not exist in the component schema. Valid keys are: ${existingKeys.join(', ')}. ` +
        `Do not rename or add keys — only change values.`
      );
    }
    for (const key of Object.keys(replacement as object)) {
      assertNoNewKeys(
        (existing as Record<string, unknown>)[key],
        (replacement as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
  }
}

// Anthropic tool definitions for CSS capabilities.
// list_sites / list_branches / list_documents are intentionally excluded — the
// site, branch, and document are always provided in the editor context.
export const CSS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_components',
    description: 'List P1 components available for building a new page. Only needed when creating a new page — do not call when editing an existing page.',
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
    description: 'Get the full P1 document snapshot. Only call when you need the page structure and do not already have it from earlier in this conversation.',
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
    description: [
      'Apply edit operations to the document.',
      'Path uses dot-notation: "content.0.props.title" NOT "content[0]".',
      'Never rename or add keys — only change values. Field names must match the component schema exactly.',
      '',
      'Operation types:',
      '  replace — overwrite a value at path with content (e.g. change a prop value: path "content.0.props.title", content "New title").',
      '  add     — insert content into an array. Path ends with the target index (e.g. "content.2" inserts at index 2).',
      '  remove  — delete the element at path (e.g. "content.1" removes the second component).',
      '  move    — reorder a single element within an array. Path is the array (e.g. "content"), with fromIndex and toIndex.',
      '',
      'To reorder one component, prefer "move" — it is a single atomic operation. Only use a full-array "replace" on "content" when reordering many components at once.',
    ].join('\n'),
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
              type: { type: 'string', enum: ['add', 'remove', 'replace', 'move'] },
              path: { type: 'string' },
              content: {},
              fromIndex: { type: 'number', description: 'For move: source index in the array.' },
              toIndex: { type: 'number', description: 'For move: destination index in the array.' },
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
    description: 'Create a brand-new page document with P1 components. ONLY call after the user has explicitly confirmed they want a new page — never call for editing requests. No edit session needed. IMPORTANT: component types must be names returned by list_components — never invent or guess component names.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string', description: 'Path for the new page, e.g. /about' },
        components: {
          type: 'array',
          description: 'Ordered list of P1 components for the page',
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

// Tool definitions for web/media capabilities
export const WEB_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_media',
    description: 'List media files available in the site media library. Optionally filter by filename substring.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        search: { type: 'string', description: 'Optional filename substring filter' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'fetch_page',
    description: 'Fetch a public web page and extract its title, meta description, headings, paragraphs, and images as structured text. Only works with public http/https URLs — not localhost or private IP ranges.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The http or https URL to fetch' },
      },
      required: ['url'],
    },
  },
];

// Tool name union for type safety
type ToolName = (typeof CSS_TOOLS)[number]['name'] | (typeof WEB_TOOLS)[number]['name'];

// Validate that a URL is safe to fetch (public http/https only)
export function validatePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`URL must use http or https protocol`);
  }

  const host = url.hostname.toLowerCase();

  // Reject localhost variants
  if (host === 'localhost' || host === '::1' || host === '[::1]') {
    throw new Error(`Fetching localhost URLs is not allowed`);
  }

  // Reject private IPv4 ranges: 127.x, 10.x, 192.168.x, 172.16-31.x
  const privatePatterns = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
  ];
  if (privatePatterns.some(p => p.test(host))) {
    throw new Error(`Fetching private IP addresses is not allowed`);
  }

  return url;
}

// Execute a tool call from Claude against the CSS backend or web tools
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  cssApi: McpApiClient,
  userId: string,
  webConfig?: { token: string; mediaWorkerUrl: string },
): Promise<unknown> {
  const name = toolName as ToolName;

  switch (name) {
    case 'list_sites':
      return cssApi.listSites();

    case 'list_branches':
      return cssApi.listBranches(toolInput.site_id as string);

    case 'list_documents':
      return cssApi.listDocuments(toolInput.site_id as string, toolInput.branch_id as string);

    case 'list_components': {
      const result = await cssApi.listComponents(toolInput.site_id as string, toolInput.branch_id as string);
      return (result.components as Array<Record<string, unknown>>).map(c => ({
        name: c.name,
        defaultProps: c.defaultProps,
        ...(c.ai && (c.ai as Record<string, unknown>).instructions
          ? { instructions: (c.ai as Record<string, unknown>).instructions }
          : {}),
      }));
    }

    case 'get_document': {
      const siteId = toolInput.site_id as string;
      const branchId = toolInput.branch_id as string;
      const rawPath = toolInput.document_path as string;
      const documentPath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
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
      type AgentOp = {
        type: 'add' | 'remove' | 'replace' | 'move';
        path: string;
        content?: unknown;
        fromIndex?: number;
        toIndex?: number;
      };
      // Normalize agent ops (path + ID injection) but keep agent vocabulary
      // for validation. Translation to backend ops happens after validation.
      const operations = (toolInput.operations as AgentOp[]).map(op => {
        const normalized: AgentOp = { ...op, path: normalizePath(op.path) };
        if ((op.type === 'add' || op.type === 'replace') && op.content !== undefined) {
          normalized.content = injectPuckIds(op.content);
        }
        return normalized;
      });

      try {
        const siteId = toolInput.site_id as string;
        const branchId = toolInput.branch_id as string;
        const rawDocPath = toolInput.document_path as string;
        const documentPath = rawDocPath.startsWith('/') ? rawDocPath.slice(1) : rawDocPath;
        const docs = await cssApi.listDocuments(siteId, branchId, { pathPrefix: documentPath });
        const doc = docs.documents.find(d => d.path === documentPath);
        if (doc) {
          const version = await cssApi.getDocumentLatestVersion(siteId, branchId, doc.id);
          const snapshot = version.snapshot;
          for (const op of operations) {
            if (op.type === 'replace' && op.content !== undefined) {
              assertNoNewKeys(getAtPath(snapshot, op.path), op.content, op.path);
            } else if (op.type === 'add' && op.content !== undefined) {
              const segments = op.path.split('.');
              const parentPath = segments.slice(0, -1).join('.');
              const parentVal = parentPath ? getAtPath(snapshot, parentPath) : snapshot;
              if (Array.isArray(parentVal) && parentVal.length > 0) {
                assertNoNewKeys(parentVal[0], op.content, op.path);
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Invalid key(s)')) {
          throw err;
        }
      }

      // Registry-based validation for any add/replace ops containing Puck components.
      // Snapshot-based validation above silently skips empty arrays (no reference item),
      // so this pass catches hallucinated props when inserting into empty or new content.
      const componentOps = operations.filter(
        op => (op.type === 'add' || op.type === 'replace') &&
          op.content !== undefined &&
          containsPuckComponent(op.content),
      );
      if (componentOps.length > 0) {
        try {
          const registryResult = await cssApi.listComponents(
            toolInput.site_id as string,
            toolInput.branch_id as string,
          );
          const schemaMap = new Map<string, Record<string, unknown>>();
          for (const comp of registryResult.components as Array<Record<string, unknown>>) {
            if (typeof comp.name === 'string') schemaMap.set(comp.name, comp);
          }
          for (const op of componentOps) {
            validateComponentsAgainstRegistry(op.content, schemaMap, op.path);
          }
        } catch (err) {
          if (err instanceof Error && (
            err.message.startsWith('Invalid key(s)') ||
            err.message.startsWith('Unknown component type')
          )) {
            throw err;
          }
          // Registry fetch failed — proceed without registry validation
        }
      }

      // Translate agent vocabulary to the CSS backend's operation set.
      // Backend accepts: set | delete | insert | move | replace.
      const backendOps = operations.map(op => {
        switch (op.type) {
          case 'add': {
            const segments = op.path.split('.');
            const tail = segments.pop();
            if (!tail || !/^\d+$/.test(tail)) {
              throw new Error(
                `add operation requires a numeric index at the end of the path. Got: "${op.path}". ` +
                `Example: path "content.2" inserts at index 2.`
              );
            }
            return { type: 'insert' as const, path: segments.join('.'), index: parseInt(tail, 10), value: op.content };
          }
          case 'remove':
            return { type: 'delete' as const, path: op.path };
          case 'replace':
            return { type: 'replace' as const, path: op.path, content: op.content };
          case 'move':
            if (typeof op.fromIndex !== 'number' || typeof op.toIndex !== 'number') {
              throw new Error('move operation requires both fromIndex and toIndex.');
            }
            return { type: 'move' as const, path: op.path, fromIndex: op.fromIndex, toIndex: op.toIndex };
        }
      });

      return cssApi.applyEdits({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        editSessionId: toolInput.edit_session_id as string,
        operations: backendOps,
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
      const registryComponents = await cssApi.listComponents(toolInput.site_id as string, toolInput.branch_id as string);
      const schemaMap = new Map<string, Record<string, unknown>>();
      for (const comp of registryComponents.components as Array<Record<string, unknown>>) {
        if (typeof comp.name === 'string') {
          schemaMap.set(comp.name, comp);
        }
      }
      const validNames = new Set(schemaMap.keys());
      const invalid = components.map(c => c.type).filter(t => !validNames.has(t));
      if (invalid.length > 0) {
        throw new Error(
          `Unknown component type(s): ${invalid.join(', ')}. Available: ${[...validNames].join(', ')}`
        );
      }

      // Validate props and build component instances with fresh ULIDs
      interface PuckComponent { type: string; props: Record<string, unknown> & { id: string } }
      const contentComponents: PuckComponent[] = [];

      for (const component of components) {
        const schema = schemaMap.get(component.type);
        const defaultProps = schema?.defaultProps as Record<string, unknown> | undefined;
        if (defaultProps) {
          // Exclude id from validation — it's never in defaultProps but we always inject it
          const { id: _ignore, ...propsForValidation } = component.props;
          assertNoNewKeys(defaultProps, propsForValidation, `${component.type}.props`);
        }
        // Overwrite any agent-provided id with a fresh ULID
        const id = generateULID();
        contentComponents.push({ type: component.type, props: { ...component.props, id } });
      }

      const siteId = toolInput.site_id as string;
      const branchId = toolInput.branch_id as string;

      // Step 1: Create the document (CRDT layer starts empty regardless of initial snapshot)
      const createResult = await cssApi.createDocument(siteId, branchId, documentPath, {
        content: [], root: { props: toolInput.root_props ?? {} }, zones: {},
      });

      if (contentComponents.length === 0) {
        return createResult;
      }

      // Step 2: Apply components via edit session so the CRDT layer picks them up
      const editCheck = await cssApi.canAgentEdit({
        siteId, branchId, documentPath,
        intent: 'Populating new page with initial components',
        targetRegions: ['content'],
        trigger: 'human_requested',
        requestedById: userId,
      });
      if (!editCheck.canEdit) {
        return { ...createResult, warning: `Page created but could not populate components: ${editCheck.reason ?? 'edit not allowed'}` };
      }

      const editSession = await cssApi.startAgentEdit({
        siteId, branchId, documentPath,
        intent: 'Populating new page with initial components',
        targetRegions: ['content'],
        trigger: 'human_requested',
        requestedById: userId,
      });

      let editsApplied = false;
      try {
        // Add all components via a single replace on content — injectPuckIds handles IDs
        await cssApi.applyEdits({
          siteId, branchId, documentPath,
          editSessionId: editSession.editSessionId,
          operations: [{
            type: 'replace',
            path: 'content',
            content: contentComponents,
          }],
        });

        // Set root props if provided
        if (toolInput.root_props && Object.keys(toolInput.root_props as object).length > 0) {
          await cssApi.applyEdits({
            siteId, branchId, documentPath,
            editSessionId: editSession.editSessionId,
            operations: [{
              type: 'replace',
              path: 'root.props',
              content: toolInput.root_props,
            }],
          });
        }

        editsApplied = true;
        await cssApi.completeAgentEdit({ siteId, branchId, documentPath, editSessionId: editSession.editSessionId });
      } catch (err) {
        // Only abort if edits haven't been applied yet — aborting after a successful
        // applyEdits could roll back components already written to the CRDT.
        if (!editsApplied) {
          await cssApi.abortAgentEdit({ siteId, branchId, documentPath, editSessionId: editSession.editSessionId, reason: String(err) }).catch(() => undefined);
        }
        throw err;
      }

      return {
        ...createResult,
        components: contentComponents.map(c => ({ type: c.type, id: c.props.id })),
      };
    }

    case 'list_media': {
      if (!webConfig) throw new Error('list_media is not available in this context');
      const { mediaWorkerUrl, token } = webConfig;
      const siteId = toolInput.site_id as string;
      const search = toolInput.search as string | undefined;
      const url = new URL(`${mediaWorkerUrl}/media`);
      url.searchParams.set('siteId', siteId);
      if (search) url.searchParams.set('search', search);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Media worker returned ${res.status}: ${await res.text()}`);
      }
      return res.json() as Promise<Array<{ key: string; url: string; filename: string; size: number; lastModified: string }>>;
    }

    case 'fetch_page': {
      const rawUrl = toolInput.url as string;
      const safeUrl = validatePublicUrl(rawUrl);

      const response = await fetch(safeUrl.toString());
      if (!response.ok) {
        throw new Error(`fetch_page: ${safeUrl} returned HTTP ${response.status}`);
      }

      const MAX_CHARS = 5000;
      const chunks: string[] = [];
      let charCount = 0;

      function addChunk(label: string, value: string): void {
        if (charCount >= MAX_CHARS) return;
        const piece = `${label}: ${value}\n`;
        const remaining = MAX_CHARS - charCount;
        chunks.push(piece.slice(0, remaining));
        charCount += piece.length;
      }

      // Accumulators for text nodes that span multiple chunks
      let titleBuf = '';
      let headingBuf = '';
      let paragraphBuf = '';
      let headingTag = '';

      const rewriter = new HTMLRewriter()
        .on('title', {
          text(chunk) {
            titleBuf += chunk.text;
            if (chunk.lastInTextNode) {
              if (titleBuf.trim()) addChunk('Title', titleBuf.trim());
              titleBuf = '';
            }
          },
        })
        .on('meta[name="description"]', {
          element(el) {
            const content = el.getAttribute('content');
            if (content && content.trim()) addChunk('Description', content.trim());
          },
        })
        .on('h1,h2,h3,h4,h5,h6', {
          element(el) {
            headingTag = el.tagName.toUpperCase();
            headingBuf = '';
          },
          text(chunk) {
            headingBuf += chunk.text;
            if (chunk.lastInTextNode) {
              if (headingBuf.trim()) addChunk(headingTag, headingBuf.trim());
              headingBuf = '';
            }
          },
        })
        .on('p', {
          element() {
            paragraphBuf = '';
          },
          text(chunk) {
            paragraphBuf += chunk.text;
            if (chunk.lastInTextNode) {
              if (paragraphBuf.trim()) addChunk('P', paragraphBuf.trim());
              paragraphBuf = '';
            }
          },
        })
        .on('img', {
          element(el) {
            const src = el.getAttribute('src');
            const alt = el.getAttribute('alt');
            if (src) {
              const desc = alt ? `${src} (alt: ${alt})` : src;
              addChunk('IMG', desc);
            }
          },
        });

      const transformed = rewriter.transform(response);
      await transformed.text(); // consume the full stream

      return chunks.join('');
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
