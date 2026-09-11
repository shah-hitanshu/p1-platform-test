"use client";

import { useP1Auth } from "@pantheon-systems/puck-css";

import { P1Lockup } from "./p1-lockup";
import styles from "./welcome-block.module.css";

export function P1SignInPage() {
  const { login, isLoading, error } = useP1Auth();

  return (
    <div className={styles.surface}>
      <div className={styles.inner}>
        <P1Lockup />

        <h1 className={styles.heading}>
          Your Collaborative Website Management Workspace.
        </h1>
        <p className={styles.description}>
          Log in to your Pantheon P1 account to edit your P1 powered website.
          If you don&apos;t have yet a Pantheon P1 account, contact us{" "}
          <a href="https://pantheon.io/contact-us" className={styles.link}>here</a>.
        </p>

        <div className={styles.actions}>
          <button
            className={styles.button}
            onClick={() => void login()}
            disabled={isLoading}
          >
            {isLoading ? "Signing in..." : "Continue"}
          </button>
        </div>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
