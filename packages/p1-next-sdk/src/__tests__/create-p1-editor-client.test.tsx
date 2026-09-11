// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    pathname: "/p1/about",
    configThrows: null as string | null,
    authenticated: true,
    editor: {
      loading: false,
      reloading: null as string | null,
      hasContent: true,
      error: null as Error | null,
      puckKey: "key-1",
      puckProps: { config: {}, data: {} },
    },
  };
  return {
    state,
    push: vi.fn(),
    useP1Editor: vi.fn(),
    p1Plugin: { name: "p1-plugin" },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => h.state.pathname,
  useRouter: () => ({ push: h.push }),
}));

vi.mock("@puckeditor/core", () => ({
  Puck: () => {
    // A fresh id on mount, so a changed canvas key is observable as a remount.
    const [id] = React.useState(() => Math.random().toString(36).slice(2));
    return <div data-testid="puck" data-instance={id} />;
  },
}));

vi.mock("@pantheon-systems/puck-css", () => ({
  P1App: ({ config, children, loginFallback }: any) =>
    h.state.authenticated ? (
      <div data-testid="p1-app" data-user-role={config.userRole}>
        {children}
      </div>
    ) : (
      loginFallback ?? <div data-testid="default-login" />
    ),
  P1QueryProvider: ({ children }: any) => <>{children}</>,
  createNextConfig: () => {
    if (h.state.configThrows) throw new Error(h.state.configThrows);
    return { baseUrl: "https://example.test", siteId: "site-1", authMode: "broker" };
  },
  editorPathHref: (p: string) => `/p1${p}`,
  EditorReloadOverlay: ({ reloading }: any) => (
    <div data-testid="reload-overlay" data-reloading={String(reloading)} />
  ),
  useEditorContext: () => ({ data: { remoteDatasourceRegistry: [] } }),
  useP1Editor: (opts: any) => h.useP1Editor(opts),
  useP1Plugins: () => [h.p1Plugin],
  useRemoteDatasourceContext: () => ({ context: {} }),
  wrapConfigForEditorPreview: (config: unknown) => ({ wrapped: config }),
}));

vi.mock("@pantheon-systems/puck-css/fields", () => ({
  DatasourceRegistryProvider: ({ children }: any) => <>{children}</>,
  DatasourceDataProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock("@pantheon-systems/puck-css/pds", () => ({
  LoadingMessage: ({ message, ...rest }: any) => <div {...rest}>{message}</div>,
}));

vi.mock("../P1NextRouterProvider", () => ({
  P1NextRouterProvider: ({ children }: any) => <>{children}</>,
}));

import { createP1EditorClient } from "../editor-client/create-p1-editor-client";

// This jsdom build exposes no localStorage, and the post-login redirect is read
// out of it.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  },
});

const puckConfig = { components: {} } as never;

function lastEditorOptions() {
  return h.useP1Editor.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  h.state.pathname = "/p1/about";
  h.state.configThrows = null;
  h.state.authenticated = true;
  h.state.editor = {
    loading: false,
    reloading: null,
    hasContent: true,
    error: null,
    puckKey: "key-1",
    puckProps: { config: {}, data: {} },
  };
  h.push.mockReset();
  h.useP1Editor.mockReset();
  h.useP1Editor.mockImplementation(() => h.state.editor);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("editor shell", () => {
  it("renders the canvas for the document the URL names", () => {
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    screen.getByTestId("puck");
    expect(lastEditorOptions().documentPath).toBe("/about");
  });

  it("shows a loading message while the document loads", () => {
    h.state.editor.loading = true;
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    expect(screen.getByTestId("editor-loading").textContent).toBe("Loading document");
    expect(screen.queryByTestId("puck")).toBeNull();
  });

  it("explains itself instead of rendering when P1 is not configured", () => {
    h.state.configThrows = "siteId is required";
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    const panel = screen.getByTestId("editor-unavailable");
    expect(panel.textContent).toContain("Editor unavailable");
    expect(panel.textContent).toContain("siteId is required");
    expect(screen.queryByTestId("puck")).toBeNull();
  });
});

describe("last-good-state", () => {
  it("keeps the document on screen when a reload fails", () => {
    h.state.editor.error = new Error("network down");
    h.state.editor.hasContent = true;
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    screen.getByTestId("puck");
    expect(screen.queryByTestId("editor-error")).toBeNull();
  });

  it("takes over the view when the failure has nothing to fall back on", () => {
    h.state.editor.error = new Error("network down");
    h.state.editor.hasContent = false;
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    const panel = screen.getByTestId("editor-error");
    expect(panel.textContent).toContain("Error loading document");
    expect(panel.textContent).toContain("network down");
    expect(screen.queryByTestId("puck")).toBeNull();
  });
});

describe("branch switching", () => {
  it("hands the reload kind to the overlay rather than unmounting the canvas", () => {
    h.state.editor.reloading = "branch";
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    expect(screen.getByTestId("reload-overlay").getAttribute("data-reloading")).toBe("branch");
    screen.getByTestId("puck");
  });
});

describe("post-login redirect", () => {
  it("returns to the stashed page and clears it", () => {
    localStorage.setItem("p1_return_to", "/blog/hello");
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    expect(h.push).toHaveBeenCalledWith("/blog/hello");
    expect(localStorage.getItem("p1_return_to")).toBeNull();
    expect(screen.getByTestId("editor-redirecting").textContent).toBe("Redirecting");
  });

  it("drops a stashed location that would leave the site", () => {
    // A protocol-relative URL reads as a path but navigates off-origin, and
    // anything on this origin can write the key it comes out of.
    localStorage.setItem("p1_return_to", "//evil.example/phish");
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    expect(h.push).not.toHaveBeenCalled();
    expect(localStorage.getItem("p1_return_to")).toBeNull();
    screen.getByTestId("puck");
  });

  it("drops a stashed location that only reads as a path before parsing", () => {
    // The URL parser strips tab, LF and CR, so this satisfies a "starts with one
    // slash" test and still resolves to https://evil.example.
    localStorage.setItem("p1_return_to", "/\t/evil.example/phish");
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    expect(h.push).not.toHaveBeenCalled();
    expect(localStorage.getItem("p1_return_to")).toBeNull();
    screen.getByTestId("puck");
  });

  it("navigates to the parsed path, not the raw stashed string", () => {
    localStorage.setItem("p1_return_to", "/blog/hello?draft=1#top");
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    expect(h.push).toHaveBeenCalledWith("/blog/hello?draft=1#top");
  });

  it("stays put when nothing was stashed", () => {
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    expect(h.push).not.toHaveBeenCalled();
    screen.getByTestId("puck");
  });
});

describe("document navigation", () => {
  it("opens a selected document through the editor route", () => {
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    lastEditorOptions().pluginOptions.onDocumentSelect("/blog/post");
    expect(h.push).toHaveBeenCalledWith("/p1/blog/post");
  });

  it("tells the plugin which document is open", () => {
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    expect(lastEditorOptions().pluginOptions.selectedDocumentPath).toBe("/about");
  });
});

describe("customization slots", () => {
  it("uses the supplied sign-in page while signed out", () => {
    h.state.authenticated = false;
    const Client = createP1EditorClient({
      puckConfig,
      signInPage: <div data-testid="custom-sign-in" />,
    });
    render(<Client />);

    screen.getByTestId("custom-sign-in");
    expect(screen.queryByTestId("default-login")).toBeNull();
  });

  it("falls back to the built-in sign-in page", () => {
    h.state.authenticated = false;
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);

    screen.getByTestId("default-login");
  });

  it("wraps the editor in app-owned providers inside the auth gate", () => {
    const Client = createP1EditorClient({
      puckConfig,
      wrapEditor: (children) => <div data-testid="app-provider">{children}</div>,
    });
    render(<Client />);

    const provider = screen.getByTestId("app-provider");
    expect(screen.getByTestId("p1-app").contains(provider)).toBe(true);
    expect(provider.contains(screen.getByTestId("puck"))).toBe(true);
  });

  it("appends app plugins after the ones P1 supplies", () => {
    const appPlugin = { name: "app-plugin" };
    const Client = createP1EditorClient({ puckConfig, plugins: [appPlugin] as never });
    render(<Client />);

    expect(lastEditorOptions().additionalPlugins).toEqual([h.p1Plugin, appPlugin]);
  });

  it("merges app plugin and override options over the defaults", () => {
    const onPublishSuccess = vi.fn();
    const Client = createP1EditorClient({
      puckConfig,
      pluginOptions: { logoUrl: "/logo.svg" },
      overrideOptions: { onPublishSuccess },
    });
    render(<Client />);

    const opts = lastEditorOptions();
    expect(opts.pluginOptions.logoUrl).toBe("/logo.svg");
    expect(opts.pluginOptions.siteId).toBe("site-1");
    expect(opts.overrideOptions.showDefaultPublish).toBe(false);
    expect(opts.overrideOptions.onPublishSuccess).toBe(onPublishSuccess);
  });

  it("starts in the requested content role", () => {
    const Client = createP1EditorClient({ puckConfig, userRole: "admin" });
    render(<Client />);

    expect(screen.getByTestId("p1-app").getAttribute("data-user-role")).toBe("admin");
  });

  it("keeps the role picker out of the page unless asked for", () => {
    const Client = createP1EditorClient({ puckConfig });
    render(<Client />);
    expect(screen.queryByTestId("p1-role-switcher")).toBeNull();
  });

  it("offers every content role the editor understands", () => {
    const Client = createP1EditorClient({ puckConfig, roleSwitcher: true });
    render(<Client />);

    const options = Array.from(
      screen.getByTestId("p1-role-switcher").querySelectorAll("option"),
    ).map((o) => o.value);
    expect(options).toEqual(["admin", "editor", "author", "junior-editor"]);
  });

  it("re-renders the editor as the role the picker selects", () => {
    const Client = createP1EditorClient({ puckConfig, roleSwitcher: true });
    render(<Client />);

    const select = screen.getByTestId("p1-role-switcher").querySelector("select")!;
    fireEvent.change(select, { target: { value: "junior-editor" } });

    expect(screen.getByTestId("p1-app").getAttribute("data-user-role")).toBe("junior-editor");
  });
});

describe("render-time extensions", () => {
  it("contributes plugins, plugin options and overrides worked out during render", () => {
    const flagPlugin = { name: "flag-plugin" };
    const Client = createP1EditorClient({
      puckConfig,
      pluginOptions: { logoUrl: "/logo.svg" },
      useExtensions: ({ path }) => ({
        plugins: [flagPlugin] as never,
        pluginOptions: { selectedDocumentPath: `${path}?live` } as never,
        overrideOptions: { showDefaultPublish: true },
      }),
    });
    render(<Client />);

    const opts = lastEditorOptions();
    expect(opts.additionalPlugins).toEqual([h.p1Plugin, flagPlugin]);
    expect(opts.pluginOptions.logoUrl).toBe("/logo.svg");
    expect(opts.pluginOptions.selectedDocumentPath).toBe("/about?live");
    expect(opts.overrideOptions.showDefaultPublish).toBe(true);
  });

  it("can open another document from the context it is handed", () => {
    let open: ((p: string) => void) | undefined;
    const Client = createP1EditorClient({
      puckConfig,
      useExtensions: ({ openDocument }) => {
        open = openDocument;
        return {};
      },
    });
    render(<Client />);

    open!("/blog/created");
    expect(h.push).toHaveBeenCalledWith("/p1/blog/created");
  });

  it("remounts the canvas when the key suffix changes", () => {
    let suffix = "-a";
    const Client = createP1EditorClient({
      puckConfig,
      useExtensions: () => ({ editorKeySuffix: suffix }),
    });
    const { rerender } = render(<Client />);
    const before = screen.getByTestId("puck").getAttribute("data-instance");

    rerender(<Client />);
    expect(screen.getByTestId("puck").getAttribute("data-instance")).toBe(before);

    suffix = "-b";
    rerender(<Client />);
    expect(screen.getByTestId("puck").getAttribute("data-instance")).not.toBe(before);
  });
});
