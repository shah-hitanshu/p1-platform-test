/**
 * Phase 5.1: Sync Queue Consumer Tests
 *
 * Tests for the queue consumer that processes batches of sync messages
 * from Durable Objects and persists them to PostgreSQL via batchSyncToPostgres.
 *
 * Key behaviors:
 * - Processes batches of SyncQueueMessage from Cloudflare Queues
 * - Deduplicates by siteId:documentId:branchId (keeps latest timestamp)
 * - Opens single Hyperdrive connection per batch via runWithConnection()
 * - Calls batchSyncToPostgres() with deduplicated payloads
 * - Logs failures; relies on Cloudflare's automatic retry + dead-letter queue
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SyncQueueMessage } from '../../src/types/queue-messages';

// =============================================================================
// Mock Infrastructure
// =============================================================================

// Mock the db module for runWithConnection
vi.mock('../../src/db', () => ({
  runWithConnection: vi.fn().mockImplementation(
    async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
  ),
}));

// Mock batchSyncToPostgres
vi.mock('../../src/services/document-version-service', () => ({
  batchSyncToPostgres: vi.fn().mockResolvedValue({
    inserted: [],
    skippedCount: 0,
  }),
}));

// =============================================================================
// Types for Cloudflare Queue mock
// =============================================================================

interface MockMessage<T> {
  body: T;
  id: string;
  timestamp: Date;
  ack: () => void;
  retry: () => void;
}

interface MockMessageBatch<T> {
  queue: string;
  messages: MockMessage<T>[];
  ackAll: () => void;
  retryAll: () => void;
}

interface MockEnv {
  HYPERDRIVE?: { connectionString: string };
  POSTGRES_CONNECTION_STRING?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function createMockMessage(
  body: SyncQueueMessage,
  id = `msg-${Math.random().toString(36).substring(2, 9)}`,
): MockMessage<SyncQueueMessage> {
  return {
    body,
    id,
    timestamp: new Date(body.timestamp),
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function createMockBatch(
  messages: MockMessage<SyncQueueMessage>[],
  queue = 'css-sync-queue',
): MockMessageBatch<SyncQueueMessage> {
  return {
    queue,
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

function createSyncMessage(overrides: Partial<SyncQueueMessage> = {}): SyncQueueMessage {
  return {
    siteId: 'site-1',
    documentId: 'doc-1',
    branchId: 'branch-1',
    snapshot: { content: 'hello' },
    crdtState: btoa('mock-crdt-state'),
    actorId: 'user-1',
    actorType: 'user',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createMockEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    HYPERDRIVE: { connectionString: 'postgresql://user:pass@host:5432/db' },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Phase 5.1: Sync Queue Consumer', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    // Re-setup default mock implementations after reset
    const db = await import('../../src/db');
    (db.runWithConnection as ReturnType<typeof vi.fn>).mockImplementation(
      async (_connStr: string, _opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
    const dvs = await import('../../src/services/document-version-service');
    (dvs.batchSyncToPostgres as ReturnType<typeof vi.fn>).mockResolvedValue({
      inserted: [],
      skippedCount: 0,
    });
  });

  describe('batch processing', () => {
    it('should process a single message batch', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

      const msg = createSyncMessage();
      const batch = createMockBatch([createMockMessage(msg)]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(batchSyncToPostgres).toHaveBeenCalledTimes(1);
      expect(batchSyncToPostgres).toHaveBeenCalledWith([
        expect.objectContaining({
          documentId: msg.documentId,
          branchId: msg.branchId,
          snapshot: msg.snapshot,
          crdtState: msg.crdtState,
          actorId: msg.actorId,
          actorType: msg.actorType,
        }),
      ]);
    });

    it('should process multiple messages in a batch', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

      const msg1 = createSyncMessage({ documentId: 'doc-1', timestamp: 1000 });
      const msg2 = createSyncMessage({ documentId: 'doc-2', timestamp: 2000 });
      const msg3 = createSyncMessage({ documentId: 'doc-3', timestamp: 3000 });

      const batch = createMockBatch([
        createMockMessage(msg1),
        createMockMessage(msg2),
        createMockMessage(msg3),
      ]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(batchSyncToPostgres).toHaveBeenCalledTimes(1);
      const payloads = (batchSyncToPostgres as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[];
      expect(payloads).toHaveLength(3);
    });

    it('should use Hyperdrive connection string when available', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { runWithConnection } = await import('../../src/db');

      const batch = createMockBatch([createMockMessage(createSyncMessage())]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(runWithConnection).toHaveBeenCalledWith(
        'postgresql://user:pass@host:5432/db',
        expect.objectContaining({ isHyperdrive: true }),
        expect.any(Function),
      );
    });

    it('should fall back to POSTGRES_CONNECTION_STRING when HYPERDRIVE is not available', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { runWithConnection } = await import('../../src/db');

      const batch = createMockBatch([createMockMessage(createSyncMessage())]);
      const env = createMockEnv({
        HYPERDRIVE: undefined,
        POSTGRES_CONNECTION_STRING: 'postgresql://local:pass@localhost:5432/cssdb',
      });

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(runWithConnection).toHaveBeenCalledWith(
        'postgresql://local:pass@localhost:5432/cssdb',
        expect.objectContaining({ isHyperdrive: false }),
        expect.any(Function),
      );
    });

    it('should ackAll on successful processing', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');

      const batch = createMockBatch([createMockMessage(createSyncMessage())]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(batch.ackAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate messages with same siteId:documentId:branchId, keeping latest timestamp', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

      const earlyMsg = createSyncMessage({
        siteId: 'site-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: 'old' },
        timestamp: 1000,
      });
      const lateMsg = createSyncMessage({
        siteId: 'site-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: 'new' },
        timestamp: 2000,
      });

      const batch = createMockBatch([
        createMockMessage(earlyMsg),
        createMockMessage(lateMsg),
      ]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(batchSyncToPostgres).toHaveBeenCalledTimes(1);
      const payloads = (batchSyncToPostgres as ReturnType<typeof vi.fn>)
        .mock.calls[0][0] as { snapshot: Record<string, unknown> }[];
      expect(payloads).toHaveLength(1);
      expect(payloads[0].snapshot).toEqual({ content: 'new' });
    });

    it('should keep messages with different document keys as separate entries', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

      const msg1 = createSyncMessage({ documentId: 'doc-1', timestamp: 1000 });
      const msg2 = createSyncMessage({ documentId: 'doc-2', timestamp: 1000 });
      const msg3 = createSyncMessage({
        documentId: 'doc-1',
        branchId: 'branch-2',
        timestamp: 1000,
      });

      const batch = createMockBatch([
        createMockMessage(msg1),
        createMockMessage(msg2),
        createMockMessage(msg3),
      ]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      const payloads = (batchSyncToPostgres as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[];
      expect(payloads).toHaveLength(3);
    });

    it('should handle large batches with many duplicates', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

      // 100 messages for 5 unique document keys
      const messages: MockMessage<SyncQueueMessage>[] = [];
      for (let i = 0; i < 100; i++) {
        const docIndex = i % 5;
        messages.push(
          createMockMessage(
            createSyncMessage({
              documentId: `doc-${String(docIndex)}`,
              snapshot: { version: i },
              timestamp: 1000 + i,
            }),
          ),
        );
      }

      const batch = createMockBatch(messages);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      const payloads = (batchSyncToPostgres as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[];
      expect(payloads).toHaveLength(5); // Only 5 unique document keys
    });
  });

  describe('error handling', () => {
    it('should retryAll when batchSyncToPostgres throws', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

      (batchSyncToPostgres as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const batch = createMockBatch([createMockMessage(createSyncMessage())]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(batch.retryAll).toHaveBeenCalledTimes(1);
      expect(batch.ackAll).not.toHaveBeenCalled();
    });

    it('should retryAll when no connection string is available', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');

      const batch = createMockBatch([createMockMessage(createSyncMessage())]);
      const env = createMockEnv({
        HYPERDRIVE: undefined,
        POSTGRES_CONNECTION_STRING: undefined,
      });

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(batch.retryAll).toHaveBeenCalledTimes(1);
    });

    it('should handle empty batch gracefully', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');

      const batch = createMockBatch([]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      // Should ack empty batch without calling batchSyncToPostgres
      expect(batchSyncToPostgres).not.toHaveBeenCalled();
      expect(batch.ackAll).toHaveBeenCalledTimes(1);
    });

    it('should retryAll when runWithConnection throws', async () => {
      const { handleSyncQueue } = await import('../../src/queues/sync-consumer');
      const { runWithConnection } = await import('../../src/db');

      (runWithConnection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Hyperdrive connection failed'),
      );

      const batch = createMockBatch([createMockMessage(createSyncMessage())]);
      const env = createMockEnv();

      await handleSyncQueue(batch as unknown as MessageBatch<SyncQueueMessage>, env);

      expect(batch.retryAll).toHaveBeenCalledTimes(1);
      expect(batch.ackAll).not.toHaveBeenCalled();
    });
  });
});
