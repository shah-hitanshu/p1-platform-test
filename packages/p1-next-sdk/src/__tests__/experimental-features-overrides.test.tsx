// @vitest-environment jsdom
/**
 * A local override has to be a definite answer that beats LaunchDarkly, and has to be
 * absent from a production build — the point of it is that nothing reaches a deployed
 * site, so "does not apply in production" is the case that matters most here.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  initialize: vi.fn(),
  flags: {} as Record<string, unknown>,
}));

vi.mock("launchdarkly-js-client-sdk", () => ({
  initialize: (clientSideId: string, context: unknown, options: unknown) => {
    h.initialize(clientSideId, context, options);
    return {
      waitForInitialization: () => Promise.resolve(),
      allFlags: () => h.flags,
      close: () => Promise.resolve(),
    };
  },
}));

import { useP1ExperimentalFeatures } from "../experimental-features";
import { resetFeatureCache } from "../experimental-features/session-cache";

const threads = () =>
  renderHook(() => useP1ExperimentalFeatures({ userId: "editor@example.com", siteId: "site-1" }));

async function resolvedThreads(): Promise<boolean> {
  const { result } = threads();
  await waitFor(() => expect(result.current.resolved).toBe(true));
  return result.current.isEnabled("threads");
}

beforeEach(() => {
  resetFeatureCache();
  h.initialize.mockReset();
  h.flags = {};
  vi.stubEnv("NEXT_PUBLIC_LD_CLIENT_ID", "test-client-id");
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local flag overrides", () => {
  it("turns a feature on from a list of flag keys", async () => {
    vi.stubEnv("NEXT_PUBLIC_P1_FLAG_OVERRIDES", "p1-collaboration");

    await expect(resolvedThreads()).resolves.toBe(true);
  });

  // The spelling a worker's own overrides use, so one value can serve both once
  // something on the server gates this too.
  it("accepts the object spelling as well", async () => {
    vi.stubEnv("NEXT_PUBLIC_P1_FLAG_OVERRIDES", '{"p1-collaboration":true}');

    await expect(resolvedThreads()).resolves.toBe(true);
  });

  it("never asks LaunchDarkly once every feature is answered locally", async () => {
    vi.stubEnv("NEXT_PUBLIC_P1_FLAG_OVERRIDES", "p1-collaboration");

    await resolvedThreads();

    expect(h.initialize).not.toHaveBeenCalled();
  });

  it("beats a flag LaunchDarkly says is on", async () => {
    h.flags = { "p1-collaboration": true };
    vi.stubEnv("NEXT_PUBLIC_P1_FLAG_OVERRIDES", '{"p1-collaboration":false}');

    await expect(resolvedThreads()).resolves.toBe(false);
  });

  it("does not apply in a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_P1_FLAG_OVERRIDES", "p1-collaboration");

    await expect(resolvedThreads()).resolves.toBe(false);
    expect(h.initialize).toHaveBeenCalled();
  });

  it("ignores a key that gates nothing, and still asks LaunchDarkly", async () => {
    h.flags = { "p1-collaboration": true };
    vi.stubEnv("NEXT_PUBLIC_P1_FLAG_OVERRIDES", "p1-nonsense");

    await expect(resolvedThreads()).resolves.toBe(true);
    expect(h.initialize).toHaveBeenCalled();
  });

  it("ignores a malformed object rather than failing the editor", async () => {
    vi.stubEnv("NEXT_PUBLIC_P1_FLAG_OVERRIDES", '{"p1-collaboration":');

    await expect(resolvedThreads()).resolves.toBe(false);
    expect(h.initialize).toHaveBeenCalled();
  });

  it("ignores a value that is not a boolean", async () => {
    vi.stubEnv("NEXT_PUBLIC_P1_FLAG_OVERRIDES", '{"p1-collaboration":"true"}');

    await expect(resolvedThreads()).resolves.toBe(false);
    expect(h.initialize).toHaveBeenCalled();
  });
});
