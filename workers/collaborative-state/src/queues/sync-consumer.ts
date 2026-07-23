/**
 * Phase 5.1: Queue Consumer for DO-to-PostgreSQL Sync
 *
 * Receives batches of SyncQueueMessage from Cloudflare Queues,
 * deduplicates by siteId:documentId:branchId (keeping latest timestamp),
 * and persists via batchSyncToPostgres() using a single Hyperdrive connection.
 *
 * Failures are logged; Cloudflare's automatic retry + dead-letter queue
 * handles retries.
 */

import type { SyncQueueMessage } from '../types/queue-messages';
import { runWithConnection } from '../db';
import { batchSyncToPostgres } from '../services/document-version-service';
import type { BatchSyncPayload } from '../services/document-version-service';

/**
 * Environment bindings available to the queue consumer.
 */
interface QueueConsumerEnv {
  HYPERDRIVE?: Hyperdrive;
  POSTGRES_CONNECTION_STRING?: string;
}

/**
 * Handle a batch of sync messages from the Cloudflare Queue.
 *
 * @param batch - MessageBatch of SyncQueueMessage
 * @param env - Worker environment bindings
 */
export async function handleSyncQueue(
  batch: MessageBatch<SyncQueueMessage>,
  env: QueueConsumerEnv,
): Promise<void> {
  // Handle empty batch
  if (batch.messages.length === 0) {
    batch.ackAll();
    return;
  }

  // Determine connection string
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_CONNECTION_STRING;
  const isHyperdrive = env.HYPERDRIVE?.connectionString !== undefined;

  if (connectionString === undefined) {
    console.error('Sync queue: no database connection string available');
    batch.retryAll();
    return;
  }

  try {
    // Deduplicate messages by siteId:documentId:branchId, keeping latest timestamp
    const deduplicated = deduplicateMessages(batch.messages);

    // Convert to batch sync payloads
    const payloads: BatchSyncPayload[] = deduplicated.map((msg) => ({
      documentId: msg.documentId,
      branchId: msg.branchId,
      snapshot: msg.snapshot,
      actorId: msg.actorId,
      actorType: msg.actorType,
      actorEmail: msg.actorEmail,
      actorName: msg.actorName,
      actionType: msg.actionType,
      actionMetadata: msg.actionMetadata,
      puckActions: msg.puckActions,
    }));

    // Open single connection per batch and persist
    await runWithConnection(connectionString, { isHyperdrive }, async () => {
      const result = await batchSyncToPostgres(payloads);
      console.log(
        `Sync queue: processed ${String(batch.messages.length)} messages,`
        + ` ${String(payloads.length)} unique,`
        + ` ${String(result.inserted.length)} inserted,`
        + ` ${String(result.skippedCount)} skipped`,
      );
    });

    batch.ackAll();
  } catch (error) {
    console.error('Sync queue: batch processing failed, will retry:', error);
    batch.retryAll();
  }
}

/**
 * Deduplicate sync messages by siteId:documentId:branchId key,
 * keeping the message with the latest timestamp for each key.
 */
function deduplicateMessages(
  messages: readonly Message<SyncQueueMessage>[],
): SyncQueueMessage[] {
  const latest = new Map<string, SyncQueueMessage>();

  for (const msg of messages) {
    const key = `${msg.body.siteId}:${msg.body.documentId}:${msg.body.branchId}`;
    const existing = latest.get(key);

    if (existing === undefined || msg.body.timestamp > existing.timestamp) {
      // Merge puckActions from the earlier message so structural actions aren't lost
      const mergedPuckActions = existing?.puckActions && msg.body.puckActions
        ? [...existing.puckActions, ...msg.body.puckActions]
        : msg.body.puckActions ?? existing?.puckActions;

      const merged: SyncQueueMessage = { ...msg.body };
      if (mergedPuckActions && mergedPuckActions.length > 0) {
        merged.puckActions = mergedPuckActions;
      }
      // Preserve structural actionType if an earlier message was structural
      if (existing?.actionType === 'structural' && merged.actionType !== 'structural') {
        merged.actionType = 'structural';
      }
      latest.set(key, merged);
    } else if (existing !== undefined) {
      // Earlier message wins on snapshot, but merge its puckActions into the kept message
      if (msg.body.puckActions && msg.body.puckActions.length > 0) {
        existing.puckActions = [
          ...msg.body.puckActions,
          ...(existing.puckActions ?? []),
        ];
      }
      if (msg.body.actionType === 'structural' && existing.actionType !== 'structural') {
        existing.actionType = 'structural';
      }
    }
  }

  return [...latest.values()];
}
