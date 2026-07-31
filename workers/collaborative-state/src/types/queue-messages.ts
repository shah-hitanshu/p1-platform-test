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
  actorId: string;
  actorType: 'user' | 'agent';
  /** Verified email of the actor (PCC-3457) — enables JIT user provisioning for OAuth subjects */
  actorEmail?: string;
  /** Verified display name of the actor (PCC-3457) */
  actorName?: string;
  timestamp: number;
  actionType?: string; // Puck action type (e.g., "insert", "reorder", "set")
  actionMetadata?: Record<string, unknown>; // Additional Puck action context
  puckActions?: { type: string; [key: string]: unknown }[]; // Batched Puck actions
}

/**
 * Request to capture a fresh screenshot for a site.
 */
export interface ScreenshotQueueMessage {
  siteId: string;
  url: string;
  enqueuedAt: number;
  reason: 'url_changed' | 'published' | 'cron';
}
