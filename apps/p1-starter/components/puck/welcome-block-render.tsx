"use client";

import { useEffect, useState } from "react";
import { P1Lockup } from "../p1-lockup";
import styles from "../welcome-block.module.css";

export interface WelcomeBlockRenderProps {
  heading?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  footnote?: string;
  loggedInHeading?: string;
  loggedInDescription?: string;
  loggedInCtaLabel?: string;
  loggedInCtaHref?: string;
  loggedInSecondaryLabel?: string;
  loggedInFootnote?: string;
  showLogo?: boolean;
}

const LOGGED_IN_DEFAULTS = {
  heading: "Welcome to your new Pantheon P1 Site.",
  description:
    "You just created this new site from Pantheon P1 starter kit, congrats! Start editing this page or visit the P1 dashboard to manage your site.",
  ctaLabel: "Edit this page with P1 Visual Editor",
  ctaHref: "/p1",
  secondaryLabel: "Go to P1 Dashboard",
  secondaryHref: process.env.NEXT_PUBLIC_P1_ADMIN_DASHBOARD_URL || "https://content.pantheon.io",
  footnote:
    "Visit [P1 documentation](https://docs.pantheon.io) for more information.",
};

export function WelcomeBlockRender(props: WelcomeBlockRenderProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem("p1_logged_in"));
  }, []);

  const activeHeading = isLoggedIn
    ? (props.loggedInHeading || LOGGED_IN_DEFAULTS.heading)
    : props.heading;
  const activeDescription = isLoggedIn
    ? (props.loggedInDescription || LOGGED_IN_DEFAULTS.description)
    : props.description;
  const activeCtaLabel = isLoggedIn
    ? (props.loggedInCtaLabel || LOGGED_IN_DEFAULTS.ctaLabel)
    : props.ctaLabel;
  const activeCtaHref = isLoggedIn
    ? (props.loggedInCtaHref || LOGGED_IN_DEFAULTS.ctaHref)
    : props.ctaHref;
  const activeFootnote = isLoggedIn
    ? (props.loggedInFootnote || LOGGED_IN_DEFAULTS.footnote)
    : props.footnote;
  const secondaryLabel = isLoggedIn
    ? (props.loggedInSecondaryLabel || LOGGED_IN_DEFAULTS.secondaryLabel)
    : null;

  const footnoteHtml = (activeFootnote ?? "").replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="$2" target="_blank" rel="noopener noreferrer" class="${styles.link}">$1</a>`,
  );

  return (
    <div className={styles.surface}>
      <div className={styles.inner}>
        {props.showLogo !== false && <P1Lockup />}
        <h1 className={styles.heading}>{activeHeading}</h1>
        <p className={styles.description}>{activeDescription}</p>
        <div className={styles.actions}>
          <button
            className={styles.button}
            onClick={() => {
              if (!isLoggedIn) {
                localStorage.setItem("p1_return_to", window.location.pathname);
              }
              window.location.href = activeCtaHref || "/";
            }}
          >
            {activeCtaLabel}
          </button>
          {secondaryLabel && (
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={() => {
                window.open(LOGGED_IN_DEFAULTS.secondaryHref, "_blank", "noopener,noreferrer");
              }}
            >
              {secondaryLabel}
            </button>
          )}
        </div>
        {activeFootnote && (
          <p
            className={styles.footnote}
            dangerouslySetInnerHTML={{ __html: footnoteHtml }}
          />
        )}
      </div>
    </div>
  );
}
