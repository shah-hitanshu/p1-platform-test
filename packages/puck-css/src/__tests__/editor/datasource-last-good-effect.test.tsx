/**
 * The carried-over "last good" datasource context is written from a commit
 * effect, not from the useMemo factory: useMemo is a memoization hint, not a
 * once-per-commit guarantee, so writing there makes the carry-over a
 * render-phase side effect. StrictMode double-invokes render, which is the
 * cheapest way to pin that the carry-over survives the move and stays
 * idempotent.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React, { StrictMode } from "react";

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

function createStrictWrapper(router: P1Router) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      StrictMode,
      null,
      React.createElement(
        P1QueryProvider,
        null,
        React.createElement(P1RouterContext.Provider, { value: router }, children),
      ),
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

describe("useRemoteDatasourceContext under StrictMode", () => {
  it("carries the previous path's context across a switch without render-phase writes", async () => {
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
      { wrapper: createStrictWrapper(router), initialProps: { path: "/a" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.context).toEqual({ swapi: { name: "Luke" } });

    rerender({ path: "/b" });

    expect(result.current.context).toEqual({ swapi: { name: "Luke" } });
    expect(result.current.isLoading).toBe(true);

    resolveB({
      ok: true,
      json: () => Promise.resolve({ id: "swapi", data: { name: "Leia" } }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.context).toEqual({ swapi: { name: "Leia" } });
  });

  it("re-reading the hook result does not change the carried-over context", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "swapi", data: { name: "Luke" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const router = createMockRouter();
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useRemoteDatasourceContext(path, registry),
      { wrapper: createStrictWrapper(router), initialProps: { path: "/a" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ path: "/a" });
    rerender({ path: "/a" });

    expect(result.current.context).toEqual({ swapi: { name: "Luke" } });
  });
});
