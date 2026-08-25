/**
 * DO session reload fan-out.
 *
 * After documents are published on a branch, each live DocumentState session
 * must be told to reload so open editors pick up the new version. The
 * session-id scheme (`siteId:documentId:branchId`) is load-bearing — it must
 * match how realtime sessions derive their DO name. This is the one shared
 * implementation; per-document failures are logged and swallowed so a failed
 * reload never breaks the caller (merge response or workflow step).
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';

export async function reloadDocumentSessions(
  binding: DurableObjectNamespace,
  siteId: string,
  branchId: string,
  documentIds: string[],
  logFields: Record<string, string> = {},
): Promise<void> {
  const logger = getLogger();
  for (const documentId of documentIds) {
    try {
      const sessionId = `${siteId}:${documentId}:${branchId}`;
      const stub = binding.get(binding.idFromName(sessionId));
      await stub.fetch(
        new Request('http://internal/reload', {
          method: 'POST',
          headers: { 'X-Session-Id': sessionId },
        }),
      );
    } catch (error) {
      logger.warn('document session reload failed', {
        ...logFields,
        document_id: documentId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}
