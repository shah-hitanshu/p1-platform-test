/**
 * The plugin object is now created once and never recreated, so it can't
 * rely on a `routes`/`registry` value closed over at creation time — it must
 * read live data via useLiveRemoteDatasources instead.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
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

const registryCalls: unknown[] = [];
vi.mock("../../p1/editor/template-autocomplete-layer", () => ({
  TemplateAutocompleteLayer: (props: {
    registry?: unknown[];
    children: React.ReactNode;
  }) => {
    registryCalls.push(props.registry);
    return <>{props.children}</>;
  },
}));

import { createFieldConnectPlugin } from "../../p1/editor/connect/field-connect-plugin";

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
    return (
      <P1QueryProvider>
        <P1RouterContext.Provider value={router}>{children}</P1RouterContext.Provider>
      </P1QueryProvider>
    );
  };
}

beforeEach(() => {
  registryCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("field-connect plugin data source", () => {
  it("passes the live remote-datasource registry, not the (empty) closure snapshot", async () => {
    let resolveContext: (value: unknown) => void = () => undefined;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/p1/api/editor-context")) {
        return new Promise((resolve) => {
          resolveContext = resolve;
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", mockFetch);

    // Built exactly as useP1Plugins builds it after the fix: no routes /
    // remoteDatasourceRegistry passed — the plugin has never seen this data.
    const mockConfig = { components: {}, root: { render: () => null } };
    const plugin = createFieldConnectPlugin({
      config: mockConfig as never,
      editorPath: "/people/1",
    });
    const Field = plugin.overrides!.fieldTypes!.text as (
      props: Record<string, unknown>,
    ) => React.ReactElement;

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Field name="body" value="" onChange={() => {}}>
          <textarea />
        </Field>
      </Wrapper>,
    );

    await waitFor(() => expect(registryCalls.length).toBeGreaterThan(0));
    expect(registryCalls[registryCalls.length - 1]).toEqual([]);

    resolveContext({
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

    // The plugin object never changed — this only passes if the field reads
    // the registry live rather than from the factory's closure.
    await waitFor(() =>
      expect(registryCalls[registryCalls.length - 1]).toEqual(registry),
    );
  });

  // Exercises the published `EditorClient` (client.tsx) call site, which has
  // no P1PuckProvider and so still passes constructor-time fallback props —
  // live data must win once it resolves, not just leave the fallback in place.
  it("prefers live data over a non-empty fallback once it resolves", async () => {
    const liveRegistry = [
      {
        id: "swapi-planet",
        label: "Star Wars planet detail",
        description: "test",
        resolution: "test",
        fields: [{ path: "name", description: "Name" }],
      },
    ];
    let resolveContext: (value: unknown) => void = () => undefined;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/p1/api/editor-context")) {
        return new Promise((resolve) => {
          resolveContext = resolve;
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockConfig = { components: {}, root: { render: () => null } };
    const plugin = createFieldConnectPlugin({
      config: mockConfig as never,
      editorPath: "/people/1",
      remoteDatasourceRegistry: registry,
    });
    const Field = plugin.overrides!.fieldTypes!.text as (
      props: Record<string, unknown>,
    ) => React.ReactElement;

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Field name="body" value="" onChange={() => {}}>
          <textarea />
        </Field>
      </Wrapper>,
    );

    await waitFor(() => expect(registryCalls.length).toBeGreaterThan(0));
    expect(registryCalls[registryCalls.length - 1]).toEqual(registry);

    resolveContext({
      ok: true,
      json: () =>
        Promise.resolve({
          remoteDatasourceContext: {},
          routes: [],
          routeTemplateKeys: [],
          savedPreviewParams: {},
          remoteDatasourceRegistry: liveRegistry,
        }),
    });

    await waitFor(() =>
      expect(registryCalls[registryCalls.length - 1]).toEqual(liveRegistry),
    );
  });

  it("prefers a genuinely empty live result over a non-empty fallback", async () => {
    let resolveContext: (value: unknown) => void = () => undefined;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/p1/api/editor-context")) {
        return new Promise((resolve) => {
          resolveContext = resolve;
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockConfig = { components: {}, root: { render: () => null } };
    const plugin = createFieldConnectPlugin({
      config: mockConfig as never,
      editorPath: "/people/1",
      remoteDatasourceRegistry: registry,
    });
    const Field = plugin.overrides!.fieldTypes!.text as (
      props: Record<string, unknown>,
    ) => React.ReactElement;

    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Field name="body" value="" onChange={() => {}}>
          <textarea />
        </Field>
      </Wrapper>,
    );

    await waitFor(() => expect(registryCalls.length).toBeGreaterThan(0));
    expect(registryCalls[registryCalls.length - 1]).toEqual(registry);

    resolveContext({
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

    // A length check would keep showing the stale non-empty fallback forever
    // here — this only passes if the field trusts `hasLoaded` instead.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(registryCalls[registryCalls.length - 1]).toEqual([]),
    );
  });
});
