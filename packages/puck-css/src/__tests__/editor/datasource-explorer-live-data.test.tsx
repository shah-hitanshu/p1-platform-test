/**
 * Puck receives its plugin array once per mount, so a plugin that carries
 * datasource data by value renders that value forever: the plugins are built the
 * moment the registry first exists, while the context fetch is still in flight,
 * which left the explorer panel on a permanent loading skeleton.
 *
 * The panel must therefore pick up data that lands *after* the plugin object was
 * created, without the plugin being recreated.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

import { P1RouterContext, type P1Router } from "../../p1/router-context";
import { P1QueryProvider } from "../../data/query-provider";

vi.mock("../../auth/P1AuthProvider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../auth/P1AuthProvider")>();
  return {
    ...actual,
    useOptionalP1Auth: () => null,
    useP1Auth: () => ({ getToken: vi.fn().mockResolvedValue(null) }),
  };
});

import { createRemoteDatasourceExplorerPlugin } from "../../p1/editor/remote-datasources/remote-datasource-explorer-plugin";

const registry = [
  {
    id: "swapi",
    label: "Star Wars character detail",
    description: "test",
    resolution: "test",
    fields: [{ path: "name", description: "Name" }],
  },
];

function createWrapper() {
  const router: P1Router = {
    refresh: vi.fn(),
    replace: vi.fn(),
    pathname: "/people/1",
    searchParams: new URLSearchParams(),
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1QueryProvider,
      null,
      React.createElement(P1RouterContext.Provider, { value: router }, children),
    );
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("datasource explorer panel data source", () => {
  it("renders datasource values that arrive after the plugin was created", async () => {
    let resolveContext: (value: unknown) => void = () => undefined;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/p1/api/editor-context")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              remoteDatasourceContext: {},
              routes: [],
              routeTemplateKeys: [],
              savedPreviewParams: {},
              remoteDatasourceRegistry: registry,
            }),
        });
      }
      return new Promise((resolve) => {
        resolveContext = resolve;
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    // Built exactly as the editor builds it: no data, because none exists yet.
    const plugin = createRemoteDatasourceExplorerPlugin({
      editorPath: "/people/1",
    });
    const Panel = plugin.render as () => React.ReactElement;

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Panel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("Star Wars character detail")).toBeDefined(),
    );

    // The datasource fetch is still in flight — the panel shows the skeleton.
    expect(screen.queryByText(/Luke Skywalker/)).toBeNull();

    resolveContext({
      ok: true,
      json: () =>
        Promise.resolve({ id: "swapi", data: { name: "Luke Skywalker" } }),
    });

    // The plugin object never changed, so this only passes if the panel reads
    // datasource state live rather than from the factory's closure.
    await waitFor(() =>
      expect(screen.getByText(/Luke Skywalker/)).toBeDefined(),
    );
  });
});
