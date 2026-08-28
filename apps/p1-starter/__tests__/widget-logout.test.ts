import { describe, expect, it } from "vitest";
import type { LogoutOutcome } from "@pantheon-systems/puck-css";
import { runWidgetLogout } from "../app/[...puckPath]/widget-logout";

// Records the effects in order, so each test asserts the whole sequence a
// logout attempt produces rather than one call in isolation.
function recorder(logout: () => Promise<LogoutOutcome>) {
  const calls: string[] = [];
  return {
    calls,
    fx: {
      logout,
      navigate: (url: string) => calls.push(`navigate:${url}`),
      reload: () => calls.push("reload"),
      setBusy: (busy: boolean) => calls.push(`busy:${busy}`),
      setError: (message: string | null) =>
        calls.push(`error:${message ?? "cleared"}`),
    },
  };
}

const LOGOUT_URL = "https://example.auth0.com/v2/logout?client_id=abc";

describe("runWidgetLogout", () => {
  it("navigates to the Auth0 logout URL when the session ended", async () => {
    const { calls, fx } = recorder(async () => ({
      status: "signed_out",
      logoutUrl: LOGOUT_URL,
    }));

    await runWidgetLogout(fx);

    // Stays busy: the navigation replaces the page, so releasing the button
    // would only flash it back to "Log out" on the way out.
    expect(calls).toEqual([
      "busy:true",
      "error:cleared",
      `navigate:${LOGOUT_URL}`,
    ]);
  });

  it("keeps the menu open and shows why when logout failed", async () => {
    const { calls, fx } = recorder(async () => ({
      status: "error",
      message: "Broker logout failed (503)",
    }));

    await runWidgetLogout(fx);

    // Still signed in and retryable, so the button must come back.
    expect(calls).toEqual([
      "busy:true",
      "error:cleared",
      "error:Broker logout failed (503)",
      "busy:false",
    ]);
  });

  it("reloads when there was no session to end", async () => {
    const { calls, fx } = recorder(async () => ({ status: "no_session" }));

    await runWidgetLogout(fx);

    expect(calls).toEqual(["busy:true", "error:cleared", "reload"]);
  });

  it("reports a thrown error instead of leaving the button stuck", async () => {
    const { calls, fx } = recorder(async () => {
      throw new Error("Failed to fetch");
    });

    await runWidgetLogout(fx);

    expect(calls).toEqual([
      "busy:true",
      "error:cleared",
      "error:Failed to fetch",
      "busy:false",
    ]);
  });

  it("falls back to a generic message when something non-Error is thrown", async () => {
    const { calls, fx } = recorder(async () => {
      throw "socket closed";
    });

    await runWidgetLogout(fx);

    expect(calls).toEqual([
      "busy:true",
      "error:cleared",
      "error:Logout failed",
      "busy:false",
    ]);
  });

  it("clears a previous failure before retrying", async () => {
    const { calls, fx } = recorder(async () => ({
      status: "signed_out",
      logoutUrl: LOGOUT_URL,
    }));

    await runWidgetLogout(fx);
    await runWidgetLogout(fx);

    // The second attempt clears the slot again; a stale message must not sit
    // under a logout that is now succeeding.
    expect(calls.slice(3)).toEqual([
      "busy:true",
      "error:cleared",
      `navigate:${LOGOUT_URL}`,
    ]);
  });
});
