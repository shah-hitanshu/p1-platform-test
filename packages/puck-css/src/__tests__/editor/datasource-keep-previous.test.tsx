/**
 * During a page switch the datasource-context queries change key (path).
 * The previous page's context must remain available (marked as loading)
 * instead of emptying out, so preview resolution and the datasource explorer
 * don't flash empty mid-switch.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";

import { P1RouterContext, type P1Router } from "../../p1/router-context";
import { useRemoteDatasourceContext } from "../../p1/editor/hooks";
import { P1QueryProvider } from "../../data/query-provider";

function createMockRouter(): P1Router {
  return {
    refresh: vi.fn(),
    replace: vi.fn(),
    pathname: "/test",
    searchParams: new URLSearchParams(),
  };
}

function createWrapper(router: P1Router) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1QueryProvider,
      null,
      React.createElement(P1RouterContext.Provider, { value: router }, children),
    );
  };
}

const registry = [
  {
    id: "swapi",
    label: "SWAPI",
    description: "test",
    resolution: "test",
    fields: [{ path: "name", description: "Name" }],
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRemoteDatasourceContext across a path change", () => {
  it("keeps the previous path's context while the new path's fetch is in flight", async () => {
    let resolveB: (value: unknown) => void = () => undefined;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes(encodeURIComponent("/a"))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "swapi", data: { name: "Luke" } }),
        });
      }
      return new Promise((resolve) => {
        resolveB = resolve;
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const router = createMockRouter();
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useRemoteDatasourceContext(path, registry),
      { wrapper: createWrapper(router), initialProps: { path: "/a" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.context).toEqual({ swapi: { name: "Luke" } });

    rerender({ path: "/b" });

    // In flight: old data still present, but flagged as loading
    expect(result.current.context).toEqual({ swapi: { name: "Luke" } });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingIds.has("swapi")).toBe(true);

    resolveB({
      ok: true,
      json: () => Promise.resolve({ id: "swapi", data: { name: "Leia" } }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.context).toEqual({ swapi: { name: "Leia" } });
    expect(result.current.loadingIds.size).toBe(0);
  });
});
