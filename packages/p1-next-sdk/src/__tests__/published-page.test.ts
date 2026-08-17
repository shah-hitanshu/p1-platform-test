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
