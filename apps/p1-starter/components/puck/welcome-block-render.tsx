"use client";

import { useEffect, useState } from "react";
import { P1Lockup } from "../p1-lockup";

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

const BTN_PRIMARY =
  "inline-flex items-center justify-center h-12 px-6 gap-2 rounded-full border border-[#1a1a2e] bg-[#1a1a2e] text-white font-['Inter',system-ui,sans-serif] text-lg font-medium leading-none whitespace-nowrap cursor-pointer transition-colors duration-200 hover:bg-[#2d2d44] hover:border-[#2d2d44] focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-600 focus-visible:outline-offset-1 disabled:opacity-40 disabled:cursor-not-allowed";

const BTN_SECONDARY =
  "inline-flex items-center justify-center h-12 px-6 gap-2 rounded-full border border-[#d0d0d8] bg-transparent text-[#1a1a2e] font-['Inter',system-ui,sans-serif] text-lg font-medium leading-none whitespace-nowrap cursor-pointer transition-colors duration-200 hover:bg-[rgba(26,26,46,0.06)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-600 focus-visible:outline-offset-1";

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
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline">$1</a>',
  );

  return (
    <div className="w-full max-w-[620px] mx-auto flex flex-col items-center text-center px-8 py-16 font-['Inter',system-ui,sans-serif] text-[#1a1a2e] min-h-screen justify-center">
      {props.showLogo !== false && <P1Lockup />}
      <h1 className="text-[2.5rem] leading-[1.08] font-semibold m-0 mb-4">
        {activeHeading}
      </h1>
      <p className="text-base leading-6 text-[#5a5a6e] max-w-[54ch] m-0">
        {activeDescription}
      </p>
      <div className="flex gap-3 mt-8 justify-center">
        <button
          className={BTN_PRIMARY}
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
            className={BTN_SECONDARY}
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
          className="mt-12 text-sm text-[#5a5a6e]"
          dangerouslySetInnerHTML={{ __html: footnoteHtml }}
        />
      )}
    </div>
  );
}
