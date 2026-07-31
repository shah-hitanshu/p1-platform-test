"use client";

/**
 * Document-sync plugin
 *
 * Lets a single mounted <Puck> instance follow document switches instead of
 * being remounted via a React key (which tears down the preview iframe and
 * re-parses all canvas styles). useP1Editor publishes the freshly loaded
 * document into a DocumentSyncStore; a headless component inside the Puck
 * tree picks it up and replaces editor state through the history API.
 *
 * A single history.setHistories([{ state }]) call does everything atomically:
 * it dispatches the new state into Puck and replaces the undo stack, so
 * undo can never resurrect the previous document. The state passed omits
 * `indexes` on purpose — Puck's set action only re-runs walkAppState (which
 * rebuilds the node/zone indexes for the new content) when indexes are absent.
 */

import React, { useEffect, useSyncExternalStore } from "react";
import { useGetPuck } from "@puckeditor/core";
import type { Plugin } from "@puckeditor/core";
import type { PuckData } from "@pantheon-systems/css-client";

export interface DocumentSyncSnapshot {
  /** Identity of the loaded document (e.g. `${branchId}:${documentId}`) */
  syncKey: string | null;
  data: PuckData | null;
}

export interface DocumentSyncStore {
  publish(snapshot: DocumentSyncSnapshot): void;
  subscribe(onChange: VoidFunction): VoidFunction;
  getSnapshot(): DocumentSyncSnapshot;
  /** Records which document the Puck canvas currently shows; null before the first */
  markApplied(syncKey: string | null): void;
  /** Sync key of the document the canvas shows, or null before the first one */
  getAppliedKey(): string | null;
}

const EMPTY_SNAPSHOT: DocumentSyncSnapshot = { syncKey: null, data: null };

/**
 * Sync-key format for a loaded document. Shared so the publisher
 * (useP1Editor) and readers of the applied key (ContextSyncBridge, the
 * write-back guard) can never disagree about what identifies a document.
 */
export function documentSyncKey(
  branchId: string | null | undefined,
  documentId: string,
): string {
  return `${branchId ?? ""}:${documentId}`;
}

/**
 * Guarantee a complete PuckData shape before handing data to Puck. Puck's
 * walkAppState reads data.root.props while rebuilding indexes, so a page whose
 * root or content hasn't settled yet (as can happen mid document-switch) would
 * otherwise crash with "Cannot read properties of undefined (reading 'props')".
 * Settled data passes through by reference unchanged; a non-object (a bug
 * upstream — data should already be parsed) collapses to a blank page rather
 * than being spread character-by-character.
 */
export function normalizeSyncData(data: PuckData): PuckData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { content: [], root: { props: {} } };
  }
  if (data.content && data.root?.props) return data;
  const root = data.root ?? { props: {} };
  return {
    ...data,
    content: data.content ?? [],
    root: { ...root, props: root.props ?? {} },
  };
}

export function createDocumentSyncStore(): DocumentSyncStore {
  let snapshot = EMPTY_SNAPSHOT;
  let appliedKey: string | null = null;
  const listeners = new Set<VoidFunction>();

  return {
    publish(next) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot() {
      return snapshot;
    },
    markApplied(syncKey) {
      appliedKey = syncKey;
    },
    getAppliedKey() {
      return appliedKey;
    },
  };
}

interface PuckUiSlice {
  itemSelector: unknown;
  [key: string]: unknown;
}

interface PuckAppStateSlice {
  data: unknown;
  ui: PuckUiSlice;
  [key: string]: unknown;
}

interface PuckStateSlice {
  appState: PuckAppStateSlice;
  history: {
    setHistories: (histories: { state: Record<string, unknown> }[]) => void;
  };
}

function DocumentSync({ store }: { store: DocumentSyncStore }) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  // Puck state is read imperatively at push time rather than subscribed to —
  // subscribing to appState would re-run this component on every keystroke.
  const getPuck = useGetPuck();

  useEffect(() => {
    const { syncKey, data } = snapshot;
    if (!syncKey || !data) return;

    const appliedKey = store.getAppliedKey();
    if (appliedKey === syncKey) return;
    if (appliedKey === null) {
      // First document observed: Puck was mounted with it, nothing to push.
      store.markApplied(syncKey);
      return;
    }
    const { appState, history } = getPuck() as unknown as PuckStateSlice;
    // Omit indexes so Puck re-runs walkAppState for the new content.
    const { indexes: _indexes, ...rest } = appState;

    // Marked before dispatching, and rolled back if the dispatch fails. Puck's
    // onChange is a store subscriber, so it fires synchronously inside
    // setHistories: the echo has to find the new document already applied, or
    // useP1Editor's write-back guard reports a race on every switch. A failed
    // dispatch must not leave the key advanced either — the canvas would still
    // hold the old document and the guard would wave through a save that writes
    // it into the new one.
    store.markApplied(syncKey);
    try {
      history.setHistories([
        {
          state: {
            ...rest,
            data: normalizeSyncData(data),
            ui: { ...rest.ui, itemSelector: null },
          },
        },
      ]);
    } catch (err) {
      store.markApplied(appliedKey);
      throw err;
    }
  }, [snapshot, getPuck, store]);

  return null;
}

export function createDocumentSyncPlugin(store: DocumentSyncStore): Plugin {
  return {
    name: "p1-document-sync",
    overrides: {
      puck: ({ children }: { children: React.ReactNode }) => (
        <>
          <DocumentSync store={store} />
          {children}
        </>
      ),
    },
  };
}
