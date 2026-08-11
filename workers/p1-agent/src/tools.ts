import { validateOps, validateDocumentStructure } from '@pantheon-systems/p1-content-validator';
import type { ComponentSchema } from '@pantheon-systems/p1-content-validator';
import type { McpApiClient, TemplateSummaryInfo } from './css-api.js';
import { TEMPLATE_FILL_CONTRACT } from './prompt.js';

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

// The home page's canonical document path is the literal string "/" — every
// other document is stored without a leading slash. Stripping the slash
// unconditionally turns "/" into "", which matches no document.
function normalizeDocumentPath(path: string): string {
  if (path === '/') return path;
  return path.startsWith('/') ? path.slice(1) : path;
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

function buildRegistry(components: unknown[]): Record<string, ComponentSchema> {
  const registry: Record<string, ComponentSchema> = {};
  for (const comp of components as Record<string, unknown>[]) {
    if (typeof comp.name === 'string') {
      registry[comp.name] = {
        name: comp.name,
        defaultProps: (comp.defaultProps as Record<string, unknown> | undefined) ?? {},
        fields: Array.isArray(comp.fields) ? (comp.fields as ComponentSchema['fields']) : undefined,
      };
    }
  }
  return registry;
}

/** A template as `list_page_templates` returns it: enough to choose between them, no layout. */
function describeTemplate(template: TemplateSummaryInfo): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    ...(template.label ? { label: template.label } : {}),
    ...(template.description ? { description: template.description } : {}),
    ...(template.defaultUrlPattern ? { defaultUrlPattern: template.defaultUrlPattern } : {}),
  };
}

/**
 * The components a template scaffolded — the ones the agent fills in by editing their props.
 *
 * Tolerates a snapshot-less version: `/versions/latest` returns diff-only versions with a null
 * snapshot and does not reconstruct them. Version 1 of a fresh page is never one, but the agent's
 * type says non-null where the API does not.
 */
function scaffoldedComponents(
  snapshot: Record<string, unknown> | null | undefined,
): { type: string; id: string }[] {
  const content = snapshot?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap(item => {
    if (typeof item !== 'object' || item === null) return [];
    const { type, props } = item as { type?: unknown; props?: { id?: unknown } };
    if (typeof type !== 'string' || typeof props?.id !== 'string') return [];
    return [{ type, id: props.id }];
  });
}

/**
 * Create a page from a template and report what landed on it.
 *
 * The template supplies the components, so none of `create_page`'s own component handling runs:
 * no registry validation (the template's components are already valid) and no edit session (the
 * backend wrote them into version 1).
 */
async function createPageFromTemplate(
  cssApi: McpApiClient,
  { siteId, branchId, documentPath, templateId, title }: {
    siteId: string;
    branchId: string;
    documentPath: string;
    templateId: string;
    title?: string;
  },
): Promise<unknown> {
  // Resolved against the live list first, so an id the model invented fails naming the tool that
  // has the real ones instead of as a 404 from the create call.
  const { templates } = await cssApi.listTemplates(siteId, branchId);
  const template = templates.find(t => t.id === templateId);
  if (!template) {
    throw new Error(
      `No page template with id "${templateId}". Call list_page_templates and copy an id from it.`,
    );
  }
  if (template.deprecated === true) {
    throw new Error(
      `The "${template.label ?? template.name}" template is deprecated, so it cannot start a new page.`,
    );
  }

  const createResult = await cssApi.createDocumentFromTemplate(
    siteId, branchId, documentPath, templateId, title,
  );

  let components: { type: string; id: string }[] = [];
  try {
    const version = await cssApi.getDocumentLatestVersion(siteId, branchId, createResult.documentId);
    components = scaffoldedComponents(version.snapshot);
  } catch (err) {
    // The page was created either way, and the agent can still read it with get_document.
    console.warn('create_page: could not read back the scaffolded components —', err);
  }

  return {
    ...createResult,
    template: { id: template.id, label: template.label ?? template.name },
    components,
    // This turn's context note was built before the page existed, so the contract it carries for
    // template-bound pages is repeated here.
    note: TEMPLATE_FILL_CONTRACT.join(' '),
  };
}

// Provider-neutral tool specs live in tool-defs.ts (no runtime deps, so Node tooling
// like the smoke test can import them). Re-exported here for existing importers.
export { CSS_TOOLS, WEB_TOOLS, toOpenAiTools, type RawTool } from './tool-defs.js';

// Tool names are validated at runtime in executeTool's switch (with a default).
type ToolName = string;

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
      return (result.components as Record<string, unknown>[]).map(c => ({
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
      const documentPath = normalizeDocumentPath(toolInput.document_path as string);
      // Live session state, not `/versions/latest`: version rows come from a debounced
      // sync that a bare deletion never triggers, so they can still show a removed component.
      const { snapshot } = await cssApi.getDocument(siteId, branchId, documentPath);
      // An unloaded session returns `{}` with a 200 — not the same as an empty page.
      if (!snapshot || !('content' in snapshot)) {
        throw new Error(
          `Document "${documentPath}" returned no content — its session may have failed to ` +
          `load. Do not treat this as an empty page.`,
        );
      }
      return { documentPath, snapshot };
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

      const siteId = toolInput.site_id as string;
      const branchId = toolInput.branch_id as string;
      const rawDocPath = toolInput.document_path as string;
      const documentPath = normalizeDocumentPath(rawDocPath);

      // Fetch snapshot and registry in parallel for validation.
      // Both failures are handled gracefully — the library validates what it can.
      const hasContentOp = operations.some(op => op.type === 'add' || op.type === 'replace');
      let snapshot: Record<string, unknown> | undefined;
      let registry: Record<string, ComponentSchema> = {};

      if (hasContentOp) {
        const prefetch = await Promise.allSettled([
          (async () => {
            const doc = await cssApi.getDocument(siteId, branchId, documentPath);
            snapshot = doc.snapshot;
          })(),
          (async () => {
            const result = await cssApi.listComponents(siteId, branchId);
            registry = buildRegistry(result.components as unknown[]);
          })(),
        ]);
        // Log prefetch failures so a backend auth/config issue silently
        // disabling validation is noticeable in `wrangler tail`.
        for (const r of prefetch) {
          if (r.status === 'rejected') {
            console.warn('apply_document_edits: validation prefetch failed —', r.reason);
          }
        }

        const { errors } = validateOps({ operations, registry, currentSnapshot: snapshot });
        if (errors.length > 0) {
          throw new Error(errors.map(e => e.message).join('\n'));
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

      const applyResult = await cssApi.applyEdits({
        siteId,
        branchId,
        documentPath,
        editSessionId: toolInput.edit_session_id as string,
        operations: backendOps,
      });

      // Structure validation (post-apply): if the document conforms to a page
      // template, verify the edits didn't break its pinned-component skeleton.
      // Runs after applying because there's no local JSON-Patch simulation.
      //
      // On failure we surface the error and instruct the agent to call
      // abort_edit_session. Rollback is intentionally agent-driven, not
      // automatic — this matches every consumer in the ecosystem (CSS
      // mcp-server apply_document_edits). The edit session rolls back only when
      // the caller aborts, so the applied-but-invalid edits persist until then.
      let structuralError: string | undefined;
      try {
        const docInfo = await cssApi.lookupDocumentByPath(siteId, documentPath);
        const templateId = docInfo?.templateId;
        if (templateId) {
          const [updatedDoc, template] = await Promise.all([
            cssApi.getDocument(siteId, branchId, documentPath),
            cssApi.getTemplate(siteId, branchId, templateId),
          ]);
          const { errors } = validateDocumentStructure({
            documentSnapshot: updatedDoc.snapshot,
            templateSnapshot: template,
          });
          if (errors.length > 0) {
            structuralError = errors.map(e => e.message).join('\n');
          }
        }
      } catch (err) {
        // Template lookup/fetch failed — skip structure validation (graceful
        // degradation; the backend still enforces its own rules). Log so a
        // backend auth/config issue silently disabling enforcement is noticeable.
        console.warn('apply_document_edits: structure validation skipped —', err);
      }

      if (structuralError !== undefined) {
        throw new Error(
          `${structuralError}\n\nThe edits were applied but violate the page template ` +
          `structure. Call abort_edit_session to roll back these changes.`,
        );
      }

      return applyResult;
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

    case 'list_page_templates': {
      const { templates } = await cssApi.listTemplates(
        toolInput.site_id as string,
        toolInput.branch_id as string,
      );
      // Deprecated templates are excluded here rather than left for the model to avoid: the
      // create route rejects them anyway, and offering one leads to a refused page.
      return templates.filter(t => t.deprecated !== true).map(describeTemplate);
    }

    case 'create_page': {
      const documentPath = toolInput.document_path as string;

      if (documentPath.replace(/^\//, '').startsWith('_registry/')) {
        throw new Error('Cannot create pages at the _registry/ path prefix — this is reserved for system use.');
      }

      const components = (toolInput.components ?? []) as {
        type: string;
        props: Record<string, unknown>;
        zone?: string;
        parentId?: string;
      }[];

      const templateId = toolInput.template_id;
      if (typeof templateId === 'string' && templateId !== '') {
        if (components.length > 0) {
          throw new Error(
            'A page built from a template takes its components from the template. Call create_page ' +
            'with template_id and no components, then fill the scaffolded components in.',
          );
        }
        const rootProps = (toolInput.root_props ?? {}) as Record<string, unknown>;
        return createPageFromTemplate(cssApi, {
          siteId: toolInput.site_id as string,
          branchId: toolInput.branch_id as string,
          documentPath,
          templateId,
          title: typeof rootProps.title === 'string' ? rootProps.title : undefined,
        });
      }

      // Build components with fresh ULIDs then validate against the registry.
      // ULIDs are injected before validation so id format checks pass.
      interface PuckComponent { type: string; props: Record<string, unknown> & { id: string } }
      const contentComponents: PuckComponent[] = components.map(c => ({
        type: c.type,
        props: { ...c.props, id: generateULID() }, // fresh ULID overwrites any agent-provided id
      }));

      const registryComponents = await cssApi.listComponents(
        toolInput.site_id as string,
        toolInput.branch_id as string,
      );
      const registry = buildRegistry(registryComponents.components as unknown[]);

      if (contentComponents.length > 0) {
        const syntheticOps = contentComponents.map((c, i) => ({
          type: 'add' as const,
          path: `content.${String(i)}`,
          content: c,
        }));
        const { errors } = validateOps({ operations: syntheticOps, registry });
        if (errors.length > 0) {
          throw new Error(errors.map(e => e.message).join('\n'));
        }
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
      return res.json() as Promise<{ key: string; url: string; filename: string; size: number; lastModified: string }[]>;
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
