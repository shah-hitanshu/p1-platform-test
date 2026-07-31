import { P1ContentClient } from "@pantheon-systems/css-client/content";
import { NextResponse } from "next/server";

export interface P1MiddlewareConfig {
  cssBaseUrl: string;
  apiToken: string;
  siteId: string;
}

const SKIP_PREFIXES = ["/p1/", "/_next/", "/api/"];

export function createP1Middleware(config: P1MiddlewareConfig) {
  const client = new P1ContentClient({
    baseUrl: config.cssBaseUrl,
    apiToken: config.apiToken,
    siteId: config.siteId,
  });

  return async function p1Middleware(request: Request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    for (const prefix of SKIP_PREFIXES) {
      if (pathname.startsWith(prefix)) {
        return NextResponse.next();
      }
    }

    try {
      const redirect = await client.getRedirect(pathname);
      if (redirect !== null) {
        const isAbsolute = redirect.destination.startsWith("http://") || redirect.destination.startsWith("https://") || redirect.destination.startsWith("//");
        const destination = isAbsolute
          ? redirect.destination
          : new URL(redirect.destination, url.origin).toString();
        const validStatusCodes = [301, 302, 303, 307, 308];
        const statusCode = validStatusCodes.includes(redirect.statusCode) ? redirect.statusCode : 301;
        const destinationUrl = new URL(destination);
        // Preserve original query parameters
        if (url.search) {
          url.searchParams.forEach((value, key) => {
            if (!destinationUrl.searchParams.has(key)) {
              destinationUrl.searchParams.set(key, value);
            }
          });
        }
        return NextResponse.redirect(destinationUrl.toString(), statusCode);
      }
    } catch (error) {
      console.error('[P1 Middleware] Redirect lookup failed:', error);
    }

    return NextResponse.next();
  };
}
