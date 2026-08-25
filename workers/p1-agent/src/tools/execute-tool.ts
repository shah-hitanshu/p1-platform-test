import { validateOps, validateDocumentStructure } from '@pantheon-systems/p1-content-validator';
import type { ComponentSchema } from '@pantheon-systems/p1-content-validator';
import type { McpApiClient } from '../ccr/api-client.js';
import type { TemplateSummaryInfo } from '../ccr/types.js';
import type { ChatContext } from '../types.js';
import {
  assertDocumentWritable,
  assertInScope,
  assertWritable,
  normalizeDocumentPath,
} from '../conversation/scope.js';
import { TEMPLATE_FILL_CONTRACT } from '../prompt/system-prompt.js';
import { templatePagePath } from './template-path.js';

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

function isRegistryPath(path: string): boolean {
  return path.replace(/^\//, '').startsWith('_registry/');
}

/**
 * The template a page is to be built from, resolved against the live list so an id the model
 * invented fails naming the tool that has the real ones instead of as a 404 from the create call.
 */
async function resolvePageTemplate(
  ccrApi: McpApiClient,
  siteId: string,
  branchId: string,
  templateId: string,
): Promise<TemplateSummaryInfo> {
  const { templates } = await ccrApi.listTemplates(siteId, branchId);
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
  return template;
}

/**
 * Create a page from a template and report what landed on it.
 *
 * The template supplies the components, so none of `create_page`'s own component handling runs:
 * no registry validation (the template's components are already valid) and no edit session (the
 * backend wrote them into version 1).
 */
async function createPageFromTemplate(
  ccrApi: McpApiClient,
  { siteId, branchId, documentPath, template, title, movedFrom }: {
    siteId: string;
    branchId: string;
    documentPath: string;
    template: TemplateSummaryInfo;
    title?: string;
    /** The path asked for, when the template's route shape put the page somewhere else. */
    movedFrom?: string;
  },
): Promise<unknown> {
  const createResult = await ccrApi.createDocumentFromTemplate(
    siteId, branchId, documentPath, template.id, title,
  );

  let components: { type: string; id: string }[] = [];
  try {
    const version = await ccrApi.getDocumentLatestVersion(siteId, branchId, createResult.documentId);
    components = scaffoldedComponents(version.snapshot);
  } catch (err) {
    // The page was created either way, and the agent can still read it with get_document.
    console.warn('create_page: could not read back the scaffolded components —', err);
  }

  return {
    ...createResult,
    template: { id: template.id, label: template.label ?? template.name },
    components,
    note: [
      // Otherwise the reply names the path the model asked for, which is not where the page is.
      ...(movedFrom === undefined ? [] : [
        `The page is at ${createResult.documentPath}, not ${movedFrom}: that is where this`,
        "template's pages live. Use this path when you tell the user about the page.",
      ]),
      // This turn's context note was built before the page existed, so the contract it carries
      // for template-bound pages is repeated here.
      ...TEMPLATE_FILL_CONTRACT,
    ].join(' '),
  };
}

// Re-exported for existing importers; definitions.ts stays free of runtime deps so the Node
// smoke test can import it.
export { CCR_TOOLS, WEB_TOOLS, toOpenAiTools, type RawTool } from './definitions.js';

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

  // 169.254 is the cloud metadata address, which is what an SSRF attempt usually reaches for.
  const privatePatterns = [
    /^0\./,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,
  ];
  if (privatePatterns.some(p => p.test(host))) {
    throw new Error(`Fetching private IP addresses is not allowed`);
  }

  // IPv6 literals reach `hostname` bracketed. fc00::/7 is unique-local, fe80::/10 link-local.
  if (/^\[(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(host)) {
    throw new Error(`Fetching private IP addresses is not allowed`);
  }

  return url;
}

/** Ceiling on one outbound web or media call, matching the CCR client's. */
const OUTBOUND_TIMEOUT_MS = 30_000;

/** Hops `fetch_page` will follow. A chain longer than this is a loop or a tracker. */
const MAX_REDIRECTS = 5;

/**
 * Fetch a public page, re-running the guard on every hop.
 *
 * Redirects are followed by hand because `validatePublicUrl` vets the URL it is given and says
 * nothing about where that URL points: under the default `redirect: 'follow'`, any public host
 * can bounce this straight to a private address with a single 302.
 */
async function fetchPublicPage(rawUrl: string): Promise<{ response: Response; url: URL }> {
  let url = validatePublicUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const response = await fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    });

    const location = response.status >= 300 && response.status < 400
      ? response.headers.get('location')
      : null;
    if (location === null) return { response, url };

    if (hop >= MAX_REDIRECTS) {
      throw new Error(`fetch_page: ${rawUrl} redirected more than ${MAX_REDIRECTS} times`);
    }
    url = validatePublicUrl(new URL(location, url).toString());
  }
}

// Execute a tool call from Claude against the CCR backend or web tools
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ccrApi: McpApiClient,
  userId: string,
  context: ChatContext,
  webConfig?: { token: string; mediaWorkerUrl: string },
): Promise<unknown> {
  const name = toolName as ToolName;
  assertInScope(toolInput, context);
  assertWritable(name, toolInput, context);

  switch (name) {
    case 'list_documents': {
      const { documents } = await ccrApi.listDocuments(
        toolInput.site_id as string,
        toolInput.branch_id as string,
      );
      // `_registry/` holds component and template definitions: documents, but not pages to edit.
      // Projected to paths because the backend applies no default limit and the full rows are
      // re-sent to the model on every iteration of the turn, then persisted.
      return {
        documents: documents
          .map(doc => normalizeDocumentPath(doc.path))
          .filter(path => !path.startsWith('_registry/')),
      };
    }

    case 'list_components': {
      const result = await ccrApi.listComponents(toolInput.site_id as string, toolInput.branch_id as string);
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
      const { snapshot } = await ccrApi.getDocument(siteId, branchId, documentPath);
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
      return ccrApi.canAgentEdit({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        intent: toolInput.intent as string,
        targetRegions: toolInput.target_regions as string[],
        trigger: 'human_requested',
        requestedById: userId,
      });

    case 'start_edit_session':
      return ccrApi.startAgentEdit({
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
            const doc = await ccrApi.getDocument(siteId, branchId, documentPath);
            snapshot = doc.snapshot;
          })(),
          (async () => {
            const result = await ccrApi.listComponents(siteId, branchId);
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

      // Translate agent vocabulary to the CCR backend's operation set.
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

      const applyResult = await ccrApi.applyEdits({
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
      // automatic — this matches every consumer in the ecosystem (CCR
      // mcp-server apply_document_edits). The edit session rolls back only when
      // the caller aborts, so the applied-but-invalid edits persist until then.
      let structuralError: string | undefined;
      try {
        const docInfo = await ccrApi.lookupDocumentByPath(siteId, documentPath);
        const templateId = docInfo?.templateId;
        if (templateId) {
          const [updatedDoc, template] = await Promise.all([
            ccrApi.getDocument(siteId, branchId, documentPath),
            ccrApi.getTemplate(siteId, branchId, templateId),
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
      return ccrApi.completeAgentEdit({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        editSessionId: toolInput.edit_session_id as string,
      });

    case 'abort_edit_session':
      return ccrApi.abortAgentEdit({
        siteId: toolInput.site_id as string,
        branchId: toolInput.branch_id as string,
        documentPath: toolInput.document_path as string,
        editSessionId: toolInput.edit_session_id as string,
        reason: toolInput.reason as string | undefined,
      });

    case 'get_branch_presence':
      return ccrApi.getBranchPresence(toolInput.site_id as string, toolInput.branch_id as string);

    case 'get_document_presence':
      return ccrApi.getDocumentPresence(
        toolInput.site_id as string,
        toolInput.branch_id as string,
        toolInput.document_path as string,
      );

    case 'list_page_templates': {
      const { templates } = await ccrApi.listTemplates(
        toolInput.site_id as string,
        toolInput.branch_id as string,
      );
      // Deprecated templates are excluded here rather than left for the model to avoid: the
      // create route rejects them anyway, and offering one leads to a refused page.
      return templates.filter(t => t.deprecated !== true).map(describeTemplate);
    }

    case 'create_page': {
      const requestedPath = toolInput.document_path as string;
      const templateId = toolInput.template_id;
      const template = typeof templateId === 'string' && templateId !== ''
        ? await resolvePageTemplate(
          ccrApi, toolInput.site_id as string, toolInput.branch_id as string, templateId,
        )
        : null;

      // Resolved before the guards below, which must see the path the page is created at: a
      // template's route shape decides that, not the path the model asked for.
      const documentPath = template
        ? templatePagePath(template.defaultUrlPattern, requestedPath, template.label ?? template.name)
        : requestedPath;

      // Both: the resolved path is where the page lands, and a request aimed here is refused
      // rather than quietly relocated by the shape.
      if (isRegistryPath(requestedPath) || isRegistryPath(documentPath)) {
        throw new Error('Cannot create pages at the _registry/ path prefix — this is reserved for system use.');
      }

      // Creating at a taken path is not adding a page: on a branch the backend gives a page
      // inherited from main a branch-local version 1, and wipes a tombstoned page's branch history
      // to recreate it. Both change what the route serves, so both need an edit's grant.
      if (await ccrApi.lookupDocumentByPath(toolInput.site_id as string, documentPath) !== null) {
        assertDocumentWritable(documentPath, context);
      }

      const components = (toolInput.components ?? []) as {
        type: string;
        props: Record<string, unknown>;
        zone?: string;
        parentId?: string;
      }[];

      if (template) {
        if (components.length > 0) {
          throw new Error(
            'A page built from a template takes its components from the template. Call create_page ' +
            'with template_id and no components, then fill the scaffolded components in.',
          );
        }
        const rootProps = (toolInput.root_props ?? {}) as Record<string, unknown>;
        return createPageFromTemplate(ccrApi, {
          siteId: toolInput.site_id as string,
          branchId: toolInput.branch_id as string,
          documentPath,
          template,
          title: typeof rootProps.title === 'string' ? rootProps.title : undefined,
          ...(documentPath === requestedPath ? {} : { movedFrom: requestedPath }),
        });
      }

      // Build components with fresh ULIDs then validate against the registry.
      // ULIDs are injected before validation so id format checks pass.
      interface PuckComponent { type: string; props: Record<string, unknown> & { id: string } }
      const contentComponents: PuckComponent[] = components.map(c => ({
        type: c.type,
        props: { ...c.props, id: generateULID() }, // fresh ULID overwrites any agent-provided id
      }));

      const registryComponents = await ccrApi.listComponents(
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
      const createResult = await ccrApi.createDocument(siteId, branchId, documentPath, {
        content: [], root: { props: toolInput.root_props ?? {} }, zones: {},
      });

      if (contentComponents.length === 0) {
        return createResult;
      }

      // Step 2: Apply components via edit session so the CRDT layer picks them up
      const editCheck = await ccrApi.canAgentEdit({
        siteId, branchId, documentPath,
        intent: 'Populating new page with initial components',
        targetRegions: ['content'],
        trigger: 'human_requested',
        requestedById: userId,
      });
      if (!editCheck.canEdit) {
        return { ...createResult, warning: `Page created but could not populate components: ${editCheck.reason ?? 'edit not allowed'}` };
      }

      const editSession = await ccrApi.startAgentEdit({
        siteId, branchId, documentPath,
        intent: 'Populating new page with initial components',
        targetRegions: ['content'],
        trigger: 'human_requested',
        requestedById: userId,
      });

      let editsApplied = false;
      try {
        // Add all components via a single replace on content — injectPuckIds handles IDs
        await ccrApi.applyEdits({
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
          await ccrApi.applyEdits({
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
        await ccrApi.completeAgentEdit({ siteId, branchId, documentPath, editSessionId: editSession.editSessionId });
      } catch (err) {
        // Only abort if edits haven't been applied yet — aborting after a successful
        // applyEdits could roll back components already written to the CRDT.
        if (!editsApplied) {
          await ccrApi.abortAgentEdit({ siteId, branchId, documentPath, editSessionId: editSession.editSessionId, reason: String(err) }).catch(() => undefined);
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
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`Media worker returned ${res.status}: ${await res.text()}`);
      }
      return res.json() as Promise<{ key: string; url: string; filename: string; size: number; lastModified: string }[]>;
    }

    case 'fetch_page': {
      const { response, url: fetchedUrl } = await fetchPublicPage(toolInput.url as string);
      if (!response.ok) {
        throw new Error(`fetch_page: ${fetchedUrl.toString()} returned HTTP ${response.status}`);
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
