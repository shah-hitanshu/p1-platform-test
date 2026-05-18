// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

const mockUseP1Auth = vi.fn();

vi.mock("@pantheon-systems/puck-css", () => ({
  createNextConfig: () => ({
    authMode: "broker",
    baseUrl: "https://css.example.com",
  }),
  P1AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
  useP1Auth: () => mockUseP1Auth(),
}));

vi.mock("@pantheon-systems/puck-css/auth-gate", () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-gate">{children}</div>
  ),
}));

import { P1AuthShell } from "../P1AuthShell";

describe("P1AuthShell", () => {
  beforeEach(() => {
    mockUseP1Auth.mockReturnValue({
      user: null,
      logout: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders children inside auth providers when config is valid", () => {
    render(
      <P1AuthShell>
        <div data-testid="child">Editor</div>
      </P1AuthShell>,
    );
    expect(screen.getByTestId("auth-provider")).toBeDefined();
    expect(screen.getByTestId("auth-gate")).toBeDefined();
    expect(screen.getByTestId("child")).toBeDefined();
  });

  it("renders user bar with name and logout when authenticated", () => {
    mockUseP1Auth.mockReturnValue({
      user: { id: "u1", name: "Alice", email: "alice@example.com" },
      logout: vi.fn(),
    });

    render(
      <P1AuthShell>
        <div>Editor</div>
      </P1AuthShell>,
    );

    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Log out")).toBeDefined();
  });

  it("does not render user bar when no user is authenticated", () => {
    render(
      <P1AuthShell>
        <div>Editor</div>
      </P1AuthShell>,
    );

    expect(screen.queryByText("Log out")).toBeNull();
  });
});
