// @vitest-environment jsdom
/**
 * The hook decides what a caller is allowed to see, so what matters is that "off" is
 * what every unknown looks like, and that one answer is resolved per session rather
 * than per caller.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  initialize: vi.fn(),
  flags: {} as Record<string, unknown>,
  initializeFails: false,
  initializeThrows: false,
  close: vi.fn(),
}));

vi.mock("launchdarkly-js-client-sdk", () => ({
  initialize: (clientSideId: string, context: unknown, options: unknown) => {
    h.initialize(clientSideId, context, options);
    if (h.initializeThrows) {
      throw new Error("bad client-side id");
    }
    return {
      waitForInitialization: () =>
        h.initializeFails
          ? Promise.reject(new Error("unreachable"))
          : Promise.resolve(),
      allFlags: () => h.flags,
      close: () => {
        h.close();
        return Promise.resolve();
      },
    };
  },
}));

import { useP1ExperimentalFeatures } from "../experimental-features";
import { resetFeatureCache } from "../experimental-features/session-cache";

const render = (userId: string | null, siteId?: string | null) =>
  renderHook(() => useP1ExperimentalFeatures({ userId, siteId }));

beforeEach(() => {
  resetFeatureCache();
  h.initialize.mockClear();
  h.close.mockClear();
  h.flags = {};
  h.initializeFails = false;
  h.initializeThrows = false;
  vi.stubEnv("NEXT_PUBLIC_LD_CLIENT_ID", "test-client-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("useP1ExperimentalFeatures", () => {
  it("reports a feature on when its flag is on for this context", async () => {
    h.flags = { "p1-collaboration": true };
    const { result } = render("editor@example.com", "site-1");

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.isEnabled("threads")).toBe(true);
  });

  it("reports off before LaunchDarkly has answered, so nothing flashes into view", () => {
    h.flags = { "p1-collaboration": true };
    const { result } = render("editor@example.com", "site-1");

    expect(result.current.resolved).toBe(false);
    expect(result.current.isEnabled("threads")).toBe(false);
  });

  it("reports off for a flag LaunchDarkly does not carry", async () => {
    const { result } = render("editor@example.com", "site-1");

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.isEnabled("threads")).toBe(false);
  });

  // An unsynced environment answers with null rather than a boolean, and an
  // unfinished feature has to stay hidden for anything that is not literally true.
  it("reports off for a non-boolean flag value", async () => {
    h.flags = { "p1-collaboration": "true" };
    const { result } = render("editor@example.com", "site-1");

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.isEnabled("threads")).toBe(false);
  });

  it("reports off when LaunchDarkly cannot be reached", async () => {
    h.initializeFails = true;
    const { result } = render("editor@example.com", "site-1");

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.isEnabled("threads")).toBe(false);
  });

  it("reports off when the client cannot even be created, and stays answerable", async () => {
    h.initializeThrows = true;
    const { result } = render("editor@example.com", "site-1");

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.isEnabled("threads")).toBe(false);
  });

  it("evaluates nothing for a reader who is not signed in", () => {
    const { result } = render(null, "site-1");

    expect(h.initialize).not.toHaveBeenCalled();
    expect(result.current.isEnabled("threads")).toBe(false);
  });

  it("evaluates nothing when the client-side ID is empty, the deliberate opt-out", () => {
    vi.stubEnv("NEXT_PUBLIC_LD_CLIENT_ID", "");
    const { result } = render("editor@example.com", "site-1");

    expect(h.initialize).not.toHaveBeenCalled();
    expect(result.current.isEnabled("threads")).toBe(false);
  });

  it("evaluates against the user and the site, so a feature can ramp on either", async () => {
    const { result } = render("editor@example.com", "site-1");

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(h.initialize).toHaveBeenCalledWith(
      "test-client-id",
      {
        kind: "multi",
        user: { key: "editor@example.com" },
        site: { key: "site-1" },
      },
      expect.objectContaining({ streaming: false }),
    );
  });

  it("evaluates against the user alone when there is no site", async () => {
    const { result } = render("editor@example.com");

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(h.initialize).toHaveBeenCalledWith(
      "test-client-id",
      { kind: "user", key: "editor@example.com" },
      expect.objectContaining({ streaming: false }),
    );
  });

  it("resolves once per session however many callers ask", async () => {
    h.flags = { "p1-collaboration": true };

    const first = render("editor@example.com", "site-1");
    await waitFor(() => expect(first.result.current.resolved).toBe(true));

    const second = render("editor@example.com", "site-1");
    expect(second.result.current.resolved).toBe(true);
    expect(second.result.current.isEnabled("threads")).toBe(true);
    expect(h.initialize).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates for a different site, which can ramp differently", async () => {
    const first = render("editor@example.com", "site-1");
    await waitFor(() => expect(first.result.current.resolved).toBe(true));

    const second = render("editor@example.com", "site-2");
    await waitFor(() => expect(second.result.current.resolved).toBe(true));
    expect(h.initialize).toHaveBeenCalledTimes(2);
  });

  it("never shows one site's answer for another, even for a render", async () => {
    h.flags = { "p1-collaboration": true };
    const { result, rerender } = renderHook(
      ({ siteId }: { siteId: string }) =>
        useP1ExperimentalFeatures({ userId: "editor@example.com", siteId }),
      { initialProps: { siteId: "site-1" } },
    );
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.isEnabled("threads")).toBe(true);

    h.flags = {};
    rerender({ siteId: "site-2" });

    expect(result.current.resolved).toBe(false);
    expect(result.current.isEnabled("threads")).toBe(false);
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.isEnabled("threads")).toBe(false);
  });

  // Holding a streaming connection open for a snapshot we never re-read would keep
  // a socket per editor session for nothing.
  it("closes the client once it has answered", async () => {
    const { result } = render("editor@example.com", "site-1");

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(h.close).toHaveBeenCalled();
  });
});
