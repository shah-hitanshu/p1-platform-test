/**
 * Writes a document's collaborative session to Postgres before something reads
 * it from there.
 *
 * A live session holds edits in its CRDT and writes them out on an idle timer,
 * so a reader that goes straight to app.document_versions can see content the
 * session has already superseded. The session-id scheme
 * (`siteId:documentId:branchId`) is load-bearing — it must match how realtime
 * sessions derive their DO name.
 *
 * A failed flush throws, unlike a failed reload: the caller asked to read the
 * session's current content and cannot be handed something older instead.
 */

export class DocumentSessionFlushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentSessionFlushError';
  }
}

export async function flushDocumentSession(
  binding: DurableObjectNamespace,
  siteId: string,
  branchId: string,
  documentId: string,
): Promise<void> {
  const sessionId = `${siteId}:${documentId}:${branchId}`;
  const stub = binding.get(binding.idFromName(sessionId));

  let response: Response;
  try {
    response = await stub.fetch(
      new Request('http://internal/flush', {
        method: 'POST',
        headers: { 'X-Session-Id': sessionId },
      }),
    );
  } catch (error) {
    throw new DocumentSessionFlushError(
      error instanceof Error ? error.message : 'session unreachable',
    );
  }

  if (!response.ok) {
    throw new DocumentSessionFlushError(`session returned ${String(response.status)}`);
  }
}
