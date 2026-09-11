"use client";

import { useEffect, useState } from "react";

const RETURN_TO_KEY = "p1_return_to";

/**
 * Resolved against the current origin rather than matched as a prefix. The URL
 * parser strips tab, LF and CR before parsing, so `/\t/evil.example` satisfies
 * any lexical "starts with one slash" test and still leaves the site; parsing
 * settles it the same way the browser will. Returns the normalised path, so the
 * value that gets navigated to is the one that was checked.
 */
function sameOriginPath(returnTo: string): string | null {
  try {
    const url = new URL(returnTo, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Signing in leaves the browser on the route it bounced through, so the page the
 * reader came from is stashed before the redirect and claimed here. Anything on
 * the origin can write the store it comes out of, which makes the stashed value
 * a request rather than a destination.
 *
 * Returns whether a redirect is under way, so the caller can show that instead
 * of mounting an editor it is about to navigate away from.
 */
export function useReturnToRedirect(router: { push: (href: string) => void }): boolean {
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const returnTo = localStorage.getItem(RETURN_TO_KEY);
    if (!returnTo) return;
    localStorage.removeItem(RETURN_TO_KEY);
    const href = sameOriginPath(returnTo);
    if (!href) return;
    setRedirecting(true);
    router.push(href);
  }, [router]);

  return redirecting;
}
