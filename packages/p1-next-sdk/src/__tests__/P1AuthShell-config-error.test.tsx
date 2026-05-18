// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@pantheon-systems/puck-css", () => ({
  createNextConfig: () => {
    throw new Error('Missing required env: NEXT_PUBLIC_CSS_BASE_URL');
  },
  P1AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useP1Auth: () => ({ user: null, logout: vi.fn() }),
}));

vi.mock("@pantheon-systems/puck-css/auth-gate", () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { P1AuthShell } from "../P1AuthShell";

describe("P1AuthShell config error", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders config error page when createNextConfig throws", () => {
    render(
      <P1AuthShell>
        <div data-testid="child">Editor</div>
      </P1AuthShell>,
    );

    expect(screen.getByText("Configuration Required")).toBeDefined();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("displays the error message from createNextConfig", () => {
    render(
      <P1AuthShell>
        <div>Editor</div>
      </P1AuthShell>,
    );

    expect(
      screen.getByText("Missing required env: NEXT_PUBLIC_CSS_BASE_URL"),
    ).toBeDefined();
  });
});
