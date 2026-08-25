/**
 * Interstitial bypass cookies.
 *
 * Hosting platforms may answer browser-like requests with a pre-render
 * interstitial that a capture would record in place of the site.
 */

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

/**
 * Cookies that dismiss a hosting platform's pre-render interstitial. Every
 * entry is sent on each capture scoped to the captured host: the names are
 * platform-specific and inert on hosts that do not read them, and matching on
 * hostname would miss custom domains pointed at a sandbox environment.
 */
export const INTERSTITIAL_BYPASS_COOKIES: readonly { name: string; value: string }[] = [
  // Pantheon sandbox deterrence banner.
  { name: 'Deterrence-Bypass', value: '1' },
];

/**
 * Scope every configured cookie to the URL's host. A cookie domain carrying a
 * port, uppercase, or credentials is never sent, so the host is taken from
 * hostname rather than host. Unparseable URLs capture without cookies rather
 * than failing the capture.
 */
export function bypassCookies(url: string): BrowserCookie[] | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return undefined;
  }

  return INTERSTITIAL_BYPASS_COOKIES.map(
    (cookie) => ({ ...cookie, domain: hostname, path: '/' }),
  );
}
