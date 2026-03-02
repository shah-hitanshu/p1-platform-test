/**
 * Phase 5.1: Message types for Cloudflare Queue-based sync
 *
 * Defines the shape of messages sent from Durable Objects to the
 * sync queue for eventual persistence to PostgreSQL.
 */

export interface SyncQueueMessage {
  siteId: string;
  documentId: string;
  branchId: string;
  snapshot: Record<string, unknown>;
  crdtState: string; // base64-encoded Yjs state
  actorId: string;
  actorType: 'user' | 'agent';
  timestamp: number;
}
