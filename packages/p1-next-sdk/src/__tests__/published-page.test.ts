import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPage = vi.fn();
const connection = vi.fn();
const ensureInitialized = vi.fn().mockResolvedValue(undefined);
const listRouteTemplateKeysFromDatabase = vi.fn().mockResolvedValue([]);

vi.mock("@pantheon-systems/puck-css/server", () => ({
  ensureInitialized,
  getPage,
  listRouteTemplateKeysFromDatabase,
}));

vi.mock("next/server", () => ({ connection }));

// cache() memoizes per request scope; outside one it passes calls through, which
// is what lets these assertions count calls directly.
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

async function load() {
  return (await import("../published-page")).loadPublishedPage;
}

describe("loadPublishedPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ensureInitialized.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports published data as ok", async () => {
    const data = { root: { props: {} }, content: [] };
    getPage.mockResolvedValue(data);
    expect(await (await load())("/blog")).toEqual({ status: "ok", data });
  });

  // The distinction is what lets the renderer 404 a miss without 404ing a live
  // page during an outage: a miss is cacheable as a 404, an outage is not
  // cacheable at all.
  it("reports a path with no page as missing, not unavailable", async () => {
    getPage.mockResolvedValue(null);
    expect(await (await load())("/nope")).toEqual({ status: "missing" });
    expect(connection).not.toHaveBeenCalled();
  });

  it("reports a backend failure as unavailable and defers the render", async () => {
    getPage.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect(await (await load())("/down")).toEqual({ status: "unavailable" });
    expect(connection).toHaveBeenCalled();
  });

  // The denylist lives here rather than in the renderer's page.tsx: that file is
  // forkable user land, so a customer who rewrites it would otherwise publish
  // every registry and redirect document as a live page.
  describe("internal paths", () => {
    it.each([
      "/_registry",
      "/_registry/components/Hero",
      "/_redirects",
      "/_redirects/old-page",
      // Lower-cased before matching because the server normalizes document
      // paths the same way, so this resolves the same record as /_redirects/x.
      "/_Redirects/old-page",
    ])("reports %s as missing without reading the backend", async (path) => {
      expect(await (await load())(path)).toEqual({ status: "missing" });
      expect(getPage).not.toHaveBeenCalled();
      expect(ensureInitialized).not.toHaveBeenCalled();
    });

    // Prefix matching is on segment boundaries, so a real page whose slug merely
    // starts with a reserved word still renders.
    it("does not refuse a path that only shares a prefix", async () => {
      const data = { root: { props: {} }, content: [] };
      getPage.mockResolvedValue(data);
      expect(await (await load())("/_registry-guide")).toEqual({
        status: "ok",
        data,
      });
    });

    it("refuses additional prefixes passed by the caller", async () => {
      const loadPublishedPage = await load();
      const options = { internalPathPrefixes: ["/_private"] };

      expect(await loadPublishedPage("/_private/notes", options)).toEqual({
        status: "missing",
      });
      expect(getPage).not.toHaveBeenCalled();
    });

    // Additive on purpose: a caller supplying its own list must not be able to
    // un-block the built-in namespaces by omitting them.
    it("keeps the built-in prefixes when the caller passes its own", async () => {
      expect(
        await (await load())("/_registry/components/Hero", {
          internalPathPrefixes: ["/_private"],
        }),
      ).toEqual({ status: "missing" });
      expect(getPage).not.toHaveBeenCalled();
    });
  });

  // The DAL clears its own init state on failure so the next call retries.
  // Awaiting a module-level promise instead would pin a failed cold start
  // forever, serving the empty state from every render until the process
  // restarted.
  it("awaits initialization per read so a failed init can recover", async () => {
    ensureInitialized.mockRejectedValueOnce(new Error("import failed"));
    getPage.mockResolvedValue({ root: { props: {} }, content: [] });
    const loadPublishedPage = await load();

    expect(await loadPublishedPage("/cold")).toEqual({ status: "unavailable" });
    expect((await loadPublishedPage("/warm")).status).toBe("ok");
    expect(ensureInitialized).toHaveBeenCalledTimes(2);
  });
});
