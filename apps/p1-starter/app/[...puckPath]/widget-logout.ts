import type { LogoutOutcome } from "@pantheon-systems/puck-css";

export type WidgetLogoutEffects = {
  logout: () => Promise<LogoutOutcome>;
  navigate: (url: string) => void;
  reload: () => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
};

/**
 * Runs one logout attempt for the widget. Kept outside the component so each
 * outcome — navigate away, stay and explain, reload — can be exercised without
 * a browser.
 */
export async function runWidgetLogout(fx: WidgetLogoutEffects): Promise<void> {
  fx.setBusy(true);
  fx.setError(null);
  try {
    const outcome = await fx.logout();
    if (outcome.status === "signed_out") {
      fx.navigate(outcome.logoutUrl);
      return; // navigation takes over
    }
    if (outcome.status === "error") {
      // Still signed in and retryable — keep the menu open and say why.
      fx.setError(outcome.message);
      fx.setBusy(false);
      return;
    }
    fx.reload(); // no_session: drop any stale widget state
  } catch (err) {
    fx.setError(err instanceof Error ? err.message : "Logout failed");
    fx.setBusy(false);
  }
}
