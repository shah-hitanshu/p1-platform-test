/**
 * ContextSyncBridge and DocumentSync are two independent mechanisms that both
 * push whole documents into a live Puck instance. Now that Puck survives
 * document switches, DocumentSync owns document -> document transitions
 * (it swaps data and the undo stack atomically). ContextSyncBridge must stand
 * down for those, or its setData lands first — before DocumentSync updates the
 * applied key — and trips useP1Editor's write-back guard on every page switch,
 * drowning out the genuine races that guard exists to report.
 *
 * The doc-latest key is still load-bearing when the canvas already shows the
 * document (return-to-latest from a historical version), so suppression has to
 * be narrow.
 */

import { describe, it, expect } from "vitest";

import { resolveContextSyncKey } from "../../editor/plugin/context-sync-key";
import { documentSyncKey } from "../../editor/plugin/document-sync-plugin";

const docA = { id: "docA" };
const docB = { id: "docB" };

function storeWithApplied(appliedKey: string | null) {
  return { getAppliedKey: () => appliedKey };
}

describe("documentSyncKey", () => {
  it("combines branch and document into one identity", () => {
    expect(documentSyncKey("branch1", "docA")).toBe("branch1:docA");
  });

  it("tolerates a missing branch", () => {
    expect(documentSyncKey(null, "docA")).toBe(":docA");
    expect(documentSyncKey(undefined, "docA")).toBe(":docA");
  });
});

describe("resolveContextSyncKey", () => {
  it("prefers remoteSyncKey over every other source", () => {
    expect(
      resolveContextSyncKey({
        remoteSyncKey: "remote-123",
        viewingVersion: { id: "v1" },
        currentDocument: docA,
        branchId: "branch1",
        documentSyncStore: storeWithApplied("branch1:docB"),
      }),
    ).toBe("remote-123");
  });

  it("uses the version key while viewing a historical version", () => {
    expect(
      resolveContextSyncKey({
        remoteSyncKey: null,
        viewingVersion: { id: "v1" },
        currentDocument: docA,
        branchId: "branch1",
        documentSyncStore: storeWithApplied("branch1:docB"),
      }),
    ).toBe("version-v1");
  });

  it("returns null when there is no document to sync", () => {
    expect(
      resolveContextSyncKey({
        remoteSyncKey: null,
        viewingVersion: null,
        currentDocument: null,
        branchId: "branch1",
      }),
    ).toBeNull();
  });

  it("falls back to doc-latest when no document-sync store is wired", () => {
    expect(
      resolveContextSyncKey({
        remoteSyncKey: null,
        viewingVersion: null,
        currentDocument: docA,
        branchId: "branch1",
      }),
    ).toBe("doc-docA-latest");
  });

  it("falls back to doc-latest before the store has observed any document", () => {
    expect(
      resolveContextSyncKey({
        remoteSyncKey: null,
        viewingVersion: null,
        currentDocument: docA,
        branchId: "branch1",
        documentSyncStore: storeWithApplied(null),
      }),
    ).toBe("doc-docA-latest");
  });

  it("syncs doc-latest when the canvas already shows this document (return-to-latest)", () => {
    expect(
      resolveContextSyncKey({
        remoteSyncKey: null,
        viewingVersion: null,
        currentDocument: docA,
        branchId: "branch1",
        documentSyncStore: storeWithApplied("branch1:docA"),
      }),
    ).toBe("doc-docA-latest");
  });

  it("stands down when the canvas still shows a different document", () => {
    expect(
      resolveContextSyncKey({
        remoteSyncKey: null,
        viewingVersion: null,
        currentDocument: docB,
        branchId: "branch1",
        documentSyncStore: storeWithApplied("branch1:docA"),
      }),
    ).toBeNull();
  });

  it("stands down when the same document is being loaded on another branch", () => {
    expect(
      resolveContextSyncKey({
        remoteSyncKey: null,
        viewingVersion: null,
        currentDocument: docA,
        branchId: "branch2",
        documentSyncStore: storeWithApplied("branch1:docA"),
      }),
    ).toBeNull();
  });
});
