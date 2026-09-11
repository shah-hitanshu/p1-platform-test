// @vitest-environment jsdom
/**
 * The provider decides whether the editor's identity is sent to LaunchDarkly at all, so
 * both branches of that decision are pinned here: an emptied client-side ID has to leave
 * the tree unwrapped, with no client constructed.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ldProps: [] as Record<string, unknown>[],
  state: {
    user: { id: "user-1", name: "Ed Editor", email: "editor@example.com" } as {
      id: string;
      name: string;
      email?: string;
    } | null,
  },
}));

vi.mock("launchdarkly-react-client-sdk", () => ({
  LDProvider: ({ children, ...props }: { children: React.ReactNode }) => {
    h.ldProps.push(props);
    return <div data-testid="ld-provider">{children}</div>;
  },
}));

vi.mock("@pantheon-systems/puck-css", () => ({
  useP1Auth: () => ({ user: h.state.user }),
}));

import { DEFAULT_CLIENT_SIDE_ID, P1ChatbotProvider } from "../chatbot/P1ChatbotProvider";

const renderProvider = () =>
  render(
    <P1ChatbotProvider>
      <span data-testid="editor">editor</span>
    </P1ChatbotProvider>,
  );

beforeEach(() => {
  h.ldProps.length = 0;
  h.state.user = { id: "user-1", name: "Ed Editor", email: "editor@example.com" };
  vi.stubEnv("NEXT_PUBLIC_LD_CLIENT_ID", undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("P1ChatbotProvider", () => {
  it("evaluates the rollout with the client-side ID the package ships", () => {
    renderProvider();

    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(h.ldProps).toHaveLength(1);
    expect(h.ldProps[0].clientSideID).toBe(DEFAULT_CLIENT_SIDE_ID);
  });

  it("treats an emptied client-side ID as opting out, not as asking for the default", () => {
    vi.stubEnv("NEXT_PUBLIC_LD_CLIENT_ID", "");

    renderProvider();

    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.queryByTestId("ld-provider")).toBeNull();
    expect(h.ldProps).toEqual([]);
  });

  it("uses a supplied client-side ID in place of the shipped one", () => {
    vi.stubEnv("NEXT_PUBLIC_LD_CLIENT_ID", "someone-elses-id");

    renderProvider();

    expect(h.ldProps[0].clientSideID).toBe("someone-elses-id");
  });

  it("evaluates the flag for the signed-in editor", () => {
    renderProvider();

    expect(h.ldProps[0].context).toEqual({
      kind: "user",
      key: "editor@example.com",
      email: "editor@example.com",
    });
  });

  // The flag key contains dashes; camel-casing them would make the lookup miss silently.
  it("keeps flag keys verbatim", () => {
    renderProvider();

    expect(h.ldProps[0].reactOptions).toEqual({ useCamelCaseFlagKeys: false });
  });
});
