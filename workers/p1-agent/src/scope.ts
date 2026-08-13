import type { CreateDocumentResult } from './css-api.js';
import type { ChatContext } from './types.js';

/**
 * Canonical document path, mirroring the CSS backend's `normalizePath`
 * (`services/document-types.ts`). It has to agree with the backend exactly, or a write to a page
 * the user did grant is refused: the backend resolves `About`, `about/` and `//about` all to the
 * granted `about`. Diverges only on the empty path, which the backend maps to the home page `/`
 * and this treats as "no document open".
 */
export function normalizeDocumentPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '/') return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment !== '')
    .join('/');
}

const WRITE_TOOLS = new Set<string>([
  'check_edit_permission',
  'start_edit_session',
  'apply_document_edits',
  'complete_edit_session',
  'abort_edit_session',
  'create_page',
]);

/**
 * Creating at an unused path adds a document rather than changing one, so the set does not apply.
 * At a path already taken it is a change, which `tools.ts` checks the set for.
 */
const CREATE_TOOL = 'create_page';

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

export function isWriteSetScoped(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName) && toolName !== CREATE_TOOL;
}

/** Read from the result, not the model's request: the backend normalizes on the way in. */
export function createdDocumentPath(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const { documentPath } = result as Partial<CreateDocumentResult>;
  return typeof documentPath === 'string' && documentPath.trim() !== '' ? documentPath : null;
}

/**
 * Grant the page `create_page` just made, for the rest of the turn — the agent fills a new page in
 * immediately, and the client cannot add it to the set until the next turn.
 */
export function withCreatedPage(context: ChatContext, path: string): ChatContext {
  const created = normalizeDocumentPath(path);
  if (created === '') return context;
  return { ...context, writeSet: [...writableDocuments(context), created] };
}

export function writableDocuments(context: ChatContext): string[] {
  // No `writeSet` is a client older than this Worker: hold it to its open document rather than
  // leave it unrestricted. The frame is cast rather than validated on the way in, so a malformed
  // set has to fail closed here too rather than throw further down and take the turn with it.
  const declared = Array.isArray(context.writeSet) ? context.writeSet : [context.documentPath];
  const normalized = declared
    .filter((path): path is string => typeof path === 'string')
    .map(normalizeDocumentPath)
    .filter(path => path !== '');
  return [...new Set(normalized)];
}

export function assertWritable(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ChatContext,
): void {
  if (!isWriteTool(toolName)) return;

  if (toolInput.site_id !== context.siteId) {
    throw new Error(
      `Not your site. This conversation works in site ${context.siteId}; use that site_id.`,
    );
  }

  // The write set holds bare paths, so a stale `branch_id` — which restored history still carries
  // after a branch switch — would land an allowed path on another branch's copy of it.
  if (toolInput.branch_id !== context.branchId) {
    throw new Error(
      `Not your branch. This conversation works in branch ${context.branchId}; use that branch_id.`,
    );
  }

  if (!isWriteSetScoped(toolName)) return;

  assertDocumentWritable(
    typeof toolInput.document_path === 'string' ? toolInput.document_path : '',
    context,
  );
}

/** Also shown in the transcript, where the panel truncates the note past 200 characters. */
export function assertDocumentWritable(rawPath: string, context: ChatContext): void {
  const path = normalizeDocumentPath(rawPath);
  const writable = writableDocuments(context);
  if (!writable.includes(path)) {
    throw new Error(
      `"${path}" is not in your write set. `
      + `You may edit: ${writable.length > 0 ? writable.join(', ') : 'nothing on this site'}. `
      + 'Ask the user to add the page with "+ Add page" in the panel header; do not retry.',
    );
  }
}
