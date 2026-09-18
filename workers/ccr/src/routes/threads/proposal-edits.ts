/**
 * Putting an accepted proposal's edits into the page.
 *
 * A proposal speaks in dot paths (`content.2.props.title`); the document session
 * speaks in typed operations on a parent path. Translation happens here, then the
 * edits reach the page the same way a person's do: through the document session as
 * the person who accepted, so every open editor sees them arrive and the change is
 * attributed to the decider.
 */

import { assertPermission } from '../../auth/authorization';
import { getDocument } from '../../services/document-service';
import { loadCanonicalComponentNames } from '../../services/component-type-registry';
import { findComponentTypeViolations } from '../../services/component-type-validation';
import { ThreadInputError } from '../../services/threads/errors';
import type { AuthenticatedPrincipal, EditOperation } from '../../types';
import { isAgentProposal, type Comment, type ProposedOperation, type ThreadOverview } from '../../types/threads';
import { generateSessionId } from '../realtime-utils';
import type { ThreadsRouteContext } from './types';

const INDEX = /^\d+$/;

function split(path: string): { parent: string; last: string } {
  const parts = path.split('.');
  const last = parts.pop() ?? '';
  return { parent: parts.join('.'), last };
}

/**
 * The document session's form of a proposal's operations.
 *
 * `add` at a list position inserts there; anywhere else it sets a field. `move`
 * must stay within one list, since the session moves by index.
 */
export function toEditOperations(operations: readonly ProposedOperation[]): EditOperation[] {
  return operations.map((op): EditOperation => {
    switch (op.op) {
      case 'replace':
        return { type: 'replace', path: op.path, content: op.value };
      case 'remove':
        return { type: 'delete', path: op.path };
      case 'add': {
        const { parent, last } = split(op.path);
        if (parent !== '' && INDEX.test(last)) {
          return { type: 'insert', path: parent, index: Number(last), value: op.value };
        }
        return { type: 'set', path: op.path, value: op.value };
      }
      case 'move': {
        if (op.from === undefined) {
          throw new ThreadInputError('operations', `A move to ${op.path} names nothing to move`);
        }
        const from = split(op.from);
        const to = split(op.path);
        if (from.parent !== to.parent || from.parent === '' || !INDEX.test(from.last) || !INDEX.test(to.last)) {
          throw new ThreadInputError('operations', `A move must stay within one list: ${op.from} to ${op.path}`);
        }
        return { type: 'move', path: to.parent, fromIndex: Number(from.last), toIndex: Number(to.last) };
      }
    }
  });
}

async function rejectUnknownComponentTypes(operations: EditOperation[], branchId: string): Promise<void> {
  let canonical;
  try {
    canonical = await loadCanonicalComponentNames(branchId);
  } catch {
    return; // the registry is an index, not the source of truth; see realtime-api
  }
  const violations = findComponentTypeViolations(operations, canonical);
  if (violations.length > 0) {
    throw new ThreadInputError(
      'operations',
      'The proposal names components this site does not have',
      violations.map((v) => v.message),
    );
  }
}

function verifiedHeaders(sessionId: string, principal: AuthenticatedPrincipal): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('X-Session-Id', sessionId);
  headers.set('X-Verified-Actor-Id', principal.id);
  headers.set('X-Verified-Actor-Type', principal.type);
  if (principal.dbUserId !== undefined) headers.set('X-Verified-Db-User-Id', principal.dbUserId);
  if (principal.authProvider !== undefined) headers.set('X-Verified-Auth-Provider', principal.authProvider);
  if (principal.email !== undefined) headers.set('X-Verified-Email', principal.email);
  if (principal.name !== undefined) headers.set('X-Verified-Name', principal.name);
  return headers;
}

async function refusal(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
      return (body as { error: string }).error;
    }
  } catch {
    // not JSON; the text itself is the reason
  }
  return text;
}

/**
 * Applies a proposal's edits to the page it was made about, as the deciding user.
 *
 * Called with the proposal under the accept's claim, so the edits go in once. A
 * refusal from the page is a 400 on `operations`, so nothing is recorded as
 * accepted that did not land.
 */
export async function applyAcceptedProposal(
  context: ThreadsRouteContext,
  thread: ThreadOverview,
  comment: Pick<Comment, 'kind' | 'metadata'>,
): Promise<void> {
  if (!isAgentProposal(comment)) return;
  if (context.env === undefined) throw new Error('Proposals cannot be applied without the document session binding');
  if (thread.documentId === null || thread.branchId === null) {
    throw new ThreadInputError('decision', 'This proposal is not attached to a page');
  }

  const document = await getDocument(thread.documentId);
  if (document?.siteId !== context.siteId) {
    throw new ThreadInputError('decision', 'The page this proposal is about no longer exists');
  }
  await assertPermission(context.principal, context.siteId, thread.branchId, 'canEditDocuments', context.masClient);

  const operations = toEditOperations(comment.metadata.operations);
  await rejectUnknownComponentTypes(operations, thread.branchId);

  const sessionId = generateSessionId(context.siteId, document.id, thread.branchId);
  const stub = context.env.DOCUMENT_STATE.get(context.env.DOCUMENT_STATE.idFromName(sessionId));
  const response = await stub.fetch(
    new Request('http://internal/apply', {
      method: 'POST',
      headers: verifiedHeaders(sessionId, context.principal),
      body: JSON.stringify({ operations, actorId: context.principal.id }),
    }),
  );
  if (response.ok) return;

  const reason = await refusal(response);
  if (response.status < 500) {
    throw new ThreadInputError('operations', `The page refused the proposed edits: ${reason}`);
  }
  throw new Error(`Applying the proposal failed (${String(response.status)}): ${reason}`);
}
