/**
 * The editor now renders from `pages.Layout`, not `pages.Page`. A consumer who
 * upgraded but still has only the old page-based route (no `(editor)/layout.tsx`)
 * gets a silently-empty editor. `pages.Page` detects that case — it rendered but
 * `pages.Layout` never did — and emits a one-time dev-only warning pointing at
 * the codemod and migration guide. It must stay silent in production and once
 * the layout is correctly mounted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@pantheon-systems/puck-css/server", () => ({
  ensureInitialized: () => Promise.resolve(),
}));

import { createP1Pages } from "../pages-handler";

function makePages() {
  return createP1Pages({
    config: {} as never,
    EditorClient: () => null,
  } as never);
}

describe("createP1Pages legacy-structure dev warning", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns when Page renders and Layout never did (legacy page-only setup)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const pages = makePages();

    pages.Page();

    expect(console.warn).toHaveBeenCalledTimes(1);
    const msg = (console.warn as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as string;
    expect(msg).toContain("pages.Layout");
    expect(msg).toContain("p1-migrate");
  });

  it("does not warn once Layout has rendered", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const pages = makePages();

    await pages.Layout({ children: null });
    pages.Page();

    expect(console.warn).not.toHaveBeenCalled();
  });

  it("never warns in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const pages = makePages();

    pages.Page();

    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns at most once even if Page renders repeatedly", () => {
    vi.stubEnv("NODE_ENV", "development");
    const pages = makePages();

    pages.Page();
    pages.Page();
    pages.Page();

    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
