/**
 * A document record carries its page as a slug, so feeding that value straight
 * to the editor APIs makes them reject the SDK's own data as an invalid path.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";

import { P1PuckContext } from "../../core/P1PuckContext";
import type { P1PuckContextValue } from "../../core/types";
import { P1QueryProvider } from "../../data/query-provider";
import { useLiveEditorContext } from "../../p1/editor/hooks/useLiveEditorContext";

function wrapper(documentPath: string | null) {
  const ctx = {
    branchId: "branch-1",
    currentDocument: documentPath === null ? null : { id: "doc-1", path: documentPath },
  } as unknown as P1PuckContextValue;

  return ({ children }: { children: React.ReactNode }) => (
    <P1QueryProvider>
      <P1PuckContext.Provider value={ctx}>{children}</P1PuckContext.Provider>
    </P1QueryProvider>
  );
}

let mockFetch: ReturnType<typeof vi.fn>;

function editorContextUrls(): string[] {
  return mockFetch.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/p1/api/editor-context"));
}

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        remoteDatasourceContext: {},
        routes: [],
        routeTemplateKeys: [],
        savedPreviewParams: {},
        remoteDatasourceRegistry: [],
      }),
  });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLiveEditorContext page path", () => {
  it("requests the editor context for a slug-only document path as a page path", async () => {
    renderHook(() => useLiveEditorContext("/fallback"), {
      wrapper: wrapper("blog"),
    });

    await waitFor(() => expect(editorContextUrls().length).toBeGreaterThan(0));
    expect(editorContextUrls()[0]).toContain("path=%2Fblog");
    expect(editorContextUrls()[0]).not.toContain("path=blog");
  });

  it("exposes the page path it queried, since callers pass it to other endpoints", async () => {
    const { result } = renderHook(() => useLiveEditorContext("/fallback"), {
      wrapper: wrapper("resources/guide-1a"),
    });

    expect(result.current.path).toBe("/resources/guide-1a");
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  });

  it("leaves an already-rooted document path alone", async () => {
    const { result } = renderHook(() => useLiveEditorContext("/fallback"), {
      wrapper: wrapper("/"),
    });

    expect(result.current.path).toBe("/");
    await waitFor(() => expect(editorContextUrls().length).toBeGreaterThan(0));
    expect(editorContextUrls()[0]).toContain("path=%2F&");
  });

  it("roots a slug-only fallback path when there is no open document", async () => {
    const { result } = renderHook(() => useLiveEditorContext("blog"), {
      wrapper: wrapper(null),
    });

    expect(result.current.path).toBe("/blog");
  });
});
