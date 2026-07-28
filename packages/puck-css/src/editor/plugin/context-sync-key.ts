"use client";

import { documentSyncKey, type DocumentSyncStore } from "./document-sync-plugin.js";

export interface ContextSyncKeyInput {
  remoteSyncKey: string | null;
  viewingVersion: { id: string } | null;
  currentDocument: { id: string } | null;
  branchId?: string | null;
  /** Omitted by consumers that drive Puck without the document-sync plugin. */
  documentSyncStore?: Pick<DocumentSyncStore, "getAppliedKey">;
}

/**
 * Sync key ContextSyncBridge should push into Puck, or null to push nothing.
 *
 * Two mechanisms can replace the whole canvas: this one (a `setData` dispatch)
 * and the document-sync plugin (`setHistories`, which also resets the undo
 * stack). Since Puck now survives document switches, the plugin owns
 * document -> document transitions; this bridge stands down for them. Its
 * dispatch would otherwise land first — before the plugin advances the applied
 * key — and trip useP1Editor's write-back guard on every page switch, burying
 * the real races that warning is there to surface.
 *
 * The doc-latest key still matters when the canvas already shows the document:
 * returning to latest from a historical version reaches this path, and nothing
 * else restores the live data.
 */
export function resolveContextSyncKey({
  remoteSyncKey,
  viewingVersion,
  currentDocument,
  branchId,
  documentSyncStore,
}: ContextSyncKeyInput): string | null {
  if (remoteSyncKey) return remoteSyncKey;
  if (viewingVersion) return `version-${viewingVersion.id}`;
  if (!currentDocument) return null;

  if (documentSyncStore) {
    const appliedKey = documentSyncStore.getAppliedKey();
    // A null applied key means the plugin has not observed a document yet, so
    // Puck was mounted with this one and there is no switch to defer to.
    if (
      appliedKey !== null &&
      appliedKey !== documentSyncKey(branchId, currentDocument.id)
    ) {
      return null;
    }
  }

  return `doc-${currentDocument.id}-latest`;
}
